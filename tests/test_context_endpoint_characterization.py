"""Characterization tests for POST /api/chat/context.

These pin down the exact response shape and the string-matching config
semantics ("not in" skips, "insights" -> short context, "full content" ->
long context) before the context-building loop is extracted out of the
router into open_notebook/utils/context_builder.py. They must pass
unchanged before and after the refactor.

DB access is mocked following the style of
tests/test_chat_routers_characterization.py.
"""

from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _notebook(**overrides):
    defaults = dict(id="notebook:1", name="My Notebook")
    defaults.update(overrides)
    nb = SimpleNamespace(**defaults)
    nb.get_sources = AsyncMock(return_value=[])
    nb.get_notes = AsyncMock(return_value=[])
    return nb


def _source(source_id="source:s1", context=None):
    src = SimpleNamespace(id=source_id)
    src.get_context = AsyncMock(
        return_value=context if context is not None else {"id": source_id, "title": "T"}
    )
    return src


def _note(note_id="note:n1", context=None):
    note = SimpleNamespace(id=note_id)
    # Note.get_context is synchronous in the router code.
    note.get_context = MagicMock(
        return_value=context if context is not None else {"id": note_id, "title": "N"}
    )
    return note


# Patch the domain classes at their definition site so the tests are
# independent of which module hosts the context-building loop.
PATCH_NOTEBOOK = "open_notebook.domain.notebook.Notebook.get"
PATCH_SOURCE = "open_notebook.domain.notebook.Source.get"
PATCH_NOTE = "open_notebook.domain.notebook.Note.get"
PATCH_INSIGHTS = "open_notebook.domain.notebook.SourceInsight.get_for_sources"


@pytest.mark.asyncio
async def test_config_string_matching_semantics(client):
    """'not in' skips, 'insights' -> short, 'full content' -> long."""
    source_short = _source("source:s2", {"id": "source:s2", "insights": ["i"]})
    source_long = _source("source:s3", {"id": "source:s3", "full_text": "body"})
    note_full = _note("note:n2", {"id": "note:n2", "content": "note body"})

    async def get_source(full_id):
        return {"source:s2": source_short, "source:s3": source_long}[full_id]

    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook())),
        patch(PATCH_SOURCE, new=AsyncMock(side_effect=get_source)),
        patch(PATCH_NOTE, new=AsyncMock(return_value=note_full)),
    ):
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {
                    "sources": {
                        "s1": "not in context",
                        "s2": "insights",
                        "s3": "full content",
                    },
                    "notes": {"n1": "not in context", "n2": "full content"},
                },
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["context"]["sources"] == [
        {"id": "source:s2", "insights": ["i"]},
        {"id": "source:s3", "full_text": "body"},
    ]
    assert body["context"]["notes"] == [{"id": "note:n2", "content": "note body"}]

    # "insights" -> short context, "full content" -> long context
    source_short.get_context.assert_awaited_once_with(context_size="short")
    source_long.get_context.assert_awaited_once_with(context_size="long")
    note_full.get_context.assert_called_once_with(context_size="long")

    # char_count is the length of the concatenated str() of every context dict
    expected_content = (
        str({"id": "source:s2", "insights": ["i"]})
        + str({"id": "source:s3", "full_text": "body"})
        + str({"id": "note:n2", "content": "note body"})
    )
    assert body["char_count"] == len(expected_content)
    assert isinstance(body["token_count"], int)
    assert body["token_count"] > 0


@pytest.mark.asyncio
async def test_config_bare_ids_get_table_prefix(client):
    """Bare ids are prefixed with 'source:' / 'note:' before lookup."""
    source_get = AsyncMock(return_value=_source())
    note_get = AsyncMock(return_value=_note())

    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook())),
        patch(PATCH_SOURCE, new=source_get),
        patch(PATCH_NOTE, new=note_get),
    ):
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {
                    "sources": {"abc": "insights"},
                    "notes": {"def": "full content"},
                },
            },
        )

    assert response.status_code == 200
    source_get.assert_awaited_once_with("source:abc")
    note_get.assert_awaited_once_with("note:def")


@pytest.mark.asyncio
async def test_config_missing_source_is_skipped(client):
    """A source lookup failure skips that source, not the whole request."""
    ok_source = _source("source:ok")

    async def get_source(full_id):
        if full_id == "source:missing":
            raise Exception("not found")
        return ok_source

    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook())),
        patch(PATCH_SOURCE, new=AsyncMock(side_effect=get_source)),
    ):
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {
                    "sources": {"missing": "insights", "ok": "insights"},
                    "notes": {},
                },
            },
        )

    assert response.status_code == 200
    assert response.json()["context"]["sources"] == [{"id": "source:ok", "title": "T"}]


@pytest.mark.asyncio
async def test_empty_config_defaults_to_all_short_contexts(client):
    """Falsy context_config -> every source (batched insights) and note, short."""
    src = _source("source:s1", {"id": "source:s1", "title": "S"})
    note = _note("note:n1", {"id": "note:n1", "title": "N"})
    notebook = _notebook()
    notebook.get_sources = AsyncMock(return_value=[src])
    notebook.get_notes = AsyncMock(return_value=[note])
    insights = [SimpleNamespace(id="source_insight:1")]

    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=notebook)),
        patch(
            PATCH_INSIGHTS,
            new=AsyncMock(return_value={"source:s1": insights}),
        ),
    ):
        response = client.post(
            "/api/chat/context",
            json={"notebook_id": "notebook:1", "context_config": {}},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["context"]["sources"] == [{"id": "source:s1", "title": "S"}]
    assert body["context"]["notes"] == [{"id": "note:n1", "title": "N"}]
    src.get_context.assert_awaited_once_with(context_size="short", insights=insights)
    note.get_context.assert_called_once_with(context_size="short")


@pytest.mark.asyncio
async def test_default_path_survives_insight_batch_failure(client):
    """A failure batch-fetching insights falls back to empty insights."""
    src = _source("source:s1")
    notebook = _notebook()
    notebook.get_sources = AsyncMock(return_value=[src])

    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=notebook)),
        patch(PATCH_INSIGHTS, new=AsyncMock(side_effect=Exception("db hiccup"))),
    ):
        response = client.post(
            "/api/chat/context",
            json={"notebook_id": "notebook:1", "context_config": {}},
        )

    assert response.status_code == 200
    src.get_context.assert_awaited_once_with(context_size="short", insights=[])


@pytest.mark.asyncio
async def test_missing_notebook_returns_404(client):
    with patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=None)):
        response = client.post(
            "/api/chat/context",
            json={"notebook_id": "notebook:missing", "context_config": {}},
        )

    assert response.status_code == 404


# --- breakdown extension (PDR-005) ---------------------------------------------
#
# The breakdown is computed from the SAME assembled context_data/total_content
# as the original three fields, so the sources+notes segments must reconcile
# exactly with char_count (A9), and each config status string must be echoed
# back as the item's mode.


class _Msg:
    def __init__(self, id, type, content):
        self.id = id
        self.type = type
        self.content = content


def _patch_history_chain(messages=None, agent=None):
    """Patches making session/agent/history resolution hit test doubles."""
    graph = MagicMock()
    graph.get_state.return_value = MagicMock(values={"messages": messages or []})
    session = SimpleNamespace(id="chat_session:abc", agent=None)
    return [
        patch(
            "api.routers.chat.get_session_or_404",
            new=AsyncMock(return_value=("chat_session:abc", session)),
        ),
        patch(
            "api.routers.chat.resolve_agent_binding",
            new=AsyncMock(return_value=agent),
        ),
        patch(
            "api.routers._chat_shared.repo_query",
            new=AsyncMock(return_value=[{"out": "notebook:1"}]),
        ),
        patch("api.routers.chat.chat_graph", graph),
    ]


def _segment(breakdown, key):
    return next(s for s in breakdown["segments"] if s["key"] == key)


@pytest.mark.asyncio
async def test_breakdown_segments_reconcile_and_mode_lookup(client):
    """A9 reconciliation + per-item mode echo + history item detail."""
    source_short = _source(
        "source:s2", {"id": "source:s2", "title": "A", "insights": ["i"]}
    )
    source_long = _source(
        "source:s3", {"id": "source:s3", "title": "B", "full_text": "body"}
    )
    note_full = _note(
        "note:n2", {"id": "note:n2", "title": "N", "content": "note body"}
    )
    messages = [_Msg("m1", "human", "hello"), _Msg("m2", "ai", "hi there")]

    async def get_source(full_id):
        return {"source:s2": source_short, "source:s3": source_long}[full_id]

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook(description="d"))
            )
        )
        stack.enter_context(patch(PATCH_SOURCE, new=AsyncMock(side_effect=get_source)))
        stack.enter_context(patch(PATCH_NOTE, new=AsyncMock(return_value=note_full)))
        for p in _patch_history_chain(messages):
            stack.enter_context(p)

        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {
                    "sources": {
                        "s1": "not in context",
                        "s2": "insights",
                        "s3": "full content",
                    },
                    "notes": {"n2": "full content"},
                },
                "session_id": "chat_session:abc",
            },
        )

    assert response.status_code == 200
    body = response.json()

    # the original three fields are untouched by the extension
    expected_content = (
        str({"id": "source:s2", "title": "A", "insights": ["i"]})
        + str({"id": "source:s3", "title": "B", "full_text": "body"})
        + str({"id": "note:n2", "title": "N", "content": "note body"})
    )
    assert body["char_count"] == len(expected_content)
    assert body["token_count"] > 0

    breakdown = body["breakdown"]
    assert [s["key"] for s in breakdown["segments"]] == [
        "system_prompt",
        "history",
        "sources",
        "notes",
    ]

    # A9: sources + notes chars == char_count; total == sum of all segments
    sources_seg = _segment(breakdown, "sources")
    notes_seg = _segment(breakdown, "notes")
    assert sources_seg["chars"] + notes_seg["chars"] == body["char_count"]
    assert breakdown["total_chars"] == sum(s["chars"] for s in breakdown["segments"])

    # percentages: segment percents ≈ 100; every item percent is relative to
    # the total, not its own segment
    assert 99.9 <= sum(s["percent"] for s in breakdown["segments"]) <= 100.1
    for seg in breakdown["segments"]:
        if seg["items"]:
            for item in seg["items"]:
                assert item["percent"] == round(
                    item["chars"] / breakdown["total_chars"] * 100, 2
                )

    # history segment detail: ids/roles/chars from the checkpoint messages
    history_seg = _segment(breakdown, "history")
    assert history_seg["message_count"] == 2
    assert history_seg["items"] == [
        {
            "message_id": "m1",
            "role": "human",
            "chars": 5,
            "percent": round(5 / breakdown["total_chars"] * 100, 2),
        },
        {
            "message_id": "m2",
            "role": "ai",
            "chars": 8,
            "percent": round(8 / breakdown["total_chars"] * 100, 2),
        },
    ]

    # mode echo: the request's status strings come back per source; the
    # excluded source never appears
    assert [(i["id"], i["mode"]) for i in sources_seg["items"]] == [
        ("source:s2", "insights"),
        ("source:s3", "full content"),
    ]
    # note items carry no mode key at all
    assert notes_seg["items"] == [
        {
            "id": "note:n2",
            "title": "N",
            "chars": len(str({"id": "note:n2", "title": "N", "content": "note body"})),
            "percent": notes_seg["items"][0]["percent"],
        }
    ]

    # system segment: fixed instructions, no deletable items
    system_seg = _segment(breakdown, "system_prompt")
    assert system_seg["message_count"] is None
    assert system_seg["items"] is None
    assert system_seg["chars"] > 0

    # estimated_tokens rides along with the breakdown
    assert breakdown["estimated_tokens"] > 0


@pytest.mark.asyncio
async def test_breakdown_history_degrades_to_zero_on_bad_session(client):
    """A broken session_id must not fail the display-only request: the
    history segment is reported as empty instead."""
    source = _source("source:s1", {"id": "source:s1", "title": "S", "full_text": "x"})

    with ExitStack() as stack:
        stack.enter_context(
            patch(
                PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook(description="d"))
            )
        )
        stack.enter_context(patch(PATCH_SOURCE, new=AsyncMock(return_value=source)))
        stack.enter_context(
            patch(
                "api.routers.chat.get_session_or_404",
                new=AsyncMock(side_effect=HTTPException(404, "Session not found")),
            )
        )
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {"sources": {"s1": "full content"}, "notes": {}},
                "session_id": "chat_session:gone",
            },
        )

    assert response.status_code == 200
    breakdown = response.json()["breakdown"]
    history_seg = _segment(breakdown, "history")
    assert history_seg["chars"] == 0
    assert history_seg["message_count"] == 0
    assert history_seg["items"] == []
    # the rest of the breakdown is still computed
    assert _segment(breakdown, "sources")["chars"] > 0
    assert breakdown["total_chars"] > 0


@pytest.mark.asyncio
async def test_breakdown_default_path_modes_are_null(client):
    """No config → every source/note is short-context and has no mode."""
    src = _source("source:s1", {"id": "source:s1", "title": "S", "insights": []})
    note = _note("note:n1", {"id": "note:n1", "title": "N", "content": None})
    notebook = _notebook(description="d")
    notebook.get_sources = AsyncMock(return_value=[src])
    notebook.get_notes = AsyncMock(return_value=[note])

    with ExitStack() as stack:
        stack.enter_context(patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=notebook)))
        stack.enter_context(
            patch(
                PATCH_INSIGHTS,
                new=AsyncMock(return_value={"source:s1": []}),
            )
        )
        for p in _patch_history_chain([]):
            stack.enter_context(p)
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {},
                "session_id": "chat_session:abc",
            },
        )

    assert response.status_code == 200
    breakdown = response.json()["breakdown"]
    sources_seg = _segment(breakdown, "sources")
    assert sources_seg["items"][0]["mode"] is None
    notes_seg = _segment(breakdown, "notes")
    assert notes_seg["items"][0]["id"] == "note:n1"


@pytest.mark.asyncio
async def test_breakdown_absent_without_session_id(client):
    """Back-compat pin: requests without session_id must not grow a
    breakdown field value."""
    with (
        patch(PATCH_NOTEBOOK, new=AsyncMock(return_value=_notebook())),
        patch(PATCH_SOURCE, new=AsyncMock(return_value=_source())),
    ):
        response = client.post(
            "/api/chat/context",
            json={
                "notebook_id": "notebook:1",
                "context_config": {"sources": {"abc": "insights"}, "notes": {}},
            },
        )

    assert response.status_code == 200
    assert response.json()["breakdown"] is None
