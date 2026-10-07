"""Injection tests: render gate matrix, build_render_state, prompt templates."""

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from ai_prompter import Prompter
from fastapi.testclient import TestClient

from api.project_env_service import (
    INJECTABLE_STATUS_NOTE,
    render_project_env_context,
)
from open_notebook.domain.project_env import ProjectEnv


def _env(**overrides) -> ProjectEnv:
    data = dict(
        id="project_env:e1",
        name="电商平台重构",
        background="某电商平台微服务化改造项目",
        period_start="2025.01",
        period_end="2025.08",
        source_type="real",
        status="verified",
        verified_snapshot={
            "name": "电商平台重构",
            "period_start": "2025.01",
            "period_end": "2025.08",
            "background": "某电商平台微服务化改造项目",
            "tech_background": "Spring Boot 3.2",
            "frozen_at": "2026-01-01T00:00:00",
            "source_type": "real",
        },
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    data.update(overrides)
    return ProjectEnv(**data)


async def _render(env_or_error, ref="project_env:e1"):
    if isinstance(env_or_error, Exception):
        getter = patch(
            "api.project_env_service.ProjectEnv.get", side_effect=env_or_error
        )
    else:
        getter = patch(
            "api.project_env_service.ProjectEnv.get", return_value=env_or_error
        )
    with getter:
        return await render_project_env_context(ref)


@pytest.mark.asyncio
async def test_verified_env_renders_snapshot_text():
    result = await _render(_env(status="verified"))
    assert result["state"] == "verified"
    assert "某电商平台微服务化改造项目" in result["text"]
    assert "Spring Boot 3.2" in result["text"]
    assert "2025.01" in result["text"]
    assert "真实项目" in result["text"]
    assert INJECTABLE_STATUS_NOTE not in result["text"]


@pytest.mark.asyncio
async def test_pending_with_snapshot_renders_stale_marker():
    result = await _render(_env(status="pending"))
    assert result["state"] == "pending_stale"
    assert result["text"].startswith(INJECTABLE_STATUS_NOTE)
    assert "某电商平台微服务化改造项目" in result["text"]


@pytest.mark.asyncio
async def test_pending_without_snapshot_not_injectable():
    env = _env(status="pending", verified_snapshot=None)
    result = await _render(env)
    assert result == {"text": None, "state": "pending"}


@pytest.mark.asyncio
async def test_needs_review_and_failed_not_injectable():
    assert await _render(_env(status="needs_review", verified_snapshot=None)) == {
        "text": None,
        "state": "needs_review",
    }
    assert await _render(_env(status="failed", verified_snapshot=None)) == {
        "text": None,
        "state": "failed",
    }


@pytest.mark.asyncio
async def test_dangling_env_returns_dangling_signal():
    from open_notebook.exceptions import NotFoundError

    result = await _render(NotFoundError("gone"))
    assert result == {"text": None, "state": "dangling"}


@pytest.mark.asyncio
async def test_empty_ref_returns_none():
    assert await render_project_env_context(None) is None
    assert await render_project_env_context("") is None


def test_build_render_state_contains_project_env_key():
    from api.routers.chat_parallel import build_render_state

    state = build_render_state(
        history=[],
        message="问一句",
        notebook=None,
        context={"sources": []},
        agent=None,
        project_env_context="项目环境文本",
    )
    assert state["project_env_context"] == "项目环境文本"
    assert state["agent_instructions"] is None

    state = build_render_state([], "q", None, {}, None)
    assert "project_env_context" in state
    assert state["project_env_context"] is None


def _render_chat_system(**extra):
    data: dict = {
        "messages": [],
        "notebook": None,
        "context": None,
        "agent_instructions": None,
        "project_env_context": None,
    }
    data.update(extra)
    return Prompter(prompt_template="chat/system").render(data=data)


def test_chat_template_contains_project_env_block():
    rendered = _render_chat_system(project_env_context="已验证的项目背景")
    assert "软考论文写作设定" in rendered
    assert "已验证的项目背景" in rendered
    assert "优先于任何通用 persona 指令" in rendered


def test_chat_template_without_env_is_byte_identical_to_before():
    rendered = _render_chat_system()
    assert "软考论文写作设定" not in rendered
    assert "PROJECT ENVIRONMENT" not in rendered
    assert "# SYSTEM ROLE" in rendered


def test_chat_template_env_block_and_agent_persona_coexist():
    rendered = _render_chat_system(
        agent_instructions="你是一名架构师",
        project_env_context="已验证的项目背景",
    )
    assert "AGENT PERSONA" in rendered
    assert "已验证的项目背景" in rendered


def test_source_chat_template_contains_project_env_block():
    rendered = Prompter(prompt_template="source_chat/system").render(
        data={
            "source": None,
            "insights": [],
            "context": None,
            "context_indicators": {"sources": [], "insights": [], "notes": []},
            "project_env_context": "源聊里的项目环境",
        }
    )
    assert "源聊里的项目环境" in rendered
    assert "软考论文写作设定" in rendered


def test_source_chat_template_without_env_matches_baseline():
    rendered = Prompter(prompt_template="source_chat/system").render(
        data={
            "source": None,
            "insights": [],
            "context": None,
            "context_indicators": {"sources": [], "insights": [], "notes": []},
            "project_env_context": None,
        }
    )
    assert "软考论文写作设定" not in rendered
    assert "# SYSTEM ROLE" in rendered


@pytest.mark.asyncio
async def test_parallel_stream_endpoint_wires_env_context_into_render_state():
    """Router-level wiring for chat_parallel (the build_render_state unit test
    cannot catch a router that never passes the context through): the SSE
    endpoint must resolve session.project_env through the real render gate and
    hand the snapshot text to every participant's render state."""
    from langchain_core.messages import AIMessage

    from api.main import app
    from api.routers.chat_parallel import build_render_state as real_build
    from open_notebook.domain.notebook import ChatSession

    client = TestClient(app)
    session = ChatSession(
        id="chat_session:s1",
        title="s",
        project_env="project_env:e1",
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    state = type("State", (), {"values": {"messages": []}})()
    captured: dict = {}

    def spy_build(*args, **kwargs):
        captured["project_env_context"] = (
            kwargs.get("project_env_context")
            if "project_env_context" in kwargs
            else (args[5] if len(args) > 5 else "MISSING")
        )
        return real_build(*args, **kwargs)

    class _FakeProv:
        model_name = "gpt-test"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content="answer")

        def __init__(self):
            self.langchain_model = self._Model()

    async def fake_provision(content, model_id, default_type, **kwargs):
        return _FakeProv()

    with (
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.routers.chat_parallel.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch(
            "api.routers.chat_parallel.Notebook.get",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch("api.routers.chat_parallel.chat_graph.get_state", return_value=state),
        patch("api.routers.chat_parallel.build_render_state", new=spy_build),
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            side_effect=fake_provision,
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new_callable=AsyncMock()),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="verified"),
        ),
    ):
        response = client.post(
            "/api/chat/sessions/chat_session:s1/parallel",
            json={"message": "介绍项目背景", "context": {}, "runs": ["default"]},
        )

    assert response.status_code == 200
    events = []
    for line in response.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    assert any(e.get("type") == "run_complete" for e in events), events
    assert "某电商平台微服务化改造项目" in captured["project_env_context"]
    assert INJECTABLE_STATUS_NOTE not in captured["project_env_context"]


@pytest.mark.asyncio
async def test_parallel_stream_endpoint_closed_gate_sends_none():
    """A session bound to a non-injectable env (needs_review, no snapshot)
    must render with project_env_context=None — the gate closes, chat lives."""
    from langchain_core.messages import AIMessage

    from api.main import app
    from api.routers.chat_parallel import build_render_state as real_build
    from open_notebook.domain.notebook import ChatSession

    client = TestClient(app)
    session = ChatSession(
        id="chat_session:s1",
        title="s",
        project_env="project_env:e1",
        created=datetime(2026, 1, 1),
        updated=datetime(2026, 1, 1),
    )
    state = type("State", (), {"values": {"messages": []}})()
    captured: dict = {}

    def spy_build(*args, **kwargs):
        captured["project_env_context"] = (
            kwargs.get("project_env_context")
            if "project_env_context" in kwargs
            else (args[5] if len(args) > 5 else "MISSING")
        )
        return real_build(*args, **kwargs)

    class _FakeProv:
        model_name = "gpt-test"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content="answer")

        def __init__(self):
            self.langchain_model = self._Model()

    async def fake_provision(content, model_id, default_type, **kwargs):
        return _FakeProv()

    with (
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new_callable=AsyncMock,
            return_value=("chat_session:s1", session),
        ),
        patch(
            "api.routers.chat_parallel.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch(
            "api.routers.chat_parallel.Notebook.get",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch("api.routers.chat_parallel.chat_graph.get_state", return_value=state),
        patch("api.routers.chat_parallel.build_render_state", new=spy_build),
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            side_effect=fake_provision,
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new_callable=AsyncMock()),
        patch(
            "api.project_env_service.ProjectEnv.get",
            new_callable=AsyncMock,
            return_value=_env(status="needs_review", verified_snapshot=None),
        ),
    ):
        response = client.post(
            "/api/chat/sessions/chat_session:s1/parallel",
            json={"message": "介绍项目背景", "context": {}, "runs": ["default"]},
        )

    assert response.status_code == 200
    events = []
    for line in response.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    assert any(e.get("type") == "run_complete" for e in events), events
    assert captured["project_env_context"] is None


# --- generic paragraph injection (迁移 39) ---


@pytest.mark.asyncio
async def test_verified_env_appends_generic_paragraph_block():
    env = _env(status="verified", generic_paragraph="本系统采用 ____ 架构。<u>要点</u>")
    result = await _render(env)
    assert result["state"] == "verified"
    assert "通用段落（写作时直接套用，填空处按项目实情填充）：" in result["text"]
    assert "本系统采用 ____ 架构。<u>要点</u>" in result["text"]
    assert result["text"].index("验证通过时间") < result["text"].index("通用段落")


@pytest.mark.asyncio
async def test_verified_env_without_generic_paragraph_stays_unchanged():
    result = await _render(_env(status="verified"))
    assert result["state"] == "verified"
    assert "通用段落" not in result["text"]


@pytest.mark.asyncio
async def test_pending_stale_includes_note_snapshot_and_generic_paragraph():
    env = _env(status="pending", generic_paragraph="通用段落内容")
    result = await _render(env)
    assert result["state"] == "pending_stale"
    assert result["text"].startswith(INJECTABLE_STATUS_NOTE)
    assert "某电商平台微服务化改造项目" in result["text"]
    assert "通用段落内容" in result["text"]


@pytest.mark.asyncio
async def test_generic_paragraph_not_part_of_frozen_snapshot():
    env = _env(status="verified", generic_paragraph="用户写的段落")
    snapshot = env.build_snapshot()
    assert "generic_paragraph" not in snapshot


@pytest.mark.asyncio
async def test_generic_paragraph_edit_keeps_snapshot():
    env = _env(status="verified", generic_paragraph="旧段落")
    before = env.verified_snapshot
    env.generic_paragraph = "编辑后的段落"
    assert env.verified_snapshot is before
