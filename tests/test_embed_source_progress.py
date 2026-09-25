"""
Unit tests for the batch-by-batch embedding progress in embed_source_command
(commands/embedding_commands.py).

A fake embedding batch iterator is injected so progress transitions
(running -> completed/partial/failed) can be asserted without any model.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from commands.embedding_commands import EmbedSourceInput, embed_source_command
from open_notebook.domain.notebook import Source


def _fake_source(full_text: str = "some content") -> MagicMock:
    source = MagicMock(spec=Source)
    source.id = "source:1"
    source.full_text = full_text
    source.asset = None
    # Denormalized embedding progress (read by the stale-command guard)
    source.embedding_status = None
    source.embedding_command = None
    source.set_embedding_state = AsyncMock()
    return source


def _fake_batches(outcomes):
    """Build an async iterator factory: each outcome is a list of embeddings or an exception."""

    async def _iterate(texts, command_id=None):
        for outcome in outcomes:
            if isinstance(outcome, Exception):
                raise outcome
            yield outcome

    return _iterate


def _statuses(source: MagicMock) -> list[tuple]:
    return [
        (call.kwargs.get("status"), call.kwargs.get("embedded_chunks"))
        for call in source.set_embedding_state.await_args_list
    ]


def _errors(source: MagicMock) -> list:
    """Error texts passed to each state transition (None when cleared)."""
    return [
        call.kwargs.get("error") for call in source.set_embedding_state.await_args_list
    ]


@pytest.fixture
def command_env():
    """Patch out DB/model access shared by every embed_source test."""
    source = _fake_source()
    refresh = AsyncMock()
    repo_query = AsyncMock(return_value=[])
    repo_insert = AsyncMock(return_value=[])
    chunk_text = MagicMock(return_value=["c1", "c2", "c3", "c4"])
    input_data = EmbedSourceInput(source_id="source:1")
    return source, refresh, repo_query, repo_insert, chunk_text, input_data


@pytest.mark.asyncio
async def test_all_batches_succeed_marks_completed(command_env):
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([[0.1, 0.2], [0.3, 0.4]])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        output = await embed_source_command(input_data)

    assert output.success is True
    assert output.embedding_status == "completed"
    assert output.embedded_chunks == 4
    assert output.chunks_created == 4
    assert repo_insert.await_count == 2
    first_batch = repo_insert.await_args_list[0].args[1]
    assert [row["order"] for row in first_batch] == [0, 1]
    second_batch = repo_insert.await_args_list[1].args[1]
    assert [row["order"] for row in second_batch] == [2, 3]
    statuses = _statuses(source)
    assert statuses[0] == ("running", 0)
    assert ("running", 2) in statuses
    assert statuses[-1] == ("completed", 4)


@pytest.mark.asyncio
async def test_batch_failure_after_partial_insert_marks_partial(command_env):
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([[0.1, 0.2], RuntimeError("provider down")])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        output = await embed_source_command(input_data)

    # Permanent batch failure becomes a terminal ValueError -> success=False.
    assert output.success is False
    # The source itself carries the terminal state; only the first batch was
    # persisted before the failure.
    assert repo_insert.await_count == 1
    statuses = _statuses(source)
    # Terminal partial status; the persisted count stays at the last
    # per-batch update (2 rows kept).
    assert statuses[-1][0] == "partial"
    assert ("running", 2) in statuses
    assert "provider down" in (output.error_message or "")


@pytest.mark.asyncio
async def test_retry_rerun_resets_embedded_chunks_to_zero(command_env):
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([[0.1, 0.2], [0.3, 0.4]])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        await embed_source_command(input_data)
        source.set_embedding_state.reset_mock()
        repo_insert.reset_mock()
        await embed_source_command(input_data)

    # The retried run starts by resetting progress before the first batch.
    statuses = _statuses(source)
    assert statuses[0] == ("running", 0)
    assert statuses[-1] == ("completed", 4)


@pytest.mark.asyncio
async def test_progress_increases_monotonically_and_never_exceeds_total(command_env):
    """T1-1: per-batch updates must be monotonically increasing and capped at total."""
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    chunk_text.return_value = [f"c{i}" for i in range(10)]
    batches = _fake_batches([[0.1] * 3, [0.2] * 3, [0.3] * 4])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        output = await embed_source_command(input_data)

    assert output.success is True
    running_updates = [
        embedded for status, embedded in _statuses(source) if status == "running"
    ]
    assert running_updates == sorted(running_updates), "progress must never decrease"
    assert all(0 <= embedded <= 10 for embedded in running_updates)
    assert running_updates[-1] == 10


@pytest.mark.asyncio
async def test_first_batch_failure_marks_failed_not_partial(command_env):
    """T1-2: with zero inserted batches the terminal state is failed, not partial."""
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([RuntimeError("provider down on batch 1")])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        output = await embed_source_command(input_data)

    assert output.success is False
    assert repo_insert.await_count == 0
    statuses = _statuses(source)
    assert statuses[-1][0] == "failed"
    assert "provider down on batch 1" in (_errors(source)[-1] or "")


@pytest.mark.asyncio
async def test_missing_embedding_model_marks_failed_with_visible_error(command_env):
    """T4: no embedding model configured must land the source in a terminal
    failed state whose error text is what the UI Alert renders."""
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    no_model = ValueError(
        "No embedding model configured. Please configure one in the Models section."
    )
    batches = _fake_batches([no_model])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        output = await embed_source_command(input_data)

    assert output.success is False
    assert "No embedding model configured" in (output.error_message or "")
    statuses = _statuses(source)
    assert statuses[-1][0] == "failed"
    assert "No embedding model configured" in (_errors(source)[-1] or "")


@pytest.mark.asyncio
async def test_rerun_deletes_previous_embeddings_and_restarts_orders(command_env):
    """T1-3: reruns DELETE the old chunk rows first and re-insert from order 0,
    so a retried source can never accumulate duplicate chunks."""
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([[0.1, 0.2], [0.3, 0.4]])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        await embed_source_command(input_data)
        first_run_deletes = repo_query.await_count
        repo_insert.reset_mock()
        repo_query.reset_mock()
        # Interleave both mocks into one sequence to prove DELETE precedes inserts.
        sequence: list[str] = []

        async def _trace_delete(query, vars=None):
            sequence.append("delete")
            return []

        async def _trace_insert(table, rows):
            sequence.append("insert")
            return []

        repo_query.side_effect = _trace_delete
        repo_insert.side_effect = _trace_insert
        source.set_embedding_state.reset_mock()
        await embed_source_command(input_data)

    # First run protected itself with exactly one DELETE...
    assert first_run_deletes == 1
    assert sequence[0] == "delete", "rerun must DELETE stale embeddings first"
    assert "delete" not in sequence[1:], "rerun must DELETE once, then insert only"
    assert repo_insert.await_args_list, "rerun must insert again"
    for insert_call in repo_insert.await_args_list:
        rows = insert_call.args[1]
        assert [row["order"] for row in rows] == list(
            range(rows[0]["order"], rows[0]["order"] + len(rows))
        )
    all_orders = [
        row["order"] for call in repo_insert.await_args_list for row in call.args[1]
    ]
    assert all_orders == [0, 1, 2, 3], "rerun restarts at order 0 with no duplicates"


@pytest.mark.asyncio
async def test_no_text_marks_failed(command_env):
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    source.full_text = "   "

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
    ):
        output = await embed_source_command(input_data)

    assert output.success is False
    assert "no text to embed" in (output.error_message or "").lower()
    statuses = _statuses(source)
    assert statuses[-1] == ("failed", None)
    repo_insert.assert_not_awaited()


class TestSetEmbeddingStateErrorSentinel:
    """error is a tri-state: unset = leave stored error alone, None = clear it."""

    @pytest.mark.asyncio
    async def test_explicit_none_clears_stored_error(self):
        source = Source(id="source:1")
        query = AsyncMock(return_value=[])
        with patch("open_notebook.domain.notebook.repo_query", new=query):
            await source.set_embedding_state(status="completed", error=None)
        assert query.await_args is not None
        data = query.await_args.args[1]["data"]
        assert data["embedding_error"] is None

    @pytest.mark.asyncio
    async def test_unset_error_leaves_stored_error_alone(self):
        source = Source(id="source:1")
        query = AsyncMock(return_value=[])
        with patch("open_notebook.domain.notebook.repo_query", new=query):
            await source.set_embedding_state(status="running", embedded_chunks=5)
        assert query.await_args is not None
        data = query.await_args.args[1]["data"]
        assert "embedding_error" not in data

    @pytest.mark.asyncio
    async def test_error_string_is_truncated(self):
        source = Source(id="source:1")
        query = AsyncMock(return_value=[])
        with patch("open_notebook.domain.notebook.repo_query", new=query):
            await source.set_embedding_state(status="failed", error="x" * 900)
        assert query.await_args is not None
        data = query.await_args.args[1]["data"]
        assert data["embedding_error"] == "x" * 500


@pytest.mark.asyncio
async def test_transient_error_keeps_running_and_records_error(command_env):
    """A transient failure must NOT write a terminal status: the command-level
    retry will re-run embed(), and the UI keeps polling while it does. Only the
    error text is stored for observability."""
    source, refresh, repo_query, repo_insert, chunk_text, input_data = command_env
    batches = _fake_batches([ConnectionError("network blip")])

    with (
        patch.object(Source, "get", new=AsyncMock(return_value=source)),
        patch("commands.embedding_commands.refresh_embedding_params", new=refresh),
        patch("commands.embedding_commands.repo_query", new=repo_query),
        patch("commands.embedding_commands.repo_insert", new=repo_insert),
        patch("commands.embedding_commands.chunk_text", new=chunk_text),
        patch("commands.embedding_commands.iter_embedding_batches", new=batches),
    ):
        with pytest.raises(ConnectionError):
            await embed_source_command(input_data)

    statuses = _statuses(source)
    assert statuses, "no progress writes happened"
    assert all(status not in ("partial", "failed") for status, _ in statuses)
    assert statuses[-1][0] == "running"
    last_call = source.set_embedding_state.await_args_list[-1]
    assert last_call.kwargs.get("error") == "network blip"
    repo_insert.assert_not_awaited()


class TestSaveStripsEmbeddingProgress:
    """Generic save() must never write the denormalized progress fields - they
    are owned by set_embedding_state, and a stale in-memory copy would clobber
    fresher worker state written between the API's load and save."""

    @pytest.mark.asyncio
    async def test_save_does_not_write_progress_fields(self):
        source = Source(id="source:1", title="t")
        source.embedding_status = "running"
        source.embedding_command = "command:9"
        source.embedding_error = "old error"
        source.total_chunks = 40
        source.embedded_chunks = 37

        captured: dict = {}

        async def _fake_update(table, record_id, data):
            captured["table"] = table
            captured["record_id"] = record_id
            captured["data"] = data
            return [{"id": record_id}]

        with patch("open_notebook.domain.base.repo_update", new=_fake_update):
            await source.save()

        assert captured["table"] == "source"
        for field in (
            "embedding_status",
            "embedding_command",
            "embedding_error",
            "total_chunks",
            "embedded_chunks",
        ):
            assert field not in captured["data"], field

    def test_prepare_save_data_strips_progress_fields(self):
        source = Source(id="source:1", title="t")
        source.embedding_status = "completed"
        source.embedded_chunks = 3
        data = source._prepare_save_data()
        assert "embedding_status" not in data
        assert "embedded_chunks" not in data
        assert data["title"] == "t"
