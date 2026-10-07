"""API tests for project envs (routers/project_envs.py + chat session binding).

All DB and LLM seams are patched: ProjectEnv persistence, repo_query,
CommandService jobs and the pipeline functions imported by the router.
"""

import json
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.project_env import ProjectEnv
from open_notebook.exceptions import InvalidInputError, NotFoundError

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _env(**overrides) -> ProjectEnv:
    data = dict(
        id="project_env:e1",
        name="电商平台重构",
        background="某电商平台微服务化改造项目",
        period_start="2025.01",
        period_end="2025.08",
        source_type="real",
        keywords=["微服务"],
        tech_background="Spring Boot 3.2 + Redis 7.0",
        status="verified",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )
    data.update(overrides)
    return ProjectEnv(**data)


def _usage_dispatch(
    usage_rows=None, note_rows=None, verification_rows=None, env_token="t1"
):
    """Route repo_query by SQL text."""

    async def _dispatch(query, params=None):
        if "SELECT verification_token FROM project_env" in query:
            return [{"verification_token": env_token}]
        if "FROM chat_session" in query:
            return usage_rows or []
        if "FROM source" in query:
            return [{"total": 1}]
        if "FROM note" in query:
            return note_rows or [{"total": 0}]
        if "FROM project_env_verification" in query and "SELECT" in query:
            return verification_rows or []
        if "FROM refers_to" in query:
            return [{"out": "notebook:n1"}]
        if "DELETE project_env_verification" in query:
            return []
        if "UPDATE $run_id" in query:
            return []
        raise AssertionError(f"unexpected repo_query: {query[:100]}")

    return _dispatch


def _submit_job_side_effect():
    async def _submit(*args, **kwargs):
        return "command:job1"

    return _submit


# --- CRUD ---


def test_get_unknown_env_404():
    client = _client()

    async def raise_not_found(env_id):
        raise NotFoundError("missing")

    with patch("api.routers.project_envs.ProjectEnv.get", side_effect=raise_not_found):
        response = client.get("/api/project-envs/project_env:nope")

    assert response.status_code == 404


def test_create_rejects_r1_format_with_400():
    client = _client()
    payload = {
        "name": "X",
        "period_start": "2025-1",
        "period_end": "2025.08",
        "source_type": "real",
    }
    with patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock):
        response = client.post("/api/project-envs", json=payload)
    assert response.status_code == 400
    assert response.json()["detail"]["violations"][0]["rule"] == "R1"


def test_create_mock_period_violation_422():
    client = _client()
    payload = {
        "name": "X",
        "period_start": "2025.01",
        "period_end": "2025.05",  # 5 months
        "source_type": "mock",
        "background": "b",
    }
    with patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock):
        response = client.post("/api/project-envs", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"]["violations"][0]["rule"] == "R2"


def test_create_real_period_violation_warns_but_persists():
    client = _client()
    payload = {
        "name": "X",
        "period_start": "2025.01",
        "period_end": "2025.05",  # 5 months, real -> warning only
        "source_type": "real",
        "background": "b",
    }
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        saved.append(env)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(),
        ),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs", json=payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "pending"
    assert body["time_warnings"], "real R2 violation must surface as warning"
    assert body["time_warnings"][0]["rule"] == "R2"
    assert saved[0].status == "pending"
    assert saved[0].verification_token  # fencing token generated
    mock_submit.assert_awaited_once()


def test_create_submits_verification_job_with_token():
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        saved.append(env)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs",
            json={
                "name": "X",
                "period_start": "2025.01",
                "period_end": "2025.08",
                "source_type": "real",
                "background": "b",
                "background_ai_polished": True,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["ai_assisted"]["polish_count"] == 1
    assert body["has_snapshot"] is False
    submit_args = mock_submit.await_args
    assert submit_args is not None
    args = submit_args.args
    assert args[1] == "verify_project_env"
    assert args[2]["mode"] == "material"
    assert args[2]["token"] == saved[0].verification_token


def test_selectable_view_filters_pending_keeps_needs_review():
    client = _client()
    envs = [
        _env(id="project_env:v", status="verified"),
        _env(id="project_env:nr", status="needs_review"),
        _env(id="project_env:p", status="pending"),
        _env(id="project_env:f", status="failed"),
    ]
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get_all",
            new_callable=AsyncMock,
            return_value=envs,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(
                usage_rows=[{"project_env": "project_env:nr", "total": 3}]
            ),
        ),
    ):
        response = client.get("/api/project-envs?view=selectable")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == ["project_env:v", "project_env:nr"]
    by_id = {item["id"]: item for item in body}
    assert by_id["project_env:nr"]["pending_claims_count"] == 0
    assert by_id["project_env:nr"]["session_ref_count"] == 3


def test_delete_returns_affected_sessions_and_clears_verification_rows():
    client = _client()
    env = _env(status="needs_review")
    queries = []

    async def dispatch(query, params=None):
        queries.append(query)
        if "FROM chat_session" in query:
            return [{"project_env": "project_env:e1", "total": 2}]
        return []

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=dispatch),
        patch.object(ProjectEnv, "delete", new_callable=AsyncMock) as mock_delete,
        patch(
            "api.routers.project_envs.CommandService.cancel_command_job"
        ) as mock_cancel,
    ):
        mock_cancel.side_effect = _submit_job_side_effect()
        response = client.delete("/api/project-envs/project_env:e1")

    assert response.status_code == 200
    body = response.json()
    assert body == {"success": True, "affected_sessions": 2}
    assert any("DELETE project_env_verification" in q for q in queries)
    mock_delete.assert_awaited_once()
    assert mock_cancel.await_count == 0  # no active_job_id on the env


def test_update_trigger_field_resubmits_and_keeps_status_pending():
    client = _client()
    env = _env(status="verified", verified_snapshot={"name": "old"})
    saved: list[ProjectEnv] = []

    async def capture_save(e):
        saved.append(e)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.put(
            "/api/project-envs/project_env:e1", json={"background": "new background"}
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"
    assert env.verified_snapshot == {"name": "old"}  # snapshot survives edit
    mock_submit.assert_awaited_once()


def test_update_name_change_does_not_retrigger():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.put(
            "/api/project-envs/project_env:e1", json={"name": "renamed"}
        )

    assert response.status_code == 200
    assert response.json()["status"] == "verified"
    mock_submit.assert_not_awaited()


def test_update_explicit_null_clears_optional_field():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1", json={"my_role": None}
        )

    assert response.status_code == 200
    assert env.my_role is None


# --- session binding ---


def _session(**overrides):
    from open_notebook.domain.notebook import ChatSession

    data = dict(
        id="chat_session:s1",
        title="s",
        model_override=None,
        agent=None,
        project_env=None,
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    data.update(overrides)
    return ChatSession(**data)


def test_update_session_binds_verified_env():
    client = _client()
    session = _session()
    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="verified"),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock),
        patch("api.routers.chat.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
    ):
        response = client.put(
            "/api/chat/sessions/s1", json={"project_env": "project_env:e1"}
        )

    assert response.status_code == 200, response.text
    assert response.json()["project_env"] == "project_env:e1"
    assert session.project_env == "project_env:e1"


def test_update_session_rejects_needs_review_env_with_422():
    client = _client()
    session = _session()
    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="needs_review"),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock) as save,
    ):
        response = client.put(
            "/api/chat/sessions/s1", json={"project_env": "project_env:e1"}
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["env_status"] == "needs_review"
    save.assert_not_awaited()


def test_update_session_explicit_null_clears_binding():
    client = _client()
    session = _session(project_env="project_env:e1")
    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock),
        patch("api.routers.chat.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
    ):
        response = client.put("/api/chat/sessions/s1", json={"project_env": None})

    assert response.status_code == 200
    assert session.project_env is None
    assert response.json()["project_env"] is None


def test_clearing_project_env_persists_none_to_db_via_nullable_fields():
    """T1: the explicit null must reach the DB write, not just the response.

    _prepare_save_data drops None fields unless they are registered in
    nullable_fields; a missing registration would silently keep the old
    binding in SurrealDB after an UPDATE."""
    from open_notebook.domain.notebook import ChatSession

    assert "project_env" in ChatSession.nullable_fields

    client = _client()
    session = _session(project_env="project_env:e1")
    captured: dict = {}

    async def fake_repo_update(table, record_id, data):
        captured.update(table=table, record_id=record_id, data=data)
        return [data]

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch("api.routers.chat.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
        patch("open_notebook.domain.base.repo_update", new=fake_repo_update),
    ):
        response = client.put("/api/chat/sessions/s1", json={"project_env": None})

    assert response.status_code == 200, response.text
    assert captured["table"] == "chat_session"
    payload = captured["data"]
    assert "project_env" in payload, "None must be persisted, not dropped"
    assert payload["project_env"] is None


def test_agent_and_project_env_coexist_without_mutual_exclusion():
    client = _client()
    session = _session(agent="agent:a1")
    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="verified"),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock),
        patch("api.routers.chat.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
    ):
        response = client.put(
            "/api/chat/sessions/s1", json={"project_env": "project_env:e1"}
        )

    assert response.status_code == 200
    assert session.project_env == "project_env:e1"
    assert session.agent == "agent:a1"  # untouched by project_env update


def test_create_session_validates_env_binding():
    client = _client()
    from open_notebook.domain.notebook import Notebook

    notebook = Notebook(id="notebook:n1", name="nb")

    async def fake_relate(notebook_id):
        return None

    with (
        patch(
            "api.routers.chat.Notebook.get",
            new_callable=AsyncMock,
            return_value=notebook,
        ),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="pending"),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock) as save,
        patch.object(Notebook, "get_chat_sessions", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/chat/sessions",
            json={"notebook_id": "notebook:n1", "project_env": "project_env:e1"},
        )

    assert response.status_code == 422
    save.assert_not_awaited()


# --- T6: mock-generate / polish / verification / reverify / claims ---


def test_mock_generate_creates_pending_row_and_submits_mock_job():
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={
                "keywords": ["微服务", "高并发"],
                "period_start": "2025.02",
            },
        )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["job_id"] == "command:job1"
    env = saved[0]
    assert env.source_type == "mock"
    assert env.status == "pending"
    assert env.background == ""
    assert env.period_start == "2025.02"
    # completed period from the legal window (start given, end derived)
    assert env.period_end >= "2025.07"
    submit_args = mock_submit.await_args
    assert submit_args is not None
    assert submit_args.args[2]["mode"] == "mock"


def test_mock_generate_stores_requested_industry():
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "industry": "医疗行业"},
        )

    assert response.status_code == 201, response.text
    assert saved[0].industry == "医疗行业"


def test_mock_generate_defaults_industry_to_logistics():
    """No industry (or blank) falls back to the domain default so the env row
    always carries one and regenerate keeps it."""
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"]},
        )
        assert response.status_code == 201, response.text
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "industry": "   "},
        )

    assert response.status_code == 201, response.text
    # save fires again when the job id lands on the row; every write keeps it
    assert saved and all(env.industry == "物流行业" for env in saved)


def test_mock_generate_industry_exactly_20_chars_is_stored():
    """边界：恰好 20 字（INDUSTRY_MAX_CHARS）必须原样入库。"""
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        industry = "物" * 20
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "industry": industry},
        )

    assert response.status_code == 201, response.text
    assert saved[0].industry == industry


def test_mock_generate_rejects_industry_over_20_chars_with_422():
    """异常：超过 20 字（MockGenerateRequest.max_length）必须 422 拒绝，
    不得截断入库。"""
    client = _client()
    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "industry": "物" * 21},
        )

    assert response.status_code == 422, response.text


def test_mock_generate_strips_industry_before_storing():
    """正常：前后空白的行业先 strip 再入库，空白才落默认。"""
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "industry": "  医疗行业  "},
        )

    assert response.status_code == 201, response.text
    assert saved and all(env.industry == "医疗行业" for env in saved)


def test_project_env_domain_rejects_industry_over_20_chars():
    """第二道防线：绕过 API 直接构造（命令层/数据导入路径）时，
    domain 校验器同样拦截超长行业。"""
    with pytest.raises(InvalidInputError):
        _env(industry="行" * 21)
    assert _env(industry="行" * 20).industry == "行" * 20
    assert _env(industry=None).industry is None  # 真实来源/老行允许为空


def test_mock_generate_on_empty_kb_succeeds_without_kb_reads():
    """The empty-KB 422 guard is gone: mock generation runs no knowledge-base
    query at all, so an empty library still creates the row and submits."""
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    async def no_kb_reads(query, params=None):
        assert "FROM source" not in query and "FROM note" not in query, query[:100]
        return []

    with (
        patch("api.routers.project_envs.repo_query", side_effect=no_kb_reads),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"]},
        )

    assert response.status_code == 201, response.text
    assert saved and saved[0].source_type == "mock"
    assert mock_submit.await_args is not None


def test_mock_generate_rejects_illegal_period_with_422():
    client = _client()
    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/mock-generate",
            json={
                "keywords": ["a", "b"],
                "period_start": "2026.01",  # no legal window ends >= 13 months ago
            },
        )
    assert response.status_code == 422


def test_polish_background_does_not_persist():
    client = _client()
    with (
        patch(
            "api.routers.project_envs.render_polish",
            new_callable=AsyncMock,
            return_value="润色后的背景",
        ) as mock_polish,
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as save,
    ):
        response = client.post(
            "/api/project-envs/polish-background",
            json={"background": "原始背景"},
        )

    assert response.status_code == 200
    assert response.json()["polished"] == "润色后的背景"
    mock_polish.assert_awaited_once_with(
        background="原始背景", name=None, tech_background=None
    )
    save.assert_not_awaited()


def test_reverify_recent_pending_run_returns_409():
    client = _client()
    env = _env(
        status="pending",
        verification_progress={
            "stage": "verifying",
            "percent": 50,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post("/api/project-envs/project_env:e1/reverify")

    assert response.status_code == 409
    mock_submit.assert_not_awaited()


def test_reverify_after_guard_resubmits():
    client = _client()
    env = _env(
        status="needs_review",
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs/project_env:e1/reverify")

    assert response.status_code == 200
    assert response.json()["job_id"] == "command:job1"
    assert env.status == "pending"


def test_regenerate_mock_env_resets_fields_and_uses_mock_mode():
    """Regenerate keeps the keywords but discards draft/snapshot/promoted
    fields, then submits the mock pipeline (draft generation included)."""
    client = _client()
    env = _env(
        source_type="mock",
        background="旧内容",
        tech_background="旧技术栈",
        draft_content={"background": "旧草稿"},
        verified_snapshot={"background": "旧快照"},
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit
        response = client.post("/api/project-envs/project_env:e1/regenerate")

    assert response.status_code == 200
    assert submitted[0][2]["mode"] == "mock"
    assert env.keywords == ["微服务"]  # kept
    assert env.background == ""  # promoted fields cleared
    assert env.draft_content is None
    assert env.verified_snapshot is None
    assert env.status == "pending"


def test_regenerate_mock_env_keeps_industry_on_row():
    """契约 3：regenerate 清空草稿/晋升字段时必须保留 industry——
    重生成会从 env 行重读行业（_prepare_mock_material 的 common dict），
    行业被清空就会退回默认行业，丢掉用户选择。"""
    client = _client()
    env = _env(
        source_type="mock",
        industry="医疗行业",
        background="旧内容",
        draft_content={"background": "旧草稿"},
        verified_snapshot={"background": "旧快照"},
    )

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs/project_env:e1/regenerate")

    assert response.status_code == 200, response.text
    assert env.background == ""  # cleared
    assert env.draft_content is None  # cleared
    assert env.industry == "医疗行业"  # kept


# --- 迁移 40（industry 字段） ---


class TestMigration40:
    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "40.surrealql").is_file()
        assert (MIGRATIONS_DIR / "40_down.surrealql").is_file()

    def test_manager_registers_migration_40_up_down_symmetric(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 40
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "industry" in manager.up_migrations[39].sql
        assert "project_env" in manager.up_migrations[39].sql
        assert "REMOVE FIELD industry" in manager.down_migrations[39].sql
        assert "project_env" in manager.down_migrations[39].sql

    def test_up_defines_optional_industry_field(self):
        sql = (MIGRATIONS_DIR / "40.surrealql").read_text()
        assert "DEFINE FIELD IF NOT EXISTS industry ON TABLE project_env" in sql
        assert "option<string>" in sql

    def test_down_removes_industry_field(self):
        sql = (MIGRATIONS_DIR / "40_down.surrealql").read_text()
        assert "REMOVE FIELD industry ON TABLE project_env" in sql


def test_regenerate_real_env_returns_422():
    client = _client()
    env = _env()  # real by default
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/regenerate")

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "not_mock"


def test_reverify_mock_env_without_draft_uses_mock_mode():
    """A mock env whose draft was never generated must re-run the mock
    pipeline (draft generation + verification), not verify empty material."""
    client = _client()
    env = _env(source_type="mock", background="", tech_background="", draft_content={})
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit
        response = client.post("/api/project-envs/project_env:e1/reverify")

    assert response.status_code == 200
    assert submitted[0][1] == "verify_project_env"
    assert submitted[0][2]["mode"] == "mock"


def test_reverify_mock_env_with_draft_still_uses_mock_mode():
    """A mock env with an existing draft re-verifies through the mock lanes
    (B/C) — mode must follow source_type, and the command's draft guard keeps
    regeneration to the dedicated regenerate endpoint."""
    client = _client()
    env = _env(
        source_type="mock",
        status="needs_review",
        background="已提升的内容。",
        draft_content={"background": "草稿内容采用 Redis 7.0。"},
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit
        response = client.post("/api/project-envs/project_env:e1/reverify")

    assert response.status_code == 200
    assert submitted[0][2]["mode"] == "mock"
    # the existing draft survives: reverify must not wipe it for regeneration
    assert env.draft_content == {"background": "草稿内容采用 Redis 7.0。"}


def test_update_mock_env_trigger_field_resubmits_with_mock_mode():
    """Editing a trigger field on a mock env resubmits the mock pipeline —
    mode="material" would wrongly run the KB-evidence lane on fiction."""
    client = _client()
    env = _env(source_type="mock", status="verified", verified_snapshot={"name": "old"})
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        mock_submit.side_effect = _submit
        response = client.put(
            "/api/project-envs/project_env:e1", json={"background": "新背景"}
        )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "pending"
    assert submitted[0][2]["mode"] == "mock"


def _run_row(points):
    return {
        "id": "project_env_verification:r1",
        "project_env": "project_env:e1",
        "token": "t1",
        "mode": "material",
        "status": "completed",
        "points": points,
    }


def test_dismiss_last_open_point_promotes_env_to_verified():
    client = _client()
    env = _env(
        status="needs_review",
        pending_claims=[{"point_id": "p1", "quote": "系统采用 Redis 7.0 缓存。"}],
        background="系统采用 Redis 7.0 缓存。\n整体高并发。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 7.0 缓存。",
                "field": "background",
                "state": "manual_review",
            },
            {
                "point_id": "p2",
                "quote": "整体高并发。",
                "field": "background",
                "state": "passed",
            },
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["has_snapshot"] is True
    assert body["pending_claims_count"] == 0
    # whole-paragraph removal: the other paragraph survives untouched
    assert env.background == "整体高并发。"


def test_dismiss_rejects_wrong_state_with_409():
    client = _client()
    env = _env(status="verified")  # not needs_review
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "x",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")
    assert response.status_code == 409


def test_rewrite_pass_replaces_text_and_verifies():
    client = _client()
    env = _env(
        status="needs_review",
        pending_claims=[{"point_id": "p1", "quote": "Redis 9.9 缓存"}],
        background="系统采用 Redis 9.9 缓存。后续扩展。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 9.9 缓存",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )
    lane_pass = {"verdict": "pass", "issues": []}
    lane_calls = []

    async def lane_result(lane, quote, field, context, mode="material"):
        lane_calls.append((lane, mode))
        return lane_pass

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 7.0 缓存"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["passed"] is True
    assert body["env"]["status"] == "verified"
    # material rewrite keeps all three lanes (mock drops only A)
    assert {(lane, mode) for lane, mode in lane_calls} == {
        ("A", "material"),
        ("B", "material"),
        ("C", "material"),
    }
    assert env.background == "系统采用 Redis 7.0 缓存。后续扩展。"


def test_rewrite_fail_keeps_manual_review_with_lane_opinions():
    client = _client()
    env = _env(status="needs_review", background="系统采用 Redis 9.9 缓存。")
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 9.9 缓存",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )
    verdicts = {
        "A": {"verdict": "pass", "issues": []},
        "B": {"verdict": "fail", "issues": ["Redis 9.9 不存在"]},
        "C": {"verdict": "pass", "issues": []},
    }

    async def lane_result(lane, quote, field, context, mode="material"):
        return verdicts[lane]

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 9.9 集群"},
        )

    assert response.status_code == 200  # fail is still 200
    body = response.json()
    assert body["passed"] is False
    assert body["lanes"]["B"]["issues"] == ["Redis 9.9 不存在"]
    assert body["env"]["status"] == "needs_review"
    assert body["env"]["pending_claims_count"] == 1


def test_dismiss_with_rotated_env_token_returns_409():
    """A claim dismissed while a newer verification run has taken over (token
    rotated) must be rejected instead of clobbering the newer run's env."""
    client = _client()
    env = _env(
        status="needs_review",
        pending_claims=[{"point_id": "p1", "quote": "系统采用 Redis 7.0 缓存。"}],
        background="系统采用 Redis 7.0 缓存。\n整体高并发。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 7.0 缓存。",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run], env_token="t2"),
        ),
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as mock_save,
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 409
    assert response.json()["detail"] == "验证状态已变更，请刷新后重试"
    mock_save.assert_not_awaited()  # nothing persisted to the env


def test_rewrite_with_rotated_env_token_returns_409():
    client = _client()
    env = _env(
        status="needs_review",
        pending_claims=[{"point_id": "p1", "quote": "Redis 9.9 缓存"}],
        background="系统采用 Redis 9.9 缓存。后续扩展。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 9.9 缓存",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )

    async def lane_result(lane, quote, field, context, mode="material"):
        return {"verdict": "pass", "issues": []}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run], env_token="t2"),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as mock_save,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 7.0 缓存"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == "验证状态已变更，请刷新后重试"
    mock_save.assert_not_awaited()  # nothing persisted to the env


def test_rewrite_mock_env_runs_only_lanes_b_and_c_with_mock_mode():
    """Mock envs have no KB lane: the rewrite re-verify must run B/C only and
    pass mode="mock" so lane B judges plausibility instead of off_table."""
    client = _client()
    env = _env(
        source_type="mock",
        status="needs_review",
        draft_content={
            "background": "系统采用 Redis 9.9 缓存。后续扩展。",
            "tech_background": "技术栈。",
            "tuning_process": "调优。",
            "problems_solutions": "问题。",
            "my_role": "我担任架构师。",
            "scale": "团队 20 人。",
        },
        pending_claims=[{"point_id": "p1", "quote": "Redis 9.9 缓存"}],
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 9.9 缓存",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )
    calls = []

    async def lane_result(lane, quote, field, context, mode="material"):
        calls.append((lane, mode))
        return {"verdict": "pass", "issues": []}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 7.0 缓存"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["passed"] is True
    assert len(calls) == 2
    assert {(lane, mode) for lane, mode in calls} == {("B", "mock"), ("C", "mock")}
    # rewrite landed in the draft and promotion copied it to the main field
    assert env.background == "系统采用 Redis 7.0 缓存。后续扩展。"


def test_rewrite_pass_quote_drift_keeps_manual_review():
    """Lanes passing is worthless when the original sentence is no longer in
    the material: the rewrite was never applied, so the point must not count
    as rewritten nor the env promote to verified."""
    client = _client()
    env = _env(
        status="needs_review",
        pending_claims=[{"point_id": "p1", "quote": "Redis 9.9 缓存"}],
        background="用户并发编辑后的全新正文。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 9.9 缓存",
                "field": "background",
                "state": "manual_review",
            }
        ]
    )

    async def lane_result(lane, quote, field, context, mode="material"):
        return {"verdict": "pass", "issues": []}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 7.0 缓存"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["passed"] is True
    assert body["env"]["status"] == "needs_review"
    assert body["env"]["pending_claims_count"] == 1
    assert env.background == "用户并发编辑后的全新正文。"
    assert run["points"][0]["state"] == "manual_review"
    assert run["points"][0]["manual_reason"] == "quote_drift"


def test_verification_status_joins_run_and_job():
    client = _client()
    env = _env(
        status="pending",
        active_job_id="command:job9",
        verification_progress={"stage": "verifying", "percent": 40},
    )
    run = _run_row([{"point_id": "p1", "state": "passed"}])
    run["summary"] = {"total": 1, "passed": 1}

    async def job_status(job_id):
        return {"status": "running", "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
    ):
        response = client.get("/api/project-envs/project_env:e1/verification")

    assert response.status_code == 200
    body = response.json()
    assert body["job"]["id"] == "command:job9"
    assert body["job"]["status"] == "running"
    assert body["summary"]["passed"] == 1
    assert body["progress"]["percent"] == 40
    assert body["points"][0]["point_id"] == "p1"


def test_verification_status_self_heals_orphaned_pending():
    """pending env whose job already ended must not pin the UI forever."""
    client = _client()
    env = _env(
        status="pending",
        active_job_id="command:job9",
        verification_progress=None,
    )
    run = _run_row([])
    save_mock = AsyncMock()

    async def job_status(job_id):
        return {"status": "canceled", "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
        # Instance-level patch.object trips pydantic's validate_assignment.
        patch.object(ProjectEnv, "save", new=save_mock),
    ):
        response = client.get("/api/project-envs/project_env:e1/verification")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert "已取消" in body["progress"]["error"]
    save_mock.assert_awaited_once()


def test_verification_status_self_heal_unwraps_command_status_enum():
    """CommandStatus.CANCELED (str-Enum) must match, not str() to 'CommandStatus.CANCELED'."""
    from surreal_commands.core.client import CommandStatus

    client = _client()
    env = _env(
        status="pending",
        active_job_id="command:job9",
        verification_progress=None,
    )
    save_mock = AsyncMock()

    async def job_status(job_id):
        return {"status": CommandStatus.CANCELED, "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[_run_row([])]),
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
        patch.object(ProjectEnv, "save", new=save_mock),
    ):
        response = client.get("/api/project-envs/project_env:e1/verification")

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    save_mock.assert_awaited_once()


# --- T7: materials step (素材生成：flow / generate / submit / status) ---


def _materials_store() -> dict:
    return {
        "materials": {
            "items": [
                {
                    "id": "m1",
                    "category": "background",
                    "title": "素材一",
                    "text": "电商平台重构背景。",
                    "tags": ["电商"],
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
                    "title": "数据中台路线",
                    "summary": "s1",
                    "tech_stack": ["Kafka 3.7"],
                    "scale": "15 人",
                    "role": "架构师",
                    "highlights": ["h1"],
                    "period": {"start": "2025.02", "end": "2025.09"},
                },
                {
                    "id": "r2",
                    "title": "微服务治理路线",
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


def test_mock_generate_flow_materials_creates_material_pending():
    client = _client()
    saved: list[ProjectEnv] = []

    async def capture_save(env):
        env.id = env.id or "project_env:new"
        saved.append(env)

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "flow": "materials"},
        )

    assert response.status_code == 201, response.text
    env = saved[0]
    assert env.source_type == "mock"
    assert env.status == "material_pending"
    submit_args = mock_submit.await_args
    assert submit_args is not None
    assert submit_args.args[1] == "generate_project_env_materials"
    payload = submit_args.args[2]
    assert payload["env_id"] == "project_env:new"
    assert env.verification_token  # token rotated before submission
    assert payload["token"] == env.verification_token
    assert "mode" not in payload  # materials job carries no verify mode


def test_mock_generate_default_flow_still_direct():
    client = _client()

    async def capture_save(env):
        env.id = env.id or "project_env:new"

    with (
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.ProjectEnv.save",
            autospec=True,
            side_effect=capture_save,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"]},
        )

    assert response.status_code == 201, response.text
    submit_args = mock_submit.await_args
    assert submit_args is not None
    assert submit_args.args[1] == "verify_project_env"
    assert submit_args.args[2]["mode"] == "mock"


def test_mock_generate_rejects_unknown_flow_422():
    client = _client()
    with patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock):
        response = client.post(
            "/api/project-envs/mock-generate",
            json={"keywords": ["微服务", "高并发"], "flow": "bogus"},
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "invalid_flow"


def test_mock_generate_flow_materials_period_violation_422():
    client = _client()
    with patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock):
        response = client.post(
            "/api/project-envs/mock-generate",
            json={
                "keywords": ["a", "b"],
                "flow": "materials",
                "period_start": "2026.01",  # no legal window ends >= 13 months ago
            },
        )
    assert response.status_code == 422
    assert response.json()["detail"]["violations"]


def test_materials_generate_unknown_env_404():
    client = _client()

    async def raise_not_found(env_id):
        raise NotFoundError("missing")

    with patch("api.routers.project_envs.ProjectEnv.get", side_effect=raise_not_found):
        response = client.post("/api/project-envs/project_env:nope/materials/generate")

    assert response.status_code == 404


def test_materials_generate_real_env_422_not_mock():
    client = _client()
    env = _env()  # real by default
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "not_mock"


def test_materials_generate_no_keywords_422():
    client = _client()
    env = _env(source_type="mock", keywords=None, status="failed")
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "no_keywords"


def test_materials_generate_fresh_material_pending_409():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "A materials generation run is already in progress for this project env"
    )
    mock_submit.assert_not_awaited()


def test_materials_generate_from_material_ready_clears_and_resubmits():
    client = _client()
    store = _materials_store()
    env = _env(
        source_type="mock",
        status="material_ready",
        background="旧晋升文本",
        tech_background="旧技术栈",
        draft_content={"background": "旧草稿"},
        verified_snapshot={"background": "旧快照"},
        pending_claims=[{"point_id": "p1"}],
        materials=store,
        materials_selection={"kind": "routes", "route_id": "r1"},
        verification_token="old-token",
        active_job_id="command:old",
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch(
            "api.routers.project_envs.CommandService.cancel_command_job"
        ) as mock_cancel,
    ):
        mock_submit.side_effect = _submit
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 200, response.text
    assert response.json()["job_id"] == "command:job1"
    assert env.status == "material_pending"
    assert env.draft_content is None
    assert env.verified_snapshot is None
    assert env.pending_claims is None
    assert env.materials_selection is None
    assert env.background == ""  # promoted fields cleared
    assert env.materials == store  # candidate store survives until overwritten
    assert env.verification_token != "old-token"  # fencing token rotated
    mock_cancel.assert_awaited_once_with("command:old")
    assert submitted[0][1] == "generate_project_env_materials"
    assert submitted[0][2]["token"] == env.verification_token


def test_materials_generate_stale_material_pending_passes_guard():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 200, response.text
    assert env.status == "material_pending"


def test_get_materials_returns_store_and_status():
    client = _client()
    store = _materials_store()
    selection = {
        "kind": "materials",
        "material_ids": ["m1"],
        "route_id": None,
        "submitted_at": "2026-10-07T11:00:00+00:00",
    }
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=store,
        materials_selection=selection,
        active_job_id="command:job9",
        verification_progress={"stage": "done", "percent": 100},
    )

    async def job_status(job_id):
        return {"status": "completed", "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
    ):
        response = client.get("/api/project-envs/project_env:e1/materials")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "material_ready"  # terminal job, healed state: no flip
    assert body["materials"]["items"][0]["id"] == "m1"
    assert body["routes"]["items"][1]["id"] == "r2"
    assert body["selection"] == selection
    assert body["job"]["id"] == "command:job9"
    assert body["progress"]["percent"] == 100


def test_get_materials_self_heals_orphaned_material_pending():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        active_job_id="command:job9",
        verification_progress=None,
    )
    save_mock = AsyncMock()

    async def job_status(job_id):
        return {"status": "canceled", "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
        patch.object(ProjectEnv, "save", new=save_mock),
    ):
        response = client.get("/api/project-envs/project_env:e1/materials")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "failed"
    assert "已取消" in body["progress"]["error"]
    save_mock.assert_awaited_once()


def test_get_materials_self_heal_unwraps_command_status_enum():
    from surreal_commands.core.client import CommandStatus

    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        active_job_id="command:job9",
        verification_progress=None,
    )
    save_mock = AsyncMock()

    async def job_status(job_id):
        return {"status": CommandStatus.FAILED, "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
        patch.object(ProjectEnv, "save", new=save_mock),
    ):
        response = client.get("/api/project-envs/project_env:e1/materials")

    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    save_mock.assert_awaited_once()


def test_get_materials_real_env_returns_empty_store():
    client = _client()
    env = _env(status="verified")  # real by default

    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.get("/api/project-envs/project_env:e1/materials")

    assert response.status_code == 200
    body = response.json()
    assert body["materials"] is None
    assert body["routes"] is None
    assert body["selection"] is None


def test_submit_materials_unknown_env_404():
    client = _client()

    async def raise_not_found(env_id):
        raise NotFoundError("missing")

    with patch("api.routers.project_envs.ProjectEnv.get", side_effect=raise_not_found):
        response = client.post(
            "/api/project-envs/project_env:nope/materials/submit",
            json={"kind": "materials", "material_ids": ["m1"]},
        )

    assert response.status_code == 404


def test_submit_materials_real_env_422():
    client = _client()
    env = _env(status="verified")  # real
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": ["m1"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "not_mock"


def test_submit_materials_during_generation_409():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        materials=_materials_store(),
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": ["m1"]},
        )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "A materials generation run is already in progress for this project env"
    )
    mock_submit.assert_not_awaited()


def test_submit_materials_during_fresh_verification_409():
    client = _client()
    env = _env(
        source_type="mock",
        status="pending",
        materials=_materials_store(),
        verification_progress={
            "stage": "verifying",
            "percent": 50,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "routes", "route_id": "r1"},
        )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "A verification run is already in progress for this project env"
    )
    mock_submit.assert_not_awaited()


def test_submit_materials_not_generated_422():
    client = _client()
    env = _env(source_type="mock", status="material_ready", materials=None)
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": ["m1"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "not_generated"


def test_submit_materials_unknown_ids_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": ["m1", "m99"]},
        )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["reason"] == "unknown_ids"
    assert detail["unknown"] == ["m99"]


def test_submit_materials_empty_selection_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": []},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "empty_selection"


def test_submit_routes_missing_route_id_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "routes"},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "missing_route_id"


def test_submit_invalid_combination_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "materials", "material_ids": ["m1"], "route_id": "r1"},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "invalid_combination"


def test_submit_materials_success():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        background="旧晋升文本",
        tech_background="旧技术栈",
        tuning_process="旧调优",
        draft_content={"background": "旧草稿"},
        verified_snapshot={"background": "旧快照"},
        pending_claims=[{"point_id": "p1"}],
        materials=_materials_store(),
        verification_token="old-token",
        active_job_id="command:old",
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch(
            "api.routers.project_envs.CommandService.cancel_command_job"
        ) as mock_cancel,
    ):
        mock_submit.side_effect = _submit
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            # duplicate m1 must dedup to a single entry
            json={"kind": "materials", "material_ids": ["m1", "m3", "m1"]},
        )

    assert response.status_code == 200, response.text
    assert response.json()["job_id"] == "command:job1"
    assert env.status == "pending"
    assert env.draft_content is None
    assert env.verified_snapshot is None
    assert env.pending_claims is None
    assert env.background == ""  # promoted text must yield to the new draft
    assert env.materials  # candidate store kept for re-picking
    selection = env.materials_selection
    assert selection is not None
    assert selection["kind"] == "materials"
    assert selection["material_ids"] == ["m1", "m3"]
    assert selection["route_id"] is None
    assert selection["submitted_at"]
    assert env.verification_token != "old-token"
    mock_cancel.assert_awaited_once_with("command:old")
    assert submitted[0][1] == "verify_project_env"
    assert submitted[0][2]["mode"] == "mock"
    assert submitted[0][2]["token"] == env.verification_token


def test_submit_routes_success():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "routes", "route_id": "r2"},
        )

    assert response.status_code == 200, response.text
    assert env.status == "pending"
    selection = env.materials_selection
    assert selection is not None
    assert selection["kind"] == "routes"
    assert selection["route_id"] == "r2"
    assert selection["material_ids"] is None
    assert submitted[0][1] == "verify_project_env"
    assert submitted[0][2]["mode"] == "mock"


def test_selectable_view_excludes_material_states():
    client = _client()
    envs = [
        _env(id="project_env:v", status="verified"),
        _env(id="project_env:mp", status="material_pending"),
        _env(id="project_env:mr", status="material_ready"),
    ]
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get_all",
            new_callable=AsyncMock,
            return_value=envs,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.get("/api/project-envs?view=selectable")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == ["project_env:v"]


def test_update_session_rejects_material_ready_env_with_422():
    client = _client()
    session = _session()
    with (
        patch(
            "api.routers.chat.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="material_ready"),
        ),
        patch("api.routers.chat.ChatSession.save", new_callable=AsyncMock) as save,
    ):
        response = client.put(
            "/api/chat/sessions/s1", json={"project_env": "project_env:e1"}
        )

    assert response.status_code == 422
    assert response.json()["detail"]["env_status"] == "material_ready"
    save.assert_not_awaited()


def test_verification_get_on_material_pending_returns_status_without_points():
    """The pending-only self-heal must never fire on material_* states: the
    materials flow owns its own healing (GET /materials)."""
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        active_job_id="command:job9",
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.now().isoformat(),
        },
    )
    save_mock = AsyncMock()

    async def job_status(job_id):
        return {"status": "canceled", "error_message": None}

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[]),
        ),
        patch(
            "api.routers.project_envs.CommandService.get_command_status",
            side_effect=job_status,
        ),
        patch.object(ProjectEnv, "save", new=save_mock),
    ):
        response = client.get("/api/project-envs/project_env:e1/verification")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "material_pending"  # not mislabeled failed
    assert body["points"] == []
    save_mock.assert_not_awaited()


def test_regenerate_clears_materials_selection_and_guards_material_pending():
    client = _client()

    # fresh material_pending run -> 409 (materials message)
    fresh = _env(
        source_type="mock",
        status="material_pending",
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=fresh,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post("/api/project-envs/project_env:e1/regenerate")

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "A materials generation run is already in progress for this project env"
    )
    mock_submit.assert_not_awaited()

    # material_ready with a stale selection -> keywords direct path, selection gone
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
        materials_selection={"kind": "routes", "route_id": "r1"},
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    submitted = []

    async def _submit(*args, **kwargs):
        submitted.append(args)
        return "command:job1"

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit2,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit2.side_effect = _submit
        response = client.post("/api/project-envs/project_env:e1/regenerate")

    assert response.status_code == 200, response.text
    assert env.materials_selection is None  # keywords path must not eat old picks
    assert env.status == "pending"
    assert submitted[0][1] == "verify_project_env"
    assert submitted[0][2]["mode"] == "mock"


# --- materials step: gaps pinned against plan §3 (校验表) and §2.1 (状态机) ---


def test_submit_invalid_kind_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "bogus", "material_ids": ["m1"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "invalid_kind"


def test_submit_unknown_route_422():
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "routes", "route_id": "r99"},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "unknown_route"


def test_submit_routes_with_material_ids_422():
    """Mismatch guard must fire in BOTH directions (§3.D)."""
    client = _client()
    env = _env(
        source_type="mock",
        status="material_ready",
        materials=_materials_store(),
    )
    with patch(
        "api.routers.project_envs.ProjectEnv.get",
        new_callable=AsyncMock,
        return_value=env,
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/materials/submit",
            json={"kind": "routes", "route_id": "r1", "material_ids": ["m1"]},
        )

    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "invalid_combination"


def test_materials_generate_from_failed_resubmits():
    """State machine: failed --materials/generate--> material_pending."""
    client = _client()
    env = _env(
        source_type="mock",
        status="failed",
        materials=_materials_store(),
        verification_progress={
            "stage": "done",
            "percent": 100,
            "error": "素材候选生成失败，请重试",
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.CommandService.cancel_command_job"),
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 200, response.text
    assert env.status == "material_pending"
    assert env.materials == _materials_store()  # old store survives for retry
    assert mock_submit.await_args is not None
    assert mock_submit.await_args.args[1] == "generate_project_env_materials"


def test_materials_generate_from_verified_clears_promotion_artifacts():
    """needs_review/verified re-enter the materials flow: the promoted text
    and snapshot must yield (§3.C)."""
    client = _client()
    store = _materials_store()
    env = _env(
        source_type="mock",
        status="verified",
        background="已晋升文本",
        verified_snapshot={"background": "旧快照"},
        draft_content={"background": "旧草稿"},
        pending_claims=[{"point_id": "p1"}],
        materials=store,
        materials_selection={"kind": "materials", "material_ids": ["m1"]},
        active_job_id="command:old",
        verification_progress={
            "stage": "done",
            "percent": 100,
            "updated": datetime.fromisoformat("2026-01-01T00:00:00").isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch(
            "api.routers.project_envs.CommandService.cancel_command_job"
        ) as mock_cancel,
    ):
        mock_submit.side_effect = _submit_job_side_effect()
        response = client.post("/api/project-envs/project_env:e1/materials/generate")

    assert response.status_code == 200, response.text
    assert env.status == "material_pending"
    assert env.background == ""
    assert env.draft_content is None
    assert env.verified_snapshot is None
    assert env.pending_claims is None
    assert env.materials_selection is None
    assert env.materials == store
    mock_cancel.assert_awaited_once_with("command:old")
    assert mock_submit.await_args is not None
    assert mock_submit.await_args.args[1] == "generate_project_env_materials"


def test_reverify_fresh_material_pending_returns_409():
    """reverify's running guard was extended to material_pending (§3.E2)."""
    client = _client()
    env = _env(
        source_type="mock",
        status="material_pending",
        verification_progress={
            "stage": "materialing",
            "percent": 10,
            "updated": datetime.now().isoformat(),
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
    ):
        response = client.post("/api/project-envs/project_env:e1/reverify")

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "A materials generation run is already in progress for this project env"
    )
    mock_submit.assert_not_awaited()


# --- paragraph granularity: suggest / rewrite prescreen / dismiss / generic ---


def _manual_point(**overrides):
    point = {
        "point_id": "p1",
        "quote": "系统采用 Redis 9.9 缓存。",
        "field": "background",
        "state": "manual_review",
        "manual_reason": "lanes_failed",
        "lanes": {
            "B": {"verdict": "fail", "issues": ["Redis 9.9 不存在"]},
            "C": {"verdict": "fail", "issues": ["与叙述矛盾"]},
        },
    }
    point.update(overrides)
    return point


def _needs_review_run_setup(point=None):
    env = _env(
        status="needs_review",
        background="系统采用 Redis 9.9 缓存。\n整体高并发。",
        pending_claims=[{"point_id": "p1", "quote": "系统采用 Redis 9.9 缓存。"}],
    )
    run = _run_row([point or _manual_point()])
    return env, run


def test_suggest_claim_rewrite_returns_suggestion():
    from open_notebook.ai.project_env_pipeline import SuggestRewrite

    client = _client()
    env, run = _needs_review_run_setup()
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch(
            "api.routers.project_envs.suggest_rewrite",
            new_callable=AsyncMock,
            return_value=SuggestRewrite(
                suggestion="系统采用 Redis 7.0 缓存。", explanation="版本改为锚点内版本"
            ),
        ) as mock_suggest,
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as mock_save,
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["suggestion"] == "系统采用 Redis 7.0 缓存。"
    assert body["explanation"] == "版本改为锚点内版本"
    # lane issues feed the prompt
    assert mock_suggest.await_args is not None
    issues = mock_suggest.await_args.kwargs["issues"]
    assert "Redis 9.9 不存在" in issues and "与叙述矛盾" in issues
    # stateless: nothing persisted
    mock_save.assert_not_awaited()
    assert env.background == "系统采用 Redis 9.9 缓存。\n整体高并发。"


def test_suggest_claim_rewrite_rejects_non_needs_review_with_409():
    client = _client()
    env, run = _needs_review_run_setup()
    env.status = "verified"
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")
    assert response.status_code == 409


def test_suggest_claim_rewrite_rejects_off_table_reason_with_422():
    client = _client()
    env, run = _needs_review_run_setup(
        _manual_point(manual_reason="off_table", lanes={})
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "not_suggestible"


def test_suggest_claim_rewrite_model_failure_returns_502():
    client = _client()
    env, run = _needs_review_run_setup()
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch(
            "api.routers.project_envs.suggest_rewrite",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")
    assert response.status_code == 502
    assert response.json()["detail"]["reason"] == "model_error"


def test_suggest_claim_rewrite_timeout_returns_504():
    import asyncio as _asyncio

    client = _client()
    env, run = _needs_review_run_setup()

    async def slow_suggest(**kwargs):
        await _asyncio.sleep(1)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.SUGGEST_TIMEOUT_SECONDS", 0.01),
        patch("api.routers.project_envs.suggest_rewrite", side_effect=slow_suggest),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")
    assert response.status_code == 504
    assert response.json()["detail"]["reason"] == "model_timeout"


def test_rewrite_rejects_text_over_4000_chars_with_422():
    client = _client()
    env, run = _needs_review_run_setup()
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "字" * 4001},
        )
    assert response.status_code == 422


def test_rewrite_prescreen_fail_overrides_passing_lanes():
    client = _client()
    env = _env(
        status="needs_review",
        period_start="2023.01",
        background="数据层用 MySQL 8.0。\n缓存层用 Redis 7.2。",
        pending_claims=[{"point_id": "p1", "quote": "缓存层用 Redis 7.2。"}],
    )
    run = _run_row(
        [
            _manual_point(
                quote="缓存层用 Redis 7.2。",
                lanes={
                    "A": {"verdict": "pass", "issues": []},
                    "B": {"verdict": "pass", "issues": []},
                    "C": {"verdict": "pass", "issues": []},
                },
            )
        ]
    )
    lane_pass = {"verdict": "pass", "issues": []}

    async def lane_result(lane, quote, field, context, mode="material"):
        return lane_pass

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "缓存层用 Redis 7.2，支撑亿级请求。"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    # lanes trusted the text but the anchor table did not: prescreen fails it
    assert body["passed"] is False
    assert body["lanes"]["B"]["verdict"] == "fail"
    assert body["lanes"]["B"]["prescreen"] is True
    assert body["env"]["status"] == "needs_review"


def test_rewrite_prescreen_off_table_keeps_manual_review():
    client = _client()
    env = _env(
        status="needs_review",
        background="存储层自研。\n缓存层用 Redis 7.0。",
        pending_claims=[{"point_id": "p1", "quote": "缓存层用 Redis 7.0。"}],
    )
    run = _run_row(
        [
            _manual_point(
                quote="缓存层用 Redis 7.0。",
                lanes={
                    "A": {"verdict": "pass", "issues": []},
                    "B": {"verdict": "pass", "issues": []},
                    "C": {"verdict": "pass", "issues": []},
                },
            )
        ]
    )
    lane_pass = {"verdict": "pass", "issues": []}

    async def lane_result(lane, quote, field, context, mode="material"):
        return lane_pass

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "缓存层用 HyperDB 2.0，承载热点数据。"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["passed"] is False  # off-table stays manual even with lanes pass
    assert env.background == "存储层自研。\n缓存层用 Redis 7.0。"  # nothing replaced


def test_rewrite_pass_records_prescreen_on_point():
    client = _client()
    env, run = _needs_review_run_setup()
    lane_pass = {"verdict": "pass", "issues": []}

    async def lane_result(lane, quote, field, context, mode="material"):
        return lane_pass

    run_updates: list = []

    async def capture_run_update(query, params=None):
        if "UPDATE $run_id" in query:
            run_updates.append(params)
            return []
        return await _usage_dispatch(verification_rows=[run])(query, params)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=capture_run_update),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "系统采用 Redis 7.0 缓存。"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["passed"] is True
    persisted = run_updates[-1]["points"][0]
    assert persisted["prescreen"]["status"] == "pass"
    assert persisted["state"] == "rewritten"


def test_dismiss_tolerates_whitespace_variant_quote():
    client = _client()
    env = _env(
        status="needs_review",
        background="系统采用 Redis 9.9 缓存。\n整体高并发。",
        pending_claims=[{"point_id": "p1", "quote": "系统采用 Redis 9.9 缓存。"}],
    )
    run = _run_row([_manual_point(quote="系统 采用  Redis 9.9 缓存。")])
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    assert env.background == "整体高并发。"


def test_dismiss_only_paragraph_in_field_returns_409():
    client = _client()
    env, run = _needs_review_run_setup()
    env.background = "系统采用 Redis 9.9 缓存。"  # the field's only paragraph
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 409
    assert response.json()["detail"]["reason"] == "only_paragraph"


def test_generate_generic_paragraph_requires_material():
    client = _client()
    env = _env(
        tuning_process=None,
        problems_solutions=None,
        my_role=None,
        scale=None,
    )
    env.background = ""
    env.tech_background = ""
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/generic-paragraph/generate"
        )
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "no_material"


def test_generate_generic_paragraph_passes_env_context():
    client = _client()
    env = _env(status="verified")
    for mock_type in ("real", "mock"):
        env.source_type = mock_type
        with (
            patch(
                "api.routers.project_envs.ProjectEnv.get",
                new_callable=AsyncMock,
                return_value=env,
            ),
            patch(
                "api.routers.project_envs.repo_query",
                side_effect=_usage_dispatch(),
            ),
            patch(
                "api.routers.project_envs.render_generic_paragraph",
                new_callable=AsyncMock,
                return_value="通用段落 ____ <u>要点</u>",
            ) as mock_render,
            patch(
                "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
            ) as mock_save,
        ):
            response = client.post(
                "/api/project-envs/project_env:e1/generic-paragraph/generate"
            )

        assert response.status_code == 200, response.text
        assert response.json()["paragraph"] == "通用段落 ____ <u>要点</u>"
        assert mock_render.await_args is not None
        kwargs = mock_render.await_args.kwargs
        assert kwargs["source_type"] == mock_type
        assert kwargs["name"] == env.name
        assert "background" in kwargs["candidate"]
        mock_save.assert_not_awaited()  # stateless: user saves via PUT


def test_generate_generic_paragraph_empty_output_returns_502():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
        patch(
            "api.routers.project_envs.render_generic_paragraph",
            new_callable=AsyncMock,
            side_effect=ValueError("generic paragraph returned empty output"),
        ),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/generic-paragraph/generate"
        )
    assert response.status_code == 502
    assert response.json()["detail"]["reason"] == "model_error"


def test_put_generic_paragraph_sets_and_never_retriggers():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1",
            json={"generic_paragraph": "本系统采用 ____ 架构。"},
        )

    assert response.status_code == 200, response.text
    assert response.json()["generic_paragraph"] == "本系统采用 ____ 架构。"
    assert response.json()["status"] == "verified"  # user content: no re-verify
    mock_submit.assert_not_awaited()


def test_put_generic_paragraph_explicit_null_clears():
    client = _client()
    env = _env(status="verified", generic_paragraph="旧段落")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1", json={"generic_paragraph": None}
        )

    assert response.status_code == 200
    assert env.generic_paragraph is None
    mock_submit.assert_not_awaited()


def test_put_generic_paragraph_over_5000_chars_rejected_with_422():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1",
            json={"generic_paragraph": "字" * 5001},
        )
    assert response.status_code == 422


def test_suggest_claim_rewrite_rejects_non_manual_review_point_with_409():
    client = _client()
    env, run = _needs_review_run_setup(
        _manual_point(state="pending", manual_reason=None, lanes={})
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")
    assert response.status_code == 409


def test_suggest_claim_rewrite_leaves_env_and_run_untouched():
    """The suggestion must be read-only: no run-row rewrite, no env save, and
    only SELECT queries may reach the database."""
    from open_notebook.ai.project_env_pipeline import SuggestRewrite

    client = _client()
    env, run = _needs_review_run_setup()
    run_before = json.loads(json.dumps(run, default=str))
    queries: list = []

    async def recording_dispatch(query, params=None):
        queries.append(query)
        return await _usage_dispatch(verification_rows=[run])(query, params)

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=recording_dispatch),
        patch(
            "api.routers.project_envs.suggest_rewrite",
            new_callable=AsyncMock,
            return_value=SuggestRewrite(suggestion="改写", explanation="理由"),
        ),
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as mock_save,
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/suggest")

    assert response.status_code == 200, response.text
    mock_save.assert_not_awaited()
    assert all("SELECT" in q.upper() and "UPDATE" not in q.upper() for q in queries)
    assert json.loads(json.dumps(run, default=str)) == run_before
    assert run["points"][0]["state"] == "manual_review"


def test_rewrite_prescreen_off_table_ignored_for_mock_env():
    """Mock mode has no anchor-table bounce: an off-table technology in the
    replacement text must not block a rewrite the lanes accept."""
    client = _client()
    env = _env(
        source_type="mock",
        status="needs_review",
        background="缓存层用 Redis 9.9。后续扩展。",
        draft_content={
            "background": "缓存层用 Redis 9.9。后续扩展。",
            "tech_background": "技术栈。",
            "tuning_process": "调优。",
            "problems_solutions": "问题。",
            "my_role": "我担任架构师。",
            "scale": "团队 20 人。",
        },
        pending_claims=[{"point_id": "p1", "quote": "缓存层用 Redis 9.9。"}],
    )
    run = _run_row(
        [
            _manual_point(
                quote="缓存层用 Redis 9.9。",
                lanes={
                    "B": {"verdict": "fail", "issues": []},
                    "C": {"verdict": "pass", "issues": []},
                },
            )
        ]
    )
    lane_pass = {"verdict": "pass", "issues": []}

    async def lane_result(lane, quote, field, context, mode="material"):
        return lane_pass

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "缓存层用 HyperDB 2.0，承载热点数据。"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["passed"] is True  # mock mode: no off_table route to manual
    assert body["env"]["status"] == "verified"
    assert run["points"][0]["manual_reason"] != "off_table"
    assert env.background == "缓存层用 HyperDB 2.0，承载热点数据。后续扩展。"


def test_rewrite_accepts_text_at_4000_char_boundary():
    client = _client()
    env, run = _needs_review_run_setup()
    lane_pass = {"verdict": "pass", "issues": []}

    async def lane_result(lane, quote, field, context, mode="material"):
        return lane_pass

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.verify_point_lane", side_effect=lane_result),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/project-envs/project_env:e1/claims/p1/rewrite",
            json={"text": "字" * 4000},
        )
    assert response.status_code == 200, response.text
    assert response.json()["passed"] is True


def test_dismiss_removes_paragraph_only_from_the_point_field():
    """The same sentence can appear in several fields; the dismiss must drop
    the paragraph from the claim's field alone and leave the others intact."""
    client = _client()
    quote = "系统采用 Redis 9.9 缓存。"
    env = _env(
        status="needs_review",
        background=f"{quote}\n整体高并发。",
        tech_background=f"技术栈概述。\n{quote}",
        pending_claims=[{"point_id": "p1", "quote": quote}],
    )
    run = _run_row([_manual_point(field="background", quote=quote)])
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    assert env.background == "整体高并发。"
    assert env.tech_background == f"技术栈概述。\n{quote}"  # untouched


def test_dismiss_settles_unlocatable_same_paragraph_peers():
    """A >800-char line is boxed into several points quoting one physical row;
    dismissing one must dismiss the stranded peers too, otherwise they can
    neither be dismissed (502) nor rewritten (quote_drift)."""
    client = _client()
    line = (
        "网关层率先完成改造并支撑了全站流量。"
        "缓存集群切换到新版本后命中率明显提升。"
        "订单链路压测达到预期吞吐并保持稳定。"
    )
    env = _env(
        status="needs_review",
        background=f"{line}\n整体高并发。",
        pending_claims=[
            {"point_id": "p1", "quote": "网关层率先完成改造并支撑了全站流量。"},
            {"point_id": "p2", "quote": "缓存集群切换到新版本后命中率明显提升。"},
            {"point_id": "p3", "quote": "订单链路压测达到预期吞吐并保持稳定。"},
        ],
    )
    run = _run_row(
        [
            _manual_point(point_id="p1", quote="网关层率先完成改造并支撑了全站流量。"),
            _manual_point(
                point_id="p2", quote="缓存集群切换到新版本后命中率明显提升。"
            ),
            _manual_point(point_id="p3", quote="订单链路压测达到预期吞吐并保持稳定。"),
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

        assert response.status_code == 200, response.text
        assert env.background == "整体高并发。"
        points = {p["point_id"]: p for p in run["points"]}
        assert points["p1"]["state"] == "dismissed"
        for pid in ("p2", "p3"):
            assert points[pid]["state"] == "dismissed"
            assert points[pid]["rounds"][-1]["note"] == "removed_with_paragraph"

        # the stranded peer is terminal now: re-dismiss must not 502
        response = client.post("/api/project-envs/project_env:e1/claims/p2/dismiss")
        assert response.status_code == 409, response.text


def test_dismiss_keeps_locatable_quote_in_other_field_manual_review():
    """The same quote in another field is still locatable there, so its point
    stays in manual_review — only this field's stranded points are settled."""
    client = _client()
    quote = "系统采用 Redis 9.9 缓存。"
    env = _env(
        status="needs_review",
        background=f"{quote}\n整体高并发。",
        tech_background=f"技术栈概述。\n{quote}",
        pending_claims=[
            {"point_id": "p1", "quote": quote},
            {"point_id": "p2", "quote": quote},
        ],
    )
    run = _run_row(
        [
            _manual_point(point_id="p1", field="background", quote=quote),
            _manual_point(point_id="p2", field="tech_background", quote=quote),
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    points = {p["point_id"]: p for p in run["points"]}
    assert points["p2"]["state"] == "manual_review"
    assert points["p2"].get("rounds") is None
    assert env.tech_background == f"技术栈概述。\n{quote}"  # untouched
    body = response.json()
    assert body["status"] == "needs_review"
    assert body["pending_claims_count"] == 1


def test_dismiss_all_points_final_promotes_env_to_verified():
    """With every same-line point settled by the one dismiss, the env converges
    to verified instead of staying stuck in needs_review."""
    client = _client()
    line = "网关层率先完成改造并支撑了全站流量。缓存集群切换到新版本后命中率明显提升。"
    env = _env(
        status="needs_review",
        background=f"{line}\n整体高并发。",
        pending_claims=[
            {"point_id": "p1", "quote": "网关层率先完成改造并支撑了全站流量。"},
            {"point_id": "p2", "quote": "缓存集群切换到新版本后命中率明显提升。"},
        ],
    )
    run = _run_row(
        [
            _manual_point(point_id="p1", quote="网关层率先完成改造并支撑了全站流量。"),
            _manual_point(
                point_id="p2", quote="缓存集群切换到新版本后命中率明显提升。"
            ),
            {
                "point_id": "p3",
                "quote": "整体高并发。",
                "field": "background",
                "state": "passed",
            },
        ]
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch(verification_rows=[run]),
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["has_snapshot"] is True
    assert body["pending_claims_count"] == 0
    assert env.pending_claims is None


def test_put_generic_paragraph_keeps_progress_and_status_unchanged():
    client = _client()
    progress = {"stage": "done", "percent": 100, "message": "3/3", "error": None}
    env = _env(
        status="verified",
        verification_progress=progress,
        verified_snapshot={
            "name": "电商平台重构",
            "background": "某电商平台微服务化改造项目",
        },
    )
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1",
            json={"generic_paragraph": "本系统采用 ____ 架构。"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["verification_progress"] == progress
    assert body["has_snapshot"] is True  # snapshot untouched by the edit
    mock_submit.assert_not_awaited()


def test_put_generic_paragraph_write_never_touches_live_progress():
    """DB-level guarantee behind the API response: _prepare_save_data drops
    verification_progress from every env save, so a paragraph edit cannot
    clobber the progress object a concurrent verify run is writing."""
    client = _client()
    env = _env(status="verified")
    env.verification_progress = {"stage": "verifying", "percent": 55}
    captured: dict = {}

    async def fake_repo_update(table, record_id, data):
        captured.update(table=table, record_id=record_id, data=data)
        return [data]

    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("open_notebook.domain.base.repo_update", new=fake_repo_update),
        patch(
            "api.routers.project_envs.CommandService.submit_command_job"
        ) as mock_submit,
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch()),
    ):
        response = client.put(
            "/api/project-envs/project_env:e1",
            json={"generic_paragraph": "新段落"},
        )

    assert response.status_code == 200, response.text
    assert captured["table"] == "project_env"
    payload = captured["data"]
    assert payload["generic_paragraph"] == "新段落"
    assert "verification_progress" not in payload
    assert payload["status"] == "verified"
    mock_submit.assert_not_awaited()
