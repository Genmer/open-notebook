"""Tests for verify_project_env_command (commands/project_env_commands.py).

All LLM seams (pipeline functions / provisioning) and DB writes are patched;
write ordering and fencing behavior are asserted from the recorded calls.
"""

import copy
from contextlib import ExitStack
from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from commands.project_env_commands import (
    VerifyProjectEnvInput,
    verify_project_env_command,
)
from open_notebook.ai.project_env_pipeline import MockDraft
from open_notebook.domain.project_env import ProjectEnv
from open_notebook.exceptions import ConfigurationError

ENV_ID = "project_env:e1"
TOKEN = "tok-1"


def _env(**overrides) -> ProjectEnv:
    data = dict(
        id=ENV_ID,
        name="电商平台重构",
        background="系统采用 Redis 7.0 作为缓存。整体高并发。",
        period_start="2025.01",
        period_end="2025.08",
        source_type="real",
        keywords=["微服务"],
        tech_background="Spring Boot 3.2 微服务架构。",
        status="pending",
        verification_token=TOKEN,
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    data.update(overrides)
    return ProjectEnv(**data)


class Recorder:
    """Routes SQL to canned results and records every write in order."""

    def __init__(self, resume_rows=None, sources=5, notes=2, token=TOKEN):
        self.resume_rows = resume_rows or []
        self.sources = sources
        self.notes = notes
        self.token = token  # what the DB would return for verification_token
        self.events = []  # ordered write log for ordering assertions
        self.progress_updates = []
        self.created_rows = []
        self.run_updates = []
        self.failed = False

    async def query(self, sql, params=None):
        if "FROM ONLY" in sql:
            return [{"default_chat_model": "model:chat"}]
        if "SELECT verification_token FROM project_env" in sql:
            return [{"verification_token": self.token}]
        if "count() AS total FROM source" in sql:
            return [{"total": self.sources}]
        if "count() AS total FROM note" in sql:
            return [{"total": self.notes}]
        if "FROM project_env_verification" in sql and sql.startswith("SELECT"):
            return self.resume_rows
        if "status = 'aborted'" in sql:
            self.events.append("abort_stale")
            return []
        if "SET status = 'failed'" in sql:
            self.events.append("env_failed")
            self.failed = True
            return []
        if "verification_progress = $progress" in sql:
            self.progress_updates.append(params["progress"])
            return []
        if sql.startswith("UPDATE $run_id"):
            self.run_updates.append(params)
            self.events.append("run_write")
            return []
        raise AssertionError(f"unexpected query: {sql[:120]}")

    async def create(self, table, data):
        row = {"id": "project_env_verification:r1", **data}
        # deep copy: later in-memory mutation of `degraded` etc. must not
        # retroactively change what was persisted
        self.created_rows.append((table, copy.deepcopy(data)))
        self.events.append("run_create")
        return row


def _patches(recorder, env, **pipeline_overrides):
    """Standard patch set: DB seams + pipeline LLM seams."""

    async def fake_get(env_id):
        return env

    async def fake_save(self_env):
        recorder.events.append("env_save")

    lanes = pipeline_overrides.pop(
        "lanes",
        lambda lane, quote, field, context, budget=None, lane_model=None: {
            "verdict": "pass",
            "issues": [],
        },
    )

    async def lane_call(lane, quote, field, context, budget=None, lane_model=None):
        result = lanes(lane, quote, field, context, budget, lane_model)
        if hasattr(result, "__await__"):
            result = await result
        return result

    default_overrides = {
        "extract_claims_llm": AsyncMock(return_value=[]),
        "verify_point_lane": lane_call,
        "correct_point": AsyncMock(return_value=None),
        "render_mock": AsyncMock(return_value=None),
        "compress_draft": AsyncMock(return_value=None),
    }
    default_overrides.update(pipeline_overrides)

    async def defaults_row(sql, params=None):
        # DefaultModels.get_instance uses its own module's repo_query; keep it
        # deterministic so the tests never touch a live SurrealDB.
        if "FROM ONLY" in sql:
            return [{"default_chat_model": "model:chat"}]
        raise AssertionError(f"unexpected ai.models query: {sql[:100]}")

    patches: list[Any] = [
        patch(
            "commands.project_env_commands.ProjectEnv.get",
            side_effect=fake_get,
        ),
        patch(
            "commands.project_env_commands.repo_query",
            side_effect=recorder.query,
        ),
        patch("open_notebook.ai.models.repo_query", side_effect=defaults_row),
        patch(
            "commands.project_env_commands.repo_create",
            side_effect=recorder.create,
        ),
        patch.object(ProjectEnv, "save", autospec=True, side_effect=fake_save),
    ]
    for name, value in default_overrides.items():
        patches.append(patch(f"open_notebook.ai.project_env_pipeline.{name}", value))
    return patches, default_overrides


async def _run(env, recorder, mode="material", token=TOKEN, **pipeline_overrides):
    patches, mocks = _patches(recorder, env, **pipeline_overrides)
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await verify_project_env_command(
            VerifyProjectEnvInput(env_id=str(env.id), mode=mode, token=token)
        )
    return result, mocks


class TestConvergence:
    @pytest.mark.asyncio
    async def test_all_pass_converges_verified_with_frozen_snapshot(self):
        env = _env()
        recorder = Recorder()
        result, _ = await _run(env, recorder)

        assert result.status == "verified"
        assert env.status == "verified"
        assert env.pending_claims is None
        snapshot = env.verified_snapshot
        assert snapshot
        assert snapshot["background"] == env.background
        assert snapshot["period_start"] == "2025.01"
        assert snapshot["source_type"] == "real"
        assert "frozen_at" in snapshot
        progress = env.verification_progress
        assert progress and progress["stage"] == "done"
        assert recorder.progress_updates[-1]["stage"] == "converging"

    @pytest.mark.asyncio
    async def test_mock_all_pass_promotes_draft_to_main_fields(self):
        draft = MockDraft(
            name="AI 模拟项目",
            background="模拟背景采用 MySQL 8.0 存储。",
            period_start="2025.02",
            period_end="2025.09",
            tech_background="模拟技术栈。",
            tuning_process="模拟调优。",
            problems_solutions="模拟问题。",
            my_role="我担任架构师。",
            scale="团队 20 人。",
        )

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            return {"verdict": "pass", "issues": []}

        env = _env(
            source_type="mock",
            background="",
            period_start="",
            period_end="",
        )
        recorder = Recorder()
        result, mocks = await _run(
            env,
            recorder,
            mode="mock",
            lanes=lanes,
            render_mock=AsyncMock(return_value=draft),
        )

        assert result.status == "verified"
        mocks["render_mock"].assert_awaited_once()
        # draft promoted into main fields + snapshot frozen from draft
        assert env.background == "模拟背景采用 MySQL 8.0 存储。"
        assert env.period_start == "2025.02"
        snapshot = env.verified_snapshot
        assert snapshot and snapshot["tech_background"] == "模拟技术栈。"
        assert snapshot["source_type"] == "mock"

    @pytest.mark.asyncio
    async def test_rounds_exhausted_needs_review_with_lane_opinions(self, monkeypatch):
        monkeypatch.setenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS", "1")

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            return {"verdict": "fail", "issues": [f"{lane} 意见：证据不足"]}

        env = _env(tech_background="")
        recorder = Recorder()
        correct = AsyncMock(return_value="修正后的句子。")
        result, mocks = await _run(env, recorder, lanes=lanes, correct_point=correct)

        assert result.status == "needs_review"
        assert env.status == "needs_review"
        claims = env.pending_claims
        assert claims, "pending_claims must be written"
        claim = claims[0]
        assert claim["reason_code"] == "exhausted"
        assert claim["lanes_summary"]["A"]["issues"] == ["A 意见：证据不足"]
        assert claim["lanes_summary"]["B"]["verdict"] == "fail"
        assert claim["lanes_summary"]["C"]["verdict"] == "fail"
        # one failing claim, max rounds 1 -> exactly one correction round
        correct.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_lane_error_marks_point_error_and_raises_for_retry(self):
        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            if lane == "B":
                return {"verdict": "error", "issues": ["timeout"]}
            return {"verdict": "pass", "issues": []}

        env = _env()
        recorder = Recorder()
        correct = AsyncMock()
        patches, mocks = _patches(recorder, env, lanes=lanes, correct_point=correct)
        with ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            with pytest.raises(RuntimeError):
                await verify_project_env_command(
                    VerifyProjectEnvInput(env_id=ENV_ID, mode="material", token=TOKEN)
                )
        correct.assert_not_awaited()  # error points never enter correction
        # retry exhausts eventually; the env must not stay pending at 90%
        assert "env_failed" in recorder.events
        assert recorder.progress_updates[-1]["error"]

    @pytest.mark.asyncio
    async def test_lane_timeout_retries_once_then_verdict_error(self, monkeypatch):
        import asyncio

        import open_notebook.ai.project_env_pipeline as pipeline

        monkeypatch.setattr(pipeline, "LANE_TIMEOUT_SECONDS", 0.05)

        class SlowModel:
            async def ainvoke(self, prompt):
                await asyncio.sleep(0.2)
                raise AssertionError("should be cancelled first")

        class SlowProv:
            langchain_model = SlowModel()
            model_name = "slow"

        calls = {"n": 0}

        async def slow_provision(*args, **kwargs):
            calls["n"] += 1
            return SlowProv()

        with (
            patch(
                "open_notebook.ai.project_env_pipeline.provision_langchain_model_with_info",
                side_effect=slow_provision,
            ),
            patch(
                "open_notebook.ai.project_env_pipeline.gather_evidence",
                new_callable=AsyncMock,
                return_value="(空)",
            ),
        ):
            verdict = await pipeline.verify_point_lane(
                lane="A", quote="x", field="background", context={}
            )

        assert verdict["verdict"] == "error"
        assert calls["n"] == 2  # one retry, still failing


class TestIdempotency:
    @pytest.mark.asyncio
    async def test_resume_skips_passed_points_zero_llm_calls(self):
        env = _env()
        # half-finished run: one passed point, one pending point
        resume_rows = [
            {
                "id": "project_env_verification:r1",
                "token": TOKEN,
                "status": "running",
                "points": [
                    {
                        "point_id": "p1",
                        "quote": "系统采用 Redis 7.0 作为缓存",
                        "field": "background",
                        "type": "version",
                        "state": "passed",
                        "rounds": [],
                    },
                    {
                        "point_id": "p2",
                        "quote": "整体高并发",
                        "field": "background",
                        "type": "semantic",
                        "state": "pending",
                        "rounds": [],
                    },
                ],
            }
        ]
        recorder = Recorder(resume_rows=resume_rows)
        seen_quotes = []

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            seen_quotes.append(quote)
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "verified"
        assert all(q == "整体高并发" for q in seen_quotes), seen_quotes

    @pytest.mark.asyncio
    async def test_stale_token_is_noop(self):
        env = _env(verification_token=TOKEN)
        recorder = Recorder()
        result, _ = await _run(env, recorder, token="other-token")

        assert result.status == "stale_token"
        assert result.success is True
        assert recorder.events == []  # no writes at all
        assert recorder.created_rows == []

    @pytest.mark.asyncio
    async def test_resume_never_adopts_run_row_from_other_token(self):
        """Fencing must apply to the resume lookup too: a running row left by
        an older token is aborted, never resumed, and the fresh run re-verifies
        from scratch (a wrongly adopted row would skip LLM work)."""

        class TokenAwareRecorder(Recorder):
            def __init__(self, rows_by_token):
                super().__init__()
                self.rows_by_token = rows_by_token

            async def query(self, sql, params=None):
                if "FROM project_env_verification" in sql and sql.startswith("SELECT"):
                    token = (params or {}).get("token")
                    return self.rows_by_token.get(token, [])
                return await super().query(sql, params)

        env = _env()
        old_row = [
            {
                "id": "project_env_verification:old",
                "token": "older-token",
                "status": "running",
                "points": [
                    {
                        "point_id": "p1",
                        "quote": "系统采用 Redis 7.0 作为缓存",
                        "field": "background",
                        "state": "passed",
                        "rounds": [],
                    }
                ],
            }
        ]
        recorder = TokenAwareRecorder({"older-token": old_row})
        seen_quotes = []

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            seen_quotes.append(quote)
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "verified"
        assert "abort_stale" in recorder.events  # old-token row fenced off
        assert "run_create" in recorder.events  # fresh run, not a resume
        assert seen_quotes, "the old row's settled points must not be adopted"

    @pytest.mark.asyncio
    async def test_resume_all_points_settled_converges_with_zero_llm_calls(self):
        """Crash-window recovery: a run that settled every point but died
        before converging must converge on retry without any LLM work."""
        env = _env(status="pending")
        resume_rows = [
            {
                "id": "project_env_verification:r1",
                "token": TOKEN,
                "status": "running",
                "points": [
                    {
                        "point_id": "p1",
                        "quote": "系统采用 Redis 7.0 作为缓存",
                        "field": "background",
                        "state": "passed",
                        "rounds": [],
                    },
                    {
                        "point_id": "p2",
                        "quote": "整体高并发",
                        "field": "background",
                        "type": "semantic",
                        "state": "passed",
                        "rounds": [],
                    },
                ],
            }
        ]
        recorder = Recorder(resume_rows=resume_rows)

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            raise AssertionError(
                f"settled resume must not call lanes, got {lane}:{quote}"
            )

        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "verified"
        assert env.status == "verified"
        assert recorder.created_rows == []  # resumed, not re-created
        assert recorder.events.index("run_write") < recorder.events.index("env_save")

    @pytest.mark.asyncio
    async def test_resume_retries_error_points_before_converging(self):
        """Worker-retry contract: points left in error by a crashed attempt
        are re-verified on resume (they are work, not verdicts). Settling
        them converges; skipping them would wrongly pin needs_review."""
        env = _env(status="pending")
        resume_rows = [
            {
                "id": "project_env_verification:r1",
                "token": TOKEN,
                "status": "running",
                "points": [
                    {
                        "point_id": "p1",
                        "quote": "系统采用 Redis 7.0 作为缓存",
                        "field": "background",
                        "state": "error",
                        "rounds": [],
                    }
                ],
            }
        ]
        recorder = Recorder(resume_rows=resume_rows)
        seen_quotes = []

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            seen_quotes.append(quote)
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "verified"
        assert env.status == "verified"
        # three lanes each saw exactly the recovered point's quote
        assert len(seen_quotes) == 3
        assert set(seen_quotes) == {"系统采用 Redis 7.0 作为缓存"}


class TestFencingRecheck:
    """The entry-point token check cannot protect a run that executes for
    minutes: every env write must re-read the token and stand down when a
    newer run has taken over."""

    @pytest.mark.asyncio
    async def test_token_rotated_mid_run_skips_convergence_write(self):
        env = _env()
        recorder = Recorder()

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            recorder.token = "tok-2"  # concurrent edit rotated the token
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "superseded"
        assert "env_save" not in recorder.events  # full-field write dropped
        assert env.status == "pending"  # the user's edit state survives
        assert env.verified_snapshot is None
        final_run = recorder.run_updates[-1]
        assert final_run["status"] == "aborted"
        assert final_run["reason"] == "superseded"

    @pytest.mark.asyncio
    async def test_token_rotated_during_mock_prepare_skips_env_save(self):
        draft = MockDraft(
            name="AI 模拟项目",
            background="模拟背景采用 MySQL 8.0 存储。",
            period_start="2025.02",
            period_end="2025.09",
        )
        recorder = Recorder()

        async def render_mock(**kwargs):
            recorder.token = "tok-2"  # user PUT raced the generation call
            return draft

        env = _env(
            source_type="mock",
            background="",
            period_start="",
            period_end="",
        )
        result, _ = await _run(env, recorder, mode="mock", render_mock=render_mock)

        assert result.status == "superseded"
        assert "env_save" not in recorder.events
        final_run = recorder.run_updates[-1]
        assert final_run["status"] == "aborted"
        assert final_run["reason"] == "superseded"


class TestQuoteDrift:
    @pytest.mark.asyncio
    async def test_extraction_drops_llm_claims_missing_from_text(self):
        env = _env()
        recorder = Recorder()
        drifted = [
            {"quote": "文中不存在的幻觉句子", "field": "background", "type": "semantic"}
        ]

        result, _ = await _run(
            env, recorder, extract_claims_llm=AsyncMock(return_value=drifted)
        )

        assert result.status == "verified"
        assert result.summary["total"] == 2  # only regex-extractable quotes
        run_points = recorder.run_updates[-1]["points"]
        assert "文中不存在的幻觉句子" not in {p["quote"] for p in run_points}

    @pytest.mark.asyncio
    async def test_correction_quote_drift_marks_manual_review(self, monkeypatch):
        monkeypatch.setenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS", "2")
        # a stale run row whose quote predates the user's concurrent edit
        resume_rows = [
            {
                "id": "project_env_verification:r1",
                "token": TOKEN,
                "status": "running",
                "points": [
                    {
                        "point_id": "p1",
                        "quote": "系统采用 Redis 7.0 作为缓存",
                        "field": "background",
                        "state": "pending",
                        "rounds": [],
                    }
                ],
            }
        ]
        env = _env(background="用户并发编辑后的全新文本。", tech_background="")
        recorder = Recorder(resume_rows=resume_rows)

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            return {"verdict": "fail", "issues": ["证据不足"]}

        correct = AsyncMock(return_value="修正后的句子。")
        result, _ = await _run(env, recorder, lanes=lanes, correct_point=correct)

        assert result.status == "needs_review"
        correct.assert_awaited_once()
        claims = env.pending_claims or []
        assert claims
        assert claims[0]["reason_code"] == "quote_drift"
        # the un-applied correction never replaces the user's text
        assert env.background == "用户并发编辑后的全新文本。"


class TestConditionalWriteFencing:
    """_fail_env/_set_progress bypass ObjectModel.save, so their raw UPDATEs
    must carry their own token guard — verified against a live SurrealDB the
    WHERE-conditional form writes only when the token still matches (and the
    param must not be named $token, which SurrealDB reserves)."""

    @pytest.mark.asyncio
    async def test_fail_env_update_is_token_guarded(self):
        captured: list = []

        async def fake_repo_query(sql, params=None):
            captured.append((sql, params))
            return []

        import commands.project_env_commands as cmd

        with patch.object(cmd, "repo_query", fake_repo_query):
            await cmd._fail_env("project_env:e1", "boom", "tok-1")

        sql, params = next((s, p) for s, p in captured if "SET status = 'failed'" in s)
        assert "verification_token = $fence" in sql
        assert params["fence"] == "tok-1"

    @pytest.mark.asyncio
    async def test_fail_env_without_token_stays_unconditional(self):
        captured: list = []

        async def fake_repo_query(sql, params=None):
            captured.append((sql, params))
            return []

        import commands.project_env_commands as cmd

        with patch.object(cmd, "repo_query", fake_repo_query):
            await cmd._fail_env("project_env:e1", "boom")

        sql, _ = next((s, p) for s, p in captured if "SET status = 'failed'" in s)
        assert "verification_token" not in sql


class TestLaneFailures:
    @pytest.mark.asyncio
    async def test_lane_configuration_error_propagates(self):
        import open_notebook.ai.project_env_pipeline as pipeline

        async def raising_provision(*args, **kwargs):
            raise ConfigurationError("no chat model configured")

        with (
            patch(
                "open_notebook.ai.project_env_pipeline.provision_langchain_model_with_info",
                side_effect=raising_provision,
            ),
            patch(
                "open_notebook.ai.project_env_pipeline.gather_evidence",
                new_callable=AsyncMock,
                return_value="(空)",
            ),
        ):
            with pytest.raises(ConfigurationError):
                await pipeline.verify_point_lane(
                    lane="A", quote="x", field="background", context={}
                )

    @pytest.mark.asyncio
    async def test_lane_configuration_error_fails_env_permanently(self):
        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            raise ConfigurationError("no chat model configured")

        env = _env()
        recorder = Recorder()
        patches, _ = _patches(recorder, env, lanes=lanes)
        with ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            with pytest.raises(ConfigurationError):
                await verify_project_env_command(
                    VerifyProjectEnvInput(env_id=ENV_ID, mode="material", token=TOKEN)
                )
        assert "env_failed" in recorder.events


class TestPreconditions:
    @pytest.mark.asyncio
    async def test_empty_kb_mock_fails_fast(self):
        env = _env(source_type="mock")
        recorder = Recorder(sources=0, notes=0)
        with pytest.raises(ValueError):
            await _run(env, recorder, mode="mock")
        assert "env_failed" in recorder.events
        assert recorder.failed

    @pytest.mark.asyncio
    async def test_empty_kb_material_degrades_lane_a(self):
        env = _env()
        recorder = Recorder(sources=0, notes=0)
        result, _ = await _run(env, recorder, mode="material")

        assert result.status == "verified"
        created = dict(recorder.created_rows[0][1])
        assert created["degraded"]["lane_a"] == "kb_empty_anchor_only"
        # frontend reads kb_empty; the run row persists it at create time
        assert created["degraded"]["kb_empty"] is True
        # lane models all default -> single model flag
        assert created["degraded"]["single_model"] is True

    @pytest.mark.asyncio
    async def test_missing_default_model_raises_configuration_error(self):
        env = _env()
        recorder = Recorder()

        async def no_default(sql, params=None):
            # DefaultModels.get_instance uses the repo_query from its own module
            if "FROM ONLY" in sql:
                return [{}]
            return await recorder.query(sql, params)

        async def fake_get(env_id):
            return env

        from open_notebook.exceptions import ConfigurationError

        with (
            patch("commands.project_env_commands.ProjectEnv.get", side_effect=fake_get),
            patch("open_notebook.ai.models.repo_query", side_effect=no_default),
            patch(
                "commands.project_env_commands.repo_query", side_effect=recorder.query
            ),
            patch(
                "commands.project_env_commands.repo_create", side_effect=recorder.create
            ),
        ):
            with pytest.raises(ConfigurationError):
                await verify_project_env_command(
                    VerifyProjectEnvInput(env_id=ENV_ID, mode="material", token=TOKEN)
                )
        assert "env_failed" in recorder.events


class TestBudgetAndRounds:
    @pytest.mark.asyncio
    async def test_rounds_clamped_to_bounds(self, monkeypatch):
        from open_notebook.ai.project_env_pipeline import get_max_correction_rounds

        monkeypatch.setenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS", "0")
        assert get_max_correction_rounds() == 1
        monkeypatch.setenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS", "9")
        assert get_max_correction_rounds() == 4
        monkeypatch.delenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS")
        assert get_max_correction_rounds() == 2

    @pytest.mark.asyncio
    async def test_call_budget_default_cap_is_200(self, monkeypatch):
        """T5: the hard stop defaults to 200 LLM calls without env tuning."""
        from open_notebook.ai.project_env_pipeline import CallBudget

        monkeypatch.delenv("PROJECT_ENV_LLM_CALL_CAP", raising=False)
        budget = CallBudget()
        assert budget.cap == 200
        assert budget.exhausted is False
        monkeypatch.setenv("PROJECT_ENV_LLM_CALL_CAP", "garbage")
        assert CallBudget().cap == 200  # unparseable falls back to the default

    @pytest.mark.asyncio
    async def test_cost_cap_hard_stops_remaining_points(self, monkeypatch):
        monkeypatch.setenv("PROJECT_ENV_LLM_CALL_CAP", "3")
        monkeypatch.setattr(
            "commands.project_env_commands.LANE_CONCURRENCY", 1
        )  # deterministic spend order
        env = _env(
            tech_background="",
            background=(
                "句子一采用 Redis 7.0。"
                "句子二采用 Kafka 3.7。"
                "句子三采用 Elasticsearch 8.0。"
            ),
        )

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            if budget is not None and not budget.exhausted:
                budget.spend()
                return {"verdict": "pass", "issues": []}
            return {"verdict": "fail", "issues": ["budget"]}

        recorder = Recorder()
        result, _ = await _run(env, recorder, lanes=lanes)

        assert result.status == "needs_review"
        # points beyond the cap become cost_cap manual reviews
        run_points = recorder.run_updates[-1]["points"]
        states = {p["state"] for p in run_points}
        assert "manual_review" in states
        cap_points = [p for p in run_points if p.get("manual_reason") == "cost_cap"]
        assert cap_points, "cap-exhausted points must be marked cost_cap"
        monkeypatch.delenv("PROJECT_ENV_LLM_CALL_CAP")


class TestWriteOrdering:
    @pytest.mark.asyncio
    async def test_run_row_written_before_env_on_convergence(self):
        env = _env()
        recorder = Recorder()
        await _run(env, recorder)

        assert recorder.events.index("run_write") < recorder.events.index("env_save")
        final_run = recorder.run_updates[-1]
        assert final_run["status"] == "completed"
        assert final_run["summary"]["total"] >= 1
        assert "llm_calls" in final_run  # patched lanes spend nothing
