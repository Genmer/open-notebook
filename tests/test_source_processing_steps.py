"""Tests for the derived processing-pipeline steps on the source status API."""

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.models import SourceEmbeddingStatus
from api.routers.sources import (
    _compute_processing_steps,
    _derive_processing_steps,
    _processing_info_from_row,
)
from open_notebook.database.repository import ensure_record_id

TRUNCATED_201 = "e" * 200 + "…"


def _embedding(**overrides) -> SourceEmbeddingStatus:
    fields = {
        "status": "not_embedded",
        "embedded_chunks": 0,
        "total_chunks": None,
        "error": None,
        "command_id": None,
    }
    fields.update(overrides)
    return SourceEmbeddingStatus(**fields)


def _compute_steps(**overrides):
    """Run _compute_processing_steps with sane defaults, keyed by step key."""
    fields: dict[str, Any] = {
        "cmd_status": "running",
        "cmd_error": None,
        "args": {"embed": True, "transformations": ["transformation:a", "transformation:b"]},
        "full_text": "content",
        "embedding": _embedding(),
        "n_transformations": 2,
        "m_insights": 1,
    }
    fields.update(overrides)
    return {step.key: step for step in _compute_processing_steps(**fields)}


class TestComputeProcessingStepsExtraction:
    def test_full_text_present_is_done(self):
        assert _compute_steps()["extraction"].status == "done"

    def test_running_without_full_text_is_in_progress(self):
        steps = _compute_steps(full_text=None)
        assert steps["extraction"].status == "in_progress"

    def test_failed_is_failed_with_truncated_error(self):
        steps = _compute_steps(full_text=None, cmd_status="failed", cmd_error="e" * 500)
        assert steps["extraction"].status == "failed"
        assert steps["extraction"].error == TRUNCATED_201

    def test_canceled_is_unknown(self):
        steps = _compute_steps(full_text=None, cmd_status="canceled")
        assert steps["extraction"].status == "unknown"

    def test_missing_command_is_unknown(self):
        steps = _compute_steps(full_text=None, cmd_status=None)
        assert steps["extraction"].status == "unknown"


class TestComputeProcessingStepsEmbedding:
    def test_args_none_is_unknown(self):
        assert _compute_steps(args=None)["embedding"].status == "unknown"

    def test_args_without_embed_key_is_unknown(self):
        assert _compute_steps(args={"transformations": []})["embedding"].status == "unknown"

    def test_embed_false_is_skipped(self):
        steps = _compute_steps(args={"embed": False, "transformations": ["transformation:a"]})
        assert steps["embedding"].status == "skipped"

    def test_completed_is_done(self):
        steps = _compute_steps(embedding=_embedding(status="completed", embedded_chunks=4, total_chunks=4))
        assert steps["embedding"].status == "done"

    def test_running_is_in_progress_with_chunk_progress(self):
        steps = _compute_steps(embedding=_embedding(status="running", embedded_chunks=3, total_chunks=5))
        assert steps["embedding"].status == "in_progress"
        assert steps["embedding"].current == 3
        assert steps["embedding"].total == 5

    def test_failed_is_failed_with_error(self):
        steps = _compute_steps(
            cmd_status="completed", embedding=_embedding(status="failed", error="boom")
        )
        assert steps["embedding"].status == "failed"
        assert steps["embedding"].error == "boom"

    def test_partial_counts_as_failed(self):
        steps = _compute_steps(
            cmd_status="completed",
            embedding=_embedding(status="partial", embedded_chunks=2, error="half broke"),
        )
        assert steps["embedding"].status == "failed"
        assert steps["embedding"].error == "half broke"

    def test_stale_failed_embedding_while_active_is_pending(self):
        """While the main command runs, a previous round's failed/partial value
        is stale (an embed failure never fails the main command) — show pending,
        never a retryable failure whose embed would race the pipeline."""
        failed = _compute_steps(embedding=_embedding(status="failed", error="old boom"))
        partial = _compute_steps(embedding=_embedding(status="partial", embedded_chunks=1))
        assert failed["embedding"].status == "pending"
        assert failed["embedding"].error is None
        assert partial["embedding"].status == "pending"

    def test_not_embedded_while_active_is_pending(self):
        steps = _compute_steps(embedding=_embedding(status="not_embedded"))
        assert steps["embedding"].status == "pending"

    def test_not_embedded_on_terminal_command_is_unknown(self):
        steps = _compute_steps(embedding=_embedding(status="not_embedded"), cmd_status="completed")
        assert steps["embedding"].status == "unknown"


class TestComputeProcessingStepsTransformation:
    def test_args_without_transformations_key_is_unknown(self):
        steps = _compute_steps(args={"embed": True})
        assert steps["transformation"].status == "unknown"

    def test_retry_without_transformations_is_skipped(self):
        """Retry resubmits with transformations=[] — the step must show skipped,
        not hang in_progress forever."""
        steps = _compute_steps(args={"embed": True, "transformations": []}, n_transformations=0)
        assert steps["transformation"].status == "skipped"

    def test_zero_titles_is_skipped(self):
        steps = _compute_steps(n_transformations=0, m_insights=0)
        assert steps["transformation"].status == "skipped"

    def test_pending_without_full_text(self):
        steps = _compute_steps(full_text=None)
        assert steps["transformation"].status == "pending"

    def test_failed_is_failed_with_error(self):
        steps = _compute_steps(cmd_status="failed", cmd_error="e" * 500)
        assert steps["transformation"].status == "failed"
        assert steps["transformation"].error == TRUNCATED_201

    def test_running_caps_current_at_total(self):
        """Manually added insights (m=5) must not inflate the progress beyond N=2."""
        steps = _compute_steps(m_insights=5)
        assert steps["transformation"].status == "in_progress"
        assert steps["transformation"].current == 2
        assert steps["transformation"].total == 2

    def test_completed_with_all_insights_is_done(self):
        steps = _compute_steps(cmd_status="completed", m_insights=2)
        assert steps["transformation"].status == "done"

    def test_completed_with_missing_insights_is_unknown(self):
        steps = _compute_steps(cmd_status="completed", m_insights=1)
        assert steps["transformation"].status == "unknown"

    def test_canceled_is_unknown(self):
        steps = _compute_steps(cmd_status="canceled")
        assert steps["transformation"].status == "unknown"


class TestComputeProcessingStepsFullPipeline:
    def test_running_without_full_text_yields_pending_pipeline(self):
        """Freshly submitted source: extraction running, everything else waits."""
        steps = _compute_steps(full_text=None)
        assert [steps[k].status for k in ("extraction", "embedding", "transformation", "completion")] == [
            "in_progress",
            "pending",
            "pending",
            "pending",
        ]
        assert steps["extraction"].error is None

    def test_fully_completed_pipeline_is_all_done(self):
        """Terminal success: every step reports done so the UI can hide the card."""
        steps = _compute_steps(
            cmd_status="completed",
            embedding=_embedding(status="completed", embedded_chunks=2, total_chunks=2),
            m_insights=2,
        )
        assert [steps[k].status for k in ("extraction", "embedding", "transformation", "completion")] == [
            "done",
            "done",
            "done",
            "done",
        ]

    def test_failed_transformation_keeps_residual_progress(self):
        """A failed transformation keeps the residual x/N so users see how far it
        got (m=1/N=3 → 1/3); embedding failure stays numberless (full re-embed)."""
        steps = _compute_steps(
            cmd_status="failed", cmd_error="insight blew up", n_transformations=3, m_insights=1
        )
        assert steps["transformation"].status == "failed"
        assert steps["transformation"].error == "insight blew up"
        assert steps["transformation"].current == 1
        assert steps["transformation"].total == 3

    def test_failed_embedding_reports_no_progress_numbers(self):
        steps = _compute_steps(
            cmd_status="completed",
            embedding=_embedding(status="failed", embedded_chunks=7, total_chunks=10, error="boom"),
        )
        assert steps["embedding"].status == "failed"
        assert steps["embedding"].current is None
        assert steps["embedding"].total is None


class TestDeriveProcessingSteps:
    """IO shell: the acceptance rule is N = distinct titles for the command's
    transformation IDs and m = insights matching exactly those titles."""

    @staticmethod
    def _row(transformations):
        return {
            "id": "command:1",
            "status": "running",
            "args": {"embed": True, "transformations": transformations},
            "error_message": None,
            "result": None,
        }

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_duplicate_transformation_ids_collapse_to_distinct_titles(self, mock_repo_query):
        """Two IDs resolving to the same title must not inflate the denominator."""
        source = _source_mock()

        async def fake_repo_query(query, params=None):
            if "FROM transformation" in query:
                return ["Summary", "Summary"]
            if "source_insight" in query:
                return [{"count": 1}]
            raise AssertionError(f"Unexpected query: {query}")

        mock_repo_query.side_effect = fake_repo_query
        steps = await _derive_processing_steps(source, self._row(["transformation:a", "transformation:b"]), _embedding())

        by_key = {step.key: step for step in steps}
        assert by_key["transformation"].status == "in_progress"
        assert by_key["transformation"].total == 1
        assert by_key["transformation"].current == 1

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_insight_count_query_scoped_to_resolved_titles(self, mock_repo_query):
        """The count query must filter on the resolved titles, so manually added
        insights of other types never enter m."""
        source = _source_mock()
        seen_params = {}

        async def fake_repo_query(query, params=None):
            if "FROM transformation" in query:
                return ["Summary", "Key Points"]
            if "source_insight" in query:
                seen_params["titles"] = params["titles"]
                return [{"count": 2}]
            raise AssertionError(f"Unexpected query: {query}")

        mock_repo_query.side_effect = fake_repo_query
        steps = await _derive_processing_steps(source, self._row(["transformation:a", "transformation:b"]), _embedding())

        assert seen_params["titles"] == ["Summary", "Key Points"]
        by_key = {step.key: step for step in steps}
        assert by_key["transformation"].status == "in_progress"
        assert by_key["transformation"].current == 2
        assert by_key["transformation"].total == 2

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_dual_transformation_source_counts_both_insight_types(self, mock_repo_query):
        """Regression (Critical): without the outer GROUP ALL the count query
        yields one row per group ([1, 1, …]) and count_rows[0] collapsed m to 1,
        leaving finished dual-transformation sources stuck unknown/pending."""
        source = _source_mock()
        queries_seen = []

        async def fake_repo_query(query, params=None):
            queries_seen.append(query)
            if "FROM transformation" in query:
                return ["Simple Summary", "Dense Summary"]
            if "source_insight" in query:
                return [{"count": 2}]
            raise AssertionError(f"Unexpected query: {query}")

        mock_repo_query.side_effect = fake_repo_query
        row = self._row(["transformation:a", "transformation:b"])
        row["status"] = "completed"

        steps = await _derive_processing_steps(
            source, row, _embedding(status="completed", embedded_chunks=4, total_chunks=4)
        )

        by_key = {step.key: step for step in steps}
        # m=2 >= N=2 → done; the m=1 regression made this unknown + completion pending
        assert by_key["transformation"].status == "done"
        assert by_key["completion"].status == "done"
        count_query = next(q for q in queries_seen if "source_insight" in q)
        assert "GROUP ALL" in count_query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_blank_transformation_entries_are_dropped(self, mock_repo_query):
        source = _source_mock()
        captured = {}

        async def fake_repo_query(query, params=None):
            if "FROM transformation" in query:
                captured["ids"] = params["ids"]
                return ["Summary"]
            if "source_insight" in query:
                return [{"count": 0}]
            raise AssertionError(f"Unexpected query: {query}")

        mock_repo_query.side_effect = fake_repo_query
        steps = await _derive_processing_steps(
            source, self._row(["transformation:a", "", None]), _embedding()
        )

        assert captured["ids"] == [ensure_record_id("transformation:a")]
        by_key = {step.key: step for step in steps}
        assert by_key["transformation"].status == "in_progress"


class TestComputeProcessingStepsCompletion:
    def test_done_when_all_predecessors_settled(self):
        steps = _compute_steps(
            cmd_status="completed",
            embedding=_embedding(status="completed", embedded_chunks=4, total_chunks=4),
            m_insights=2,
        )
        assert steps["completion"].status == "done"
        assert steps["completion"].error is None

    def test_done_when_steps_skipped(self):
        steps = _compute_steps(
            cmd_status="completed",
            args={"embed": False, "transformations": []},
            embedding=_embedding(status="not_embedded"),
            n_transformations=0,
            m_insights=0,
        )
        assert steps["completion"].status == "done"

    def test_pending_while_running(self):
        assert _compute_steps()["completion"].status == "pending"

    def test_pending_when_failed_does_not_inherit_failed(self):
        """A failed earlier step surfaces on its own row, completion stays pending."""
        steps = _compute_steps(
            cmd_status="failed",
            cmd_error="boom",
            embedding=_embedding(status="failed", error="boom"),
        )
        assert steps["completion"].status == "pending"
        assert steps["embedding"].status == "failed"


class TestProcessingInfoFromRow:
    def test_shape_matches_domain_get_processing_progress(self):
        row = {
            "id": "command:1",
            "status": "completed",
            "args": {"embed": True},
            "error_message": None,
            "result": {"execution_metadata": {"started_at": "t0", "completed_at": "t1"}},
        }
        info = _processing_info_from_row(row)
        assert set(info.keys()) == {"status", "started_at", "completed_at", "error", "result"}
        assert info["status"] == "completed"
        assert info["started_at"] == "t0"
        assert info["completed_at"] == "t1"
        assert info["error"] is None
        assert info["result"] == {"execution_metadata": {"started_at": "t0", "completed_at": "t1"}}

    def test_non_dict_result_yields_empty_metadata(self):
        info = _processing_info_from_row({"status": "new", "error_message": "x", "result": None})
        assert info["started_at"] is None
        assert info["completed_at"] is None
        assert info["error"] == "x"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _source_mock(command="command:1", full_text="content"):
    source = MagicMock()
    source.id = "source:1"
    source.command = command
    source.title = "My source"
    source.full_text = full_text
    source.embedding_status = "running"
    source.embedding_error = None
    source.embedding_command = None
    source.total_chunks = 5
    source.embedded_chunks = 3
    source.get_embedded_chunks = AsyncMock(return_value=3)
    return source


class TestStatusEndpointSteps:
    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_running_source_returns_steps(self, mock_get, mock_repo_query, client):
        source = _source_mock()
        mock_get.return_value = source
        command_row = {
            "id": "command:1",
            "status": "running",
            "args": {"embed": True, "transformations": ["transformation:a", "transformation:b"]},
            "error_message": None,
            "result": None,
        }

        async def fake_repo_query(query, params=None):
            if "FROM $command_id" in query:
                return [command_row]
            if "FROM transformation" in query:
                return ["T1", "T2"]
            if "source_insight" in query:
                return [{"count": 2}]
            raise AssertionError(f"Unexpected query: {query}")

        mock_repo_query.side_effect = fake_repo_query

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "running"
        assert [step["key"] for step in body["steps"]] == [
            "extraction",
            "embedding",
            "transformation",
            "completion",
        ]
        steps = {step["key"]: step for step in body["steps"]}
        assert steps["extraction"]["status"] == "done"
        assert steps["embedding"]["status"] == "in_progress"
        assert steps["embedding"]["current"] == 3
        assert steps["embedding"]["total"] == 5
        assert steps["transformation"]["status"] == "in_progress"
        assert steps["transformation"]["current"] == 2
        assert steps["transformation"]["total"] == 2
        assert steps["completion"]["status"] == "pending"
        # processing_info shape unchanged
        assert body["processing_info"] == {
            "status": "running",
            "started_at": None,
            "completed_at": None,
            "error": None,
            "result": None,
        }

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_legacy_source_has_no_steps(self, mock_get, client):
        mock_get.return_value = _source_mock(command=None)

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        body = response.json()
        assert body["steps"] is None
        assert body["embedding"]["status"] == "running"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_missing_command_row_returns_unknown_without_steps(
        self, mock_get, mock_repo_query, client
    ):
        mock_get.return_value = _source_mock()
        mock_repo_query.return_value = []

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "unknown"
        assert body["steps"] is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
