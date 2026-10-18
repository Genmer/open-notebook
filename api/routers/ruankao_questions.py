"""Question-workbench generation endpoint (软考题目工作台生成).

POST /api/ruankao/questions/generate — synchronous, stateless, no path
params: the question data comes from the request body (the question is a
frontend localStorage record, not a server resource, so nothing is looked
up or persisted). Skeleton follows the fixed-parts precedent
(api/routers/project_envs.py generate_fixed_parts): validate →
asyncio.wait_for(render, 600) → map TimeoutError/ValueError to
504 model_timeout / 502 model_error.

POST /api/ruankao/questions/generate/stream — SSE twin of the same render:
forwards every LLM chunk as a ``delta`` event (the workbench renders live
token speed / peak / elapsed from them), then one ``complete`` event whose
result field is byte-identical to the sync endpoint's response, or one
``error`` event (reason=model_timeout|model_error). ``stage`` events
(preparing at stream start, then the pipeline's waiting / thinking /
generating callbacks) report progress while no token has flowed yet —
pacing/throttling can hold the first chunk for tens of seconds. Deliberately
NOT decoupled from the SSE generator's lifetime (unlike chat_stream): the
call is stateless — a client disconnect cancels the model call mid-stream,
which is exactly the promised 关闭弹窗=中断 semantics and saves quota.

Red line (ADR-017): the request carries ONLY exam metadata (title / year /
domain / three question prompts) plus the candidate's own note; the
pipeline does no retrieval, so marked model essays are unreachable by
construction.

POST /ruankao/questions/essay/generate/stream — 整篇生成 (one full essay
draft) SSE endpoint. Same event grammar as the stream twin above (stage /
delta / complete / error + 15s ping + disconnect-cancels-render), except
``complete`` carries the plain-text draft in ``content`` (no JSON product,
so no result wrapping). The one sanctioned red-line extension: the request
also carries env_id, resolved server-side through the SAME async channel
chat uses (api.project_env_service.render_project_env_context — verified
snapshot gate, dangling refs degrade); unresolvable/closed gate raises
422 no_env BEFORE the stream starts. Still no retrieval, no notebook, no
model-essay text — the only added context is the candidate's own project
environment.
"""

import asyncio
import json
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from api.models import (
    BreakdownResult,
    OutlineResult,
    Q2PointsResult,
    QuestionBreakdownAngle,
    QuestionEssayGenerateRequest,
    QuestionGeneratePrompts,
    QuestionGenerateRequest,
    QuestionGenerateResponse,
    QuestionOutlineParagraph,
    QuestionQ2Point,
)
from api.project_env_service import render_project_env_context
from api.routers._chat_shared import resolve_agent_binding
from open_notebook.ai.ruankao_question_pipeline import (
    render_question_breakdown,
    render_question_essay,
    render_question_outline,
    render_question_q2_points,
)
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()

# 实测默认 chat 模型出长文要 3 分钟以上，600 与 fixed-parts/suggest 同款有界
# 超时（再长就该走 worker，ADR-004——本端点按设计稿定稿保持同步）。
QUESTION_GENERATE_TIMEOUT_SECONDS = 600

# SSE keep-alive：首次出 token 前的思考期可能 >30s，15s 一发 `: ping` 注释行
# 防中间层掐连接（chat_stream 同款；前端 watchdog 对任何字节重置）。
_STREAM_KEEPALIVE_SECONDS = 15.0


def _render_kwargs(request: QuestionGenerateRequest) -> Dict[str, Any]:
    """Shared body→render-kwargs mapping (red line: only the five metadata
    fields + note ever cross this boundary)."""
    prompts = request.prompts or QuestionGeneratePrompts()
    return {
        "title": request.title.strip(),
        "year": request.year,
        "domain": request.domain,
        "q1": prompts.q1,
        "q2": prompts.q2,
        "q3": prompts.q3,
        "note": request.note,
    }


def _renderer_for(kind: str) -> Optional[Any]:
    """Call-time resolution (NOT an import-time dict): the tests patch the
    module attributes ``render_question_*`` — a module-level dict would
    capture the originals and silently bypass the patch seam (the exact
    ainvoke-fake lesson from the streaming review batch)."""
    if kind == "breakdown":
        return render_question_breakdown
    if kind == "q2_points":
        return render_question_q2_points
    if kind == "outline":
        return render_question_outline
    return None


def _wrap_result(kind: str, result: Dict[str, Any]) -> QuestionGenerateResponse:
    if kind == "breakdown":
        return BreakdownResult(
            angles=[QuestionBreakdownAngle(**angle) for angle in result["angles"]],
            combo_advice=result["combo_advice"],
        )
    if kind == "q2_points":
        return Q2PointsResult(
            framework=result["framework"],
            points=[QuestionQ2Point(**point) for point in result["points"]],
            outline_hint=result["outline_hint"],
        )
    return OutlineResult(
        paragraphs=[
            QuestionOutlineParagraph(**paragraph) for paragraph in result["paragraphs"]
        ],
    )


@router.post(
    "/ruankao/questions/generate",
    response_model=QuestionGenerateResponse,
)
async def generate_question_workbench(
    request: QuestionGenerateRequest,
) -> QuestionGenerateResponse:
    """Stateless AI generation for one question-workbench product (论点矩阵 /
    问题2要点 / 论点提纲); never persisted — the frontend keeps it in
    localStorage. Red line (ADR-017): exam metadata + note in, no retrieval."""
    try:
        title = request.title.strip()
        if not title:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "题目缺少标题，无法生成",
                    "reason": "no_title",
                },
            )
        prompts = request.prompts or QuestionGeneratePrompts()
        try:
            result: Dict[str, Any]
            if request.kind == "breakdown":
                result = await asyncio.wait_for(
                    render_question_breakdown(
                        title=title,
                        year=request.year,
                        domain=request.domain,
                        q1=prompts.q1,
                        q2=prompts.q2,
                        q3=prompts.q3,
                        note=request.note,
                    ),
                    timeout=QUESTION_GENERATE_TIMEOUT_SECONDS,
                )
                return BreakdownResult(
                    angles=[
                        QuestionBreakdownAngle(**angle) for angle in result["angles"]
                    ],
                    combo_advice=result["combo_advice"],
                )
            if request.kind == "q2_points":
                result = await asyncio.wait_for(
                    render_question_q2_points(
                        title=title,
                        year=request.year,
                        domain=request.domain,
                        q1=prompts.q1,
                        q2=prompts.q2,
                        q3=prompts.q3,
                        note=request.note,
                    ),
                    timeout=QUESTION_GENERATE_TIMEOUT_SECONDS,
                )
                return Q2PointsResult(
                    framework=result["framework"],
                    points=[QuestionQ2Point(**point) for point in result["points"]],
                    outline_hint=result["outline_hint"],
                )
            result = await asyncio.wait_for(
                render_question_outline(
                    title=title,
                    year=request.year,
                    domain=request.domain,
                    q1=prompts.q1,
                    q2=prompts.q2,
                    q3=prompts.q3,
                    note=request.note,
                ),
                timeout=QUESTION_GENERATE_TIMEOUT_SECONDS,
            )
            return OutlineResult(
                paragraphs=[
                    QuestionOutlineParagraph(**paragraph)
                    for paragraph in result["paragraphs"]
                ],
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail={"reason": "model_timeout"})
        except ValueError as e:
            logger.warning(f"Question generation failed for kind={request.kind}: {e}")
            raise HTTPException(status_code=502, detail={"reason": "model_error"})
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error generating question workbench product: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error generating question workbench product: {e}",
        )


@router.post("/ruankao/questions/generate/stream")
async def generate_question_workbench_stream(
    request: QuestionGenerateRequest,
) -> StreamingResponse:
    """SSE twin of the sync endpoint: ``delta`` events (LLM chunks) → one
    ``complete`` (result field = sync response shape) or one ``error``;
    ``stage`` events (preparing → waiting/thinking/generating) fill the
    no-token-yet window. Validation failures raise before the stream starts
    (plain 422 JSON). Client disconnect cancels the render task (stateless —
    nothing to keep)."""
    if not request.title.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "message": "题目缺少标题，无法生成",
                "reason": "no_title",
            },
        )
    renderer = _renderer_for(request.kind)
    if renderer is None:
        raise HTTPException(status_code=422, detail="Unknown generation kind")

    queue: asyncio.Queue = asyncio.Queue()

    def _put_stage(stage: str) -> None:
        queue.put_nowait({"type": "stage", "stage": stage})

    async def _render() -> None:
        def _put_delta(delta: str) -> None:
            queue.put_nowait({"type": "delta", "content": delta})

        try:
            result = await asyncio.wait_for(
                renderer(
                    **_render_kwargs(request),
                    on_delta=_put_delta,
                    on_stage=_put_stage,
                ),
                timeout=QUESTION_GENERATE_TIMEOUT_SECONDS,
            )
            await queue.put(
                {
                    "type": "complete",
                    "result": _wrap_result(request.kind, result).model_dump(),
                }
            )
        except asyncio.CancelledError:
            raise  # client disconnect: propagate, nothing to report
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "reason": "model_timeout"})
        except ValueError as e:
            logger.warning(
                f"Question stream generation failed for kind={request.kind}: {e}"
            )
            await queue.put({"type": "error", "reason": "model_error"})
        except OpenNotebookError as e:
            await queue.put(
                {"type": "error", "reason": "model_error", "message": str(e)}
            )
        except Exception as e:
            logger.error(f"Error streaming question workbench product: {e}")
            await queue.put({"type": "error", "reason": "model_error"})
        finally:
            await queue.put(None)

    async def event_stream():
        # The render task is owned by this generator's scope on purpose: when
        # the client disconnects Starlette cancels the generator, the finally
        # block cancels the task, and the in-flight model call is aborted.
        # "preparing" is queued before the first yield so the client sees the
        # stream is alive even while the first model call is still pending.
        queue.put_nowait({"type": "stage", "stage": "preparing"})
        task = asyncio.create_task(_render())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_STREAM_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/ruankao/questions/essay/generate/stream")
async def generate_question_essay_stream(
    request: QuestionEssayGenerateRequest,
) -> StreamingResponse:
    """SSE 整篇生成: one full plain-text essay draft grounded in the
    candidate's own project environment. Event grammar identical to the
    workbench stream (stage preparing/waiting/thinking/generating → delta →
    complete/error, 15s ping, client disconnect cancels the render); the
    ``complete`` event carries the draft itself in ``content`` (bare-text
    product — no JSON result wrapping). Pre-stream validation: empty title →
    422 no_title; env unresolvable or gate closed → 422 no_env. Stateless —
    nothing is persisted."""
    if not request.title.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "message": "题目缺少标题，无法生成",
                "reason": "no_title",
            },
        )
    env_id = (request.env_id or "").strip()
    # 与 chat 同一条异步取 env 通道 + 验证门渲染（verified snapshot 才可注入；
    # dangling/未验证都拿不到 text）——取不到可注入上下文就在流前 422。
    env_context = await render_project_env_context(env_id)
    env_text = str((env_context or {}).get("text") or "").strip()
    if not env_text:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "未找到可用的项目环境，无法生成整篇论文",
                "reason": "no_env",
            },
        )

    # 模型/提示词模板（=智能体）解析，quick_chat 同款：悬空/禁用智能体降级为
    # 默认（不报错）；模型优先级 显式 model_id > 智能体绑定 > 系统默认。
    agent = await resolve_agent_binding(request.agent_id or None)
    model_id = (request.model_id or "").strip() or (
        agent.model_id if agent is not None else None
    )
    extra_instructions = (
        str(agent.system_prompt or "").strip() if agent is not None else ""
    )

    prompts = request.prompts or QuestionGeneratePrompts()
    queue: asyncio.Queue = asyncio.Queue()

    def _put_stage(stage: str) -> None:
        queue.put_nowait({"type": "stage", "stage": stage})

    async def _render() -> None:
        def _put_delta(delta: str) -> None:
            queue.put_nowait({"type": "delta", "content": delta})

        try:
            content = await asyncio.wait_for(
                render_question_essay(
                    title=request.title.strip(),
                    year=request.year,
                    domain=request.domain,
                    q1=prompts.q1,
                    q2=prompts.q2,
                    q3=prompts.q3,
                    note=request.note,
                    env_id=env_id,
                    env_context=env_text,
                    model_id=model_id,
                    extra_instructions=extra_instructions,
                    on_delta=_put_delta,
                    on_stage=_put_stage,
                ),
                timeout=QUESTION_GENERATE_TIMEOUT_SECONDS,
            )
            await queue.put({"type": "complete", "content": content})
        except asyncio.CancelledError:
            raise  # client disconnect: propagate, nothing to report
        except asyncio.TimeoutError:
            await queue.put({"type": "error", "reason": "model_timeout"})
        except ValueError as e:
            logger.warning(f"Question essay stream generation failed: {e}")
            await queue.put({"type": "error", "reason": "model_error"})
        except OpenNotebookError as e:
            await queue.put(
                {"type": "error", "reason": "model_error", "message": str(e)}
            )
        except Exception as e:
            logger.error(f"Error streaming question essay: {e}")
            await queue.put({"type": "error", "reason": "model_error"})
        finally:
            await queue.put(None)

    async def event_stream():
        # Same lifetime contract as the workbench stream: the render task is
        # owned by this generator, so a client disconnect cancels the in-flight
        # model call (stateless — nothing to keep, quota saved).
        queue.put_nowait({"type": "stage", "stage": "preparing"})
        task = asyncio.create_task(_render())
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_STREAM_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
