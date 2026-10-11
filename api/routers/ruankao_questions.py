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
    QuestionGeneratePrompts,
    QuestionGenerateRequest,
    QuestionGenerateResponse,
    QuestionOutlineParagraph,
    QuestionQ2Point,
)
from open_notebook.ai.ruankao_question_pipeline import (
    render_question_breakdown,
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
