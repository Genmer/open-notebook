"""
Tests for the rebuild_embeddings "missing" mode: source selection predicate,
atomic claim + submit, submit-failure writeback, the stale-running sweep and
the stale-command guard in embed_source. All DB access is stubbed at
repo_query (no live SurrealDB).
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from surreal_commands import ExecutionContext

from commands.embedding_commands import (
    EmbedSourceInput,
    _claim_and_submit_sources,
    collect_items_for_rebuild,
    embed_source_command,
)
from open_notebook.domain.notebook import Source

# The status allowlist that defines "missing" in both the collect and claim
# queries. Sources with these statuses (or a NULL status) are selected.
MISSING_STATUSES = ("'not_embedded'", "'failed'", "'partial'")


def _execution_context(command_id: str) -> ExecutionContext:
    return ExecutionContext(
        command_id=command_id,
        execution_started_at=datetime.now(),
        app_name="open_notebook",
        command_name="embed_source",
    )


class TestCollectItemsMissingMode:
    @pytest.mark.asyncio
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_missing_mode_queries_sources_with_missing_predicate(
        self, repo_query
    ):
        repo_query.side_effect = [
            ["source:a", "source:b"],  # missing-status sources
            [],  # no running sources to sweep
        ]

        items = await collect_items_for_rebuild("missing", True, False, False)

        query = repo_query.await_args_list[0].args[0]
        assert "FROM source" in query
        assert "full_text != NONE" in query
        assert "string::trim(full_text)" in query
        for status in MISSING_STATUSES:
            assert status in query
        assert items["sources"] == ["source:a", "source:b"]
        assert items["stale_sources"] == {}
        assert items["notes"] == []
        assert items["insights"] == []

    @pytest.mark.asyncio
    async def test_missing_mode_selection_matrix_is_in_the_predicate(self):
        """Selection matrix: NULL / not_embedded / failed / partial with
        full_text are in; completed / queued / running / empty full_text are
        out of the main predicate (running is handled by the stale sweep).
        All of that lives in the WHERE clause, so assert its shape."""
        repo_query = AsyncMock(return_value=[])

        with patch("commands.embedding_commands.repo_query", repo_query):
            await collect_items_for_rebuild("missing", True, True, True)

        query = repo_query.await_args_list[0].args[0]
        # included: no status yet + the three retryable statuses
        for status in MISSING_STATUSES:
            assert status in query
        assert "embedding_status IS NONE" in query
        # excluded: terminal/in-flight statuses never appear in the allowlist
        for excluded in ("'completed'", "'queued'", "'running'"):
            assert excluded not in query
        # excluded: sources without extractable text
        assert "full_text != NONE" in query

    @pytest.mark.asyncio
    async def test_missing_mode_skips_notes_and_insights(self):
        repo_query = AsyncMock(return_value=[])

        with patch("commands.embedding_commands.repo_query", repo_query):
            items = await collect_items_for_rebuild("missing", True, True, True)

        # Only source queries run - missing mode never touches notes/insights
        assert repo_query.await_count == 2
        assert "FROM source" in repo_query.await_args_list[0].args[0]
        assert items["notes"] == []
        assert items["insights"] == []

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_missing_mode_sweeps_stale_running_with_terminal_owner(
        self, repo_query
    ):
        repo_query.side_effect = [
            [],  # no regular missing sources
            [
                {"id": "source:stale1", "embedding_command": "command:dead"},
                {"id": "source:live", "embedding_command": "command:busy"},
            ],
            [{"status": "failed"}],  # owner of stale1 is terminal
            [{"status": "running"}],  # owner of live is still active
        ]

        items = await collect_items_for_rebuild("missing", True, False, False)

        assert items["stale_sources"] == {"source:stale1": "command:dead"}
        # Stale candidates join the flat source list for the rebuild batch
        assert items["sources"] == ["source:stale1"]

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_missing_mode_sweeps_running_with_vanished_owner(
        self, repo_query
    ):
        repo_query.side_effect = [
            [],
            [{"id": "source:x", "embedding_command": "command:gone"}],
            [],  # owning command record no longer exists
        ]

        items = await collect_items_for_rebuild("missing", True, False, False)

        assert items["stale_sources"] == {"source:x": "command:gone"}
        assert items["sources"] == ["source:x"]

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_missing_mode_owner_lookup_failure_is_conservative(
        self, repo_query
    ):
        """A transient failure checking the owner must not claim the source."""
        repo_query.side_effect = [
            [],
            [{"id": "source:x", "embedding_command": "command:busy"}],
            RuntimeError("db blip"),
        ]

        items = await collect_items_for_rebuild("missing", True, False, False)

        assert items["stale_sources"] == {}
        assert items["sources"] == []


class TestClaimAndSubmitSources:
    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_submits_only_rows_returned_by_claim(self, repo_query, submit):
        repo_query.return_value = [{"id": "source:1"}]

        submitted, failed = await _claim_and_submit_sources(
            ["source:1", "source:2"], "command:coord"
        )

        assert (submitted, failed) == (1, 0)
        submit.assert_called_once_with(
            "open_notebook", "embed_source", {"source_id": "source:1"}
        )
        claim_query = repo_query.await_args_list[0].args[0]
        assert "UPDATE source SET embedding_status = 'queued'" in claim_query
        assert "embedding_status IS NONE" in claim_query
        for status in MISSING_STATUSES:
            assert status in claim_query
        # The claim stamps the coordinator so no second command can start a
        # concurrent embed during the queued->running window
        assert "embedding_command = $coordinator_id" in claim_query
        assert str(repo_query.await_args_list[0].args[1]["coordinator_id"]) == (
            "command:coord"
        )

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_claim_without_execution_context_writes_no_command(
        self, repo_query, submit
    ):
        repo_query.return_value = [{"id": "source:1"}]

        await _claim_and_submit_sources(["source:1"], "unknown")

        claim_query = repo_query.await_args_list[0].args[0]
        assert "embedding_command = $coordinator_id" not in claim_query
        assert "coordinator_id" not in repo_query.await_args_list[0].args[1]

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_second_claim_of_claimed_batch_yields_zero_rows(
        self, repo_query, submit
    ):
        """Re-running the claim on the same batch returns no rows (the sources
        are already 'queued'), so nothing is submitted twice."""
        first_call = [{"id": "source:1"}, {"id": "source:2"}]
        repo_query.side_effect = [first_call, [], []]

        submitted, failed = await _claim_and_submit_sources(
            ["source:1", "source:2"], "command:coord"
        )
        assert (submitted, failed) == (2, 0)
        assert submit.call_count == 2

        # Immediate duplicate: claim UPDATE matches nothing anymore
        submitted, failed = await _claim_and_submit_sources(
            ["source:1", "source:2"], "command:coord"
        )
        assert (submitted, failed) == (0, 0)
        assert submit.call_count == 2

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_submit_failure_writes_back_failed_status(self, repo_query, submit):
        repo_query.return_value = [{"id": "source:1"}]
        submit.side_effect = RuntimeError("queue down")

        submitted, failed = await _claim_and_submit_sources(
            ["source:1"], "command:coord"
        )

        assert (submitted, failed) == (0, 1)
        writeback = repo_query.await_args_list[1]
        assert "embedding_status = 'failed'" in writeback.args[0]
        assert writeback.args[1]["source_id"] is not None
        assert "queue down" in writeback.args[1]["error"]


class TestStaleRunningClaim:
    """Stale-running sources are claimed through a second, optimistic-lock
    UPDATE: only while the source still points at the verified dead command."""

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_stale_running_claimed_via_optimistic_lock(
        self, repo_query, submit
    ):
        repo_query.side_effect = [
            [],  # regular claim: running source doesn't match the predicate
            [{"id": "source:stale1"}],  # optimistic-lock claim succeeds
        ]

        submitted, failed = await _claim_and_submit_sources(
            ["source:stale1"],
            "command:coord",
            {"source:stale1": "command:dead"},
        )

        assert (submitted, failed) == (1, 0)
        submit.assert_called_once_with(
            "open_notebook", "embed_source", {"source_id": "source:stale1"}
        )
        stale_query = repo_query.await_args_list[1].args[0]
        stale_params = repo_query.await_args_list[1].args[1]
        assert "embedding_status = 'running'" in stale_query
        assert "embedding_command = $owner" in stale_query
        assert str(stale_params["owner"]) == "command:dead"
        assert str(stale_params["coordinator_id"]) == "command:coord"

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_stale_claim_skipped_when_owner_changed(self, repo_query, submit):
        """If a live command took over between sweep and claim, the lock finds
        nothing and no job is submitted."""
        repo_query.side_effect = [[], []]

        submitted, failed = await _claim_and_submit_sources(
            ["source:stale1"],
            "command:coord",
            {"source:stale1": "command:dead"},
        )

        assert (submitted, failed) == (0, 0)
        submit.assert_not_called()

    @pytest.mark.asyncio
    @patch("commands.embedding_commands.submit_command")
    @patch("commands.embedding_commands.repo_query", new_callable=AsyncMock)
    async def test_ownerless_running_claimed_via_is_none_lock(
        self, repo_query, submit
    ):
        repo_query.side_effect = [[], [{"id": "source:orphan"}]]

        submitted, failed = await _claim_and_submit_sources(
            ["source:orphan"], "command:coord", {"source:orphan": ""}
        )

        assert (submitted, failed) == (1, 0)
        stale_query = repo_query.await_args_list[1].args[0]
        assert "embedding_command IS NONE" in stale_query
        assert "$owner" not in stale_query


class TestEmbedSourceStaleCommandGuard:
    @pytest.mark.asyncio
    async def test_skips_when_owned_by_active_command(self):
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.embedding_status = "running"
        source.embedding_command = "command:other"
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch(
                "commands.embedding_commands.repo_query",
                new=AsyncMock(return_value=[{"status": "running"}]),
            ) as repo,
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 0
        # The owner was checked, but the destructive embeddings DELETE never ran
        assert repo.await_count == 1
        assert "type::thing" in repo.await_args_list[0].args[0]
        assert not any(
            "DELETE source_embedding" in call.args[0] for call in repo.await_args_list
        )

    @pytest.mark.asyncio
    async def test_skips_when_owned_by_active_queued_command(self):
        """A queued run is owned too - the manual trigger must wait."""
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.embedding_status = "queued"
        source.embedding_command = "command:other"
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch(
                "commands.embedding_commands.repo_query",
                new=AsyncMock(return_value=[{"status": "queued"}]),
            ) as repo,
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 0
        assert not any(
            "DELETE source_embedding" in call.args[0] for call in repo.await_args_list
        )

    @pytest.mark.asyncio
    async def test_takes_over_when_owning_command_is_terminal(self):
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.full_text = "content"
        source.asset = None
        source.embedding_status = "running"
        source.embedding_command = "command:dead"
        source.set_embedding_state = AsyncMock()

        async def _one_batch(texts, command_id=None):
            yield [0.1]

        repo_query = AsyncMock(return_value=[{"status": "failed"}])
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch("commands.embedding_commands.repo_query", new=repo_query),
            patch("commands.embedding_commands.repo_insert", new=AsyncMock(return_value=[])),
            patch(
                "commands.embedding_commands.chunk_text",
                MagicMock(return_value=["c1"]),
            ),
            patch(
                "commands.embedding_commands.iter_embedding_batches", new=_one_batch
            ),
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 1
        # Takeover: the stale owner's embeddings are deleted and rebuilt
        assert any(
            "DELETE source_embedding" in call.args[0]
            for call in repo_query.await_args_list
        )

    @pytest.mark.asyncio
    async def test_takes_over_when_owning_command_record_is_gone(self):
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.full_text = "content"
        source.asset = None
        source.embedding_status = "running"
        source.embedding_command = "command:gone"
        source.set_embedding_state = AsyncMock()

        async def _one_batch(texts, command_id=None):
            yield [0.1]

        repo_query = AsyncMock(return_value=[])
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch("commands.embedding_commands.repo_query", new=repo_query),
            patch("commands.embedding_commands.repo_insert", new=AsyncMock(return_value=[])),
            patch(
                "commands.embedding_commands.chunk_text",
                MagicMock(return_value=["c1"]),
            ),
            patch(
                "commands.embedding_commands.iter_embedding_batches", new=_one_batch
            ),
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 1
        assert any(
            "DELETE source_embedding" in call.args[0]
            for call in repo_query.await_args_list
        )

    @pytest.mark.asyncio
    async def test_skips_when_owner_lookup_fails_transiently(self):
        """Conservative: an error while checking the owner keeps the skip, the
        next attempt (or the sweep) rescues the source."""
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.embedding_status = "running"
        source.embedding_command = "command:other"
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch(
                "commands.embedding_commands.repo_query",
                new=AsyncMock(side_effect=RuntimeError("db down")),
            ) as repo,
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 0
        assert not any(
            "DELETE source_embedding" in call.args[0] for call in repo.await_args_list
        )

    @pytest.mark.asyncio
    async def test_same_command_retry_is_not_skipped(self):
        """A retry of the same command carries the same command_id and must
        run to completion (fresh delete + re-embed)."""
        source = MagicMock(spec=Source)
        source.id = "source:1"
        source.full_text = "content"
        source.asset = None
        source.embedding_status = "running"
        source.embedding_command = "command:mine"
        source.set_embedding_state = AsyncMock()

        async def _one_batch(texts, command_id=None):
            yield [0.1]

        repo_query = AsyncMock(return_value=[])
        repo_insert = AsyncMock(return_value=[])
        input_data = EmbedSourceInput(
            source_id="source:1", execution_context=_execution_context("command:mine")
        )

        with (
            patch.object(Source, "get", new=AsyncMock(return_value=source)),
            patch(
                "commands.embedding_commands.refresh_embedding_params",
                new=AsyncMock(),
            ),
            patch("commands.embedding_commands.repo_query", new=repo_query),
            patch("commands.embedding_commands.repo_insert", new=repo_insert),
            patch(
                "commands.embedding_commands.chunk_text",
                MagicMock(return_value=["c1"]),
            ),
            patch(
                "commands.embedding_commands.iter_embedding_batches", new=_one_batch
            ),
        ):
            output = await embed_source_command(input_data)

        assert output.success is True
        assert output.chunks_created == 1
        # The embeddings DELETE ran - the command owns this source
        assert any(
            "DELETE source_embedding" in call.args[0]
            for call in repo_query.await_args_list
        )
