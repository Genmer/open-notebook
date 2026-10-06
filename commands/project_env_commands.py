"""verify_project_env: async verification pipeline for project environments.

Three lanes (A: KB evidence, B: time/GA anchors, C: narrative coherence) run
per claim with a bounded correction loop. Fencing token: a stale invocation
(token != env.verification_token) is a no-op, and the token is re-read from
the DB before every env write so a superseded run can never clobber a newer
one. The command is idempotent under worker retry: the latest running detail
row for the same token is resumed and already-settled points cost zero LLM
calls.
"""

import asyncio
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from loguru import logger
from pydantic import Field
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.ai import project_env_pipeline as pipeline
from open_notebook.database.repository import ensure_record_id, repo_create, repo_query
from open_notebook.domain.project_env import ProjectEnv
from open_notebook.domain.project_env_rules import (
    check_ga_ordering,
    check_runtime_consistency,
    legal_window,
    month_index,
    shift_month,
    validate_period,
)
from open_notebook.exceptions import ConfigurationError, NotFoundError

PROJECT_ENV_RETRY_CONFIG = {
    "max_attempts": 3,
    "wait_strategy": "exponential_jitter",
    "wait_min": 5,
    "wait_max": 60,
    "stop_on": [ValueError, ConfigurationError, NotFoundError],
}

POINT_POOL_CAP = 20
LANE_CONCURRENCY = 5
FINAL_STATES = {"passed", "dismissed", "rewritten", "exempt", "manual_review"}

KB_EMPTY_MOCK_MESSAGE = (
    "本地知识库为空（无来源与笔记）：AI 模拟项目依赖本地资料作为验证证据源，"
    "请先在 notebook 导入资料后再使用 AI 模拟。"
)


class _Superseded(Exception):
    """Env token rotated mid-run: a newer run owns the env, so this one must
    not persist anything to it."""


async def _token_current(env_id: str, token: str) -> bool:
    """Fencing recheck right before every env write — env.save() is a
    full-field merge that would silently roll back concurrent edits."""
    rows = await repo_query(
        "SELECT verification_token FROM project_env WHERE id = $id",
        {"id": ensure_record_id(env_id)},
    )
    current = (rows[0] or {}).get("verification_token") if rows else None
    return bool(rows) and str(current or "") == token


class VerifyProjectEnvInput(CommandInput):
    env_id: str
    mode: str = "material"  # material | mock
    token: str


class VerifyProjectEnvOutput(CommandOutput):
    success: bool
    status: str
    summary: Dict[str, int] = Field(default_factory=dict)
    error_message: Optional[str] = None


async def _set_progress(
    env_id: str,
    stage: str,
    percent: int,
    message: str = "",
    error: Optional[str] = None,
    token: Optional[str] = None,
) -> None:
    try:
        # conditional UPDATE = fencing for best-effort writes: a superseded
        # run must not repaint progress over a newer run's. Param is $fence —
        # $token is a SurrealDB protected variable and rejects the query.
        guard = " AND verification_token = $fence" if token else ""
        await repo_query(
            f"UPDATE $env_id SET verification_progress = $progress WHERE true{guard}",
            {
                "env_id": ensure_record_id(env_id),
                "progress": {
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                    "error": error,
                    "updated": datetime.now().isoformat(),
                },
                "fence": token,
            },
        )
    except Exception as e:  # cosmetic; must never kill the run
        logger.warning(f"Failed to update verification_progress for {env_id}: {e}")


async def _knowledge_base_empty() -> bool:
    # GROUP ALL is mandatory: without it SurrealDB applies count() per row
    source_rows = await repo_query("SELECT count() AS total FROM source GROUP ALL")
    note_rows = await repo_query("SELECT count() AS total FROM note GROUP ALL")
    sources = int((source_rows or [{}])[0].get("total", 0))
    notes = int((note_rows or [{}])[0].get("total", 0))
    return sources + notes == 0


async def _fail_env(env_id: str, message: str, token: Optional[str] = None) -> None:
    try:
        # same fencing as _set_progress: a superseded run must not flip a
        # newer run's env to failed. $fence, not $token (protected variable)
        guard = " AND verification_token = $fence" if token else ""
        await repo_query(
            f"UPDATE $env_id SET status = 'failed' WHERE true{guard}",
            {"env_id": ensure_record_id(env_id), "fence": token},
        )
    except Exception as e:
        logger.warning(f"Best-effort failed-mark for {env_id} did not land: {e}")
    await _set_progress(env_id, "failed", 100, error=message[:500], token=token)


async def _require_model_configured(lane_models: Dict[str, Optional[str]]) -> None:
    if any(lane_models.values()):
        return  # explicit model ids: provisioning validates them on first call
    from open_notebook.ai.models import DefaultModels

    defaults = await DefaultModels.get_instance()
    if not defaults.default_chat_model:
        raise ConfigurationError(
            "No default chat model configured: project env verification needs a "
            "chat model (Manage → Models)."
        )


# --- detail-run rows ---


async def _create_run(env: ProjectEnv, token: str, mode: str, degraded: Dict[str, Any]):
    created = await repo_create(
        "project_env_verification",
        {
            "project_env": ensure_record_id(str(env.id)),
            "token": token,
            "mode": mode,
            "status": "running",
            "degraded": degraded,
            "llm_calls": 0,
            "summary": {},
            "points": [],
        },
    )
    # repo_create wraps SDK insert(), which returns a list of created rows
    return created[0] if isinstance(created, list) else created


async def _resume_run(env_id: str, token: str) -> Optional[Dict[str, Any]]:
    """Latest running run for this token, or None. Older running rows for
    other tokens are marked aborted (stale by fencing)."""
    rows = await repo_query(
        "SELECT * FROM project_env_verification "
        "WHERE project_env = $id AND token = $fence AND status = 'running' "
        "ORDER BY created DESC LIMIT 1",
        {"id": ensure_record_id(env_id), "fence": token},
    )
    return rows[0] if rows else None


async def _abort_stale_runs(env_id: str, token: str) -> None:
    try:
        await repo_query(
            "UPDATE project_env_verification SET status = 'aborted', "
            "reason = 'superseded' "
            "WHERE project_env = $id AND status = 'running' AND token != $fence",
            {"id": ensure_record_id(env_id), "fence": token},
        )
    except Exception as e:
        logger.warning(f"Could not abort stale runs for {env_id}: {e}")


async def _save_run(run: Dict[str, Any], **fields: Any) -> None:
    sets = ", ".join(f"{key} = ${key}" for key in fields)
    await repo_query(
        f"UPDATE $run_id SET {sets}",
        {"run_id": ensure_record_id(str(run.get("id"))), **fields},
    )


# --- material preparation ---


async def _prepare_mock_material(
    env: ProjectEnv, token: str, budget: pipeline.CallBudget
) -> None:
    draft = await pipeline.render_mock(
        keywords=env.keywords or [],
        name=env.name,
        period_start=env.period_start or None,
        period_end=env.period_end or None,
        budget=budget,
    )
    if draft is None:
        raise ValueError("mock generation failed after retry")

    period = (draft.period_start, draft.period_end)
    violations = validate_period(period[0], period[1], "mock")["violations"]
    if violations:
        feedback = "; ".join(v["message"] for v in violations)
        draft = await pipeline.render_mock(
            keywords=env.keywords or [],
            name=env.name,
            period_start=env.period_start or None,
            period_end=env.period_end or None,
            budget=budget,
            feedback=feedback,
        )
        if draft is None:
            raise ValueError("mock regeneration failed after rule violations")
        violations = validate_period(draft.period_start, draft.period_end, "mock")[
            "violations"
        ]

    time_adjusted: Optional[Dict[str, Any]] = None
    if violations:
        # deterministic shift to the nearest legal window (never trust the
        # model with date arithmetic a second time)
        window = legal_window()
        if env.period_start and env.period_end:
            target_start, target_end = env.period_start, env.period_end
        else:
            span = month_index(draft.period_end) - month_index(draft.period_start) + 1
            if not 6 <= span <= 10:
                span = 8
            target_end = min(draft.period_end, window["legal_end_latest"])
            target_start = max(
                window["legal_start_earliest"], shift_month(target_end, -(span - 1))
            )
        time_adjusted = {
            "from": {
                "period_start": draft.period_start,
                "period_end": draft.period_end,
            },
            "to": {"period_start": target_start, "period_end": target_end},
            "reason": "; ".join(v["rule"] for v in violations),
        }
        draft.period_start, draft.period_end = target_start, target_end

    env.draft_content = draft.model_dump()
    env.period_start = draft.period_start
    env.period_end = draft.period_end
    env.time_adjusted = time_adjusted
    if not await _token_current(str(env.id), token):
        raise _Superseded()
    await env.save()


# --- claim extraction funnel ---


def _prescreen_version_points(points: List[Dict[str, Any]], period_start: str) -> None:
    """R5 pre-screen: anchor-table lookup for version claims."""
    for point in points:
        if point.get("type") != "version":
            continue
        match = pipeline.VERSION_RE.search(str(point.get("quote") or ""))
        tech = (match.group(1).strip() if match else "") or str(point.get("tech") or "")
        version = match.group(2) if match else point.get("version")
        result = check_ga_ordering(tech, version, period_start)
        point["prescreen"] = result
        if result.get("status") == "off_table":
            point["state"] = "manual_review"
            point["manual_reason"] = "off_table"


def _mark_overflow(points: List[Dict[str, Any]]) -> None:
    for point in points[POINT_POOL_CAP:]:
        if point.get("state") not in FINAL_STATES:
            point["state"] = "manual_review"
            point["manual_reason"] = "uncovered"


def _drop_drifted_claims(
    claims: List[Dict[str, Any]], candidate: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Quotes the LLM hallucinated out of the material verify nothing; keep
    only claims actually present in the candidate text."""
    kept: List[Dict[str, Any]] = []
    for claim in claims:
        quote = str(claim.get("quote") or "")
        field = str(claim.get("field") or "")
        text = str(candidate.get(field) or "")
        if quote and quote in text:
            kept.append(claim)
    return kept


async def _extract_points(
    env: ProjectEnv, mode: str, token: str, budget: pipeline.CallBudget
) -> List[Dict[str, Any]]:
    candidate = env.candidate_fields()
    claims = pipeline.dedup_claims(pipeline.extract_claims_regex(candidate))
    claims = pipeline.dedup_claims(
        claims + await pipeline.extract_claims_llm(candidate, budget)
    )
    claims = _drop_drifted_claims(claims, candidate)

    points: List[Dict[str, Any]] = []
    for claim in claims:
        if claim.get("type") == "exempt":
            points.append({**claim, "point_id": uuid.uuid4().hex, "state": "exempt"})
        else:
            points.append({**claim, "point_id": uuid.uuid4().hex, "state": "pending"})

    if len(points) > POINT_POOL_CAP and mode == "mock":
        # one compression rewrite round, then re-extract
        compressed = await pipeline.compress_draft(env.draft_content or {}, budget)
        if compressed:
            if not await _token_current(str(env.id), token):
                raise _Superseded()
            env.draft_content = compressed
            await env.save()
            candidate = env.candidate_fields()
            claims = pipeline.dedup_claims(
                pipeline.extract_claims_regex(candidate)
                + await pipeline.extract_claims_llm(candidate, budget)
            )
            claims = _drop_drifted_claims(claims, candidate)
            points = [
                {
                    **claim,
                    "point_id": uuid.uuid4().hex,
                    "state": "exempt" if claim.get("type") == "exempt" else "pending",
                }
                for claim in claims
            ]

    _mark_overflow(points)
    _prescreen_version_points(points, env.period_start)
    return points


# --- lane processing ---


def _lane_context(env: ProjectEnv) -> Dict[str, Any]:
    return {
        "period_start": env.period_start,
        "period_end": env.period_end,
        "narrative": "\n\n".join(
            f"[{field}]\n{env.text_for(field)}"
            for field in (
                "background",
                "tech_background",
                "tuning_process",
                "problems_solutions",
                "my_role",
                "scale",
            )
        ),
        "my_role": env.my_role or "",
        "keywords": env.keywords or [],
    }


async def _run_lanes(
    point: Dict[str, Any],
    context: Dict[str, Any],
    lane_models: Dict[str, Optional[str]],
    budget: pipeline.CallBudget,
) -> Dict[str, Dict[str, Any]]:
    results = await asyncio.gather(
        *[
            pipeline.verify_point_lane(
                lane=lane,
                quote=str(point.get("quote") or ""),
                field=str(point.get("field") or ""),
                context=context,
                budget=budget,
                lane_model=lane_models[lane],
            )
            for lane in ("A", "B", "C")
        ]
    )
    return dict(zip(("A", "B", "C"), results))


async def _process_point(
    sem: asyncio.Semaphore,
    point: Dict[str, Any],
    env: ProjectEnv,
    context: Dict[str, Any],
    lane_models: Dict[str, Optional[str]],
    budget: pipeline.CallBudget,
    max_rounds: int,
) -> List[Dict[str, Any]]:
    """Verify + bounded correction loop for one point. Returns NEW points
    discovered by re-extracting corrected text (they join the pool)."""
    discovered: List[Dict[str, Any]] = []
    rounds_used = 0
    rounds: List[Dict[str, Any]] = point.setdefault("rounds", [])

    while point.get("state") not in FINAL_STATES:
        if budget.exhausted:
            point["state"] = "manual_review"
            point["manual_reason"] = "cost_cap"
            break

        async with sem:
            lanes = await _run_lanes(point, context, lane_models, budget)
        point["lanes"] = lanes

        # R5 pre-screen fail overrides lane B (never let memory judge GA)
        prescreen = point.get("prescreen") or {}
        if prescreen.get("status") == "fail":
            lanes["B"] = {
                "verdict": "fail",
                "issues": [prescreen.get("message") or "GA after project start"],
                "prescreen": True,
            }

        verdicts = {lane: result.get("verdict") for lane, result in lanes.items()}
        if "error" in verdicts.values():
            point["state"] = "error"
            rounds.append(
                {
                    "round": len(rounds) + 1,
                    "action": "verify",
                    "lane_results": lanes,
                    "verdict": "error",
                }
            )
            break
        if verdicts.get("B") == "off_table":
            point["state"] = "manual_review"
            point["manual_reason"] = "off_table"
            rounds.append(
                {
                    "round": len(rounds) + 1,
                    "action": "verify",
                    "lane_results": lanes,
                    "verdict": "off_table",
                }
            )
            break
        if all(v == "pass" for v in verdicts.values()):
            point["state"] = "passed"
            point["correction_rounds_used"] = rounds_used
            rounds.append(
                {
                    "round": len(rounds) + 1,
                    "action": "verify",
                    "lane_results": lanes,
                    "verdict": "pass",
                }
            )
            break

        if rounds_used >= max_rounds:
            point["state"] = "manual_review"
            point["manual_reason"] = "exhausted"
            point["correction_rounds_used"] = rounds_used
            rounds.append(
                {
                    "round": len(rounds) + 1,
                    "action": "verify",
                    "lane_results": lanes,
                    "verdict": "fail",
                }
            )
            break

        issues = [i for result in lanes.values() for i in result.get("issues", [])]
        corrected = await pipeline.correct_point(
            quote=str(point.get("quote") or ""),
            field=str(point.get("field") or ""),
            issues=issues,
            context=context,
            budget=budget,
        )
        rounds_used += 1
        if corrected is None:
            continue  # correction unavailable: re-verify once more up to rounds

        field = str(point.get("field") or "")
        old_quote = str(point.get("quote") or "")
        text = env.text_for(field)
        if not old_quote or old_quote not in text:
            # the material drifted from the extracted quote: applying the
            # correction would verify a sentence that is not in the text
            point["state"] = "manual_review"
            point["manual_reason"] = "quote_drift"
            break
        env.apply_candidate_text(field, text.replace(old_quote, corrected))
        point["quote"] = corrected
        rounds.append(
            {
                "round": len(rounds) + 1,
                "action": "correct",
                "lane_results": lanes,
                "corrected_text": corrected,
                "verdict": "corrected",
            }
        )
        # corrected text joins the pool as new regex claims (deduped)
        for claim in pipeline.extract_claims_regex({field: corrected}):
            new_quote = claim["quote"]
            if new_quote == corrected:
                continue
            discovered.append(
                {
                    **claim,
                    "point_id": uuid.uuid4().hex,
                    "state": "pending",
                    "origin": "correction",
                }
            )

    point["correction_rounds_used"] = rounds_used
    return discovered


# --- convergence ---


def _summarize(points: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {
        "total": len(points),
        "passed": 0,
        "failed": 0,
        "manual": 0,
        "uncovered": 0,
    }
    for point in points:
        state = point.get("state")
        if state == "passed":
            counts["passed"] += 1
        elif state == "manual_review":
            counts["manual"] += 1
            if point.get("manual_reason") == "uncovered":
                counts["uncovered"] += 1
        elif state in ("error",):
            counts["failed"] += 1
    return counts


async def _converge(
    env: ProjectEnv,
    run: Dict[str, Any],
    points: List[Dict[str, Any]],
    budget: pipeline.CallBudget,
) -> str:
    """Run row first, then env (ordering asserted by tests)."""
    summary = _summarize(points)
    errors = [p for p in points if p.get("state") == "error"]
    if errors and not budget.exhausted:
        await _save_run(
            run, status="aborted", points=points, summary=summary, llm_calls=budget.used
        )
        raise RuntimeError(
            f"{len(errors)} points in error state; worker retry resumes them"
        )

    ok_states = {"passed", "dismissed", "rewritten", "exempt"}
    if not await _token_current(str(env.id), str(run.get("token") or "")):
        raise _Superseded()
    if all(p.get("state") in ok_states for p in points):
        if env.source_type == "mock" and env.draft_content:
            env.promote_draft()
        env.verified_snapshot = env.build_snapshot()
        env.status = "verified"
        env.pending_claims = None
        final_status = "verified"
    else:
        env.status = "needs_review"
        env.pending_claims = [
            {
                "point_id": p.get("point_id"),
                "quote": p.get("quote"),
                "field": p.get("field"),
                "reason_code": p.get("manual_reason") or "lanes_failed",
                "lanes_summary": p.get("lanes"),
            }
            for p in points
            if p.get("state") not in ok_states
        ]
        final_status = "needs_review"

    await _save_run(
        run, status="completed", points=points, summary=summary, llm_calls=budget.used
    )
    env.verification_progress = {
        "stage": "done",
        "percent": 100,
        "message": f"{summary['passed']}/{summary['total']} points verified",
        "error": None,
        "updated": datetime.now().isoformat(),
    }
    await env.save()
    return final_status


@command("verify_project_env", app="open_notebook", retry=PROJECT_ENV_RETRY_CONFIG)
async def verify_project_env_command(
    input_data: VerifyProjectEnvInput,
) -> VerifyProjectEnvOutput:
    env_id = input_data.env_id
    env = await ProjectEnv.get(env_id)  # NotFoundError: permanent

    if input_data.token != (env.verification_token or ""):
        logger.info(f"[verify_project_env:{env_id}] stale token, no-op")
        return VerifyProjectEnvOutput(success=True, status="stale_token")

    budget = pipeline.CallBudget()
    lane_models = pipeline.get_lane_models()
    degraded: Dict[str, Any] = {}
    if len(set(lane_models.values())) == 1:
        degraded["single_model"] = True
    max_rounds = pipeline.get_max_correction_rounds()

    run: Optional[Dict[str, Any]] = None
    try:
        await _require_model_configured(lane_models)

        # kb_empty must be known before the run row is created: degraded flags
        # are persisted with the row, never patched in afterwards
        kb_empty = await _knowledge_base_empty()
        if kb_empty and input_data.mode == "mock":
            await _fail_env(env_id, KB_EMPTY_MOCK_MESSAGE, input_data.token)
            raise ValueError(KB_EMPTY_MOCK_MESSAGE)
        if kb_empty:
            degraded["lane_a"] = "kb_empty_anchor_only"
            degraded["kb_empty"] = True

        await _set_progress(
            env_id, "preparing", 5, "前置检查与素材准备", token=input_data.token
        )
        run = await _resume_run(env_id, input_data.token)
        if run is None:
            await _abort_stale_runs(env_id, input_data.token)
            run = await _create_run(env, input_data.token, input_data.mode, degraded)
        points: List[Dict[str, Any]] = list(run.get("points") or [])

        if not points:
            if input_data.mode == "mock" and not env.draft_content:
                await _set_progress(
                    env_id,
                    "drafting",
                    10,
                    "AI 扩充：根据关键词生成完整项目背景草稿",
                    token=input_data.token,
                )
                await _prepare_mock_material(env, input_data.token, budget)
            await _set_progress(
                env_id, "extracting", 20, "提取技术断言点", token=input_data.token
            )
            await _save_run(run, time_warnings=_time_warnings(env))
            points = await _extract_points(
                env, input_data.mode, input_data.token, budget
            )
            if not points:
                # Empty material (or an extraction that found nothing) must
                # not converge to verified on a vacuous "all zero passed".
                await _fail_env(
                    env_id,
                    "未能从材料中提取到任何技术断言点：请检查环境内容是否为空",
                    input_data.token,
                )
                raise ValueError("no claims extracted from material")
            await _save_run(run, points=points)

        total_points = max(len(points), 1)
        round_no = 0
        sem = asyncio.Semaphore(LANE_CONCURRENCY)
        context = _lane_context(env)
        work = [p for p in points if p.get("state") not in FINAL_STATES]
        while work and not budget.exhausted:
            round_no += 1
            settled = sum(1 for p in points if p.get("state") in FINAL_STATES)
            await _set_progress(
                env_id,
                "verifying",
                min(30 + int(55 * settled / total_points), 85),
                f"三路验证 · 第 {round_no} 轮：{settled}/{total_points} 个断言点已判定",
                token=input_data.token,
            )
            batches = await asyncio.gather(
                *[
                    _process_point(
                        sem, p, env, context, lane_models, budget, max_rounds
                    )
                    for p in work
                ]
            )
            # only newly discovered correction points enter the next batch;
            # settled points (incl. error) must not loop forever
            known_quotes = {p.get("quote") for p in points}
            work = []
            for discovered in batches:
                for point in discovered:
                    if point.get("quote") in known_quotes:
                        continue
                    points.append(point)
                    work.append(point)
            _mark_overflow(points)
            _prescreen_version_points(work, env.period_start)

        if budget.exhausted:
            for point in points:
                if (
                    point.get("state") not in FINAL_STATES
                    and point.get("state") != "error"
                ):
                    point["state"] = "manual_review"
                    point["manual_reason"] = "cost_cap"

        await _set_progress(
            env_id, "converging", 90, "收敛判定", token=input_data.token
        )
        status = await _converge(env, run, points, budget)
        await _set_progress(
            env_id,
            status,
            100,
            "验证通过" if status == "verified" else "待人工复核",
            token=input_data.token,
        )
        logger.info(f"[verify_project_env:{env_id}] converged: {status}")
        return VerifyProjectEnvOutput(
            success=True, status=status, summary=_summarize(points)
        )
    except _Superseded:
        logger.info(f"[verify_project_env:{env_id}] superseded mid-run, standing down")
        if run is not None:
            await _save_run(run, status="aborted", reason="superseded")
        return VerifyProjectEnvOutput(success=True, status="superseded")
    except (ValueError, ConfigurationError) as e:
        await _fail_env(env_id, str(e), input_data.token)
        raise
    except NotFoundError:
        raise
    except RuntimeError as e:
        # retriable, but when every retry dies the env must not stay pending
        # forever at 90% — a successful retry overwrites the failed mark
        await _fail_env(env_id, str(e), input_data.token)
        raise


def _time_warnings(env: ProjectEnv) -> List[Dict[str, Any]]:
    if not (env.period_start and env.period_end):
        return []
    warnings: List[Dict[str, Any]] = [
        v
        for v in validate_period(env.period_start, env.period_end, "real")["violations"]
        if v.get("severity") == "warn"
    ]
    warnings.extend(
        check_runtime_consistency(env.scale, env.period_start, env.period_end)[
            "violations"
        ]
    )
    return warnings
