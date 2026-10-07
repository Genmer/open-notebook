"""Project environment CRUD + AI endpoints (软考项目环境).

Deletion is hard: the env row and its verification detail rows go together;
sessions keep the dangling id and degrade at injection time (same posture as
agent deletion, PDR-004). Every create and every trigger-field edit submits
the async verification job (decision ⑥).
"""

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.command_service import CommandService
from api.models import (
    GenericParagraphResponse,
    MaterialsStatusResponse,
    MaterialsSubmitRequest,
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
    SuggestClaimRewriteResponse,
    VerificationStatusResponse,
)
from open_notebook.ai.project_env_pipeline import (
    _find_verbatim,
    prescreen_quote,
    render_generic_paragraph,
    render_polish,
    suggest_rewrite,
    verify_point_lane,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.project_env import (
    DEFAULT_INDUSTRY,
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
RUNNING_MATERIALS_MESSAGE = (
    "A materials generation run is already in progress for this project env"
)
RUNNING_VERIFICATION_MESSAGE = (
    "A verification run is already in progress for this project env"
)


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
        industry=env.industry,
        tech_background=env.tech_background,
        tuning_process=env.tuning_process,
        problems_solutions=env.problems_solutions,
        my_role=env.my_role,
        scale=env.scale,
        generic_paragraph=env.generic_paragraph,
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


async def _submit_materials_job(env: ProjectEnv) -> str:
    """Same fencing pattern as _submit_verification for the candidate job."""
    token = str(uuid4())
    env.verification_token = token
    await env.save()
    job_id = await CommandService.submit_command_job(
        "open_notebook",
        "generate_project_env_materials",
        {"env_id": str(env.id), "token": token},
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
            generic_paragraph=env_data.generic_paragraph,
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
            "generic_paragraph",
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
            # source_type decides the pipeline: a mock env must never run the
            # KB-evidence lane even after an edit of its promoted fields
            await _submit_verification(
                env, "mock" if env.source_type == "mock" else "material"
            )

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


@router.post(
    "/project-envs/mock-generate", response_model=MockGenerateResponse, status_code=201
)
async def mock_generate(request: MockGenerateRequest):
    """Create a mock env from keywords and submit the mock pipeline job. The
    narrative fields are generated by the job; the row starts blank.
    flow="materials" swaps the job for candidate generation (素材/路线候选),
    landing the env in material_ready for the user to pick from."""
    try:
        if request.flow not in ("direct", "materials"):
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "flow 必须是 direct 或 materials",
                    "reason": "invalid_flow",
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
            industry=(request.industry or "").strip() or DEFAULT_INDUSTRY,
            tech_background="",
            status="material_pending" if request.flow == "materials" else "pending",
        )
        await env.save()
        if request.flow == "materials":
            job_id = await _submit_materials_job(env)
        else:
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
        if env.status == "pending" and job_status in (
            "canceled",
            "failed",
            "completed",
        ):
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


def _reject_running_env(env: ProjectEnv) -> None:
    """409 while a fenced run (verification or materials generation) is live.
    An over-age run is an orphan: the caller cancels its job and proceeds."""
    if env.status not in ("pending", "material_pending"):
        return
    age = _progress_age(env.verification_progress)
    if age is None or age > REVERIFY_GUARD:
        return
    if env.status == "material_pending":
        raise HTTPException(status_code=409, detail=RUNNING_MATERIALS_MESSAGE)
    raise HTTPException(status_code=409, detail=RUNNING_VERIFICATION_MESSAGE)


@router.post("/project-envs/{env_id}/reverify", response_model=ReverifyResponse)
async def reverify(env_id: str):
    """Full re-verification. Concurrent-run guard: a pending env whose
    progress updated within 15 minutes returns 409."""
    try:
        env = await _get_env_or_404(env_id)
        _reject_running_env(env)
        await _cancel_active_job(env)
        env.status = "pending"
        env.pending_claims = None
        await env.save()
        # Mock envs always verify through the mock pipeline (B/C lanes, no KB
        # lane); the command (re)generates the draft only when it is missing.
        mode = "mock" if env.source_type == "mock" else "material"
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
        _reject_running_env(env)
        await _cancel_active_job(env)
        env.status = "pending"
        env.pending_claims = None
        env.draft_content = None
        env.verified_snapshot = None
        env.materials_selection = None
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


# --- materials step (素材生成：候选 store 与用户选择) ---


def _materials_error(message: str, reason: str, **extra: Any) -> HTTPException:
    detail: Dict[str, Any] = {"message": message, "reason": reason}
    detail.update(extra)
    return HTTPException(status_code=422, detail=detail)


def _clear_draft_outputs(env: ProjectEnv) -> None:
    """Drop every stale verification artifact so the new run starts clean."""
    env.pending_claims = None
    env.draft_content = None
    env.verified_snapshot = None
    env.materials_selection = None
    for field in (
        "background",
        "tech_background",
        "tuning_process",
        "problems_solutions",
        "my_role",
        "scale",
    ):
        setattr(env, field, "")


@router.get("/project-envs/{env_id}/materials", response_model=MaterialsStatusResponse)
async def get_materials_status(env_id: str):
    """Candidate stores + selection for the wizard's materials step. Real envs
    get an empty store (the frontend hides the flow) instead of an error."""
    try:
        env = await _get_env_or_404(env_id)
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

        # Self-heal an orphaned material_pending (same posture as GET
        # /verification; .value unwraps surreal_commands' str-Enum status).
        raw_job_status = (job or {}).get("status")
        job_status = str(getattr(raw_job_status, "value", raw_job_status) or "")
        if env.status == "material_pending" and job_status in (
            "canceled",
            "failed",
            "completed",
        ):
            reason = {
                "canceled": "素材生成任务已取消。请点重新生成。",
                "failed": "素材生成任务执行失败。请点重新生成。",
                "completed": "素材生成任务已结束但未写回结果。请点重新生成。",
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

        store = env.materials if env.source_type == "mock" else None
        return MaterialsStatusResponse(
            status=env.status,
            job=job,
            progress=env.verification_progress,
            materials=(store or {}).get("materials"),
            routes=(store or {}).get("routes"),
            selection=env.materials_selection,
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching materials status: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching materials status: {e}"
        )


@router.post(
    "/project-envs/{env_id}/materials/generate", response_model=ReverifyResponse
)
async def generate_materials(env_id: str):
    """Retry/redo candidate generation: from material_ready, failed,
    needs_review or verified (back into the materials flow). The old
    materials store survives until the command overwrites it."""
    try:
        env = await _get_env_or_404(env_id)
        if env.source_type != "mock":
            raise _materials_error("仅 AI 模拟环境支持素材生成", "not_mock")
        if not (env.keywords or []):
            raise _materials_error("关键词为空，无法生成素材", "no_keywords")
        _reject_running_env(env)
        await _cancel_active_job(env)
        env.status = "material_pending"
        _clear_draft_outputs(env)
        await env.save()
        job_id = await _submit_materials_job(env)
        return ReverifyResponse(job_id=job_id)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error generating materials for {env_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error generating materials: {e}")


@router.post("/project-envs/{env_id}/materials/submit", response_model=ReverifyResponse)
async def submit_materials(env_id: str, request: MaterialsSubmitRequest):
    """Turn the user's pick into the drafting source: persist the selection,
    clear stale outputs, re-enter pending and submit the mock pipeline (its
    drafting step renders from the selection)."""
    try:
        env = await _get_env_or_404(env_id)
        if env.source_type != "mock":
            raise _materials_error("仅 AI 模拟环境支持素材生成", "not_mock")
        if request.kind not in ("materials", "routes"):
            raise _materials_error("kind 必须是 materials 或 routes", "invalid_kind")

        store = env.materials or {}
        material_items = (store.get("materials") or {}).get("items") or []
        route_items = (store.get("routes") or {}).get("items") or []
        if request.kind == "materials" and not material_items:
            raise _materials_error("素材候选尚未生成，请先生成", "not_generated")
        if request.kind == "routes" and not route_items:
            raise _materials_error("备选路线尚未生成，请先生成", "not_generated")

        _reject_running_env(env)

        selection: Dict[str, Any]
        if request.kind == "materials":
            if request.route_id is not None:
                raise _materials_error(
                    "kind=materials 不能携带 route_id", "invalid_combination"
                )
            seen: set = set()
            ids: List[str] = []
            for item_id in request.material_ids or []:
                if item_id and item_id not in seen:
                    seen.add(item_id)
                    ids.append(item_id)
            if not ids:
                raise _materials_error("至少选择一条素材", "empty_selection")
            known = {str(m.get("id")) for m in material_items}
            unknown = [i for i in ids if i not in known]
            if unknown:
                raise _materials_error(
                    "包含不在候选集中的素材 id", "unknown_ids", unknown=unknown
                )
            selection = {
                "kind": "materials",
                "material_ids": ids,
                "route_id": None,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }
        else:
            if request.material_ids is not None:
                raise _materials_error(
                    "kind=routes 不能携带 material_ids", "invalid_combination"
                )
            if not request.route_id:
                raise _materials_error("缺少路线 id", "missing_route_id")
            if not any(str(r.get("id")) == request.route_id for r in route_items):
                raise _materials_error("路线 id 不在候选集中", "unknown_route")
            selection = {
                "kind": "routes",
                "material_ids": None,
                "route_id": request.route_id,
                "submitted_at": datetime.now(timezone.utc).isoformat(),
            }

        await _cancel_active_job(env)
        _clear_draft_outputs(env)
        env.materials_selection = selection
        env.status = "pending"
        await env.save()
        job_id = await _submit_verification(env, "mock")
        return ReverifyResponse(job_id=job_id)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error submitting materials selection for {env_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error submitting materials selection: {e}"
        )


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


def _remove_paragraph(text: str, quote: str) -> Optional[str]:
    """Drop the newline-delimited paragraph containing the quote
    (whitespace-normalized match). Returns the remaining text, "" when the
    field held nothing else (caller maps that to 409), None on no match."""
    if not text or not quote:
        return None
    needle = re.sub(r"\s+", "", quote)
    if not needle:
        return None
    paragraphs = text.split("\n")
    kept = [p for p in paragraphs if needle not in re.sub(r"\s+", "", p)]
    if len(kept) == len(paragraphs):
        return None
    return "\n".join(kept).strip()


def _settle_paragraph_peers(env: ProjectEnv, points: List[Dict[str, Any]]) -> None:
    """A >800-char line is split into several points quoting one physical row;
    removing it strands the still-open peers' quotes, so dismiss them too or
    they can neither be dismissed (502) nor rewritten (quote_drift)."""
    for peer in points:
        if peer.get("state") in FINAL_POINT_STATES:
            continue
        field_text = env.text_for(str(peer.get("field") or ""))
        if _find_verbatim(field_text, str(peer.get("quote") or "")):
            continue
        peer["state"] = "dismissed"
        peer.setdefault("rounds", []).append(
            {
                "round": len(peer.get("rounds", [])) + 1,
                "action": "dismiss",
                "lane_results": {},
                "verdict": "dismissed",
                "note": "removed_with_paragraph",
            }
        )


@router.post(
    "/project-envs/{env_id}/claims/{point_id}/dismiss",
    response_model=ProjectEnvResponse,
)
async def dismiss_claim(env_id: str, point_id: str):
    """Dismiss one manual-review claim: remove its whole supporting paragraph
    from the candidate. Dismissing the last open point promotes the env to
    verified with a refreshed snapshot."""
    try:
        env = await _get_env_or_404(env_id)
        run = await _run_or_404(env)
        point = _find_point(run, point_id)
        _require_claim_state(env, point)

        field = str(point.get("field") or "")
        text = env.text_for(field)
        quote = str(point.get("quote") or "")
        new_text = _remove_paragraph(text, quote)
        if new_text is None:
            raise HTTPException(
                status_code=502, detail="Could not remove the supporting statement"
            )
        if not new_text.strip():
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "该段是字段唯一内容，请改写而非移除",
                    "reason": "only_paragraph",
                },
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
        _settle_paragraph_peers(env, run.get("points") or [])
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
    """Rewrite one claim with user text, re-verified through the verification
    lanes in parallel (B/C for mock envs — no KB lane). Always 200: fail keeps
    the point in manual_review and returns the lane opinions."""
    try:
        env = await _get_env_or_404(env_id)
        run = await _run_or_404(env)
        point = _find_point(run, point_id)
        _require_claim_state(env, point)

        # mock envs verify without lane A: a fictional project has no KB
        # evidence, so lane B must judge plausibility instead of off_table
        mode = "mock" if env.source_type == "mock" else "material"
        lane_ids = ("B", "C") if mode == "mock" else ("A", "B", "C")
        lane_results = await asyncio.gather(
            *[
                verify_point_lane(
                    lane=lane,
                    quote=request.text,
                    field=str(point.get("field") or ""),
                    context=_lane_context(env),
                    mode=mode,
                )
                for lane in lane_ids
            ]
        )
        lanes = dict(zip(lane_ids, lane_results))

        # R5 pre-screen covers the user's replacement text too: a GA violation
        # fails the point even when the lanes trust it; an off-table tech
        # (material mode) keeps it in manual review no matter what lanes say.
        prescreen = prescreen_quote(request.text, env.period_start)
        point["prescreen"] = prescreen
        if prescreen.get("status") == "fail":
            lanes["B"] = {
                "verdict": "fail",
                "issues": [prescreen.get("message") or "GA after project start"],
                "prescreen": True,
            }
        off_table_prescreen = prescreen.get("status") == "off_table" and mode != "mock"
        if off_table_prescreen:
            point["manual_reason"] = "off_table"

        passed = (
            all(result.get("verdict") == "pass" for result in lanes.values())
            and not off_table_prescreen
        )

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
                env.apply_candidate_text(
                    field, text.replace(old_quote, request.text, 1)
                )
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


SUGGESTIBLE_REASONS = ("lanes_failed", "exhausted")
# 实测默认 chat 模型出长文要 3 分钟以上，180 会把功能挡死；同步端点仍需有界
SUGGEST_TIMEOUT_SECONDS = 600


@router.post(
    "/project-envs/{env_id}/claims/{point_id}/suggest",
    response_model=SuggestClaimRewriteResponse,
)
async def suggest_claim_rewrite(env_id: str, point_id: str):
    """Stateless AI suggestion for rewriting a failed paragraph; never
    persisted — the user adopts it into the rewrite box or discards it."""
    try:
        env = await _get_env_or_404(env_id)
        run = await _run_or_404(env)
        point = _find_point(run, point_id)
        _require_claim_state(env, point)
        if point.get("manual_reason") not in SUGGESTIBLE_REASONS:
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "该验证点不支持 AI 修改建议",
                    "reason": "not_suggestible",
                },
            )
        issues = [
            issue
            for result in (point.get("lanes") or {}).values()
            for issue in result.get("issues", [])
        ]
        try:
            suggestion = await asyncio.wait_for(
                suggest_rewrite(
                    quote=str(point.get("quote") or ""),
                    field=str(point.get("field") or ""),
                    issues=issues,
                    context=_lane_context(env),
                ),
                timeout=SUGGEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail={"reason": "model_timeout"})
        if suggestion is None:
            raise HTTPException(status_code=502, detail={"reason": "model_error"})
        return SuggestClaimRewriteResponse(
            suggestion=suggestion.suggestion, explanation=suggestion.explanation
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error suggesting rewrite for {point_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error suggesting rewrite: {e}")


@router.post(
    "/project-envs/{env_id}/generic-paragraph/generate",
    response_model=GenericParagraphResponse,
)
async def generate_generic_paragraph(env_id: str):
    """Stateless AI draft of the reusable generic paragraph; never persisted —
    the user reviews/edits the text and saves it via PUT."""
    try:
        env = await _get_env_or_404(env_id)
        candidate = env.candidate_fields()
        if not any(str(text or "").strip() for text in candidate.values()):
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "项目素材为空，无法生成通用段落",
                    "reason": "no_material",
                },
            )
        try:
            paragraph = await asyncio.wait_for(
                render_generic_paragraph(
                    name=env.name,
                    period_start=env.period_start,
                    period_end=env.period_end,
                    source_type=env.source_type,
                    candidate=candidate,
                ),
                timeout=SUGGEST_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail={"reason": "model_timeout"})
        except ValueError as e:
            logger.warning(f"Generic paragraph generation failed for {env_id}: {e}")
            raise HTTPException(status_code=502, detail={"reason": "model_error"})
        return GenericParagraphResponse(paragraph=paragraph)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error generating generic paragraph for {env_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error generating generic paragraph: {e}"
        )
