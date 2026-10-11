"""API tests for the fixed-parts generation endpoint (批次4 写作台固定件).

Mirrors the generic-paragraph endpoint tests in test_project_envs_api.py:
all DB and LLM seams are patched (ProjectEnv persistence, repo_query, and
the pipeline function imported by the router). The endpoint is stateless —
success must never call ProjectEnv.save.
"""

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from open_notebook.domain.project_env import ProjectEnv


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


async def _usage_dispatch(query, params=None):
    if "SELECT verification_token FROM project_env" in query:
        return [{"verification_token": "t1"}]
    if "FROM chat_session" in query:
        return []
    if "FROM source" in query:
        return [{"total": 1}]
    if "FROM note" in query:
        return [{"total": 0}]
    return []


FIXED_PARTS_PAYLOAD = {
    "abstract": "摘要 ____ <u>微服务</u>",
    "background": "背景 ____ <u>Redis</u>",
    "closing": "结尾 ____ <u>限流</u>",
}


def test_generate_fixed_parts_success_is_stateless_and_passes_env_context():
    client = _client()
    env = _env(status="verified", industry="物流行业")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ) as mock_get,
        patch(
            "api.routers.project_envs.repo_query",
            side_effect=_usage_dispatch,
        ),
        patch(
            "api.routers.project_envs.render_fixed_parts",
            new_callable=AsyncMock,
            return_value=dict(FIXED_PARTS_PAYLOAD),
        ) as mock_render,
        patch(
            "api.routers.project_envs.ProjectEnv.save", new_callable=AsyncMock
        ) as mock_save,
    ):
        response = client.post("/api/project-envs/project_env:e1/fixed-parts/generate")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["abstract"] == FIXED_PARTS_PAYLOAD["abstract"]
    assert body["background"] == FIXED_PARTS_PAYLOAD["background"]
    assert body["closing"] == FIXED_PARTS_PAYLOAD["closing"]
    # 素材上下文全量透传给渲染函数（红线：仅 ProjectEnv 字段，无检索）
    assert mock_render.await_args is not None
    kwargs = mock_render.await_args.kwargs
    assert kwargs["name"] == env.name
    assert kwargs["source_type"] == env.source_type
    assert kwargs["industry"] == env.industry
    assert kwargs["period_start"] == env.period_start
    assert kwargs["period_end"] == env.period_end
    assert "background" in kwargs["candidate"]
    mock_get.assert_awaited_once()
    mock_save.assert_not_awaited()  # stateless: user saves into the draft


def test_generate_fixed_parts_requires_material():
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
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch),
    ):
        response = client.post("/api/project-envs/project_env:e1/fixed-parts/generate")
    assert response.status_code == 422
    assert response.json()["detail"]["reason"] == "no_material"


def test_generate_fixed_parts_unusable_output_returns_502():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch),
        patch(
            "api.routers.project_envs.render_fixed_parts",
            new_callable=AsyncMock,
            side_effect=ValueError("fixed parts returned unusable output"),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/fixed-parts/generate")
    assert response.status_code == 502
    assert response.json()["detail"]["reason"] == "model_error"


def test_generate_fixed_parts_timeout_returns_504():
    client = _client()
    env = _env(status="verified")
    with (
        patch(
            "api.routers.project_envs.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=env,
        ),
        patch("api.routers.project_envs.repo_query", side_effect=_usage_dispatch),
        patch(
            "api.routers.project_envs.render_fixed_parts",
            new_callable=AsyncMock,
            side_effect=asyncio.TimeoutError(),
        ),
    ):
        response = client.post("/api/project-envs/project_env:e1/fixed-parts/generate")
    assert response.status_code == 504
    assert response.json()["detail"]["reason"] == "model_timeout"
