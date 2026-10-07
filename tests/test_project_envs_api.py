"""API tests for project envs (routers/project_envs.py + chat session binding).

All DB and LLM seams are patched: ProjectEnv persistence, repo_query,
CommandService jobs and the pipeline functions imported by the router.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from open_notebook.domain.project_env import ProjectEnv
from open_notebook.exceptions import NotFoundError


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
        pending_claims=[{"point_id": "p1", "quote": "Redis 7.0"}],
        background="系统采用 Redis 7.0 缓存。整体高并发。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 7.0 缓存",
                "field": "background",
                "state": "manual_review",
            },
            {
                "point_id": "p2",
                "quote": "整体高并发",
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
        patch(
            "api.routers.project_envs.remove_supporting_text",
            new_callable=AsyncMock,
            return_value="整体高并发。",
        ) as mock_remove,
        patch("api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock),
    ):
        response = client.post("/api/project-envs/project_env:e1/claims/p1/dismiss")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "verified"
    assert body["has_snapshot"] is True
    assert body["pending_claims_count"] == 0
    mock_remove.assert_awaited_once()
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
        pending_claims=[{"point_id": "p1", "quote": "Redis 7.0"}],
        background="系统采用 Redis 7.0 缓存。整体高并发。",
    )
    run = _run_row(
        [
            {
                "point_id": "p1",
                "quote": "系统采用 Redis 7.0 缓存",
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
            "api.routers.project_envs.remove_supporting_text",
            new_callable=AsyncMock,
            return_value="整体高并发。",
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
