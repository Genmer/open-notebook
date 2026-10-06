"""PDR-004 batch 4: parallel chat orchestration.

Covers: run-key validation, SSE event sequence, per-run agent degradation,
single archive call carrying group metadata, disconnect-safe orchestration
(the archive happens even when nobody consumes the queue), and synthesis
integration is covered separately in batch 5.
"""

import asyncio
import json
from contextlib import ExitStack
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
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
        system_prompt="Be rigorous.",
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


def _session() -> ChatSession:
    return ChatSession(
        id="chat_session:s1",
        title="Session",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )


def _wire_common(session=None, history=None):
    """Patch everything the endpoint touches before the orchestration task."""
    session = session or _session()
    state = type("State", (), {"values": {"messages": history or []}})()

    class _FakeProv:
        model_name = "gpt-test"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content=f"answer::{payload[-1].content}")

        langchain_model = None

        def __init__(self):
            self.langchain_model = self._Model()

    async def fake_provision(content, model_id, default_type, **kwargs):
        return _FakeProv()

    patches = [
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new=AsyncMock(return_value=("chat_session:s1", session)),
        ),
        patch(
            "api.routers.chat_parallel.repo_query",
            new=AsyncMock(return_value=[{"out": "notebook:n1"}]),
        ),
        patch(
            "api.routers.chat_parallel.Notebook.get",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "api.routers.chat_parallel.chat_graph.get_state",
            return_value=state,
        ),
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            side_effect=fake_provision,
        ),
        patch(
            "api.routers.chat_parallel.record_llm_usage_sync",
        ),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]
    return session, patches


def _sse_events(resp) -> list:
    events = []
    for line in resp.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: "):]))
    return events


def test_parallel_rejects_bad_run_keys():
    client = _client()
    # validation happens before any session lookup
    response = client.post(
        "/api/chat/sessions/chat_session:s1/parallel",
        json={"message": "hi", "context": {}, "runs": ["bogus:1"]},
    )
    assert response.status_code == 400
    assert "invalid run key" in response.json()["detail"]


def test_parallel_rejects_too_many_runs():
    client = _client()
    runs = [f"model:model:{i}" for i in range(6)]
    response = client.post(
        "/api/chat/sessions/chat_session:s1/parallel",
        json={"message": "hi", "context": {}, "runs": runs},
    )
    assert response.status_code == 400
    assert "1 to 5" in response.json()["detail"]


def test_parallel_rejects_duplicates():
    client = _client()
    response = client.post(
        "/api/chat/sessions/chat_session:s1/parallel",
        json={
            "message": "hi",
            "context": {},
            "runs": ["default", "default"],
        },
    )
    assert response.status_code == 400
    assert "duplicates" in response.json()["detail"]


def test_parallel_streams_runs_archives_once():
    client = _client()
    agent = _agent()
    session, patches = _wire_common()

    update_state_calls = []

    def fake_update_state(config, values):
        update_state_calls.append(values)

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        stack.enter_context(
            patch(
                "api.routers.chat_parallel.resolve_agent_binding",
                new=AsyncMock(return_value=agent),
            )
        )
        stack.enter_context(
            patch(
                "api.routers.chat_parallel.chat_graph.update_state",
                side_effect=fake_update_state,
            )
        )
        response = client.post(
            "/api/chat/sessions/chat_session:s1/parallel",
            json={
                "message": "compare this",
                "context": {},
                "runs": ["default", "agent:agent:1"],
            },
        )

    assert response.status_code == 200
    events = _sse_events(response)
    types = [e["type"] for e in events]

    assert types[0] == "runs_started"
    assert types[-1] == "complete"
    assert types.count("run_complete") == 2
    assert "archived" in types

    started = events[0]
    assert started["group_id"].startswith("par_")
    assert [r["key"] for r in started["runs"]] == ["default", "agent:agent:1"]
    assert started["runs"][1]["name"] == "Researcher"

    archived = next(e for e in events if e["type"] == "archived")
    # human message + two AI answers, all carrying the group id
    assert archived["messages"][0]["type"] == "human"
    assert archived["messages"][0]["group_id"] == started["group_id"]
    ai_messages = [m for m in archived["messages"] if m["type"] == "ai"]
    assert len(ai_messages) == 2
    assert {m["agent_name"] for m in ai_messages} == {None, "Researcher"}
    assert all(m["run_role"] == "answer" for m in ai_messages)

    # exactly one archive write with all messages
    assert len(update_state_calls) == 1
    assert len(update_state_calls[0]["messages"]) == 3


def test_parallel_dangling_agent_degrades_to_run_error():
    client = _client()
    session, patches = _wire_common()

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        stack.enter_context(
            patch(
                "api.routers.chat_parallel.resolve_agent_binding",
                new=AsyncMock(return_value=None),
            )
        )
        stack.enter_context(
            patch("api.routers.chat_parallel.chat_graph.update_state")
        )
        response = client.post(
            "/api/chat/sessions/chat_session:s1/parallel",
            json={
                "message": "hi",
                "context": {},
                "runs": ["agent:agent:gone", "default"],
            },
        )

    assert response.status_code == 200
    events = _sse_events(response)
    errors = [e for e in events if e["type"] == "run_error"]
    assert len(errors) == 1
    assert errors[0]["key"] == "agent:agent:gone"
    assert "not available" in errors[0]["message"]
    # the other run still completes and archives
    assert any(e["type"] == "run_complete" for e in events)
    assert any(e["type"] == "archived" for e in events)


@pytest.mark.asyncio
async def test_orchestration_archives_without_consumer():
    """The orchestration task must archive even if the SSE stream is dropped."""
    from langchain_core.messages import BaseMessage

    from api.routers.chat_parallel import _orchestrate

    session = _session()
    history: list[BaseMessage] = [HumanMessage(content="earlier")]
    participants = [
        {
            "key": "default",
            "kind": "default",
            "model_id": None,
            "agent": None,
            "error": None,
            "display_name": "default",
        }
    ]

    class _FakeProv:
        model_name = "gpt-test"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content="solo answer")

        langchain_model = None

        def __init__(self):
            self.langchain_model = self._Model()

    queue: asyncio.Queue = asyncio.Queue()
    update_calls = []

    def fake_update_state(config, values):
        update_calls.append(values)

    with (
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            new=AsyncMock(return_value=_FakeProv()),
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
        patch("api.routers.chat_parallel.chat_graph.update_state", side_effect=fake_update_state),
    ):
        # fire and forget: nobody awaits/consumes the queue
        task = asyncio.create_task(
            _orchestrate(
                queue=queue,
                full_session_id="chat_session:s1",
                session=session,
                notebook=None,
                context={},
                history=history,
                message="orphan run",
                participants=participants,
                group_id="par_test",
            )
        )
        # drain the queue as the generator would, until the sentinel
        while True:
            item = await queue.get()
            if item is None:
                break
        await task

    assert len(update_calls) == 1
    archived = update_calls[0]["messages"]
    assert archived[0].content == "orphan run"
    assert archived[0].additional_kwargs["group_id"] == "par_test"
    assert archived[1].content == "solo answer"
    assert archived[1].additional_kwargs["group_id"] == "par_test"


def test_answer_once_mirrors_graph_node_metadata():
    import asyncio as _asyncio

    from api.routers.chat_parallel import _answer_once

    agent = _agent()

    class _FakeProv:
        model_name = "gpt-agent"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content="<think>x</think>clean body")

        langchain_model = None

        def __init__(self):
            self.langchain_model = self._Model()

    seen_kwargs: dict = {}

    async def fake_provision(content, model_id, default_type, **kwargs):
        seen_kwargs.update(kwargs)
        return _FakeProv()

    with patch(
        "api.routers.chat_parallel.provision_langchain_model_with_info",
        side_effect=fake_provision,
    ):
        archived, prov, raw = _asyncio.run(
            _answer_once(
                notebook=None,
                context=None,
                history=[],
                message="q",
                agent=agent,
                model_id="model:gpt",
                group_id="par_x",
            )
        )

    assert archived.content == "clean body"  # thinking tags stripped
    assert archived.additional_kwargs["agent_name"] == "Researcher"
    assert archived.additional_kwargs["run_role"] == "answer"
    assert archived.additional_kwargs["group_id"] == "par_x"
    # agent sampling overrides reach the provisioning kwargs
    assert seen_kwargs == {"max_tokens": 1024, "temperature": 0.2}


def test_synthesize_merges_group_and_archives_synthesis():
    client = _client()
    from langchain_core.messages import AIMessage, HumanMessage

    group = "par_abc"
    state = type(
        "State",
        (),
        {
            "values": {
                "messages": [
                    HumanMessage(
                        content="q1",
                        additional_kwargs={"group_id": group},
                    ),
                    AIMessage(
                        content="answer A",
                        additional_kwargs={
                            "group_id": group,
                            "model_name": "m-a",
                            "run_role": "answer",
                        },
                    ),
                    AIMessage(
                        content="answer B",
                        additional_kwargs={
                            "group_id": group,
                            "agent_name": "Researcher",
                            "run_role": "answer",
                        },
                    ),
                    HumanMessage(content="unrelated"),
                ]
            }
        },
    )()

    class _FakeProv:
        model_name = "gpt-synth"

        class _Model:
            async def ainvoke(self, payload):
                return AIMessage(content="<think>z</think>merged answer")

        langchain_model = None

        def __init__(self):
            self.langchain_model = self._Model()

    update_calls = []

    def fake_update_state(config, values):
        update_calls.append(values)

    seen: dict = {}

    async def fake_provision(content, model_id, default_type, **kwargs):
        seen["prompt"] = content
        seen["kwargs"] = kwargs
        return _FakeProv()

    agent = _agent()
    with (
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new=AsyncMock(return_value=("chat_session:s1", _session())),
        ),
        patch(
            "api.routers.chat_parallel.chat_graph.get_state",
            return_value=state,
        ),
        patch(
            "api.routers.chat_parallel.resolve_agent_binding",
            new=AsyncMock(return_value=agent),
        ),
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            side_effect=fake_provision,
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
        patch(
            "api.routers.chat_parallel.chat_graph.update_state",
            side_effect=fake_update_state,
        ),
    ):
        response = client.post(
            "/api/chat/sessions/chat_session:s1/synthesize",
            json={
                "group_id": group,
                "instruction": "focus on trade-offs",
                "agent": "agent:agent:1",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["content"] == "merged answer"
    assert body["agent_name"] == "Researcher"

    # prompt contains question, both labeled answers and the user instruction
    prompt = seen["prompt"]
    assert "q1" in prompt
    assert "answer A" in prompt
    assert "answer B" in prompt
    assert "m-a" in prompt
    assert "Researcher" in prompt
    assert "focus on trade-offs" in prompt

    # archived as synthesis carrying the same group id
    assert len(update_calls) == 1
    archived = update_calls[0]["messages"][0]
    assert archived.additional_kwargs["run_role"] == "synthesis"
    assert archived.additional_kwargs["group_id"] == group
    # agent sampling params flow through
    assert seen["kwargs"] == {"max_tokens": 1024, "temperature": 0.2}


def test_synthesize_404_on_unknown_group():
    client = _client()
    state = type("State", (), {"values": {"messages": []}})()
    with (
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new=AsyncMock(return_value=("chat_session:s1", _session())),
        ),
        patch(
            "api.routers.chat_parallel.chat_graph.get_state",
            return_value=state,
        ),
    ):
        response = client.post(
            "/api/chat/sessions/chat_session:s1/synthesize",
            json={"group_id": "par_missing"},
        )
    assert response.status_code == 404
