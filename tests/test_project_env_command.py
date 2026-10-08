"""Tests for verify_project_env_command (commands/project_env_commands.py).

All LLM seams (pipeline functions / provisioning) and DB writes are patched;
write ordering and fencing behavior are asserted from the recorded calls.
"""

import asyncio
import copy
from contextlib import ExitStack
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from commands.project_env_commands import (
    GenerateProjectEnvMaterialsInput,
    VerifyProjectEnvInput,
    _prescreen_version_points,
    generate_project_env_materials_command,
    verify_project_env_command,
)
from open_notebook.ai.project_env_pipeline import (
    MaterialItem,
    MaterialsBundle,
    MockDraft,
    RoutePeriod,
    RouteProposal,
    RoutesBundle,
)
from open_notebook.domain.project_env import TEXT_FIELDS, ProjectEnv
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

    def __init__(
        self,
        resume_rows=None,
        sources=5,
        notes=2,
        token=TOKEN,
        db_generic_paragraph=None,
        rotate_token_after=None,
    ):
        self.resume_rows = resume_rows or []
        self.sources = sources
        self.notes = notes
        self.token = token  # what the DB would return for verification_token
        self.db_generic_paragraph = db_generic_paragraph
        # models a user PUT rotating the token mid-run: after the Nth
        # verification_token read the DB starts returning a different token
        self.rotate_token_after = rotate_token_after
        self.token_reads = 0
        self.events = []  # ordered write log for ordering assertions
        self.progress_updates = []
        self.created_rows = []
        self.run_updates = []
        self.paragraph_updates = []  # (sql, params) of fenced paragraph writes
        self.failed = False

    async def query(self, sql, params=None):
        if "FROM ONLY" in sql:
            return [{"default_chat_model": "model:chat"}]
        if "SELECT verification_token FROM project_env" in sql:
            self.token_reads += 1
            current = self.token
            if (
                self.rotate_token_after is not None
                and self.token_reads > self.rotate_token_after
            ):
                current = "tok-rotated"
            return [{"verification_token": current}]
        if "SELECT generic_paragraph FROM project_env" in sql:
            return [{"generic_paragraph": self.db_generic_paragraph}]
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
        if "SET generic_paragraph = $paragraph" in sql:
            self.paragraph_updates.append((sql, params))
            self.events.append("paragraph_write")
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

    async def lane_call(
        lane, quote, field, context, budget=None, lane_model=None, mode="material"
    ):
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
        # _converge auto-generates a generic paragraph for converged envs
        "render_generic_paragraph": AsyncMock(return_value="自动生成的通用段落。"),
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
    async def test_empty_material_fails_instead_of_vacuous_verified(self):
        """Zero extracted claims must fail the env — an all-pass on an empty
        point set must never converge to verified (the lost-keywords bug)."""
        env = _env(background="", tech_background="", keywords=[], tuning_process=None)
        recorder = Recorder()
        with pytest.raises(ValueError, match="no claims extracted"):
            await _run(env, recorder)

        assert "env_failed" in recorder.events

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
        last = recorder.progress_updates[-1]
        assert last["stage"] == "verified" and last["percent"] == 100

    @pytest.mark.asyncio
    async def test_converge_generates_generic_paragraph_when_empty(self):
        """收敛成功且段落为空 → 生成结果经围栏 UPDATE 落库（industry 透传），
        不进内存 env、不随 env.save() 走。"""
        env = _env(industry="物流行业")
        recorder = Recorder()
        mock_render = AsyncMock(return_value="自动生成的通用段落。")
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        mock_render.assert_awaited_once()
        kwargs = mock_render.await_args.kwargs
        assert kwargs["industry"] == "物流行业"
        assert kwargs["candidate"] == env.candidate_fields()
        assert env.generic_paragraph is None  # in-memory env stays untouched
        assert "env_save" in recorder.events
        assert recorder.events.index("paragraph_write") > recorder.events.index(
            "env_save"
        ), "段落必须在验证结果落库之后才写"
        assert len(recorder.paragraph_updates) == 1
        sql, params = recorder.paragraph_updates[0]
        assert params["paragraph"] == "自动生成的通用段落。"
        assert params["fence"] == TOKEN
        # WHERE 双条件：token 未轮换 + DB 段落仍为空白
        assert "verification_token = $fence" in sql
        assert "generic_paragraph = NONE OR string::trim(generic_paragraph) = ''" in sql

    @pytest.mark.asyncio
    async def test_converge_generates_generic_paragraph_when_whitespace_only(self):
        """段落是纯空白（"  \\n  "）等同于为空：必须触发生成，围栏 UPDATE 的
        WHERE 也按 trim 后判空，能把旧空白值覆盖掉。"""
        env = _env(generic_paragraph="  \n  ")
        recorder = Recorder()
        mock_render = AsyncMock(return_value="空白后生成的段落。")
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        mock_render.assert_awaited_once()
        assert len(recorder.paragraph_updates) == 1
        assert recorder.paragraph_updates[0][1]["paragraph"] == "空白后生成的段落。"

    @pytest.mark.asyncio
    async def test_converge_needs_review_also_generates_generic_paragraph(self):
        """needs_review 收敛路径同样默认生成：生成发生在收敛写库之后，与
        最终状态无关，两条路径行为必须一致。"""

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            if lane == "B":
                return {"verdict": "error", "issues": ["timeout"]}
            return {"verdict": "pass", "issues": []}

        env = _env(industry="物流行业")
        recorder = Recorder()
        mock_render = AsyncMock(return_value="待复核环境的通用段落。")
        result, mocks = await _run(
            env, recorder, lanes=lanes, render_generic_paragraph=mock_render
        )

        assert result.status == "needs_review"
        assert env.status == "needs_review"
        mock_render.assert_awaited_once()
        kwargs = mock_render.await_args.kwargs
        assert kwargs["industry"] == "物流行业"
        assert len(recorder.paragraph_updates) == 1
        assert recorder.paragraph_updates[0][1]["paragraph"] == "待复核环境的通用段落。"

    @pytest.mark.asyncio
    async def test_converge_keeps_existing_generic_paragraph(self):
        """用户已写过的段落绝不被自动生成覆盖。"""
        env = _env(generic_paragraph="用户手写的段落。")
        recorder = Recorder()
        mock_render = AsyncMock(return_value="不应出现的自动段落。")
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        mock_render.assert_not_awaited()
        assert env.generic_paragraph == "用户手写的段落。"
        assert recorder.paragraph_updates == []

    @pytest.mark.asyncio
    async def test_converge_generic_paragraph_failure_does_not_affect_verification(
        self,
    ):
        """生成抛异常只是 warning：状态/快照/进度照常落库。"""
        env = _env()
        recorder = Recorder()
        mock_render = AsyncMock(side_effect=RuntimeError("model boom"))
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        assert env.status == "verified"
        assert env.generic_paragraph is None
        assert env.verified_snapshot and "frozen_at" in env.verified_snapshot
        assert env.verification_progress["stage"] == "done"
        assert "env_save" in recorder.events
        assert recorder.paragraph_updates == []

    @pytest.mark.asyncio
    async def test_converge_merges_db_paragraph_before_save(self):
        """运行中用户保存的段落（DB 有、内存空）必须在 env.save() 前合并回
        内存，否则全字段 save 会回滚用户写入；合并后不再触发生成。"""
        env = _env()
        recorder = Recorder(db_generic_paragraph="用户运行中保存的段落。")
        mock_render = AsyncMock(return_value="不应生成。")
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        assert env.generic_paragraph == "用户运行中保存的段落。"
        mock_render.assert_not_awaited()
        assert recorder.paragraph_updates == []

    @pytest.mark.asyncio
    async def test_converge_skips_paragraph_write_when_token_rotated(self):
        """生成窗口内用户 PUT 轮换了 token → 写前复查失败，静默放弃：
        验证结果已落库，不得 raise，也不得写段落。"""
        env = _env()
        # 第一次 token 读（收敛围栏）返回原 token，之后读返回轮换值
        recorder = Recorder(rotate_token_after=1)
        mock_render = AsyncMock(return_value="迟到的段落。")
        result, mocks = await _run(env, recorder, render_generic_paragraph=mock_render)

        assert result.status == "verified"
        mock_render.assert_awaited_once()
        assert recorder.paragraph_updates == []

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
        # the UI stepper walks drafting → extracting → verifying → terminal
        stages = [u["stage"] for u in recorder.progress_updates]
        assert "drafting" in stages and "extracting" in stages
        assert stages[-1] == "verified" and stages[-2] == "converging"

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
    async def test_lane_error_degrades_to_needs_review_with_llm_error_reason(self):
        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            if lane == "B":
                return {"verdict": "error", "issues": ["timeout"]}
            return {"verdict": "pass", "issues": []}

        env = _env()
        recorder = Recorder()
        correct = AsyncMock()
        result, _ = await _run(env, recorder, lanes=lanes, correct_point=correct)

        correct.assert_not_awaited()  # error points never enter correction
        assert result.status == "needs_review"
        assert result.summary["failed"] == 2  # both points degraded to error
        claims = env.pending_claims or []
        assert claims and all(c["reason_code"] == "llm_error" for c in claims)
        # the run completes and persists the error points for the retry path
        final_run = recorder.run_updates[-1]
        assert final_run["status"] == "completed"
        assert all(p["state"] == "error" for p in final_run["points"])
        assert "env_failed" not in recorder.events
        assert not recorder.progress_updates[-1]["error"]

    @pytest.mark.asyncio
    async def test_mixed_error_and_pass_points_degrade_only_the_error_point(self):
        """One erroring point must not take the passed ones down with it: the
        run completes, only the error point lands in pending_claims."""

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            if lane == "B" and "Redis" in quote:
                return {"verdict": "error", "issues": ["timeout"]}
            return {"verdict": "pass", "issues": []}

        env = _env()  # Redis 7.0 point + Spring Boot 3.2 point
        recorder = Recorder()
        correct = AsyncMock()
        result, _ = await _run(env, recorder, lanes=lanes, correct_point=correct)

        correct.assert_not_awaited()  # error points never enter correction
        assert result.status == "needs_review"
        assert env.status == "needs_review"
        assert result.summary == {
            "total": 2,
            "passed": 1,
            "failed": 1,
            "manual": 0,
            "uncovered": 0,
        }
        claims = env.pending_claims
        assert claims is not None
        assert len(claims) == 1  # only the error point, passed point excluded
        assert "Redis" in claims[0]["quote"]
        assert claims[0]["reason_code"] == "llm_error"
        assert claims[0]["lanes_summary"]["B"]["verdict"] == "error"
        final_run = recorder.run_updates[-1]
        assert final_run["status"] == "completed"
        states = {p["quote"]: p["state"] for p in final_run["points"]}
        # paragraph granularity: the whole background sentence pair is ONE point
        assert states == {
            "系统采用 Redis 7.0 作为缓存。整体高并发。": "error",
            "Spring Boot 3.2 微服务架构。": "passed",
        }
        assert "env_failed" not in recorder.events

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


class TestMockModeLanes:
    """Mock mode drops lane A (a fictional project has no KB evidence) and
    off_table prescreens defer to lane B's plausibility judgement."""

    @pytest.mark.asyncio
    async def test_mock_mode_runs_only_lanes_b_and_c(self):
        env = _env(
            source_type="mock",
            draft_content={"background": "推理服务采用 vLLM 0.6 部署。"},
            background="",
        )
        recorder = Recorder()
        seen_lanes = []

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            seen_lanes.append(lane)
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, mode="mock", lanes=lanes)

        assert set(seen_lanes) == {"B", "C"}
        assert result.status == "verified"

    @pytest.mark.asyncio
    async def test_mock_mode_off_table_prescreen_defers_to_lane_b(self):
        env = _env(
            source_type="mock",
            draft_content={"background": "数据管道采用 Flink 1.18 计算。"},
            background="",
        )
        recorder = Recorder()

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, mode="mock", lanes=lanes)

        assert result.status == "verified"
        run_points = recorder.run_updates[-1]["points"]
        off_table = [
            p
            for p in run_points
            if (p.get("prescreen") or {}).get("status") == "off_table"
        ]
        assert off_table, "Flink is not in the anchor table"
        assert all(p.get("state") == "passed" for p in off_table)
        assert all("manual_reason" not in p for p in off_table)

    @pytest.mark.asyncio
    async def test_material_mode_off_table_prescreen_still_routes_manual_review(self):
        env = _env(tech_background="服务端采用 Flink 1.18 开发。")
        recorder = Recorder()
        result, _ = await _run(env, recorder, mode="material")

        assert result.status == "needs_review"
        claims = env.pending_claims or []
        assert claims
        assert any(c["reason_code"] == "off_table" for c in claims)


class TestPrescreenModes:
    def _version_point(self):
        return [
            {
                "point_id": "p1",
                "quote": "采用 Flink 1.18 计算",
                "field": "background",
                "type": "version",
                "state": "pending",
            }
        ]

    def test_material_mode_off_table_marks_manual_review(self):
        points = self._version_point()
        _prescreen_version_points(points, "2025.01", mode="material")

        assert points[0]["state"] == "manual_review"
        assert points[0]["manual_reason"] == "off_table"
        assert points[0]["prescreen"]["status"] == "off_table"

    def test_mock_mode_off_table_only_marks_prescreen(self):
        points = self._version_point()
        _prescreen_version_points(points, "2025.01", mode="mock")

        assert points[0]["state"] == "pending"
        assert "manual_reason" not in points[0]
        assert points[0]["prescreen"]["status"] == "off_table"


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


class TestLaneModeSemantics:
    @pytest.mark.asyncio
    async def test_lane_b_mock_mode_rejects_off_table_and_reaches_template(self):
        import open_notebook.ai.project_env_pipeline as pipeline
        from open_notebook.ai.project_env_pipeline import LaneVerdict

        captured = {}

        async def fake_invoke(
            template, data, result_model, model_id, budget, validator=None
        ):
            captured["data"] = data
            captured["validator"] = validator
            return LaneVerdict(verdict="pass", issues=[])

        with patch(
            "open_notebook.ai.project_env_pipeline._invoke_json", new=fake_invoke
        ):
            verdict = await pipeline.verify_point_lane(
                lane="B", quote="x", field="background", context={}, mode="mock"
            )

        assert verdict["verdict"] == "pass"
        assert captured["data"]["mode"] == "mock"
        # mock mode must force a plausibility judgement, never a table bounce
        assert captured["validator"](LaneVerdict(verdict="off_table")) != ""
        assert captured["validator"](LaneVerdict(verdict="pass")) == ""

    @pytest.mark.asyncio
    async def test_lane_b_material_mode_still_allows_off_table(self):
        import open_notebook.ai.project_env_pipeline as pipeline
        from open_notebook.ai.project_env_pipeline import LaneVerdict

        captured = {}

        async def fake_invoke(
            template, data, result_model, model_id, budget, validator=None
        ):
            captured["validator"] = validator
            return LaneVerdict(verdict="pass", issues=[])

        with patch(
            "open_notebook.ai.project_env_pipeline._invoke_json", new=fake_invoke
        ):
            verdict = await pipeline.verify_point_lane(
                lane="B", quote="x", field="background", context={}
            )

        assert verdict["verdict"] == "pass"
        assert captured["validator"](LaneVerdict(verdict="off_table")) == ""


class TestPreconditions:
    @pytest.mark.asyncio
    async def test_empty_kb_mock_runs_without_kb_reads(self):
        """Mock verification never reads the KB: an empty library must neither
        block the run nor mark it degraded (the fail-fast is gone)."""

        class NoKbReadRecorder(Recorder):
            async def query(self, sql, params=None):
                assert "FROM source" not in sql and "FROM note" not in sql, (
                    f"mock run must not read the KB, got: {sql[:80]}"
                )
                return await super().query(sql, params)

        env = _env(
            source_type="mock",
            draft_content={"background": "推理服务采用 vLLM 0.6 部署。"},
            background="",
        )
        recorder = NoKbReadRecorder(sources=0, notes=0)

        def lanes(lane, quote, field, context, budget=None, lane_model=None):
            return {"verdict": "pass", "issues": []}

        result, _ = await _run(env, recorder, mode="mock", lanes=lanes)

        assert result.status == "verified"
        assert "env_failed" not in recorder.events
        created = dict(recorder.created_rows[0][1])
        assert "kb_empty" not in created["degraded"]
        assert "lane_a" not in created["degraded"]

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
            # paragraph granularity needs separate paragraphs for separate points
            background=(
                "句子一采用 Redis 7.0。\n"
                "句子二采用 Kafka 3.7。\n"
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


class TestRateLimitBackoff:
    @pytest.mark.asyncio
    async def test_invoke_json_sleeps_before_retrying_rate_limit(self):
        from open_notebook.ai import project_env_pipeline as pipeline

        calls = {"n": 0}
        sleeps: list[float] = []

        class _Prov:
            langchain_model = None

        async def fake_provision(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError(
                    "Error code: 429 - {'error': {'code': '1302', "
                    "'message': 'rate limit'}}"
                )
            raise AssertionError("second attempt must not run after cap")  # noqa

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        with (
            patch.object(
                pipeline, "provision_langchain_model_with_info", fake_provision
            ),
            patch.object(pipeline.asyncio, "sleep", fake_sleep),
        ):
            result = await pipeline._invoke_json(
                "project_env/verify_c", {}, pipeline.LaneVerdict, None, None
            )

        assert result is None  # both attempts failed (second is a parse path)
        assert calls["n"] >= 1
        assert 8 in sleeps  # backoff fired on the 429 before retrying

    @pytest.mark.asyncio
    async def test_invoke_json_no_backoff_on_plain_errors(self):
        from open_notebook.ai import project_env_pipeline as pipeline

        sleeps: list[float] = []

        async def fake_provision(*args, **kwargs):
            raise RuntimeError("connection reset by peer")

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        with (
            patch.object(
                pipeline, "provision_langchain_model_with_info", fake_provision
            ),
            patch.object(pipeline.asyncio, "sleep", fake_sleep),
        ):
            await pipeline._invoke_json(
                "project_env/verify_c", {}, pipeline.LaneVerdict, None, None
            )

        assert sleeps == []  # non-rate-limit errors retry immediately

    @pytest.mark.asyncio
    async def test_invoke_json_times_out_hung_model_calls(self):
        """挂死的模型调用必须被超时兜住：两次尝试后返回 None 而不是永久等待。"""
        from open_notebook.ai import project_env_pipeline as pipeline

        calls = {"n": 0}

        class _Model:
            async def ainvoke(self, prompt):
                calls["n"] += 1
                await asyncio.Event().wait()  # never resolves

        class _Prov:
            langchain_model = _Model()

        async def fake_provision(prompt, model_id, kind, max_tokens=4096):
            return _Prov()

        with (
            patch.object(
                pipeline, "provision_langchain_model_with_info", fake_provision
            ),
            patch.object(pipeline, "LLM_CALL_TIMEOUT_SECONDS", 0.05),
        ):
            result = await pipeline._invoke_json(
                "project_env/verify_c", {}, pipeline.LaneVerdict, None, None
            )

        assert result is None
        assert calls["n"] == 2  # timeout counts as a failed attempt, retried once


class TestMaterialsOutputBudget:
    @pytest.mark.asyncio
    async def test_generate_materials_raises_output_cap(self):
        """18 条素材束是全管线最大单次 JSON 输出，必须高于默认 4096 上限。"""
        from open_notebook.ai import project_env_pipeline as pipeline

        seen: list[int] = []

        class _Model:
            async def ainvoke(self, prompt):
                return SimpleNamespace(
                    content=(
                        '{"items": [{"category": "background", "title": "t", '
                        '"text": "片段", "tags": []}]}'
                    )
                )

        class _Prov:
            langchain_model = _Model()

        async def fake_provision(prompt, model_id, kind, max_tokens=4096):
            seen.append(max_tokens)
            return _Prov()

        with patch.object(
            pipeline, "provision_langchain_model_with_info", fake_provision
        ):
            result = await pipeline.generate_materials(
                keywords=["微服务"], name=None, period_start=None, period_end=None
            )

        assert result is not None
        assert seen == [8192]


# --- materials candidate generation (素材生成步骤) ---


def _materials_bundle(valid=6, extra_invalid=0):
    categories = [
        "background",
        "tech_background",
        "tuning_process",
        "problems_solutions",
        "my_role",
        "scale",
    ]
    items = [
        MaterialItem(
            category=categories[i % len(categories)],
            title=f"素材 {i}",
            text=f"片段 {i} 采用 Redis 7.0 缓存。",
            tags=["测试"],
        )
        for i in range(valid)
    ]
    items.extend(
        MaterialItem(category="bogus", title=f"坏素材 {i}", text="x", tags=[])
        for i in range(extra_invalid)
    )
    return MaterialsBundle(items=items)


def _routes_bundle(n=3):
    return RoutesBundle(
        routes=[
            RouteProposal(
                title=f"路线 {i}",
                summary="一句话概括",
                tech_stack=["Kafka 3.7", "Flink 1.18"],
                scale="团队 20 人",
                role="我担任架构师",
                highlights=["难点一"],
                period=RoutePeriod(start="2025.02", end="2025.09"),
            )
            for i in range(n)
        ]
    )


class MaterialsRecorder(Recorder):
    """Recorder that also logs token rechecks (the write fence)."""

    async def query(self, sql, params=None):
        if "SELECT verification_token FROM project_env" in sql:
            self.events.append("token_check")
        return await super().query(sql, params)


async def _run_materials(env, recorder, token=TOKEN, **pipeline_overrides):
    async def fake_get(env_id):
        return env

    async def fake_save(self_env):
        recorder.events.append("env_save")

    defaults = {
        "generate_materials": AsyncMock(return_value=_materials_bundle()),
        "generate_routes": AsyncMock(return_value=_routes_bundle()),
    }
    defaults.update(pipeline_overrides)

    async def defaults_row(sql, params=None):
        if "FROM ONLY" in sql:
            return [{"default_chat_model": "model:chat"}]
        raise AssertionError(f"unexpected ai.models query: {sql[:100]}")

    patches: list[Any] = [
        patch("commands.project_env_commands.ProjectEnv.get", side_effect=fake_get),
        patch("commands.project_env_commands.repo_query", side_effect=recorder.query),
        patch("open_notebook.ai.models.repo_query", side_effect=defaults_row),
        patch.object(ProjectEnv, "save", autospec=True, side_effect=fake_save),
    ]
    for name, value in defaults.items():
        patches.append(patch(f"open_notebook.ai.project_env_pipeline.{name}", value))
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await generate_project_env_materials_command(
            GenerateProjectEnvMaterialsInput(env_id=str(env.id), token=token)
        )
    return result, defaults


def _materials_env(**overrides) -> ProjectEnv:
    data = dict(
        id=ENV_ID,
        name="AI 模拟项目",
        background="",
        period_start="2025.02",
        period_end="2025.09",
        source_type="mock",
        keywords=["微服务", "高并发"],
        tech_background="",
        status="material_pending",
        verification_token=TOKEN,
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    data.update(overrides)
    return ProjectEnv(**data)


class TestGenerateMaterialsCommand:
    @pytest.mark.asyncio
    async def test_success_writes_both_stores_with_renumbered_ids(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        result, mocks = await _run_materials(env, recorder)

        assert result.success is True
        assert result.status == "material_ready"
        assert result.counts == {"materials": 6, "routes": 3}
        mocks["generate_materials"].assert_awaited_once()
        mocks["generate_routes"].assert_awaited_once()
        assert env.status == "material_ready"
        store = env.materials
        assert store is not None
        assert [m["id"] for m in store["materials"]["items"]] == [
            f"m{i}" for i in range(1, 7)
        ]
        assert [r["id"] for r in store["routes"]["items"]] == [
            f"r{i}" for i in range(1, 4)
        ]
        assert store["materials"]["generated_at"]
        assert store["routes"]["generated_at"]
        # progress walks materialing -> routing -> done via the fenced UPDATE
        stages = [u["stage"] for u in recorder.progress_updates]
        assert stages == ["materialing", "routing", "done"]
        # the full-field save is fenced by a token recheck right before it
        assert recorder.events.index("token_check") < recorder.events.index("env_save")

    @pytest.mark.asyncio
    async def test_industry_forwarded_to_materials_and_routes(self):
        env = _materials_env(industry="物流行业")
        recorder = MaterialsRecorder()
        result, mocks = await _run_materials(env, recorder)

        assert result.status == "material_ready"
        assert mocks["generate_materials"].await_args.kwargs["industry"] == "物流行业"
        assert mocks["generate_routes"].await_args.kwargs["industry"] == "物流行业"

    @pytest.mark.asyncio
    async def test_stale_token_is_noop(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        result, mocks = await _run_materials(env, recorder, token="other-token")

        assert result.status == "stale_token"
        assert recorder.events == []
        mocks["generate_materials"].assert_not_awaited()

    @pytest.mark.asyncio
    async def test_parse_failure_marks_failed(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        with pytest.raises(ValueError):
            await _run_materials(
                env, recorder, generate_materials=AsyncMock(return_value=None)
            )

        assert "env_failed" in recorder.events
        assert "env_save" not in recorder.events

    @pytest.mark.asyncio
    async def test_below_floor_fails_after_filtering(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        # 5 valid + 1 off-whitelist: the filter drops one, leaving 5 < 6
        with pytest.raises(ValueError):
            await _run_materials(
                env,
                recorder,
                generate_materials=AsyncMock(
                    return_value=_materials_bundle(valid=5, extra_invalid=1)
                ),
            )

        assert "env_failed" in recorder.events
        assert "env_save" not in recorder.events

    @pytest.mark.asyncio
    async def test_routes_below_floor_fails(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        with pytest.raises(ValueError):
            await _run_materials(
                env, recorder, generate_routes=AsyncMock(return_value=_routes_bundle(1))
            )

        assert "env_failed" in recorder.events

    @pytest.mark.asyncio
    async def test_category_whitelist_drops_invalid_without_error(self):
        env = _materials_env()
        recorder = MaterialsRecorder()
        result, _ = await _run_materials(
            env,
            recorder,
            generate_materials=AsyncMock(
                return_value=_materials_bundle(valid=6, extra_invalid=2)
            ),
        )

        assert result.status == "material_ready"
        assert env.materials is not None
        items = env.materials["materials"]["items"]
        assert len(items) == 6  # bogus entries silently dropped
        assert all(item["category"] in TEXT_FIELDS for item in items)
        assert [m["id"] for m in items] == [f"m{i}" for i in range(1, 7)]

    @pytest.mark.asyncio
    async def test_token_rotated_mid_run_stands_down_without_writes(self):
        env = _materials_env()
        recorder = MaterialsRecorder(token=TOKEN)

        async def slow_routes(**kwargs):
            recorder.token = "tok-2"  # a newer submission rotated the token
            return _routes_bundle()

        result, _ = await _run_materials(env, recorder, generate_routes=slow_routes)

        assert result.status == "superseded"
        assert result.success is True
        assert "env_save" not in recorder.events  # no store written
        assert "env_failed" not in recorder.events
        assert env.materials is None
        assert env.status == "material_pending"


def _selection_env(**overrides) -> ProjectEnv:
    store = {
        "materials": {
            "items": [
                {
                    "id": "m1",
                    "category": "background",
                    "title": "素材一",
                    "text": "电商平台重构背景。",
                    "tags": [],
                },
                {
                    "id": "m2",
                    "category": "tech_background",
                    "title": "素材二",
                    "text": "技术栈选型。",
                    "tags": [],
                },
                {
                    "id": "m3",
                    "category": "scale",
                    "title": "素材三",
                    "text": "团队 20 人。",
                    "tags": [],
                },
            ],
            "generated_at": "2026-10-07T10:00:00",
        },
        "routes": {
            "items": [
                {
                    "id": "r1",
                    "title": "路线一",
                    "summary": "s1",
                    "tech_stack": ["Kafka 3.7"],
                    "scale": "15 人",
                    "role": "架构师",
                    "highlights": ["h1"],
                    "period": {"start": "2025.02", "end": "2025.09"},
                },
                {
                    "id": "r2",
                    "title": "路线二",
                    "summary": "s2",
                    "tech_stack": ["Spring Boot 3.2"],
                    "scale": "25 人",
                    "role": "项目负责人",
                    "highlights": ["h2"],
                    "period": {"start": "2025.01", "end": "2025.08"},
                },
            ],
            "generated_at": "2026-10-07T10:00:00",
        },
    }
    data = dict(
        id=ENV_ID,
        name="AI 模拟项目",
        background="",
        period_start="",
        period_end="",
        source_type="mock",
        keywords=["微服务"],
        tech_background="",
        status="pending",
        verification_token=TOKEN,
        materials=store,
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    data.update(overrides)
    return ProjectEnv(**data)


def _mock_draft() -> MockDraft:
    return MockDraft(
        name="AI 模拟项目",
        background="拼装背景采用 MySQL 8.0 存储。",
        period_start="2025.02",
        period_end="2025.09",
        tech_background="拼装技术栈。",
        tuning_process="拼装调优。",
        problems_solutions="拼装问题。",
        my_role="我担任架构师。",
        scale="团队 20 人。",
    )


class TestDraftingFromSelection:
    @pytest.mark.asyncio
    async def test_materials_selection_renders_from_selection(self):
        env = _selection_env(
            materials_selection={
                "kind": "materials",
                "material_ids": ["m1", "m3"],
                "route_id": None,
                "submitted_at": "2026-10-07T11:00:00+00:00",
            }
        )
        recorder = Recorder()
        render = AsyncMock(return_value=_mock_draft())
        result, mocks = await _run(
            env,
            recorder,
            mode="mock",
            render_materials_draft=render,
        )

        assert result.status == "verified"
        render.assert_awaited_once()
        assert render.await_args is not None
        picked = render.await_args.kwargs["selected_items"]
        assert [m["id"] for m in picked] == ["m1", "m3"]
        mocks["render_mock"].assert_not_awaited()
        assert env.draft_content == _mock_draft().model_dump()
        drafting = next(
            u for u in recorder.progress_updates if u["stage"] == "drafting"
        )
        assert "选中素材" in drafting["message"]

    @pytest.mark.asyncio
    async def test_routes_selection_renders_route_draft(self):
        env = _selection_env(
            materials_selection={
                "kind": "routes",
                "material_ids": None,
                "route_id": "r2",
                "submitted_at": "2026-10-07T11:00:00+00:00",
            }
        )
        recorder = Recorder()
        render = AsyncMock(return_value=_mock_draft())
        result, mocks = await _run(
            env,
            recorder,
            mode="mock",
            render_route_draft=render,
        )

        assert result.status == "verified"
        render.assert_awaited_once()
        assert render.await_args is not None
        assert render.await_args.kwargs["route"]["id"] == "r2"
        mocks["render_mock"].assert_not_awaited()
        assert env.draft_content == _mock_draft().model_dump()

    @pytest.mark.asyncio
    async def test_selection_missing_falls_back_to_render_mock(self):
        """A selection pointing at ids that no longer exist must degrade to
        the keywords path (with a warning), never block drafting."""
        from loguru import logger as loguru_logger

        env = _selection_env(
            materials_selection={
                "kind": "materials",
                "material_ids": ["m99"],
                "route_id": None,
                "submitted_at": "2026-10-07T11:00:00+00:00",
            }
        )
        recorder = Recorder()
        render_selection = AsyncMock(return_value=_mock_draft())
        warnings: list = []
        handler = loguru_logger.add(warnings.append, level="WARNING")

        try:
            result, mocks = await _run(
                env,
                recorder,
                mode="mock",
                render_materials_draft=render_selection,
                render_mock=AsyncMock(return_value=_mock_draft()),
            )
        finally:
            loguru_logger.remove(handler)

        assert result.status == "verified"
        render_selection.assert_not_awaited()
        mocks["render_mock"].assert_awaited_once()
        assert any("falling back" in str(w) for w in warnings)
        drafting = next(
            u for u in recorder.progress_updates if u["stage"] == "drafting"
        )
        assert "关键词" in drafting["message"]

    @pytest.mark.asyncio
    async def test_industry_forwarded_to_all_draft_paths(self):
        """env.industry 必须随 common dict 下发到三条 draft 路径；为空时下发
        None（pipeline 侧回退默认行业）。"""
        # 关键词路径（materials_selection 为空）
        env = _selection_env(industry="医疗行业")
        recorder = Recorder()
        render_kw = AsyncMock(return_value=_mock_draft())
        await _run(env, recorder, mode="mock", render_mock=render_kw)
        assert render_kw.await_args is not None
        assert render_kw.await_args.kwargs["industry"] == "医疗行业"

        # 素材路径
        env = _selection_env(
            industry="医疗行业",
            materials_selection={
                "kind": "materials",
                "material_ids": ["m1"],
                "route_id": None,
                "submitted_at": "2026-10-07T11:00:00+00:00",
            },
        )
        render_mat = AsyncMock(return_value=_mock_draft())
        await _run(env, Recorder(), mode="mock", render_materials_draft=render_mat)
        assert render_mat.await_args is not None
        assert render_mat.await_args.kwargs["industry"] == "医疗行业"

        # 路线路径
        env = _selection_env(
            industry="医疗行业",
            materials_selection={
                "kind": "routes",
                "material_ids": None,
                "route_id": "r1",
                "submitted_at": "2026-10-07T11:00:00+00:00",
            },
        )
        render_route = AsyncMock(return_value=_mock_draft())
        await _run(env, Recorder(), mode="mock", render_route_draft=render_route)
        assert render_route.await_args is not None
        assert render_route.await_args.kwargs["industry"] == "医疗行业"

        # 行业为空（老行/真实来源）→ None 下发，不由命令层填默认
        env = _selection_env(industry=None)
        render_none = AsyncMock(return_value=_mock_draft())
        await _run(env, Recorder(), mode="mock", render_mock=render_none)
        assert render_none.await_args is not None
        assert render_none.await_args.kwargs["industry"] is None


class TestParagraphGranularity:
    """Paragraph-level claim units: split / extract / dedup / drift / prescreen."""

    # --- split_paragraphs ---

    def test_split_paragraphs_newlines_and_blank_lines(self):
        from open_notebook.ai.project_env_pipeline import split_paragraphs

        units = split_paragraphs("第一段。\n\n第二段。\n  \n第三段。")
        assert units == ["第一段。", "第二段。", "第三段。"]

    def test_split_paragraphs_empty_and_whitespace_only(self):
        from open_notebook.ai.project_env_pipeline import split_paragraphs

        assert split_paragraphs("") == []
        assert split_paragraphs("  \n \n") == []

    def test_split_paragraphs_long_paragraph_packed_by_sentence_under_cap(self):
        from open_notebook.ai.project_env_pipeline import (
            PARAGRAPH_MAX_CHARS,
            split_paragraphs,
        )

        sentence = "字" * 300 + "。"
        units = split_paragraphs(sentence * 3)
        assert all(len(u) <= PARAGRAPH_MAX_CHARS for u in units)
        assert "".join(units) == sentence * 3

    def test_split_paragraphs_oversized_sentence_stays_whole(self):
        from open_notebook.ai.project_env_pipeline import (
            PARAGRAPH_MAX_CHARS,
            split_paragraphs,
        )

        giant = "字" * (PARAGRAPH_MAX_CHARS + 100)
        assert split_paragraphs(giant) == [giant]

    # --- extract_claims_regex ---

    def test_extract_claims_regex_paragraph_yields_single_version_claim(self):
        from open_notebook.ai.project_env_pipeline import extract_claims_regex

        paragraph = "缓存采用 Redis 7.0，日均处理 300 万条，超时设为 500。"
        claims = extract_claims_regex({"background": paragraph})
        assert len(claims) == 1
        assert claims[0]["type"] == "version"  # priority: version > metric > param
        assert claims[0]["quote"] == paragraph
        assert claims[0]["field"] == "background"

    def test_extract_claims_regex_skips_plain_paragraphs(self):
        from open_notebook.ai.project_env_pipeline import extract_claims_regex

        claims = extract_claims_regex({"background": "整体运行平稳。\n叙事性描述。"})
        assert claims == []

    # --- dedup_claims ---

    def test_dedup_claims_merges_whitespace_variants(self):
        from open_notebook.ai.project_env_pipeline import dedup_claims

        claims = [
            {"quote": "系统采用 Redis 7.0 作为缓存。", "field": "background"},
            {"quote": "系统采用 Redis 7.0 作为  缓存。", "field": "background"},
        ]
        assert len(dedup_claims(claims)) == 1

    def test_dedup_claims_keeps_distinct_paragraphs_sharing_prefix(self):
        from open_notebook.ai.project_env_pipeline import dedup_claims

        head = "字" * 120
        claims = [
            {"quote": head + "第一段结尾。", "field": "background"},
            {"quote": head + "第二段结尾。", "field": "background"},
        ]
        assert len(dedup_claims(claims)) == 2

    # --- _drop_drifted_claims ---

    def test_drop_drifted_claims_rewrites_quote_to_verbatim(self):
        from commands.project_env_commands import _drop_drifted_claims

        text = "系统采用 Redis 7.0 作为缓存。"
        claims = [{"quote": "系统采用 Redis 7.0 作为  缓存。", "field": "background"}]
        kept = _drop_drifted_claims(claims, {"background": text})
        assert len(kept) == 1
        assert kept[0]["quote"] == text  # exact original substring

    def test_drop_drifted_claims_drops_hallucinated_quote(self):
        from commands.project_env_commands import _drop_drifted_claims

        claims = [{"quote": "这句话不在材料里。", "field": "background"}]
        assert (
            _drop_drifted_claims(claims, {"background": "系统采用 Redis 7.0。"}) == []
        )

    # --- _find_verbatim ---

    def test_find_verbatim_handles_regex_metacharacters_in_quote(self):
        """LLM quotes carry ( ) [ ] * freely; locating them must never raise
        re.error and must stay whitespace-tolerant against the original."""
        from open_notebook.ai.project_env_pipeline import _find_verbatim

        text = "消息队列采用 Kafka（3.6）[KRaft]* 模式部署。"
        verbatim = _find_verbatim(text, "Kafka（3.6） [KRaft] *  模式")
        assert verbatim == "Kafka（3.6）[KRaft]* 模式"

        # an unterminated '[' would raise re.error if the quote went into the
        # regex unescaped; escaped it is just an unmatched literal
        absent = _find_verbatim(text, "消息队列 [Kafka 集群")
        assert absent is None

    # --- prescreen_quote ---

    def test_prescreen_quote_fail_wins_over_pass(self):
        from open_notebook.ai.project_env_pipeline import prescreen_quote

        result = prescreen_quote("数据层用 MySQL 8.0，缓存层用 Redis 7.2。", "2023.01")
        assert result["status"] == "fail"

    def test_prescreen_quote_off_table_wins_over_pass(self):
        from open_notebook.ai.project_env_pipeline import prescreen_quote

        result = prescreen_quote("存储用 HyperDB 2.0，缓存用 Redis 7.0。", "2025.01")
        assert result["status"] == "off_table"

    def test_prescreen_quote_all_in_table_passes(self):
        from open_notebook.ai.project_env_pipeline import prescreen_quote

        result = prescreen_quote("缓存采用 Redis 7.0。", "2025.01")
        assert result["status"] == "pass"

    def test_prescreen_quote_without_version_is_unspecified(self):
        from open_notebook.ai.project_env_pipeline import prescreen_quote

        assert prescreen_quote("整体高并发。", "2025.01")["status"] == "unspecified"

    # --- correct_point ---

    @pytest.mark.asyncio
    async def test_correct_point_requests_4096_tokens(self, monkeypatch):
        from open_notebook.ai import project_env_pipeline as pipeline

        captured: dict = {}

        class _Prov:
            class langchain_model:  # noqa: N801 - attribute stub
                @staticmethod
                async def ainvoke(prompt):
                    return SimpleNamespace(content="改好的段落")

        async def fake_provision(prompt, model_id, kind, max_tokens=None):
            captured["max_tokens"] = max_tokens
            return _Prov()

        monkeypatch.setattr(
            pipeline, "provision_langchain_model_with_info", fake_provision
        )
        result = await pipeline.correct_point(
            quote="错误段落。",
            field="background",
            issues=["GA 晚于开工"],
            context={"narrative": "", "period_start": "2025.01", "period_end": ""},
        )
        assert result == "改好的段落"
        assert captured["max_tokens"] == 4096
