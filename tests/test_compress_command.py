"""Tests for the compress_chat_history command (commands/chat_history_commands.py).

Real StateGraphs (production channel schemas) over temporary SqliteSaver
files — the same shape as tests/test_chat_history_api.py — so every
assertion runs against the actual add_messages/REMOVE_ALL_MESSAGES
checkpoint semantics. The LLM is always a stub: no real provider call is
made anywhere in this file.

The in-flight-generation branch is defense-in-depth only (the worker process
always sees an empty in-flight set in production); its test exists to pin
the branch's semantics, NOT as evidence that compression concurrency is
guarded — the real guards are the submit endpoint's two 409s (covered in
tests/test_chat_history_api.py) and the pre-write recheck below.
"""

import sqlite3
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage
from langchain_core.runnables import RunnableConfig

from commands.chat_history_commands import (
    MAX_COMPRESS_IDS,
    CompressChatHistoryInput,
    compress_chat_history_command,
)
from open_notebook.domain.notebook import ChatSession
from open_notebook.exceptions import NotFoundError

SESSION = "chat_session:nb1"
SOURCE_SESSION = "chat_session:src1"


def _make_graph(tmp_path, production_cls, production_node, node_name, filename):
    """Compile a real StateGraph with the production node and channel schema."""
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
        "compress-nb-cp.sqlite",
    )
    source_graph = _make_graph(
        tmp_path,
        SourceChatState,
        call_model_with_source_context,
        "source_chat_agent",
        "compress-src-cp.sqlite",
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


def _prov(summary_text: str = "Merged summary of the selected messages."):
    prov = MagicMock()
    prov.model_name = "fake-model"
    prov.langchain_model.ainvoke = AsyncMock(
        return_value=MagicMock(content=summary_text)
    )
    return prov


def _command_patches(graph, prov, owner_out="notebook:1"):
    return [
        patch(
            "commands.chat_history_commands.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=prov,
        ),
        patch(
            "commands.chat_history_commands.record_llm_usage", new_callable=AsyncMock
        ),
        patch.object(ChatSession, "get", new_callable=AsyncMock),
        patch(
            "api.routers._chat_shared.repo_query",
            new=AsyncMock(return_value=[{"out": owner_out}]),
        ),
        patch("commands.chat_history_commands.chat_graph", graph),
    ]


@pytest.mark.asyncio
async def test_compress_happy_rewrites_history_once(tmp_path):
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph,
        SESSION,
        [
            HumanMessage(content="q1"),
            AIMessage(content="a1 " + "x" * 100),
            HumanMessage(content="q2"),
            AIMessage(content="a2"),
        ],
    )
    victim_ids = [seeded[1].id, seeded[2].id]
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        result = await compress_chat_history_command(
            CompressChatHistoryInput(session_id=SESSION, message_ids=victim_ids)
        )

    assert result.success is True
    assert result.compressed_count == 2
    assert result.remaining_count == 3
    assert result.summary_message_id
    assert result.chars_before == len("q1") + len("a1 " + "x" * 100) + len("q2") + len(
        "a2"
    )
    assert result.chars_after > 0

    # exactly one LLM call, usage recorded once
    prov.langchain_model.ainvoke.assert_awaited_once()

    final = _get_messages(graph, SESSION)
    assert [m.id for m in final] == [
        seeded[0].id,
        result.summary_message_id,
        seeded[3].id,
    ]
    # selected originals are gone, survivors keep their content
    assert final[0].content == "q1"
    assert final[2].content == "a2"
    # the summary is an AI message carrying summary metadata
    summary = final[1]
    assert summary.type == "ai"
    assert summary.content.startswith("Merged summary")
    assert summary.additional_kwargs["message_kind"] == "summary"
    assert summary.additional_kwargs["created_at"]
    assert summary.additional_kwargs["model_name"] == "fake-model"
    # inserted at the minimal selected index (between seed[0] and seed[3])
    assert final.index(summary) == 1


@pytest.mark.asyncio
async def test_compress_all_selected_puts_summary_first(tmp_path):
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        result = await compress_chat_history_command(
            CompressChatHistoryInput(
                session_id=SESSION, message_ids=[m.id for m in seeded]
            )
        )

    final = _get_messages(graph, SESSION)
    assert [m.id for m in final] == [result.summary_message_id]
    assert final[0].additional_kwargs["message_kind"] == "summary"


@pytest.mark.asyncio
async def test_compress_missing_id_is_permanent_and_nondestructive(tmp_path):
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        with pytest.raises(ValueError):
            await compress_chat_history_command(
                CompressChatHistoryInput(
                    session_id=SESSION,
                    message_ids=[seeded[0].id, "00000000-0000-0000-0000-000000000000"],
                )
            )

    # the irreversible write never ran: the checkpoint is untouched
    assert [m.id for m in _get_messages(graph, SESSION)] == [m.id for m in seeded]
    prov.langchain_model.ainvoke.assert_not_awaited()


@pytest.mark.asyncio
async def test_compress_empty_summary_is_permanent_and_nondestructive(tmp_path):
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    prov = _prov(summary_text="<think>reasoning only</think>")

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        with pytest.raises(ValueError):
            await compress_chat_history_command(
                CompressChatHistoryInput(
                    session_id=SESSION, message_ids=[seeded[0].id, seeded[1].id]
                )
            )

    assert [m.id for m in _get_messages(graph, SESSION)] == [m.id for m in seeded]


@pytest.mark.asyncio
async def test_compress_pre_write_recheck_aborts_on_concurrent_delete(tmp_path):
    """The recheck is the real race guard: a delete landing between the
    snapshot and the recheck must abort the job BEFORE the irreversible write."""
    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph,
        SESSION,
        [HumanMessage(content="q1"), AIMessage(content="a1"), AIMessage(content="a2")],
    )

    class RecheckGraph:
        """First get_state passes through; the second (the recheck) first
        simulates a concurrent delete, so the recheck sees a changed history."""

        def __init__(self, real, victim_id):
            self.real = real
            self.victim_id = victim_id
            self.get_state_calls = 0
            self.update_calls: list = []

        def get_state(self, config):
            self.get_state_calls += 1
            if self.get_state_calls == 2:
                self.real.update_state(
                    config, {"messages": [RemoveMessage(id=self.victim_id)]}
                )
            return self.real.get_state(config)

        def update_state(self, config, values):
            self.update_calls.append(values)
            return self.real.update_state(config, values)

    wrapper = RecheckGraph(graph, seeded[2].id)
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(wrapper, prov):
            stack.enter_context(p)
        with pytest.raises(RuntimeError):
            await compress_chat_history_command(
                CompressChatHistoryInput(
                    session_id=SESSION, message_ids=[seeded[0].id, seeded[1].id]
                )
            )

    # the command's own write never happened; only the simulated concurrent
    # delete landed
    assert wrapper.update_calls == []
    remaining_ids = [m.id for m in _get_messages(graph, SESSION)]
    assert seeded[2].id not in remaining_ids
    assert all(
        m.additional_kwargs.get("message_kind") != "summary"
        for m in _get_messages(graph, SESSION)
    )


@pytest.mark.asyncio
async def test_compress_update_state_lock_error_propagates(tmp_path):
    """A transient sqlite lock on the first cross-process write must NOT be
    swallowed: it propagates so the retry layer re-runs the command."""

    class LockedGraph:
        def __init__(self, real):
            self.real = real

        def get_state(self, config):
            return self.real.get_state(config)

        def update_state(self, config, values):
            raise RuntimeError("database locked")

    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(LockedGraph(graph), prov):
            stack.enter_context(p)
        with pytest.raises(RuntimeError, match="database locked"):
            await compress_chat_history_command(
                CompressChatHistoryInput(
                    session_id=SESSION, message_ids=[seeded[0].id, seeded[1].id]
                )
            )

    assert [m.id for m in _get_messages(graph, SESSION)] == [m.id for m in seeded]


@pytest.mark.asyncio
async def test_compress_source_session_dispatch_preserves_channels(tmp_path):
    """A source-bound session is compressed through source_chat_graph: the
    source-only channels (context_indicators) survive the rebuild."""
    notebook_graph, source_graph = _make_graphs(tmp_path)
    indicators = {"sources": ["source:9"], "insights": ["insight:1"], "notes": []}
    _, seeded = _seed_messages(
        source_graph,
        SOURCE_SESSION,
        [HumanMessage(content="q1"), AIMessage(content="a1")],
        extra={"context_indicators": indicators, "source_id": "source:9"},
    )
    prov = _prov()

    patches = _command_patches(source_graph, prov, owner_out="source:9")
    # _command_patches patches the notebook graph slot; swap in both graphs
    patches[-1] = patch("commands.chat_history_commands.chat_graph", notebook_graph)
    patches.append(
        patch("commands.chat_history_commands.source_chat_graph", source_graph)
    )

    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await compress_chat_history_command(
            CompressChatHistoryInput(
                session_id=SOURCE_SESSION, message_ids=[m.id for m in seeded]
            )
        )

    final = _get_messages(source_graph, SOURCE_SESSION)
    assert [m.id for m in final] == [result.summary_message_id]
    state = source_graph.get_state(
        RunnableConfig(configurable={"thread_id": SOURCE_SESSION})
    )
    assert state.values["context_indicators"] == indicators
    # the notebook graph was never touched for this thread
    assert _get_messages(notebook_graph, SOURCE_SESSION) == []


@pytest.mark.asyncio
async def test_compress_inflight_generation_guard_raises(tmp_path):
    """DEFENSE-IN-DEPTH ONLY: in production the worker process always sees an
    empty in-flight set (the sets live in the API process), so this branch is
    not a concurrency guard there. This test pins the branch's in-process
    semantics; the real guards are the submit endpoint's 409s and the
    pre-write recheck."""
    from api.routers import chat_stream

    graph, _ = _make_graphs(tmp_path)
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content="q1"), AIMessage(content="a1")]
    )
    prov = _prov()

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        chat_stream._inflight.add(SESSION)
        try:
            with pytest.raises(RuntimeError, match="generation is in progress"):
                await compress_chat_history_command(
                    CompressChatHistoryInput(
                        session_id=SESSION, message_ids=[seeded[0].id, seeded[1].id]
                    )
                )
        finally:
            chat_stream._inflight.discard(SESSION)

    # aborted before any write
    assert [m.id for m in _get_messages(graph, SESSION)] == [m.id for m in seeded]


@pytest.mark.asyncio
async def test_compress_unknown_session_is_permanent(tmp_path):
    with (
        patch.object(
            ChatSession,
            "get",
            new_callable=AsyncMock,
            side_effect=NotFoundError("Session not found"),
        ),
        pytest.raises(ValueError, match="not found"),
    ):
        await compress_chat_history_command(
            CompressChatHistoryInput(
                session_id="chat_session:gone",
                message_ids=["a", "b"],
            )
        )


@pytest.mark.asyncio
async def test_compress_input_count_validation(tmp_path):
    # below the minimum: rejected before any session lookup or LLM call
    with pytest.raises(ValueError, match="2 to"):
        await compress_chat_history_command(
            CompressChatHistoryInput(session_id=SESSION, message_ids=["only-one"])
        )
    # above the cap
    too_many = [f"id-{i}" for i in range(MAX_COMPRESS_IDS + 1)]
    with pytest.raises(ValueError, match="2 to"):
        await compress_chat_history_command(
            CompressChatHistoryInput(session_id=SESSION, message_ids=too_many)
        )


@pytest.mark.asyncio
async def test_compress_truncates_prompt_message_contents(tmp_path):
    """Each message enters the prompt truncated to the per-message ceiling."""
    graph, _ = _make_graphs(tmp_path)
    long_content = "y" * 5000
    _, seeded = _seed_messages(
        graph, SESSION, [HumanMessage(content=long_content), AIMessage(content="a1")]
    )
    prov = _prov()
    captured: list = []

    async def capture_ainvoke(messages):
        captured.append(messages)
        return MagicMock(content="summary text")

    prov.langchain_model.ainvoke = AsyncMock(side_effect=capture_ainvoke)

    with ExitStack() as stack:
        for p in _command_patches(graph, prov):
            stack.enter_context(p)
        await compress_chat_history_command(
            CompressChatHistoryInput(
                session_id=SESSION, message_ids=[seeded[0].id, seeded[1].id]
            )
        )

    prompt = captured[0][0].content
    assert "y" * 4000 in prompt
    assert "y" * 4001 not in prompt
