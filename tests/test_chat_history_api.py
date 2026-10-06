"""History-editing endpoints (PDR-005): hard-delete via RemoveMessage.

Covers POST /api/chat/sessions/{id}/messages/delete and .../messages/clear
plus the DELETE-session in-flight guards and checkpoint cleanup, using REAL
StateGraphs (production channel schemas) over temporary SqliteSaver files —
the same shape as tests/test_chat_stream_api.py.

Asserted behaviors:
- delete removes exactly the requested checkpoint messages; get_state replay
  afterwards no longer contains them and survivors keep content/ids.
- clear empties the whole history (REMOVE_ALL_MESSAGES sentinel).
- 409 from either router's in-flight set (manual injection), 400 empty body,
  404 atomicity (one bogus id deletes nothing), positional `msg_*` ids 404.
- ownership dispatch: source-bound sessions are written through
  source_chat_graph, so the source-only channels (context_indicators)
  survive the deletion.
- both session DELETE endpoints clean the sqlite checkpoint tables
  (checkpoints + writes → 0 rows), tolerate delete_thread failures with a
  logged warning and a 200, and 409 while a generation is in flight.
- source stream guard: 409 on a second concurrent send, and the guard holds
  across a client disconnect until the worker thread's invoke finishes
  (done_callback is the only release path).
"""

import asyncio
import json
import sqlite3
import threading
import time
from contextlib import ExitStack
from datetime import datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger

from open_notebook.domain.notebook import ChatSession

NOTEBOOK_SESSION = "chat_session:nb1"
SOURCE_SESSION = "chat_session:src1"


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _session(session_id: str = NOTEBOOK_SESSION) -> ChatSession:
    return ChatSession(
        id=session_id,
        title="Session",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )


def _make_graph(tmp_path, production_cls, production_node, node_name, filename):
    """Compile a real StateGraph with the production node and channel schema.

    The production nodes are never invoked here (history edits only touch
    get_state/update_state), but their state classes define the channels the
    dispatch test depends on.
    """
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

    notebook_graph = _make_graph(
        tmp_path,
        ThreadState,
        call_model_with_messages,
        "agent",
        "notebook-cp.sqlite",
    )
    source_graph = _make_graph(
        tmp_path,
        SourceChatState,
        call_model_with_source_context,
        "source_chat_agent",
        "source-cp.sqlite",
    )
    return notebook_graph, source_graph


def _seed_messages(graph, thread_id, messages, extra=None):
    """Seed a checkpoint directly via update_state (no LLM involved)."""
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


def _history_patches(graph, session):
    return [
        patch(
            "api.routers.chat_history.get_session_or_404",
            new=AsyncMock(return_value=(NOTEBOOK_SESSION, session)),
        ),
        # The dispatch helper resolves repo_query from _chat_shared's globals.
        patch(
            "api.routers._chat_shared.repo_query",
            new=AsyncMock(return_value=[{"out": "notebook:1"}]),
        ),
        patch("api.routers.chat_history.chat_graph", graph),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]


# --- delete: basic semantics --------------------------------------------------


def test_h1_delete_removes_selected_messages_and_replays(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, NOTEBOOK_SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    victim_id, survivor = seeded[0].id, seeded[1]
    session = _session()

    with ExitStack() as stack:
        for p in _history_patches(graph, session):
            stack.enter_context(p)
        # the patch above swapped the class attribute for an AsyncMock
        save_mock: Any = ChatSession.save  # type: ignore[attr-defined]
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
            json={"message_ids": [victim_id]},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == NOTEBOOK_SESSION
    assert body["deleted_count"] == 1

    # authoritative replace: the response carries the remaining full history
    assert [m["id"] for m in body["messages"]] == [survivor.id]
    assert body["messages"][0]["content"] == "a1"
    assert body["messages"][0]["type"] == "ai"

    # get_state replay: the victim is gone from the checkpoint, the survivor
    # is intact (id preserved → further deletes/references keep working)
    remaining = _get_messages(graph, NOTEBOOK_SESSION)
    assert [m.id for m in remaining] == [survivor.id]
    assert remaining[0].content == "a1"

    # the session row must NOT be re-saved (no updated bump → no list jump)
    assert save_mock.await_count == 0


def test_h2_clear_empties_whole_history(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(
        graph,
        NOTEBOOK_SESSION,
        [HumanMessage(content="q1"), AIMessage(content="a1"), AIMessage(content="a2")],
    )
    patches = _history_patches(graph, _session())

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/clear")

    assert response.status_code == 200
    body = response.json()
    assert body["deleted_count"] == 3
    assert body["messages"] == []
    assert _get_messages(graph, NOTEBOOK_SESSION) == []

    # replay after clear: get_state values carry an empty message list
    state = graph.get_state(
        RunnableConfig(configurable={"thread_id": NOTEBOOK_SESSION})
    )
    assert list(state.values.get("messages", [])) == []


def test_h3_delete_missing_id_is_atomic(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, NOTEBOOK_SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    patches = _history_patches(graph, _session())

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
            json={
                "message_ids": [seeded[0].id, "00000000-0000-0000-0000-000000000000"]
            },
        )

    assert response.status_code == 404
    assert "Message not found" in response.json()["detail"]
    # atomicity: neither message was removed
    assert [m.id for m in _get_messages(graph, NOTEBOOK_SESSION)] == [
        m.id for m in seeded
    ]


def test_h4_positional_and_empty_ids_rejected(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q1")])
    patches = _history_patches(graph, _session())

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        empty = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
            json={"message_ids": []},
        )
        positional = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
            json={"message_ids": ["msg_0"]},
        )

    assert empty.status_code == 400
    assert empty.json()["detail"] == "message_ids 不能为空"
    assert positional.status_code == 404
    assert len(_get_messages(graph, NOTEBOOK_SESSION)) == 1


def test_h5_delete_unknown_session_returns_404():
    client = _client()
    with patch(
        "api.routers.chat_history.get_session_or_404",
        new=AsyncMock(side_effect=HTTPException(404)),
    ):
        response = client.post(
            f"/api/chat/sessions/gone/messages/delete",
            json={"message_ids": ["x"]},
        )
    assert response.status_code == 404


# --- 409: merged in-flight guard across both routers --------------------------


def test_h6_delete_409_while_notebook_stream_inflight(tmp_path):
    from api.routers import chat_stream

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q1")])
    patches = _history_patches(graph, _session())

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        chat_stream._inflight.add(NOTEBOOK_SESSION)
        try:
            delete_resp = client.post(
                f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
                json={"message_ids": ["anything"]},
            )
            clear_resp = client.post(
                f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/clear"
            )
        finally:
            chat_stream._inflight.discard(NOTEBOOK_SESSION)

    assert delete_resp.status_code == 409
    assert clear_resp.status_code == 409
    assert "already in progress" in delete_resp.json()["detail"]
    # nothing was deleted while guarded
    assert len(_get_messages(graph, NOTEBOOK_SESSION)) == 1


def test_h7_delete_409_while_source_stream_inflight(tmp_path):
    from api.routers import source_chat

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q1")])
    patches = _history_patches(graph, _session())

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        # the guard is the merged set: an in-flight SOURCE generation blocks
        # notebook history edits for the same session id
        source_chat._inflight.add(NOTEBOOK_SESSION)
        try:
            delete_resp = client.post(
                f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
                json={"message_ids": ["anything"]},
            )
        finally:
            source_chat._inflight.discard(NOTEBOOK_SESSION)

    assert delete_resp.status_code == 409


# --- ownership dispatch -------------------------------------------------------


def test_h8_source_session_dispatch_preserves_channels(tmp_path):
    """A source-bound session is edited through source_chat_graph: the
    source-only channels (context_indicators) survive the deletion instead of
    being blanked by a cross-graph update_state."""
    client = _client()
    notebook_graph, source_graph = _make_graphs(tmp_path)
    indicators = {"sources": ["source:9"], "insights": ["insight:1"], "notes": []}
    _, seeded = _seed_messages(
        source_graph,
        SOURCE_SESSION,
        [HumanMessage(content="q1"), AIMessage(content="a1")],
        extra={"context_indicators": indicators, "source_id": "source:9"},
    )
    victim_id, survivor = seeded[0].id, seeded[1]

    session = _session(SOURCE_SESSION)
    patches = [
        patch(
            "api.routers.chat_history.get_session_or_404",
            new=AsyncMock(return_value=(SOURCE_SESSION, session)),
        ),
        patch(
            "api.routers._chat_shared.repo_query",
            new=AsyncMock(return_value=[{"out": "source:9"}]),
        ),
        patch("api.routers.chat_history.source_chat_graph", source_graph),
        patch("api.routers.chat_history.chat_graph", notebook_graph),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(
            f"/api/chat/sessions/{SOURCE_SESSION}/messages/delete",
            json={"message_ids": [victim_id]},
        )

    assert response.status_code == 200
    assert [m["id"] for m in response.json()["messages"]] == [survivor.id]

    # the write landed on the source graph and its channels are intact
    remaining = _get_messages(source_graph, SOURCE_SESSION)
    assert [m.id for m in remaining] == [survivor.id]
    state = source_graph.get_state(
        RunnableConfig(configurable={"thread_id": SOURCE_SESSION})
    )
    assert state.values["context_indicators"] == indicators

    # the notebook graph was never touched for this thread
    assert _get_messages(notebook_graph, SOURCE_SESSION) == []


# --- session DELETE: checkpoint cleanup + guards ------------------------------


def _delete_session_patches(graph, session):
    return [
        patch(
            "api.routers.chat.get_session_or_404",
            new=AsyncMock(return_value=(NOTEBOOK_SESSION, session)),
        ),
        patch("api.routers.chat.chat_graph", graph),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]


def _checkpoint_row_counts(graph, thread_id):
    conn = graph.checkpointer.conn
    return tuple(
        conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE thread_id = ?", (thread_id,)
        ).fetchone()[0]
        for table in ("checkpoints", "writes")
    )


def test_h9_notebook_delete_cleans_checkpoint_tables(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q1")])
    session = _session()
    assert _checkpoint_row_counts(graph, NOTEBOOK_SESSION) != (0, 0)

    with ExitStack() as stack:
        for p in _delete_session_patches(graph, session):
            stack.enter_context(p)
        with patch.object(ChatSession, "delete", new=AsyncMock()) as delete_mock:
            response = client.delete(f"/api/chat/sessions/{NOTEBOOK_SESSION}")

    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "message": "Session deleted successfully",
    }
    delete_mock.assert_awaited_once()
    assert _checkpoint_row_counts(graph, NOTEBOOK_SESSION) == (0, 0)
    assert (
        graph.checkpointer.get_tuple(
            RunnableConfig(configurable={"thread_id": NOTEBOOK_SESSION})
        )
        is None
    )


def test_h10_notebook_delete_tolerates_checkpoint_failure(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q1")])
    session = _session()

    warnings: list[str] = []
    sink_id = logger.add(warnings.append, level="WARNING")

    with ExitStack() as stack:
        for p in _delete_session_patches(graph, session):
            stack.enter_context(p)
        with (
            patch.object(ChatSession, "delete", new=AsyncMock()),
            patch.object(
                type(graph.checkpointer),
                "delete_thread",
                side_effect=RuntimeError("sqlite locked"),
            ),
        ):
            response = client.delete(f"/api/chat/sessions/{NOTEBOOK_SESSION}")

    logger.remove(sink_id)

    # main operation already succeeded: the endpoint must still return 200
    assert response.status_code == 200
    assert any("checkpoint" in w for w in warnings)


def test_h11_notebook_delete_409_while_generation_inflight(tmp_path):
    from api.routers import source_chat

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    session = _session()

    with ExitStack() as stack:
        for p in _delete_session_patches(graph, session):
            stack.enter_context(p)
        with patch.object(ChatSession, "delete", new=AsyncMock()) as delete_mock:
            source_chat._inflight.add(NOTEBOOK_SESSION)
            try:
                response = client.delete(f"/api/chat/sessions/{NOTEBOOK_SESSION}")
            finally:
                source_chat._inflight.discard(NOTEBOOK_SESSION)

    assert response.status_code == 409
    delete_mock.assert_not_awaited()


def test_h12_source_delete_cleans_checkpoint_tables(tmp_path):
    client = _client()
    _, source_graph = _make_graphs(tmp_path)
    _seed_messages(source_graph, SOURCE_SESSION, [HumanMessage(content="q1")])
    session = _session(SOURCE_SESSION)
    assert _checkpoint_row_counts(source_graph, SOURCE_SESSION) != (0, 0)

    source = SimpleNamespace(id="source:9", title="S")
    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "api.routers.source_chat.get_verified_source_session",
                new=AsyncMock(
                    return_value=("source:9", source, SOURCE_SESSION, session)
                ),
            )
        )
        stack.enter_context(patch("api.routers.source_chat.chat_graph", source_graph))
        with patch.object(ChatSession, "delete", new=AsyncMock()) as delete_mock:
            response = client.delete(f"/api/sources/9/chat/sessions/{SOURCE_SESSION}")

    assert response.status_code == 200
    assert response.json()["message"] == "Source chat session deleted successfully"
    delete_mock.assert_awaited_once()
    assert _checkpoint_row_counts(source_graph, SOURCE_SESSION) == (0, 0)


def test_h13_source_delete_tolerates_checkpoint_failure(tmp_path):
    client = _client()
    _, source_graph = _make_graphs(tmp_path)
    _seed_messages(source_graph, SOURCE_SESSION, [HumanMessage(content="q1")])
    session = _session(SOURCE_SESSION)
    source = SimpleNamespace(id="source:9", title="S")

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "api.routers.source_chat.get_verified_source_session",
                new=AsyncMock(
                    return_value=("source:9", source, SOURCE_SESSION, session)
                ),
            )
        )
        stack.enter_context(patch("api.routers.source_chat.chat_graph", source_graph))
        with (
            patch.object(ChatSession, "delete", new=AsyncMock()),
            patch.object(
                type(source_graph.checkpointer),
                "delete_thread",
                side_effect=RuntimeError("boom"),
            ),
        ):
            response = client.delete(f"/api/sources/9/chat/sessions/{SOURCE_SESSION}")

    assert response.status_code == 200


# --- source stream in-flight guard --------------------------------------------


class _StubSourceGraph:
    """Graph stand-in with controllable invoke timing (threading events)."""

    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()

    def get_state(self, config):
        return SimpleNamespace(values={})

    def invoke(self, input, config):  # noqa: A002 - matches langgraph API
        self.started.set()
        self.release.wait(timeout=10)
        return {"messages": [AIMessage(content="done")]}


def _wait_for(predicate, timeout=5.0):
    deadline = time.time() + timeout
    while not predicate() and time.time() < deadline:
        time.sleep(0.01)
    return predicate()


def test_h14_source_stream_409_when_already_generating():
    from api.routers import source_chat

    client = _client()
    stub = _StubSourceGraph()
    session = _session(SOURCE_SESSION)
    source = SimpleNamespace(id="source:9", title="S")

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "api.routers.source_chat.get_verified_source_session",
                new=AsyncMock(
                    return_value=("source:9", source, SOURCE_SESSION, session)
                ),
            )
        )
        stack.enter_context(patch("api.routers.source_chat.source_chat_graph", stub))
        with patch.object(ChatSession, "save", new=AsyncMock()):
            source_chat._inflight.add(SOURCE_SESSION)
            try:
                response = client.post(
                    f"/api/sources/9/chat/sessions/{SOURCE_SESSION}/messages",
                    json={"message": "second"},
                )
            finally:
                source_chat._inflight.discard(SOURCE_SESSION)

    assert response.status_code == 409
    assert "already in progress" in response.json()["detail"]


def test_h15_source_stream_completes_and_releases_guard():
    from api.routers import source_chat

    client = _client()
    stub = _StubSourceGraph()
    stub.release.set()  # let invoke finish immediately
    session = _session(SOURCE_SESSION)
    source = SimpleNamespace(id="source:9", title="S")

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                "api.routers.source_chat.get_verified_source_session",
                new=AsyncMock(
                    return_value=("source:9", source, SOURCE_SESSION, session)
                ),
            )
        )
        stack.enter_context(patch("api.routers.source_chat.source_chat_graph", stub))
        with patch.object(ChatSession, "save", new=AsyncMock()):
            response = client.post(
                f"/api/sources/9/chat/sessions/{SOURCE_SESSION}/messages",
                json={"message": "hi"},
            )

    assert response.status_code == 200
    events = []
    for line in response.iter_lines():
        if isinstance(line, bytes):
            line = line.decode("utf-8")
        if line.startswith("data: "):
            events.append(json.loads(line[len("data: ") :]))
    assert [e["type"] for e in events] == ["user_message", "ai_message", "complete"]

    # the done_callback — not the generator finally — releases the guard
    assert _wait_for(lambda: SOURCE_SESSION not in source_chat._inflight)
    assert source_chat.inflight_session_ids() == set()


@pytest.mark.asyncio
async def test_h16_source_stream_guard_holds_across_client_disconnect():
    """Client disconnect (CancelledError into the SSE generator) must NOT
    release the in-flight guard while the worker thread is still invoking —
    the done_callback is the only release path."""
    from api.routers import source_chat

    stub = _StubSourceGraph()
    with patch("api.routers.source_chat.source_chat_graph", stub):
        source_chat._inflight.add(SOURCE_SESSION)
        try:
            generator = source_chat.stream_source_chat_response(
                session_id=SOURCE_SESSION,
                source_id="source:9",
                message="hi",
            )
            consumed: list[str] = []

            async def drain():
                async for chunk in generator:
                    consumed.append(chunk)

            task = asyncio.create_task(drain())
            # wait until the worker thread is inside invoke
            for _ in range(500):
                if stub.started.is_set():
                    break
                await asyncio.sleep(0.01)
            assert stub.started.is_set()
            assert any("user_message" in c for c in consumed)

            # simulate the client disconnect: the response scope is cancelled
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

            # give any (wrongly) scheduled discard callbacks a chance to run
            # before asserting — a correct implementation stays guarded while
            # the worker thread is still inside invoke
            for _ in range(5):
                await asyncio.sleep(0)
            # the thread is still generating: the guard MUST hold
            assert SOURCE_SESSION in source_chat._inflight

            # only the invoke's completion releases it — poll asynchronously
            # so the event loop stays free to run the done_callback
            stub.release.set()
            for _ in range(500):
                if SOURCE_SESSION not in source_chat._inflight:
                    break
                await asyncio.sleep(0.01)
            assert SOURCE_SESSION not in source_chat._inflight
        finally:
            stub.release.set()
            source_chat._inflight.discard(SOURCE_SESSION)


def test_h17_pre_task_failure_releases_guard():
    """A failure before the invoke task exists (fallback finally) must not
    leak the in-flight entry."""
    from api.routers import source_chat

    class _BrokenGraph:
        def get_state(self, config):
            raise RuntimeError("db down")

    async def run():
        generator = source_chat.stream_source_chat_response(
            session_id="chat_session:leak",
            source_id="source:9",
            message="hi",
        )
        source_chat._inflight.add("chat_session:leak")
        chunks = [chunk async for chunk in generator]
        return chunks

    with patch("api.routers.source_chat.source_chat_graph", _BrokenGraph()):
        chunks = asyncio.run(run())

    assert any('"type": "error"' in c for c in chunks)
    assert "chat_session:leak" not in source_chat._inflight


# --- merged in-flight helper ---------------------------------------------------


def test_h18_merged_inflight_helper_unions_both_routers():
    from api.routers import _chat_shared, chat_stream, source_chat

    chat_stream._inflight.add("chat_session:a")
    source_chat._inflight.add("chat_session:b")
    try:
        merged = _chat_shared.get_merged_inflight_session_ids()
        assert {"chat_session:a", "chat_session:b"} <= merged
        assert _chat_shared.session_in_generation("chat_session:a")
        assert _chat_shared.session_in_generation("chat_session:b")
        assert not _chat_shared.session_in_generation("chat_session:c")
    finally:
        chat_stream._inflight.discard("chat_session:a")
        source_chat._inflight.discard("chat_session:b")


def test_h19_owner_kind_dispatch_rules():
    from api.routers import _chat_shared

    full_id = "chat_session:abc"

    with patch(
        "api.routers._chat_shared.repo_query",
        new=AsyncMock(return_value=[{"out": "source:9"}]),
    ):
        assert asyncio.run(_chat_shared.resolve_session_owner_kind(full_id)) == "source"

    with patch(
        "api.routers._chat_shared.repo_query",
        new=AsyncMock(return_value=[{"out": "notebook:1"}]),
    ):
        assert (
            asyncio.run(_chat_shared.resolve_session_owner_kind(full_id)) == "notebook"
        )

    # orphan (no edge) defaults to the notebook graph with a warning
    with patch(
        "api.routers._chat_shared.repo_query",
        new=AsyncMock(return_value=[]),
    ):
        assert (
            asyncio.run(_chat_shared.resolve_session_owner_kind(full_id)) == "notebook"
        )


# --- notebook stream regression: guard shared with history edits ---------------


def test_h20_real_stream_arms_merged_guard_and_cleans_up(tmp_path):
    """A real notebook stream generation (fake model, real graph) runs through
    the same `_inflight` set the merged history guard reads: edits issued with
    the set armed 409 (covered deterministically here via injection, per the
    design's test strategy), and after the stream the done_callback leaves no
    stale entry, so history edits proceed past the guard."""
    from langchain_core.language_models import GenericFakeChatModel

    from api.routers import chat_stream

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="seeded")])
    model = GenericFakeChatModel(messages=iter([AIMessage("gen reply")]))
    prov = SimpleNamespace(langchain_model=model, model_name="fake-model")
    session = _session()

    patches = [
        patch(
            "api.routers.chat_stream.get_session_or_404",
            new=AsyncMock(return_value=(NOTEBOOK_SESSION, session)),
        ),
        patch("api.routers.chat_stream.repo_query", new=AsyncMock(return_value=[])),
        patch(
            "api.routers.chat_stream.resolve_agent_binding",
            new=AsyncMock(return_value=None),
        ),
        patch("api.routers.chat_stream.chat_graph", graph),
        patch(
            "open_notebook.graphs.chat.provision_langchain_model_with_info",
            new=AsyncMock(return_value=prov),
        ),
        patch("open_notebook.graphs.chat.record_llm_usage_sync"),
        patch.object(ChatSession, "save", new=AsyncMock()),
        patch(
            "api.routers.chat_history.get_session_or_404",
            new=AsyncMock(return_value=(NOTEBOOK_SESSION, session)),
        ),
        patch(
            "api.routers._chat_shared.repo_query",
            new=AsyncMock(return_value=[{"out": "notebook:1"}]),
        ),
        patch("api.routers.chat_history.chat_graph", graph),
    ]

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        stream_resp = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/stream",
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

    # no stale guard entry after the stream (done_callback cleanup)
    deadline = time.time() + 2.0
    while NOTEBOOK_SESSION in chat_stream._inflight and time.time() < deadline:
        time.sleep(0.01)
    assert NOTEBOOK_SESSION not in chat_stream._inflight

    # edits proceed past the (now empty) guard: a bogus id surfaces as the
    # normal 404, not the generation-conflict 409
    seeded = _get_messages(graph, NOTEBOOK_SESSION)
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/delete",
            json={"message_ids": ["00000000-0000-0000-0000-000000000000"]},
        )
        assert response.status_code == 404
        assert "already in progress" not in response.json()["detail"]
        assert len(_get_messages(graph, NOTEBOOK_SESSION)) == len(seeded)


# --- compression submit endpoint -----------------------------------------------
#
# The compress endpoint never touches a graph or an LLM itself: it validates,
# rejects concurrent jobs and submits the async command. DB/worker seams are
# stubbed; the command's own behavior is covered in test_compress_command.py.


def _compress_endpoint_patches(session):
    return [
        patch(
            "api.routers.chat_history.get_session_or_404",
            new=AsyncMock(return_value=(NOTEBOOK_SESSION, session)),
        ),
        # the concurrent-job guard reads the command table through the
        # router module's repo_query
        patch(
            "api.routers.chat_history.repo_query",
            new=AsyncMock(return_value=[]),
        ),
        patch(
            "api.routers.chat_history.CommandService.submit_command_job",
            new_callable=AsyncMock,
            return_value="job:compress1",
        ),
        patch.object(ChatSession, "save", new=AsyncMock()),
    ]


def test_h21_compress_submit_returns_job_id():
    from api.routers import chat_history as chat_history_router

    client = _client()
    ids = [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
    ]

    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        submit_mock: Any = chat_history_router.CommandService.submit_command_job
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": ids},
        )

    assert response.status_code == 200
    assert response.json() == {
        "job_id": "job:compress1",
        "session_id": NOTEBOOK_SESSION,
        "status": "submitted",
    }
    submit_mock.assert_awaited_once_with(
        "open_notebook",
        "compress_chat_history",
        {"session_id": NOTEBOOK_SESSION, "message_ids": ids},
    )
    # duplicate ids collapse to one entry and still pass the >=2 gate
    ids_with_dup = [ids[0], ids[0], ids[1]]
    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        submit_mock = chat_history_router.CommandService.submit_command_job
        dedup = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": ids_with_dup},
        )
    assert dedup.status_code == 200
    submit_mock.assert_awaited_once_with(
        "open_notebook",
        "compress_chat_history",
        {"session_id": NOTEBOOK_SESSION, "message_ids": ids},
    )


def test_h22_compress_submit_validates_ids():
    client = _client()

    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        one = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": ["only-one"]},
        )
        too_many = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": [f"id-{i}" for i in range(501)]},
        )

    assert one.status_code == 400
    assert "至少需要 2 条" in one.json()["detail"]
    assert too_many.status_code == 400
    assert "不能超过 500 条" in too_many.json()["detail"]


def test_h23_compress_submit_409_while_stream_inflight():
    from api.routers import chat_stream

    client = _client()

    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        chat_stream._inflight.add(NOTEBOOK_SESSION)
        try:
            response = client.post(
                f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
                json={"message_ids": ["a", "b"]},
            )
        finally:
            chat_stream._inflight.discard(NOTEBOOK_SESSION)

    assert response.status_code == 409
    assert "already in progress" in response.json()["detail"]


def test_h24_compress_submit_409_on_concurrent_job():
    from api.routers import chat_history as chat_history_router

    client = _client()

    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        submit_mock: Any = chat_history_router.CommandService.submit_command_job
        repo_mock: Any = chat_history_router.repo_query  # type: ignore[attr-defined]
        repo_mock.return_value = [{"args": {"session_id": NOTEBOOK_SESSION}}]
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": ["a", "b"]},
        )

    assert response.status_code == 409
    assert "already queued or running" in response.json()["detail"]
    submit_mock.assert_not_awaited()

    # a job for a DIFFERENT session must not block this submission
    with ExitStack() as stack:
        for p in _compress_endpoint_patches(_session()):
            stack.enter_context(p)
        submit_mock = chat_history_router.CommandService.submit_command_job
        repo_mock = chat_history_router.repo_query  # type: ignore[attr-defined]
        repo_mock.return_value = [{"args": {"session_id": "chat_session:other"}}]
        other = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/compress",
            json={"message_ids": ["a", "b"]},
        )
    assert other.status_code == 200
    submit_mock.assert_awaited_once()


def test_h25_compress_submit_unknown_session_404():
    client = _client()
    with patch(
        "api.routers.chat_history.get_session_or_404",
        new=AsyncMock(side_effect=HTTPException(404)),
    ):
        response = client.post(
            f"/api/chat/sessions/gone/messages/compress",
            json={"message_ids": ["a", "b"]},
        )
    assert response.status_code == 404


# --- topic classification endpoint ----------------------------------------------
#
# The LLM is always a stub returning canned JSON: no real provider call.


def _classify_stubs(plan_content: str):
    """Fake provisioned model whose ainvoke returns `plan_content`."""
    prov = SimpleNamespace(
        model_name="fake-model",
        langchain_model=SimpleNamespace(
            ainvoke=AsyncMock(return_value=SimpleNamespace(content=plan_content))
        ),
    )
    return [
        patch(
            "api.routers.chat_history.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=prov,
        ),
        patch("api.routers.chat_history.record_llm_usage", new_callable=AsyncMock),
    ]


def test_h26_classify_groups_messages_and_cleans_plan(tmp_path):
    from api.routers import chat_history as chat_history_router

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph,
        NOTEBOOK_SESSION,
        [
            HumanMessage(content="question about retrieval"),
            AIMessage(content="answer about retrieval"),
            HumanMessage(content="how to import data?"),
            AIMessage(content="import via csv"),
        ],
    )
    plan = {
        "groups": [
            {
                "name": "Retrieval",
                "message_ids": [seeded[0].id, seeded[1].id],
            },
            {
                # duplicates seeded[1] (first group wins) and adds an unknown id
                "name": "Import",
                "message_ids": [seeded[1].id, seeded[3].id, "unknown-id"],
            },
            {"name": "   ", "message_ids": [seeded[0].id]},  # blank name dropped
            {"name": "Empty", "message_ids": []},  # empty group dropped
        ]
    }

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        for p in _classify_stubs(json.dumps(plan)):
            stack.enter_context(p)
        usage_mock: Any = chat_history_router.record_llm_usage  # type: ignore[attr-defined]
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["session_id"] == NOTEBOOK_SESSION
    assert body["truncated"] is False
    assert body["total_messages"] == 4
    assert body["classified_messages"] == 3
    assert body["groups"] == [
        {"name": "Retrieval", "message_ids": [seeded[0].id, seeded[1].id]},
        {"name": "Import", "message_ids": [seeded[3].id]},
    ]
    # one successful LLM call, usage recorded on the success arm
    usage_mock.assert_awaited_once()
    assert usage_mock.await_args.kwargs["call_type"] == "chat_classification"

    # read-only: the checkpoint was not modified
    assert [m.id for m in _get_messages(graph, NOTEBOOK_SESSION)] == [
        m.id for m in seeded
    ]


def test_h27_classify_truncates_to_first_100(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph,
        NOTEBOOK_SESSION,
        [HumanMessage(content=f"m{i}") for i in range(105)],
    )
    plan = {
        "groups": [
            {"name": "All", "message_ids": [m.id for m in seeded[:100]]},
        ]
    }

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        for p in _classify_stubs(json.dumps(plan)):
            stack.enter_context(p)
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["truncated"] is True
    assert body["total_messages"] == 105
    assert body["classified_messages"] == 100


def test_h28_classify_retries_once_with_parser_feedback(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, NOTEBOOK_SESSION, [HumanMessage(content="q"), AIMessage(content="a")]
    )
    plan = {"groups": [{"name": "G", "message_ids": [seeded[0].id]}]}
    prompts: list[str] = []

    async def fake_ainvoke(messages):
        prompts.append(messages[0].content)
        if len(prompts) == 1:
            return SimpleNamespace(content="this is not JSON at all")
        return SimpleNamespace(content=json.dumps(plan))

    prov = SimpleNamespace(
        model_name="fake-model",
        langchain_model=SimpleNamespace(ainvoke=fake_ainvoke),
    )

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        stack.enter_context(
            patch(
                "api.routers.chat_history.provision_langchain_model_with_info",
                new_callable=AsyncMock,
                return_value=prov,
            )
        )
        stack.enter_context(
            patch("api.routers.chat_history.record_llm_usage", new_callable=AsyncMock)
        )
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
        )

    assert response.status_code == 200
    assert response.json()["groups"] == [{"name": "G", "message_ids": [seeded[0].id]}]
    assert len(prompts) == 2
    # the second attempt carries the parser feedback block
    assert "previous attempt produced invalid output" in prompts[1]
    assert "previous attempt produced invalid output" not in prompts[0]


def test_h29_classify_unparseable_after_retry_returns_500(tmp_path):
    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q")])
    prov = SimpleNamespace(
        model_name="fake-model",
        langchain_model=SimpleNamespace(
            ainvoke=AsyncMock(return_value=SimpleNamespace(content="still not JSON"))
        ),
    )

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        stack.enter_context(
            patch(
                "api.routers.chat_history.provision_langchain_model_with_info",
                new_callable=AsyncMock,
                return_value=prov,
            )
        )
        stack.enter_context(
            patch("api.routers.chat_history.record_llm_usage", new_callable=AsyncMock)
        )
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
        )

    assert response.status_code == 500
    assert "classifying chat messages" in response.json()["detail"]


def test_h30_classify_409_while_stream_inflight(tmp_path):
    from api.routers import chat_stream

    client = _client()
    graph, _ = _make_graphs(tmp_path)
    _seed_messages(graph, NOTEBOOK_SESSION, [HumanMessage(content="q")])

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        chat_stream._inflight.add(NOTEBOOK_SESSION)
        try:
            response = client.post(
                f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
            )
        finally:
            chat_stream._inflight.discard(NOTEBOOK_SESSION)

    assert response.status_code == 409


def test_h31_classify_empty_history_skips_llm(tmp_path):
    from api.routers import chat_history as chat_history_router

    client = _client()
    graph, _ = _make_graphs(tmp_path)  # nothing seeded

    with ExitStack() as stack:
        for p in _history_patches(graph, _session()):
            stack.enter_context(p)
        for p in _classify_stubs(json.dumps({"groups": []})):
            stack.enter_context(p)
        provision_mock: Any = (
            chat_history_router.provision_langchain_model_with_info  # type: ignore[attr-defined]
        )
        response = client.post(
            f"/api/chat/sessions/{NOTEBOOK_SESSION}/messages/classify"
        )

    assert response.status_code == 200
    body = response.json()
    assert body["groups"] == []
    assert body["truncated"] is False
    assert body["total_messages"] == 0
    assert body["classified_messages"] == 0
    # no history -> no LLM spend
    provision_mock.assert_not_awaited()


def test_h32_classify_unknown_session_404():
    client = _client()
    with patch(
        "api.routers.chat_history.get_session_or_404",
        new=AsyncMock(side_effect=HTTPException(404)),
    ):
        response = client.post(f"/api/chat/sessions/gone/messages/classify")
    assert response.status_code == 404
