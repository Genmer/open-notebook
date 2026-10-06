"""Regression tests: every message-write path stamps additional_kwargs
.created_at (UTC ISO) so the frontend time-grouping view can bucket history.

One test per write path (design §2.4's write points):
1. notebook execute (user) + graphs/chat node (AI)
2. notebook stream (user) + graphs/chat node (AI)
3. chat_parallel archive (user + AI answers via _answer_once/_orchestrate)
4. chat_parallel synthesis (AI)
5. source stream (user)

Real StateGraphs over temporary SqliteSaver files; every model is a fake or
a stub — no real LLM call anywhere.
"""

import asyncio
import json
import sqlite3
from contextlib import ExitStack
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from open_notebook.domain.notebook import ChatSession

SESSION = "chat_session:ts1"
SOURCE_SESSION = "chat_session:tss1"
GROUP_ID = "par_ts1"


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _session(session_id: str = SESSION) -> ChatSession:
    return ChatSession(
        id=session_id,
        title="Session",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )


def _make_graph(tmp_path, production_cls, production_node, node_name, filename):
    from langgraph.checkpoint.sqlite import SqliteSaver
    from langgraph.graph import END, START, StateGraph

    conn = sqlite3.connect(
        tmp_path / filename,
        check_same_thread=False,
    )
    builder = StateGraph(production_cls)
    builder.add_node(node_name, production_node)
    builder.add_edge(START, node_name)
    builder.add_edge(node_name, END)
    return builder.compile(checkpointer=SqliteSaver(conn))


def _make_graphs(tmp_path):
    from open_notebook.graphs.chat import ThreadState, call_model_with_messages
    from open_notebook.graphs.source_chat import (
        SourceChatState,
        call_model_with_source_context,
    )

    return (
        _make_graph(
            tmp_path, ThreadState, call_model_with_messages, "agent", "ts-nb.sqlite"
        ),
        _make_graph(
            tmp_path,
            SourceChatState,
            call_model_with_source_context,
            "source_chat_agent",
            "ts-src.sqlite",
        ),
    )


def _seed_messages(graph, thread_id, messages, extra=None):
    config = RunnableConfig(configurable={"thread_id": thread_id})
    values = {"messages": list(messages)}
    if extra:
        values.update(extra)
    graph.update_state(config, values)
    state = graph.get_state(config)
    return config, list(state.values["messages"])


def _get_messages(graph, thread_id):
    state = graph.get_state(RunnableConfig(configurable={"thread_id": thread_id}))
    return list(state.values.get("messages", [])) if state else []


def _fake_prov(reply: str = "generated reply"):
    from langchain_core.language_models import GenericFakeChatModel

    model = GenericFakeChatModel(messages=iter([AIMessage(reply)]))
    return SimpleNamespace(langchain_model=model, model_name="fake-model")


def _assert_iso(value: Any) -> None:
    assert isinstance(value, str) and value
    # raises on a non-ISO string
    datetime.fromisoformat(value)


# --- 1+2: notebook execute and stream paths -----------------------------------


def test_ts1_execute_path_stamps_user_and_ai_messages(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    session = _session()

    patches = [
        patch(
            "api.routers.chat.get_session_or_404",
            new=AsyncMock(return_value=(SESSION, session)),
        ),
        patch("api.routers.chat.repo_query", new=AsyncMock(return_value=[])),
        patch(
            "api.routers.chat.resolve_agent_binding",
            new=AsyncMock(return_value=None),
        ),
        patch("api.routers.chat.chat_graph", graph),
        patch(
            "open_notebook.graphs.chat.provision_langchain_model_with_info",
            new=AsyncMock(return_value=_fake_prov("executed reply")),
        ),
        patch("open_notebook.graphs.chat.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(
            "/api/chat/execute",
            json={"session_id": SESSION, "message": "hi", "context": {}},
        )

    assert response.status_code == 200
    final = _get_messages(graph, SESSION)
    assert [m.type for m in final] == ["human", "ai"]
    _assert_iso(final[0].additional_kwargs.get("created_at"))
    _assert_iso(final[1].additional_kwargs.get("created_at"))
    assert final[1].additional_kwargs["model_name"] == "fake-model"
    # the API response surfaces the timestamp through extract_chat_messages
    body = response.json()
    assert body["messages"][0]["timestamp"]
    assert body["messages"][1]["timestamp"]


def test_ts2_stream_path_stamps_user_and_ai_messages(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    session = _session()

    patches = [
        patch(
            "api.routers.chat_stream.get_session_or_404",
            new=AsyncMock(return_value=(SESSION, session)),
        ),
        patch("api.routers.chat_stream.repo_query", new=AsyncMock(return_value=[])),
        patch(
            "api.routers.chat_stream.resolve_agent_binding",
            new=AsyncMock(return_value=None),
        ),
        patch("api.routers.chat_stream.chat_graph", graph),
        patch(
            "open_notebook.graphs.chat.provision_langchain_model_with_info",
            new=AsyncMock(return_value=_fake_prov("streamed reply")),
        ),
        patch("open_notebook.graphs.chat.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        stream_resp = client.post(
            f"/api/chat/sessions/{SESSION}/stream",
            json={"message": "hi", "context": {}},
        )
        assert stream_resp.status_code == 200
        events = []
        for line in stream_resp.iter_lines():
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            if line.startswith("data: "):
                events.append(json.loads(line[len("data: ") :]))
        assert any(e["type"] == "complete" for e in events)

    final = _get_messages(graph, SESSION)
    assert [m.type for m in final] == ["human", "ai"]
    _assert_iso(final[0].additional_kwargs.get("created_at"))
    _assert_iso(final[1].additional_kwargs.get("created_at"))
    # the stream's complete event (extract_chat_messages) carries timestamps
    complete = next(e for e in events if e["type"] == "complete")
    assert complete["messages"][0]["timestamp"]
    assert complete["messages"][1]["timestamp"]


# --- 3: chat_parallel archive path ---------------------------------------------


@pytest.mark.asyncio
async def test_ts3_parallel_archive_stamps_user_and_answer_messages(tmp_path):
    from api.routers import chat_parallel

    graph, _ = _make_graphs(tmp_path)
    prov = MagicMock()
    prov.model_name = "fake-model"
    prov.langchain_model.ainvoke = AsyncMock(
        return_value=AIMessage(content="parallel answer")
    )

    patches = [
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=prov,
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch("api.routers.chat_parallel.chat_graph", graph),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]

    queue: asyncio.Queue = asyncio.Queue()
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        await chat_parallel._orchestrate(
            queue=queue,
            full_session_id=SESSION,
            session=_session(),
            notebook=None,
            context={},
            history=[],
            message="parallel question",
            participants=[
                {
                    "key": "default",
                    "kind": "default",
                    "model_id": None,
                    "agent": None,
                    "error": None,
                    "display_name": "default",
                }
            ],
            group_id=GROUP_ID,
        )
        # drain the queue to the None sentinel (orchestration always closes it)
        while True:
            event = await queue.get()
            if event is None:
                break

    final = _get_messages(graph, SESSION)
    assert [m.type for m in final] == ["human", "ai"]
    human, answer = final
    assert human.additional_kwargs["group_id"] == GROUP_ID
    _assert_iso(human.additional_kwargs.get("created_at"))
    assert answer.additional_kwargs["run_role"] == "answer"
    assert answer.additional_kwargs["group_id"] == GROUP_ID
    _assert_iso(answer.additional_kwargs.get("created_at"))


# --- 4: chat_parallel synthesis path -------------------------------------------


def test_ts4_synthesis_stamps_synthesis_message(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(
        graph,
        SESSION,
        [
            HumanMessage(
                content="parallel question",
                additional_kwargs={"group_id": GROUP_ID, "created_at": None},
            ),
            AIMessage(
                content="answer one",
                additional_kwargs={"group_id": GROUP_ID, "run_role": "answer"},
            ),
        ],
    )
    prov = MagicMock()
    prov.model_name = "fake-model"
    prov.langchain_model.ainvoke = AsyncMock(
        return_value=AIMessage(content="synthesized answer")
    )

    patches = [
        patch(
            "api.routers.chat_parallel.get_session_or_404",
            new=AsyncMock(return_value=(SESSION, _session())),
        ),
        patch("api.routers.chat_parallel.chat_graph", graph),
        patch(
            "api.routers.chat_parallel.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=prov,
        ),
        patch("api.routers.chat_parallel.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(
            f"/api/chat/sessions/{SESSION}/synthesize",
            json={"group_id": GROUP_ID},
        )

    assert response.status_code == 200
    final = _get_messages(graph, SESSION)
    synthesis = final[-1]
    assert synthesis.type == "ai"
    assert synthesis.additional_kwargs["run_role"] == "synthesis"
    assert synthesis.additional_kwargs["group_id"] == GROUP_ID
    _assert_iso(synthesis.additional_kwargs.get("created_at"))


# --- 5: source stream user message ----------------------------------------------


def _make_passthrough_source_graph(tmp_path):
    """SourceChatState graph whose node writes nothing: the checkpoint still
    receives the input messages, which is all this regression needs."""
    from langgraph.checkpoint.sqlite import SqliteSaver
    from langgraph.graph import END, START, StateGraph

    from open_notebook.graphs.source_chat import SourceChatState

    conn = sqlite3.connect(
        tmp_path / "ts-src-passthrough.sqlite",
        check_same_thread=False,
    )
    builder = StateGraph(SourceChatState)
    builder.add_node("source_chat_agent", lambda state, config: {})
    builder.add_edge(START, "source_chat_agent")
    builder.add_edge("source_chat_agent", END)
    return builder.compile(checkpointer=SqliteSaver(conn))


def test_ts5_source_stream_stamps_user_message(tmp_path):
    client = _client()
    graph = _make_passthrough_source_graph(tmp_path)
    source = SimpleNamespace(id="source:9", title="S")

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "api.routers.source_chat.get_verified_source_session",
                new=AsyncMock(
                    return_value=(
                        "source:9",
                        source,
                        SOURCE_SESSION,
                        _session(SOURCE_SESSION),
                    )
                ),
            )
        )
        stack.enter_context(patch("api.routers.source_chat.source_chat_graph", graph))
        with patch.object(ChatSession, "save", new=AsyncMock()):
            response = client.post(
                f"/api/sources/9/chat/sessions/{SOURCE_SESSION}/messages",
                json={"message": "hi source"},
            )

    assert response.status_code == 200
    final = _get_messages(graph, SOURCE_SESSION)
    assert [m.type for m in final] == ["human"]
    _assert_iso(final[0].additional_kwargs.get("created_at"))
