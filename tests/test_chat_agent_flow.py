"""PDR-004 batch 2: agent persona wiring through the notebook chat execute chain.

Covers: session agent field round-trip + mutual exclusion with model_override,
execute-time agent resolution (request > session), dangling/disabled agent
degradation, model fallback chain, persona injection into the system prompt,
sampling params reaching the provisioning kwargs, and run metadata
(model_name/agent_name) surfacing on ChatMessage.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage

from open_notebook.domain.agent import Agent
from open_notebook.domain.notebook import ChatSession


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _agent(**overrides) -> Agent:
    data = dict(
        id="agent:1",
        name="Researcher",
        system_prompt="Answer with academic rigor.",
        description=None,
        model="model:gpt",
        temperature=0.2,
        max_tokens=1024,
        enabled=True,
        sort_order=0,
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )
    data.update(overrides)
    return Agent(**data)


def _session(**overrides) -> ChatSession:
    data = dict(
        id="chat_session:s1",
        title="Session",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )
    data.update(overrides)
    return ChatSession(**data)


def test_update_session_setting_agent_clears_model_override():
    client = _client()
    session = _session(model_override="model:old")

    async def fake_get(session_id):
        return session

    async def capture_save(session_self):
        session_self.updated = datetime(2026, 1, 2, 12, 0, 0)

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch.object(ChatSession, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
    ):
        response = client.put(
            "/api/chat/sessions/chat_session:s1", json={"agent": "agent:1"}
        )

    assert response.status_code == 200, response.text
    assert response.json()["agent"] == "agent:1"
    assert session.agent == "agent:1"
    assert session.model_override is None


def test_update_session_setting_model_clears_agent():
    client = _client()
    session = _session(agent="agent:1")

    async def capture_save(session_self):
        session_self.updated = datetime(2026, 1, 2, 12, 0, 0)

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch.object(ChatSession, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
    ):
        response = client.put(
            "/api/chat/sessions/chat_session:s1", json={"model_override": "model:new"}
        )

    assert response.status_code == 200, response.text
    assert session.model_override == "model:new"
    assert session.agent is None


def test_update_session_explicit_both_wins():
    client = _client()
    session = _session(agent="agent:old", model_override="model:old")

    async def capture_save(session_self):
        session_self.updated = datetime(2026, 1, 2, 12, 0, 0)

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch.object(ChatSession, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch(
            "api.routers.chat.get_session_message_count",
            new_callable=AsyncMock,
            return_value=0,
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
    ):
        response = client.put(
            "/api/chat/sessions/chat_session:s1",
            json={"agent": "agent:2", "model_override": "model:new"},
        )

    assert response.status_code == 200
    assert session.agent == "agent:2"
    assert session.model_override == "model:new"


def test_execute_chat_resolves_session_agent_and_injects_state():
    client = _client()
    session = _session(agent="agent:1")
    agent = _agent()
    captured_state = {}

    def fake_invoke(input, config=None, **kwargs):  # noqa: A002
        captured_state.update(input)
        return {
            "messages": [
                HumanMessage(content="hi"),
                AIMessage(
                    content="Hello!",
                    additional_kwargs={
                        "model_name": "gpt-test",
                        "agent_name": "Researcher",
                    },
                ),
            ]
        }

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
        patch(
            "api.routers.chat.resolve_agent_binding",
            new_callable=AsyncMock,
            return_value=agent,
        ) as mock_resolve,
        patch(
            "api.routers.chat.chat_graph.get_state",
            return_value=None,
        ),
        patch("api.routers.chat.chat_graph.invoke", side_effect=fake_invoke),
        patch.object(ChatSession, "save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/chat/execute",
            json={
                "session_id": "chat_session:s1",
                "message": "hi",
                "context": {},
            },
        )

    assert response.status_code == 200, response.text
    mock_resolve.assert_awaited_once_with("agent:1")
    assert captured_state["agent_instructions"] == "Answer with academic rigor."
    assert captured_state["agent_name"] == "Researcher"
    assert captured_state["agent_temperature"] == 0.2
    assert captured_state["agent_max_tokens"] == 1024
    # agent.model fills model_override when no explicit model is set
    assert captured_state["model_override"] == "model:gpt"
    # run metadata surfaces on the AI message
    ai_msg = [m for m in response.json()["messages"] if m["type"] == "ai"][0]
    assert ai_msg["model_name"] == "gpt-test"
    assert ai_msg["agent_name"] == "Researcher"


def test_execute_chat_explicit_model_beats_agent_model():
    client = _client()
    session = _session(agent="agent:1")
    agent = _agent()

    def fake_invoke(input, config=None, **kwargs):  # noqa: A002
        assert input["model_override"] == "model:explicit"
        return {"messages": [AIMessage(content="ok")]}

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
        patch(
            "api.routers.chat.resolve_agent_binding",
            new_callable=AsyncMock,
            return_value=agent,
        ),
        patch("api.routers.chat.chat_graph.get_state", return_value=None),
        patch("api.routers.chat.chat_graph.invoke", side_effect=fake_invoke),
        patch.object(ChatSession, "save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/chat/execute",
            json={
                "session_id": "chat_session:s1",
                "message": "hi",
                "context": {},
                "model_override": "model:explicit",
            },
        )

    assert response.status_code == 200


def test_execute_chat_dangling_agent_degrades_to_default():
    client = _client()
    session = _session(agent="agent:gone")
    captured_state = {}

    def fake_invoke(input, config=None, **kwargs):  # noqa: A002
        captured_state.update(input)
        return {"messages": [AIMessage(content="ok")]}

    with (
        patch(
            "api.routers.chat.get_session_or_404",
            side_effect=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch(
            "api.routers.chat.repo_query",
            new_callable=AsyncMock,
            return_value=[{"out": "notebook:n1"}],
        ),
        patch("api.routers.chat.Notebook.get", new_callable=AsyncMock),
        # Session references a deleted agent -> resolve returns None
        patch(
            "api.routers.chat.resolve_agent_binding",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch("api.routers.chat.chat_graph.get_state", return_value=None),
        patch("api.routers.chat.chat_graph.invoke", side_effect=fake_invoke),
        patch.object(ChatSession, "save", new_callable=AsyncMock),
    ):
        response = client.post(
            "/api/chat/execute",
            json={
                "session_id": "chat_session:s1",
                "message": "hi",
                "context": {},
            },
        )

    assert response.status_code == 200
    assert captured_state["agent_instructions"] is None
    assert captured_state["model_override"] is None


def test_resolve_agent_binding_degrades_on_not_found():
    import asyncio

    from api.routers._chat_shared import resolve_agent_binding
    from open_notebook.exceptions import NotFoundError

    async def raise_not_found(agent_id):
        raise NotFoundError("gone")

    with patch(
        "open_notebook.domain.agent.Agent.get", side_effect=raise_not_found
    ):
        assert asyncio.run(resolve_agent_binding("agent:gone")) is None

    disabled = _agent(enabled=False)
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new_callable=AsyncMock,
        return_value=disabled,
    ):
        assert asyncio.run(resolve_agent_binding("agent:1")) is None

    enabled = _agent()
    with patch(
        "open_notebook.domain.agent.Agent.get",
        new_callable=AsyncMock,
        return_value=enabled,
    ):
        assert asyncio.run(resolve_agent_binding("agent:1")) is enabled

    # empty id short-circuits without touching the DB
    assert asyncio.run(resolve_agent_binding(None)) is None
    assert asyncio.run(resolve_agent_binding("")) is None


def test_system_prompt_renders_persona_block():
    from ai_prompter import Prompter

    rendered = Prompter(prompt_template="chat/system").render(
        data={
            "agent_instructions": "Speak like a pirate.",
            "notebook": None,
            "context": None,
        }
    )
    assert "Speak like a pirate." in rendered
    assert "AGENT PERSONA" in rendered

    plain = Prompter(prompt_template="chat/system").render(
        data={"notebook": None, "context": None}
    )
    assert "AGENT PERSONA" not in plain


def test_graph_node_passes_agent_sampling_params_to_provisioning():
    from open_notebook.graphs.chat import call_model_with_messages

    provision_calls = []

    class FakeProv:
        langchain_model = None
        model_name = "gpt-test"

        class _Model:
            def invoke(self, payload):
                return AIMessage(content="ok", additional_kwargs={})

        def __init__(self):
            self.langchain_model = self._Model()

    async def fake_provision(content, model_id, default_type, **kwargs):
        provision_calls.append(kwargs)
        return FakeProv()

    state = {
        "messages": [HumanMessage(content="hi")],
        "model_override": "model:gpt",
        "agent_instructions": "Be brief.",
        "agent_name": "Researcher",
        "agent_temperature": 0.4,
        "agent_max_tokens": 512,
        "notebook": None,
        "context": None,
    }

    with patch(
        "open_notebook.graphs.chat.provision_langchain_model_with_info",
        side_effect=fake_provision,
    ), patch(
        "open_notebook.graphs.chat.record_llm_usage_sync"
    ):
        result = call_model_with_messages(state, {"configurable": {}})  # type: ignore[arg-type]

    assert provision_calls == [
        {"max_tokens": 512, "temperature": 0.4}
    ]
    ai_message = result["messages"]
    assert ai_message.additional_kwargs["model_name"] == "gpt-test"
    assert ai_message.additional_kwargs["agent_name"] == "Researcher"


def test_graph_node_defaults_without_agent_params():
    from open_notebook.graphs.chat import call_model_with_messages

    provision_calls = []

    class FakeProv:
        model_name = "gpt-test"

        class _Model:
            def invoke(self, payload):
                return AIMessage(content="ok")

        langchain_model = None

        def __init__(self):
            self.langchain_model = self._Model()

    async def fake_provision(content, model_id, default_type, **kwargs):
        provision_calls.append(kwargs)
        return FakeProv()

    state = {
        "messages": [HumanMessage(content="hi")],
        "model_override": None,
        "agent_instructions": None,
        "agent_name": None,
        "agent_temperature": None,
        "agent_max_tokens": None,
        "notebook": None,
        "context": None,
    }

    with patch(
        "open_notebook.graphs.chat.provision_langchain_model_with_info",
        side_effect=fake_provision,
    ), patch(
        "open_notebook.graphs.chat.record_llm_usage_sync"
    ):
        call_model_with_messages(state, {"configurable": {}})  # type: ignore[arg-type]

    assert provision_calls == [{"max_tokens": 8192}]
