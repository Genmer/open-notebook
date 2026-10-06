"""Notebook chat token streaming (Route B, graph-native).

Covers the /api/chat/sessions/{id}/stream endpoint: token-level delta
sequence, checkpoint landing (== complete event), session.save ordering,
error path (orphan human message stays), the in-flight 409 guard, input
validation, raw <think> passthrough on deltas, and the streaming gate
regression pin (B8) that locks the esperanto/langchain-core predicate the
node-level flip depends on.
"""

import json
import sqlite3
import time
from contextlib import ExitStack
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langchain_core.runnables import RunnableConfig

from open_notebook.domain.notebook import ChatSession
from open_notebook.utils.text_utils import extract_text_content

FULL_SESSION_ID = "chat_session:s1"


def _client() -> TestClient:
    from api.main import app

    return TestClient(app)


def _session() -> ChatSession:
    return ChatSession(
        id=FULL_SESSION_ID,
        title="Session",
        created=datetime(2026, 1, 1, 12, 0, 0),
        updated=datetime(2026, 1, 1, 12, 0, 0),
    )


def _make_graph(tmp_path):
    """Compile a real StateGraph(ThreadState) with the production node.

    The node MUST be registered under the name "agent" (as in
    open_notebook/graphs/chat.py) — the endpoint's delta filter matches on
    metadata langgraph_node == "agent".
    """
    from langgraph.checkpoint.sqlite import SqliteSaver
    from langgraph.graph import END, START, StateGraph

    from open_notebook.graphs.chat import ThreadState, call_model_with_messages

    conn = sqlite3.connect(
        tmp_path / "checkpoint.sqlite",
        check_same_thread=False,
    )
    builder = StateGraph(ThreadState)
    builder.add_node("agent", call_model_with_messages)
    builder.add_edge(START, "agent")
    builder.add_edge("agent", END)
    return builder.compile(checkpointer=SqliteSaver(conn))


def _fake_model(text: str):
    """Fake model reproducing the production esperanto shape: an explicit
    streaming=False carried in model_fields_set, which langchain-core treats
    as a hard opt-out. Token streaming therefore only lights up through the
    node-level config flip (§1.9) — the decisive production dimension."""
    return GenericFakeChatModel(messages=iter([AIMessage(text)])).model_copy(
        update={"streaming": False}
    )


def _wire(graph, model, session=None):
    """Patch everything the endpoint and the real node touch.

    Note: chat_graph.get_state is deliberately NOT patched — the endpoint
    seeds history from it AND the orchestration reads the final messages
    back through it; both must hit the real test-graph checkpoint (fresh
    sqlite file per test), which is what makes the complete event assertable.
    """
    session = session or _session()
    prov = SimpleNamespace(
        langchain_model=model, model_name="fake-stream-model"
    )
    patches = [
        patch(
            "api.routers.chat_stream.get_session_or_404",
            new=AsyncMock(return_value=(FULL_SESSION_ID, session)),
        ),
        patch(
            "api.routers.chat_stream.repo_query",
            new=AsyncMock(return_value=[]),
        ),
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


def _wait_for_cleanup(module, full_id: str, timeout: float = 2.0) -> None:
    """The done-callback discard is scheduled on the event loop; give the
    TestClient portal thread a moment to run it."""
    deadline = time.time() + timeout
    while full_id in module._inflight and time.time() < deadline:
        time.sleep(0.01)


def _post_stream(client, message="hello", context=None):
    return client.post(
        f"/api/chat/sessions/{FULL_SESSION_ID}/stream",
        json={"message": message, "context": context or {}},
    )


def test_b1_streams_token_deltas_and_completes(tmp_path):
    client = _client()
    graph = _make_graph(tmp_path)
    model = _fake_model("Hello streamed world")
    session, patches = _wire(graph, model)

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = _post_stream(client, message="hi")

    assert response.status_code == 200
    events = _sse_events(response)

    deltas = [e["content"] for e in events if e["type"] == "delta"]
    assert len(deltas) >= 2, f"expected token-level deltas, got {deltas}"
    assert "".join(deltas) == "Hello streamed world"

    completes = [e for e in events if e["type"] == "complete"]
    assert len(completes) == 1
    messages = completes[0]["messages"]
    assert messages[-1]["type"] == "ai"
    assert messages[-1]["content"] == "Hello streamed world"
    assert messages[-1]["model_name"] == "fake-stream-model"
    assert messages[0]["type"] == "human"
    assert messages[0]["content"] == "hi"
    assert not any(e["type"] == "error" for e in events)


def test_b1a_empty_model_output_yields_error_event(tmp_path):
    """Empty model output: the invoke->stream conversion raises "No
    generations found in stream" before any chunk is emitted, so the endpoint
    surfaces it as an error event (never a hollow complete) while the user
    message stays checkpointed. Known behavioral difference from the sync
    /chat/execute path, which returns an empty AIMessage — rare in practice
    (only genuinely empty model completions), and the frontend reconciles
    with the checkpoint on stream errors either way."""
    client = _client()
    graph = _make_graph(tmp_path)
    session, patches = _wire(graph, _fake_model(""))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = _post_stream(client, message="hi")

    assert response.status_code == 200
    events = _sse_events(response)

    assert not any(e["type"] == "delta" for e in events)
    assert not any(e["type"] == "complete" for e in events)
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert "No generations found" in errors[0]["message"]

    state = graph.get_state(
        RunnableConfig(configurable={"thread_id": FULL_SESSION_ID})
    )
    checkpoint_messages = list(state.values.get("messages", []))
    assert len(checkpoint_messages) == 1
    assert checkpoint_messages[0].type == "human"


def test_b2_checkpoint_matches_complete_event(tmp_path):
    client = _client()
    graph = _make_graph(tmp_path)
    session, patches = _wire(graph, _fake_model("Hello streamed world"))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = _post_stream(client, message="hi")

    assert response.status_code == 200
    complete = next(e for e in _sse_events(response) if e["type"] == "complete")

    state = graph.get_state(
        RunnableConfig(configurable={"thread_id": FULL_SESSION_ID})
    )
    checkpoint_messages = list(state.values.get("messages", []))
    assert len(checkpoint_messages) == 2
    assert checkpoint_messages[0].type == "human"
    assert checkpoint_messages[1].type == "ai"
    assert checkpoint_messages[1].content == "Hello streamed world"
    # same content as the authoritative complete payload
    assert [m["content"] for m in complete["messages"]] == [
        "hi",
        "Hello streamed world",
    ]


def test_b3_session_saved_once_after_stream(tmp_path):
    client = _client()
    graph = _make_graph(tmp_path)
    session, patches = _wire(graph, _fake_model("Hello streamed world"))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = _post_stream(client, message="hi")
        # grab the mock before the ExitStack restores the real method
        save_mock = type(session).save

    assert response.status_code == 200
    assert save_mock.await_count == 1


def test_b4_error_event_and_orphan_human_message(tmp_path):
    from open_notebook.exceptions import OpenNotebookError

    client = _client()
    graph = _make_graph(tmp_path)
    session, patches = _wire(graph, _fake_model("unused"))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        # swap provision to fail (node re-raises OpenNotebookError)
        stack.enter_context(
            patch(
                "open_notebook.graphs.chat.provision_langchain_model_with_info",
                new=AsyncMock(side_effect=OpenNotebookError("provisioning failed")),
            )
        )
        response = _post_stream(client, message="doomed")

    assert response.status_code == 200
    events = _sse_events(response)
    errors = [e for e in events if e["type"] == "error"]
    assert len(errors) == 1
    assert not any(e["type"] == "complete" for e in events)
    assert not any(e["type"] == "delta" for e in events)

    # documented orphan behavior: input application already wrote the human
    # message into the checkpoint before the node failed
    state = graph.get_state(
        RunnableConfig(configurable={"thread_id": FULL_SESSION_ID})
    )
    checkpoint_messages = list(state.values.get("messages", []))
    assert len(checkpoint_messages) == 1
    assert checkpoint_messages[0].type == "human"
    assert checkpoint_messages[0].content == "doomed"


def test_b5_inflight_guard_returns_409_then_cleans_up(tmp_path):
    from api.routers import chat_stream

    client = _client()
    graph = _make_graph(tmp_path)
    session, patches = _wire(graph, _fake_model("Hello streamed world"))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        # simulate a generation already in flight for this session
        chat_stream._inflight.add(FULL_SESSION_ID)
        try:
            response = _post_stream(client, message="second")
        finally:
            chat_stream._inflight.discard(FULL_SESSION_ID)

        assert response.status_code == 409
        assert response.headers["content-type"].startswith("application/json")
        assert "already in progress" in response.json()["detail"]

        # normal request afterwards: the done-callback must clean the set
        chat_stream._inflight.discard(FULL_SESSION_ID)
        ok = _post_stream(client, message="first")
        assert ok.status_code == 200
        assert any(e["type"] == "complete" for e in _sse_events(ok))

    _wait_for_cleanup(chat_stream, FULL_SESSION_ID)
    assert FULL_SESSION_ID not in chat_stream._inflight


def test_b6_blank_message_returns_400():
    client = _client()
    with patch(
        "api.routers.chat_stream.get_session_or_404",
        new=AsyncMock(return_value=(FULL_SESSION_ID, _session())),
    ):
        response = _post_stream(client, message="   ")
    assert response.status_code == 400
    assert response.json()["detail"] == "Message content is required"


def test_b7_thinking_tags_pass_through_raw_and_clean_on_complete(tmp_path):
    client = _client()
    graph = _make_graph(tmp_path)
    raw_text = "<think>hidden reasoning</think> Visible answer"
    session, patches = _wire(graph, _fake_model(raw_text))

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        response = _post_stream(client, message="hi")

    assert response.status_code == 200
    events = _sse_events(response)
    deltas = [e["content"] for e in events if e["type"] == "delta"]
    # deltas are RAW text (no cleaning — frontend filters during streaming)
    assert "".join(deltas) == raw_text

    complete = next(e for e in events if e["type"] == "complete")
    ai = [m for m in complete["messages"] if m["type"] == "ai"][-1]
    # the node's clean_thinking_content applies to the final message only
    assert ai["content"] == "Visible answer"


def test_b8a_esperanto_streaming_predicate_pinned():
    """Lock the production gating predicate: if a langchain-core upgrade
    changes this behavior, the node-level flip stops working — fail loudly."""
    from esperanto.providers.llm.openai import OpenAILanguageModel

    lc = OpenAILanguageModel(
        model_name="gpt-4o-mini", api_key="sk-fake", base_url=None
    ).to_langchain()
    assert type(lc).__name__ == "ChatOpenAI"
    assert "streaming" in lc.model_fields_set
    assert lc.streaming is False
    # hard opt-out overrides even an affirmative trigger (astream would fall
    # back to ainvoke's single chunk)
    assert lc._should_stream(async_api=True, stream=True) is False

    flipped = lc.model_copy(update={"streaming": True})
    assert type(flipped).__name__ == "ChatOpenAI"
    assert flipped.model_name == lc.model_name
    # after the flip the instance-level affirmative trigger wins, even with
    # no handler attached (hence the config-gated flip in the node)
    assert flipped._should_stream(async_api=False, run_manager=None) is True


@pytest.mark.parametrize("stream_tokens", [True, False])
def test_b8b_node_flip_is_config_gated(tmp_path, stream_tokens):
    """Same explicit streaming=False fake model through the real node: with
    the stream_tokens flag the typewriter lights up; without it the model
    object stays untouched (execute_chat equivalence — 0 deltas)."""
    graph = _make_graph(tmp_path)
    model = _fake_model("Hello streamed world")
    prov = SimpleNamespace(
        langchain_model=model, model_name="fake-stream-model"
    )

    configurable = {"thread_id": "chat_session:t-b8"}
    if stream_tokens:
        configurable["stream_tokens"] = True

    with (
        patch(
            "open_notebook.graphs.chat.provision_langchain_model_with_info",
            new=AsyncMock(return_value=prov),
        ),
        patch("open_notebook.graphs.chat.record_llm_usage_sync"),
    ):
        deltas = []
        for chunk, meta in graph.stream(
            input={"messages": [HumanMessage(content="hi")]},  # type: ignore[arg-type]
            config=RunnableConfig(configurable=configurable),
            stream_mode="messages",
        ):
            if (meta or {}).get("langgraph_node") != "agent":
                continue
            if not isinstance(chunk, AIMessageChunk):
                continue
            delta = extract_text_content(chunk.content)
            if delta:
                deltas.append(delta)

    if stream_tokens:
        assert len(deltas) >= 2
        assert "".join(deltas) == "Hello streamed world"
    else:
        assert deltas == []

    # both paths land the full exchange in the checkpoint
    state = graph.get_state(
        RunnableConfig(configurable={"thread_id": "chat_session:t-b8"})
    )
    messages = list(state.values.get("messages", []))
    assert len(messages) == 2
    assert messages[1].content == "Hello streamed world"
