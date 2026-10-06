"""Project environment CRUD + AI endpoints (软考项目环境).

Deletion is hard: the env row and its verification detail rows go together;
sessions keep the dangling id and degrade at injection time (same posture as
agent deletion, PDR-004). Every create and every trigger-field edit submits
the async verification job (decision ⑥).
"""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.command_service import CommandService
from api.models import (
    MockGenerateRequest,
    MockGenerateResponse,
    PolishBackgroundRequest,
    PolishBackgroundResponse,
    ProjectEnvCreate,
    ProjectEnvResponse,
    ProjectEnvUpdate,
    ReverifyResponse,
    RewriteClaimRequest,
    RewriteClaimResponse,
    VerificationStatusResponse,
)
from open_notebook.ai.project_env_pipeline import (
    remove_supporting_text,
    render_polish,
    verify_point_lane,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.project_env import (
    TEXT_FIELDS,
    VERIFICATION_TRIGGER_FIELDS,
    ProjectEnv,
)
from open_notebook.domain.project_env_rules import (
    SOURCE_TYPES,
    complete_period,
    validate_period,
)
from open_notebook.exceptions import (
    ConflictError,
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
)

router = APIRouter()

REVERIFY_GUARD = timedelta(minutes=15)
FINAL_POINT_STATES = {"passed", "dismissed", "rewritten", "exempt"}


def _time_warnings(env: ProjectEnv) -> List[Dict[str, Any]]:
    if not (env.period_start and env.period_end):
        return []
    result = validate_period(env.period_start, env.period_end, env.source_type)
    return [v for v in result["violations"] if v.get("severity") == "warn"]


def _env_response(env: ProjectEnv, usage: Dict[str, int]) -> ProjectEnvResponse:
    env_id = str(env.id) if env.id else ""
    return ProjectEnvResponse(
        id=env_id,
        name=env.name,
        background=env.background,
        period_start=env.period_start,
        period_end=env.period_end,
        source_type=env.source_type,
        keywords=env.keywords,
        tech_background=env.tech_background,
        tuning_process=env.tuning_process,
        problems_solutions=env.problems_solutions,
        my_role=env.my_role,
        scale=env.scale,
        draft_content=env.draft_content or None,
        status=env.status,
        ai_assisted=env.ai_assisted,
        time_adjusted=env.time_adjusted,
        time_warnings=_time_warnings(env),
        pending_claims_count=len(env.pending_claims or []),
        session_ref_count=usage.get(env_id, 0),
        verification_progress=env.verification_progress,
        has_snapshot=bool(env.verified_snapshot),
        active_job_id=env.active_job_id,
        created=str(env.created or ""),
        updated=str(env.updated or ""),
    )


async def _session_usage_by_project_env() -> Dict[str, int]:
    rows = await repo_query(
        "SELECT project_env, count() AS total FROM chat_session "
        "WHERE project_env != NONE GROUP BY project_env"
    )
    return {str(row.get("project_env")): int(row.get("total", 0)) for row in rows}


async def _get_env_or_404(env_id: str) -> ProjectEnv:
    try:
        return await ProjectEnv.get(env_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Project env not found")


async def _submit_verification(env: ProjectEnv, mode: str) -> str:
    """Fencing token first, then the job; active_job_id recorded for cancel
    and status joins."""
    token = str(uuid4())
    env.verification_token = token
    await env.save()
    job_id = await CommandService.submit_command_job(
        "open_notebook",
        "verify_project_env",
        {"env_id": str(env.id), "mode": mode, "token": token},
    )
    env.active_job_id = job_id
    await env.save()
    return job_id


async def _cancel_active_job(env: ProjectEnv) -> None:
    if not env.active_job_id:
        return
    try:
        await CommandService.cancel_command_job(env.active_job_id)
    except Exception as e:
        logger.warning(
            f"Could not cancel stale verification job {env.active_job_id}: {e}"
        )


def _check_source_type(source_type: Optional[str]) -> None:
    if source_type and source_type not in SOURCE_TYPES:
        raise HTTPException(
            status_code=400, detail=f"source_type must be one of {SOURCE_TYPES}"
        )


def _reject_period(start: Optional[str], end: Optional[str], source_type: str) -> None:
    """R1 -> 400; R2/R3 blocking (mock) -> 422; real warnings pass through."""
    result = validate_period(start, end, source_type)
    r1 = [v for v in result["violations"] if v["rule"] == "R1"]
    if r1:
        raise HTTPException(status_code=400, detail={"violations": r1})
    blocking = [v for v in result["violations"] if v["severity"] == "block"]
    if blocking:
        raise HTTPException(status_code=422, detail={"violations": blocking})


@router.get("/project-envs", response_model=List[ProjectEnvResponse])
async def get_project_envs(view: str = Query("manage")):
    """view=manage: all statuses (default); view=selectable: verified plus
    needs_review for the session-binding picker, pending/filtered hidden."""
    try:
        envs = await ProjectEnv.get_all(order_by="updated desc")
        if view == "selectable":
            envs = [env for env in envs if env.status in ("verified", "needs_review")]
        usage = await _session_usage_by_project_env()
        return [_env_response(env, usage) for env in envs]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching project envs: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching project envs: {e}")


@router.post("/project-envs", response_model=ProjectEnvResponse)
async def create_project_env(env_data: ProjectEnvCreate):
    try:
        _check_source_type(env_data.source_type)
        _reject_period(env_data.period_start, env_data.period_end, env_data.source_type)
        env = ProjectEnv(
            name=env_data.name.strip(),
            background=env_data.background,
            period_start=env_data.period_start,
            period_end=env_data.period_end,
            source_type=env_data.source_type,
            keywords=env_data.keywords,
            tech_background=env_data.tech_background,
            tuning_process=env_data.tuning_process,
            problems_solutions=env_data.problems_solutions,
            my_role=env_data.my_role,
            scale=env_data.scale,
            status="pending",
        )
        if env_data.background_ai_polished:
            env.ai_assisted = {
                "polish_count": 1,
                "last_polished_at": datetime.now().isoformat(),
            }
        await env.save()
        await _submit_verification(env, "material")
        usage = await _session_usage_by_project_env()
        return _env_response(env, usage)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating project env: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating project env: {e}")


@router.get("/project-envs/{env_id}", response_model=ProjectEnvResponse)
async def get_project_env(env_id: str):
    try:
        env = await _get_env_or_404(env_id)
        usage = await _session_usage_by_project_env()
        return _env_response(env, usage)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching project env {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error fetching project env: {e}")


@router.put("/project-envs/{env_id}", response_model=ProjectEnvResponse)
async def update_project_env(env_id: str, env_update: ProjectEnvUpdate):
    """Nullable fields are cleared by explicit null (model_fields_set).
    Any trigger-field change re-enters pending (old snapshot kept) and
    resubmits verification; name/keywords/source_type never retrigger."""
    try:
        env = await _get_env_or_404(env_id)
        update_data = env_update.model_dump(exclude_unset=True)
        originals = {
            field: getattr(env, field) for field in VERIFICATION_TRIGGER_FIELDS
        }

        _check_source_type(update_data.get("source_type"))
        if update_data.get("name"):
            env.name = update_data["name"].strip()
        for field in (
            "keywords",
            "tuning_process",
            "problems_solutions",
            "my_role",
            "scale",
        ):
            if field in update_data:
                setattr(env, field, update_data[field])
        for field in ("background", "tech_background"):
            if update_data.get(field) is not None:
                setattr(env, field, update_data[field])
        for field in ("period_start", "period_end"):
            if update_data.get(field) is not None:
                setattr(env, field, update_data[field])
        if update_data.get("source_type"):
            env.source_type = update_data["source_type"]

        trigger_changed = any(
            getattr(env, field) != originals[field]
            for field in VERIFICATION_TRIGGER_FIELDS
        )
        if trigger_changed:
            # reject before anything persists
            _reject_period(env.period_start, env.period_end, env.source_type)
            env.status = "pending"
        await env.save()

        if trigger_changed:
            await _cancel_active_job(env)
            await _submit_verification(env, "material")

        usage = await _session_usage_by_project_env()
        return _env_response(env, usage)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating project env {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating project env: {e}")


@router.delete("/project-envs/{env_id}")
async def delete_project_env(env_id: str):
    """Hard delete: the env row plus its verification detail rows. Session
    bindings are never cascaded here; they dangle and degrade at injection."""
    try:
        env = await _get_env_or_404(env_id)
        usage = await _session_usage_by_project_env()
        env_id_str = str(env.id)
        await repo_query(
            "DELETE project_env_verification WHERE project_env = $id",
            {"id": ensure_record_id(env_id_str)},
        )
        await _cancel_active_job(env)
        await env.delete()
        return {"success": True, "affected_sessions": usage.get(env_id_str, 0)}
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting project env {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting project env: {e}")


# --- AI endpoint family (T6) ---

KB_EMPTY_GUIDANCE = (
    "请先在 notebook 导入资料（来源或笔记）后再使用 AI 模拟："
    "模拟与验证依赖本地知识库作为证据源。"
)


async def _knowledge_base_empty() -> bool:
    # GROUP ALL is mandatory: without it SurrealDB applies count() per row
    source_rows = await repo_query("SELECT count() AS total FROM source GROUP ALL")
    note_rows = await repo_query("SELECT count() AS total FROM note GROUP ALL")
    sources = int((source_rows or [{}])[0].get("total", 0))
    notes = int((note_rows or [{}])[0].get("total", 0))
    return sources + notes == 0


@router.post(
    "/project-envs/mock-generate", response_model=MockGenerateResponse, status_code=201
)
async def mock_generate(request: MockGenerateRequest):
    """Create a mock env from keywords and submit the mock pipeline job. The
    narrative fields are generated by the job; the row starts blank."""
    try:
        if await _knowledge_base_empty():
            raise HTTPException(
                status_code=422,
                detail={
                    "message": KB_EMPTY_GUIDANCE,
                    "reason": "knowledge_base_empty",
                },
            )

        period_start: Optional[str] = None
        period_end: Optional[str] = None
        if request.period_start or request.period_end:
            completed = complete_period(request.period_start, request.period_end)
            violations = completed.get("violations") or []
            if violations:
                raise HTTPException(status_code=422, detail={"violations": violations})
            period_start = completed["period_start"]
            period_end = completed["period_end"]
            result = validate_period(period_start, period_end, "mock")
            blocking = [v for v in result["violations"] if v["severity"] == "block"]
            if blocking:
                raise HTTPException(status_code=422, detail={"violations": blocking})

        env = ProjectEnv(
            name=(request.name or "AI 模拟项目").strip(),
            background="",
            period_start=period_start or "",
            period_end=period_end or "",
            source_type="mock",
            keywords=request.keywords,
            tech_background="",
            status="pending",
        )
        await env.save()
        job_id = await _submit_verification(env, "mock")
        return MockGenerateResponse(id=str(env.id), job_id=job_id)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error in mock-generate: {e}")
        raise HTTPException(status_code=500, detail=f"Error in mock-generate: {e}")


@router.post("/project-envs/polish-background", response_model=PolishBackgroundResponse)
async def polish_background(request: PolishBackgroundRequest):
    """Expression-only polish of a background draft; never persisted."""
    try:
        polished = await render_polish(
            background=request.background,
            name=request.name,
            tech_background=request.tech_background,
        )
        return PolishBackgroundResponse(polished=polished)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error polishing background: {e}")
        raise HTTPException(status_code=500, detail=f"Error polishing background: {e}")


async def _latest_run(env_id: str) -> Optional[Dict[str, Any]]:
    rows = await repo_query(
        "SELECT * FROM project_env_verification WHERE project_env = $id "
        "ORDER BY created DESC LIMIT 1",
        {"id": ensure_record_id(env_id)},
    )
    return rows[0] if rows else None


@router.get(
    "/project-envs/{env_id}/verification", response_model=VerificationStatusResponse
)
async def get_verification_status(env_id: str):
    try:
        env = await _get_env_or_404(env_id)
        run = await _latest_run(str(env.id))
        job = None
        if env.active_job_id:
            try:
                status = await CommandService.get_command_status(env.active_job_id)
                job = {
                    "id": env.active_job_id,
                    "status": status.get("status"),
                    "error_message": status.get("error_message"),
                }
            except Exception as e:
                logger.warning(f"Command status lookup failed: {e}")

        # Self-heal an orphaned "pending": a job that ended without writing
        # back (worker restart, manual cancel, crash mid-run) would otherwise
        # pin the UI on a spinning 0% with every action gated behind
        # status === 'pending'. The read repairs it once, permanently.
        # (.value: surreal_commands' CommandStatus is a str-Enum whose str()
        # is "CommandStatus.CANCELED", which would never match here.)
        raw_job_status = (job or {}).get("status")
        job_status = str(getattr(raw_job_status, "value", raw_job_status) or "")
        if env.status == "pending" and job_status in ("canceled", "failed", "completed"):
            reason = {
                "canceled": "验证任务已取消。请点重新验证。",
                "failed": "验证任务执行失败。请点重新验证。",
                "completed": "验证任务已结束但未写回结果。请点重新验证。",
            }[job_status]
            env.status = "failed"
            env.verification_progress = {
                "stage": "done",
                "percent": 100,
                "message": "",
                "error": reason,
                "updated": datetime.now(timezone.utc).isoformat(),
            }
            await env.save()

        return VerificationStatusResponse(
            status=env.status,
            job=job,
            progress=env.verification_progress,
            summary=(run or {}).get("summary"),
            points=(run or {}).get("points") or [],
            degraded=(run or {}).get("degraded"),
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching verification status: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching verification status: {e}"
        )


def _progress_age(env: Optional[Dict[str, Any]]) -> Optional[timedelta]:
    if not env:
        return None
    updated = env.get("updated")
    if not updated:
        return None
    try:
        updated_dt = datetime.fromisoformat(str(updated))
    except ValueError:
        return None
    if updated_dt.tzinfo is not None:
        updated_dt = updated_dt.replace(tzinfo=None)
    return datetime.now() - updated_dt


@router.post("/project-envs/{env_id}/reverify", response_model=ReverifyResponse)
async def reverify(env_id: str):
    """Full re-verification. Concurrent-run guard: a pending env whose
    progress updated within 15 minutes returns 409."""
    try:
        env = await _get_env_or_404(env_id)
        age = _progress_age(env.verification_progress)
        if env.status == "pending" and age is not None and age <= REVERIFY_GUARD:
            raise HTTPException(
                status_code=409,
                detail="A verification run is already in progress for this project env",
            )
        await _cancel_active_job(env)
        env.status = "pending"
        env.pending_claims = None
        await env.save()
        # A mock env that never produced a draft needs the mock pipeline again
        # (draft generation + verification); otherwise verify the material.
        mode = (
            "mock"
            if env.source_type == "mock" and not env.draft_content
            else "material"
        )
        job_id = await _submit_verification(env, mode)
        return ReverifyResponse(job_id=job_id)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error re-verifying project env {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error re-verifying: {e}")


@router.post("/project-envs/{env_id}/regenerate", response_model=ReverifyResponse)
async def regenerate_mock(env_id: str):
    """Mock-only: discard the current draft/fields and regenerate the whole
    environment from its stored keywords (no delete-and-recreate needed).
    Sessions bound to the old snapshot lose the injection (dangling banner)."""
    try:
        env = await _get_env_or_404(env_id)
        if env.source_type != "mock":
            raise HTTPException(
                status_code=422,
                detail={"message": "仅 AI 模拟环境支持重新生成", "reason": "not_mock"},
            )
        if not (env.keywords or []):
            raise HTTPException(
                status_code=422,
                detail={"message": "关键词为空，无法重新生成", "reason": "no_keywords"},
            )
        age = _progress_age(env.verification_progress)
        if env.status == "pending" and age is not None and age <= REVERIFY_GUARD:
            raise HTTPException(
                status_code=409,
                detail="A verification run is already in progress for this project env",
            )
        await _cancel_active_job(env)
        env.status = "pending"
        env.pending_claims = None
        env.draft_content = None
        env.verified_snapshot = None
        for field in (
            "background",
            "tech_background",
            "tuning_process",
            "problems_solutions",
            "my_role",
            "scale",
        ):
            setattr(env, field, "")
        await env.save()
        job_id = await _submit_verification(env, "mock")
        return ReverifyResponse(job_id=job_id)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error regenerating project env {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error regenerating: {e}")


def _find_point(run: Dict[str, Any], point_id: str) -> Dict[str, Any]:
    for point in run.get("points") or []:
        if str(point.get("point_id")) == point_id:
            return point
    raise HTTPException(status_code=404, detail=f"Claim point {point_id} not found")


async def _run_or_404(env: ProjectEnv) -> Dict[str, Any]:
    run = await _latest_run(str(env.id))
    if not run:
        raise HTTPException(status_code=404, detail="Verification run not found")
    return run


def _require_claim_state(env: ProjectEnv, point: Dict[str, Any]) -> None:
    if env.status != "needs_review":
        raise HTTPException(
            status_code=409,
            detail=f"Project env status is {env.status}, expected needs_review",
        )
    if point.get("state") != "manual_review":
        raise HTTPException(
            status_code=409,
            detail=f"Claim point state is {point.get('state')}, expected manual_review",
        )


def _sync_pending_claims(env: ProjectEnv, points: List[Dict[str, Any]]) -> bool:
    """Rebuild pending_claims from unresolved points; True when every point is
    in a final state (eligible to promote to verified)."""
    unresolved = [p for p in points if p.get("state") not in FINAL_POINT_STATES]
    env.pending_claims = [
        {
            "point_id": p.get("point_id"),
            "quote": p.get("quote"),
            "field": p.get("field"),
            "reason_code": p.get("manual_reason") or "lanes_failed",
            "lanes_summary": p.get("lanes"),
        }
        for p in unresolved
    ] or None
    return not unresolved


async def _require_run_token_current(env: ProjectEnv, run: Dict[str, Any]) -> None:
    """Fencing for claim outcomes: re-read the env's token right before the
    write — a rotated token means a newer run owns the env and this edit (and
    its full-field env.save) must be rejected, not clobbered."""
    rows = await repo_query(
        "SELECT verification_token FROM project_env WHERE id = $id",
        {"id": ensure_record_id(str(env.id))},
    )
    current = str((rows[0] or {}).get("verification_token") or "") if rows else ""
    if current != str(run.get("token") or ""):
        raise ConflictError("验证状态已变更，请刷新后重试")


async def _persist_claim_outcome(
    env: ProjectEnv, run: Dict[str, Any], points: List[Dict[str, Any]]
) -> bool:
    """Run row first, then env (write ordering mirrors the command side)."""
    await _require_run_token_current(env, run)
    resolved = _sync_pending_claims(env, points)
    if resolved:
        if env.source_type == "mock" and env.draft_content:
            env.promote_draft()
        env.verified_snapshot = env.build_snapshot()
        env.status = "verified"
    await repo_query(
        "UPDATE $run_id SET points = $points, updated = time::now()",
        {"run_id": ensure_record_id(str(run.get("id"))), "points": points},
    )
    await env.save()
    return resolved


def _regex_remove_sentence(text: str, quote: str) -> Optional[str]:
    """Fallback removal: drop the whole sentence containing the quote."""
    if not text or not quote or quote not in text:
        return None
    idx = text.index(quote)
    start = text.rfind("。", 0, idx) + 1
    end = text.find("。", idx)
    end = len(text) if end == -1 else end + 1
    return (text[:start] + text[end:]).strip() or None


@router.post(
    "/project-envs/{env_id}/claims/{point_id}/dismiss",
    response_model=ProjectEnvResponse,
)
async def dismiss_claim(env_id: str, point_id: str):
    """Dismiss one manual-review claim: remove its supporting text from the
    candidate (light LLM, regex-sentence fallback). Dismissing the last open
    point promotes the env to verified with a refreshed snapshot."""
    try:
        env = await _get_env_or_404(env_id)
        run = await _run_or_404(env)
        point = _find_point(run, point_id)
        _require_claim_state(env, point)

        field = str(point.get("field") or "")
        text = env.text_for(field)
        quote = str(point.get("quote") or "")
        new_text: Optional[str] = None
        try:
            new_text = await remove_supporting_text(text, quote)
        except Exception as e:
            logger.warning(f"LLM removal failed for {point_id}: {e}")
        if not new_text or new_text == text:
            new_text = _regex_remove_sentence(text, quote)
        if new_text is None:
            raise HTTPException(
                status_code=502, detail="Could not remove the supporting statement"
            )
        env.apply_candidate_text(field, new_text)

        point["state"] = "dismissed"
        point.setdefault("rounds", []).append(
            {
                "round": len(point.get("rounds", [])) + 1,
                "action": "dismiss",
                "lane_results": {},
                "verdict": "dismissed",
            }
        )
        await _persist_claim_outcome(env, run, run.get("points") or [])
        usage = await _session_usage_by_project_env()
        return _env_response(env, usage)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error dismissing claim {point_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error dismissing claim: {e}")


def _lane_context(env: ProjectEnv) -> Dict[str, Any]:
    return {
        "period_start": env.period_start,
        "period_end": env.period_end,
        "narrative": "\n\n".join(
            f"[{field}]\n{env.text_for(field)}" for field in TEXT_FIELDS
        ),
        "my_role": env.my_role or "",
        "keywords": env.keywords or [],
    }


@router.post(
    "/project-envs/{env_id}/claims/{point_id}/rewrite",
    response_model=RewriteClaimResponse,
)
async def rewrite_claim(env_id: str, point_id: str, request: RewriteClaimRequest):
    """Rewrite one claim with user text, re-verified through the three lanes
    in parallel. Always 200: fail keeps the point in manual_review and
    returns the lane opinions."""
    try:
        env = await _get_env_or_404(env_id)
        run = await _run_or_404(env)
        point = _find_point(run, point_id)
        _require_claim_state(env, point)

        lane_results = await asyncio.gather(
            *[
                verify_point_lane(
                    lane=lane,
                    quote=request.text,
                    field=str(point.get("field") or ""),
                    context=_lane_context(env),
                )
                for lane in ("A", "B", "C")
            ]
        )
        lanes = dict(zip(("A", "B", "C"), lane_results))
        passed = all(result.get("verdict") == "pass" for result in lane_results)

        point["lanes"] = lanes
        point.setdefault("rounds", []).append(
            {
                "round": len(point.get("rounds", [])) + 1,
                "action": "user_rewrite",
                "lane_results": lanes,
                "corrected_text": request.text,
                "verdict": "pass" if passed else "fail",
            }
        )

        if passed:
            field = str(point.get("field") or "")
            old_quote = str(point.get("quote") or "")
            text = env.text_for(field)
            if old_quote and old_quote in text:
                env.apply_candidate_text(field, text.replace(old_quote, request.text))
                point["state"] = "rewritten"
            else:
                # passing lanes are worthless if the sentence is not in the
                # material: the fix was never applied, so it stays manual
                point["manual_reason"] = "quote_drift"

        await _persist_claim_outcome(env, run, run.get("points") or [])
        usage = await _session_usage_by_project_env()
        return RewriteClaimResponse(
            passed=passed, lanes=lanes, env=_env_response(env, usage)
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error rewriting claim {point_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error rewriting claim: {e}")
