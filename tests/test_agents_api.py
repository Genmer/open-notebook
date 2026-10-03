from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from open_notebook.domain.agent import Agent
from open_notebook.exceptions import InvalidInputError


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _agent(**overrides) -> Agent:
    data = dict(
        id="agent:123",
        name="Researcher",
        system_prompt="You are a meticulous researcher.",
        description="Default research persona",
        model="model:local",
        temperature=0.7,
        max_tokens=2048,
        enabled=True,
        sort_order=0,
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )
    data.update(overrides)
    return Agent(**data)


def _create_payload() -> dict:
    return {
        "name": "Researcher",
        "system_prompt": "You are a meticulous researcher.",
        "description": "Default research persona",
        "model": "model:local",
        "temperature": 0.7,
        "max_tokens": 2048,
    }


def _usage_side_effect(rows=None, name_rows=None):
    """Dispatch repo_query by SQL text: name-uniqueness lookups vs usage counts."""

    async def _dispatch(query, params=None):
        if "FROM agent WHERE" in query:
            return name_rows or []
        if "FROM chat_session" in query:
            return rows or []
        raise AssertionError(f"unexpected repo_query: {query}")

    return _dispatch


def test_create_agent_persists_and_reads_back():
    client = _client()
    saved: list[Agent] = []

    async def capture_save(agent: Agent):
        saved.append(agent)
        agent.id = "agent:created"
        agent.created = datetime(2026, 1, 1, 12, 0, 0)
        agent.updated = datetime(2026, 1, 1, 12, 0, 0)

    with (
        patch.object(Agent, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.agents.Model.get", new_callable=AsyncMock
        ) as mock_model_get,
        patch(
            "api.routers.agents.repo_query",
            side_effect=_usage_side_effect(),
        ) as mock_repo,
    ):
        response = client.post("/api/agents", json=_create_payload())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["id"] == "agent:created"
    assert body["model_id"] == "model:local"
    assert body["in_use_session_count"] == 0
    assert saved[0].name == "Researcher"
    mock_model_get.assert_awaited_once_with("model:local")
    # both the uniqueness precheck and the usage aggregate ran
    queries = [call.args[0] for call in mock_repo.call_args_list]
    assert any("FROM agent WHERE" in q for q in queries)
    assert any("FROM chat_session" in q for q in queries)


def test_create_agent_rejects_duplicate_name():
    client = _client()
    with (
        patch(
            "api.routers.agents.repo_query",
            side_effect=_usage_side_effect(name_rows=[{"id": "agent:existing"}]),
        ),
        patch.object(Agent, "save", new_callable=AsyncMock) as mock_save,
    ):
        response = client.post("/api/agents", json=_create_payload())

    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]
    mock_save.assert_not_awaited()


def test_create_agent_rejects_unknown_model():
    from open_notebook.exceptions import NotFoundError

    client = _client()

    async def raise_not_found(model_id):
        raise NotFoundError("model not found")

    with (
        patch(
            "api.routers.agents.Model.get", side_effect=raise_not_found
        ),
        patch.object(Agent, "save", new_callable=AsyncMock) as mock_save,
    ):
        response = client.post("/api/agents", json=_create_payload())

    assert response.status_code == 404
    assert response.json()["detail"] == "Model not found"
    mock_save.assert_not_awaited()


def test_update_agent_clears_model_on_explicit_null():
    client = _client()
    agent = _agent()

    async def fake_get(agent_id):
        assert agent_id == "agent:123"
        return agent

    async def capture_save(agent_self):
        agent_self.updated = datetime(2026, 1, 2, 12, 0, 0)

    with (
        patch("api.routers.agents.Agent.get", side_effect=fake_get),
        patch.object(Agent, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.agents.repo_query",
            side_effect=_usage_side_effect(
                rows=[{"agent": "agent:123", "total": 3}]
            ),
        ),
    ):
        response = client.put("/api/agents/agent:123", json={"model": None})

    assert response.status_code == 200, response.text
    assert agent.model is None
    assert response.json()["model_id"] is None
    assert response.json()["in_use_session_count"] == 3


def test_update_agent_skips_fields_not_in_payload():
    client = _client()
    agent = _agent()

    async def fake_get(agent_id):
        return agent

    async def capture_save(agent_self):
        agent_self.updated = datetime(2026, 1, 2, 12, 0, 0)

    with (
        patch("api.routers.agents.Agent.get", side_effect=fake_get),
        patch.object(Agent, "save", autospec=True, side_effect=capture_save),
        patch(
            "api.routers.agents.repo_query",
            side_effect=_usage_side_effect(),
        ),
    ):
        response = client.put("/api/agents/agent:123", json={"enabled": False})

    assert response.status_code == 200
    assert agent.enabled is False
    # temperature/max_tokens stay untouched when absent from the payload
    assert agent.temperature == 0.7
    assert agent.max_tokens == 2048


def test_delete_agent_does_not_touch_sessions():
    client = _client()
    agent = _agent()

    async def fake_get(agent_id):
        return agent

    with (
        patch("api.routers.agents.Agent.get", side_effect=fake_get),
        patch.object(Agent, "delete", new_callable=AsyncMock) as mock_delete,
        patch("api.routers.agents.repo_query", new_callable=AsyncMock) as mock_repo,
    ):
        response = client.delete("/api/agents/agent:123")

    assert response.status_code == 200
    mock_delete.assert_awaited_once_with()
    mock_repo.assert_not_awaited()


def test_list_agents_filters_disabled_and_maps_usage():
    client = _client()
    agents = [
        _agent(id="agent:on", name="A", enabled=True),
        _agent(id="agent:off", name="B", enabled=False),
    ]

    with (
        patch(
            "api.routers.agents.Agent.get_all",
            new_callable=AsyncMock,
            return_value=agents,
        ) as mock_get_all,
        patch(
            "api.routers.agents.repo_query",
            side_effect=_usage_side_effect(
                rows=[{"agent": "agent:on", "total": 2}]
            ),
        ),
    ):
        response = client.get("/api/agents", params={"enabled": True})

    assert response.status_code == 200
    body = response.json()
    assert [a["id"] for a in body] == ["agent:on"]
    assert body[0]["in_use_session_count"] == 2
    mock_get_all.assert_awaited_once_with(
        order_by="enabled desc, sort_order asc, name asc"
    )


def test_get_agent_404_on_not_found():
    from open_notebook.exceptions import NotFoundError

    client = _client()

    async def raise_not_found(agent_id):
        raise NotFoundError("agent not found")

    with patch("api.routers.agents.Agent.get", side_effect=raise_not_found):
        response = client.get("/api/agents/agent:missing")

    assert response.status_code == 404
    assert response.json()["detail"] == "Agent not found"


def test_domain_rejects_out_of_range_sampling_params():
    import pytest

    with pytest.raises(InvalidInputError):
        _agent(temperature=2.5)
    with pytest.raises(InvalidInputError):
        _agent(max_tokens=0)
    with pytest.raises(InvalidInputError):
        _agent(name="   ")
    with pytest.raises(InvalidInputError):
        _agent(system_prompt="  ")


# --- POST /api/agents/polish-prompt ---


class _FakeAIMessage:
    content = "<think>scratch</think>\n\n  Polished prompt body.  \n"


class _FakeLangchainModel:
    def __init__(self):
        self.payloads = []

    async def ainvoke(self, payload):
        self.payloads.append(payload)
        return _FakeAIMessage()


class _FakeProvisionedModel:
    def __init__(self, langchain_model):
        self.langchain_model = langchain_model
        self.model_name = "gpt-fake"


def test_polish_prompt_expands_draft_via_default_model():
    client = _client()
    draft = "帮我做一个能解读上市公司财报的分析助手"
    fake_model = _FakeLangchainModel()
    provision_calls: list[tuple] = []

    async def fake_provision(content, model_id, default_type, **kwargs):
        provision_calls.append((content, model_id, default_type, kwargs))
        return _FakeProvisionedModel(fake_model)

    with (
        patch("api.routers.agents.Prompter") as mock_prompter_cls,
        patch(
            "api.routers.agents.provision_langchain_model_with_info",
            side_effect=fake_provision,
        ) as mock_provision,
    ):
        mock_prompter_cls.return_value.render.return_value = "RENDERED PROMPT"
        response = client.post(
            "/api/agents/polish-prompt",
            json={
                "draft": draft,
                "name": "财报分析师",
                "description": "解读上市公司财报",
            },
        )

    assert response.status_code == 200, response.text
    # thinking block stripped and surrounding whitespace removed
    assert response.json() == {"polished": "Polished prompt body."}

    mock_prompter_cls.assert_called_once_with(prompt_template="agents/polish")
    render_kwargs = mock_prompter_cls.return_value.render.call_args.kwargs
    assert render_kwargs["data"]["draft"] == draft
    assert render_kwargs["data"]["name"] == "财报分析师"
    assert render_kwargs["data"]["description"] == "解读上市公司财报"

    # default chat model: no explicit model id, no sampling overrides
    mock_provision.assert_awaited_once()
    content, model_id, default_type, kwargs = provision_calls[0]
    assert content == "RENDERED PROMPT"
    assert model_id is None
    assert default_type == "chat"
    assert kwargs == {}
    # the model actually sees the rendered prompt
    assert fake_model.payloads[0][0].content == "RENDERED PROMPT"


def test_polish_prompt_rejects_empty_draft():
    client = _client()

    with patch("api.routers.agents.provision_langchain_model_with_info") as mock_prov:
        response = client.post("/api/agents/polish-prompt", json={"draft": ""})

    assert response.status_code == 422
    mock_prov.assert_not_awaited()


def test_polish_prompt_rejects_draft_over_8000_chars():
    client = _client()

    with patch("api.routers.agents.provision_langchain_model_with_info") as mock_prov:
        response = client.post(
            "/api/agents/polish-prompt", json={"draft": "a" * 8001}
        )

    assert response.status_code == 422
    mock_prov.assert_not_awaited()
