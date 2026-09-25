"""Tests for the sources API endpoint."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.config import UPLOADS_FOLDER
from open_notebook.domain.notebook import Source


@pytest.fixture
def client():
    """Create test client after environment variables have been cleared by conftest."""
    from api.main import app

    return TestClient(app)


class TestAsyncSourceAssetPersistence:
    """Tests for #627 - asset is persisted before async processing.

    These tests hit the real create_source endpoint with mocked DB/command
    calls, verifying that the Source saved to the database has the correct
    asset set *before* async processing begins.
    """

    @pytest.mark.asyncio
    @patch("api.routers.sources.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.add_to_notebook", new_callable=AsyncMock)
    @patch("api.routers.sources.Notebook.get", new_callable=AsyncMock)
    async def test_async_link_source_persists_url_asset(
        self, mock_nb_get, mock_add_nb, mock_submit, client
    ):
        """POST /sources with type=link and async_processing=true persists Asset(url=...)."""
        mock_nb_get.return_value = MagicMock()
        mock_submit.return_value = "command:123"

        saved_sources = []

        async def capture_save(self_source):
            saved_sources.append(self_source)
            self_source.id = "source:fake"
            self_source.command = None

        with patch.object(Source, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/sources",
                data={
                    "type": "link",
                    "url": "https://example.com/article",
                    "notebooks": '["notebook:1"]',
                    "async_processing": "true",
                },
            )

        assert response.status_code == 200
        assert len(saved_sources) >= 1

        source = saved_sources[0]
        assert source.asset is not None
        assert source.asset.url == "https://example.com/article"
        assert source.asset.file_path is None

    @pytest.mark.asyncio
    @patch("api.routers.sources.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.add_to_notebook", new_callable=AsyncMock)
    @patch("api.routers.sources.Notebook.get", new_callable=AsyncMock)
    @patch("api.routers.sources.save_uploaded_file", new_callable=AsyncMock)
    async def test_async_upload_source_persists_file_asset(
        self, mock_upload, mock_nb_get, mock_add_nb, mock_submit, client
    ):
        """POST /sources with type=upload and async_processing=true persists Asset(file_path=...)."""
        mock_nb_get.return_value = MagicMock()
        mock_upload.return_value = os.path.join(os.path.abspath(UPLOADS_FOLDER), "video.mp4")
        mock_submit.return_value = "command:123"

        saved_sources = []

        async def capture_save(self_source):
            saved_sources.append(self_source)
            self_source.id = "source:fake"
            self_source.command = None

        with patch.object(Source, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/sources",
                data={
                    "type": "upload",
                    "notebooks": '["notebook:1"]',
                    "async_processing": "true",
                },
                files={"file": ("video.mp4", b"fake content", "video/mp4")},
            )

        assert response.status_code == 200
        assert len(saved_sources) >= 1

        source = saved_sources[0]
        assert source.asset is not None
        assert source.asset.file_path == os.path.join(os.path.abspath(UPLOADS_FOLDER), "video.mp4")
        assert source.asset.url is None

    @pytest.mark.asyncio
    @patch("api.routers.sources.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.add_to_notebook", new_callable=AsyncMock)
    @patch("api.routers.sources.Notebook.get", new_callable=AsyncMock)
    async def test_async_text_source_has_no_asset(
        self, mock_nb_get, mock_add_nb, mock_submit, client
    ):
        """POST /sources with type=text and async_processing=true has asset=None."""
        mock_nb_get.return_value = MagicMock()
        mock_submit.return_value = "command:123"

        saved_sources = []

        async def capture_save(self_source):
            saved_sources.append(self_source)
            self_source.id = "source:fake"
            self_source.command = None

        with patch.object(Source, "save", autospec=True, side_effect=capture_save):
            response = client.post(
                "/api/sources",
                data={
                    "type": "text",
                    "content": "Some text content",
                    "notebooks": '["notebook:1"]',
                    "async_processing": "true",
                },
            )

        assert response.status_code == 200
        assert len(saved_sources) >= 1

        source = saved_sources[0]
        assert source.asset is None


class TestRetrySourceProcessing:
    """POST /sources/{id}/retry must find a source's notebooks via the reference
    edge's in/out columns, not a non-existent `source` column (#861)."""

    @pytest.mark.asyncio
    @patch("api.routers.sources.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_retry_finds_notebooks_and_requeues(
        self, mock_get, mock_repo_query, mock_submit, client
    ):
        source = MagicMock()
        source.id = "source:1"
        source.command = None
        source.title = "My source"
        source.topics = []
        source.full_text = None
        source.asset = MagicMock(file_path=None, url="https://example.com/post")
        source.save = AsyncMock()
        source.get_embedded_chunks = AsyncMock(return_value=0)
        # Denormalized embedding progress fields (migration 27) must be plain
        # values, they flow straight into the response model.
        source.embedding_status = "completed"
        source.embedding_command = None
        source.embedding_error = None
        source.total_chunks = 0
        source.embedded_chunks = 0
        mock_get.return_value = source

        # The corrected query returns the linked notebook(s)
        mock_repo_query.return_value = ["notebook:1"]
        # submit_command_job returns str(RecordID), which already includes the
        # "command:" table prefix.
        mock_submit.return_value = "command:123"

        response = client.post("/api/sources/source:1/retry")

        assert response.status_code == 200
        # Regression guard: must query the reference edge by its `in` column
        called_query = mock_repo_query.await_args.args[0]
        assert "WHERE in = $source_id" in called_query
        assert "SELECT VALUE out FROM reference" in called_query
        # Regression guard: command_id must not be double-prefixed
        # (`command:command:…`), which previously raised a 500 on save.
        assert "command:command" not in str(source.command)
        assert str(source.command).count("command:") == 1
        assert str(source.command).startswith("command:")

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_retry_400_only_when_truly_unlinked(
        self, mock_get, mock_repo_query, client
    ):
        source = MagicMock()
        source.id = "source:1"
        source.command = None
        mock_get.return_value = source
        mock_repo_query.return_value = []  # genuinely no notebooks

        response = client.post("/api/sources/source:1/retry")

        assert response.status_code == 400
        assert "not associated with any notebooks" in response.json()["detail"]


class TestSourceEmbeddingStatusPayload:
    """The /status and detail endpoints must surface the denormalized
    embedding progress (migration 27) without count() re-queries, and must
    never 500 on sources created before the migration."""

    @staticmethod
    def _source_with(**embedding_fields):
        source = MagicMock()
        source.id = "source:1"
        source.command = "command:1"
        source.title = "My source"
        source.topics = []
        source.full_text = "content"
        source.asset = MagicMock(file_path=None, url=None)
        source.save = AsyncMock()
        source.get_status = AsyncMock(return_value="running")
        source.get_processing_progress = AsyncMock(return_value={"status": "running"})
        source.get_embedded_chunks = AsyncMock(return_value=0)
        # Legacy-safe defaults, overridden per test
        source.embedding_status = None
        source.embedding_command = None
        source.embedding_error = None
        source.total_chunks = None
        source.embedded_chunks = None
        for key, value in embedding_fields.items():
            setattr(source, key, value)
        return source

    @staticmethod
    def _command_row(status="running"):
        # The status endpoint reads the raw command row via repo_query.
        return {
            "id": "command:1",
            "status": status,
            "args": {"embed": True, "transformations": []},
            "error_message": None,
            "result": None,
        }

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_status_returns_running_with_progress(self, mock_get, mock_repo_query, client):
        """T2-1: while embedding runs, the status endpoint reports the live
        progress the UI progress bar renders."""
        source = self._source_with(
            embedding_status="running",
            embedded_chunks=3,
            total_chunks=5,
            embedding_command="command:9",
        )
        mock_get.return_value = source
        mock_repo_query.return_value = [self._command_row()]

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        embedding = response.json()["embedding"]
        assert embedding["status"] == "running"
        assert embedding["embedded_chunks"] == 3
        assert embedding["total_chunks"] == 5
        assert embedding["command_id"] == "command:9"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_status_truncates_error_text(self, mock_get, mock_repo_query, client):
        """T2-2: a raw provider traceback must not leak to the API response."""
        source = self._source_with(
            embedding_status="failed",
            embedded_chunks=2,
            embedding_error="e" * 500,
        )
        mock_get.return_value = source
        mock_repo_query.return_value = [self._command_row()]

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        embedding = response.json()["embedding"]
        assert embedding["status"] == "failed"
        # _truncate_error caps at 200 chars (+ the single trailing ellipsis).
        assert len(embedding["error"]) <= 201
        assert embedding["error"] == "e" * 200 + "…"

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_legacy_source_without_fields_derives_not_embedded(self, mock_get, client):
        """T2-3: sources predating migration 27 (no embedding fields at all)
        must derive a status instead of erroring."""
        source = self._source_with(embedding_status=None, embedded_chunks=None)
        source.command = None  # legacy: no async command either
        mock_get.return_value = source

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        assert response.json()["embedding"]["status"] == "not_embedded"

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_legacy_source_with_chunks_derives_completed(self, mock_get, client):
        """T2-3: a pre-migration source that already has chunks counts as completed."""
        source = self._source_with(embedding_status=None, embedded_chunks=12)
        mock_get.return_value = source

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        embedding = response.json()["embedding"]
        assert embedding["status"] == "completed"
        assert embedding["embedded_chunks"] == 12

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_unknown_status_string_maps_to_not_embedded(self, mock_get, mock_repo_query, client):
        """Defensive: a garbage status value must not break the response model
        (its Literal rejects unknown strings)."""
        source = self._source_with(embedding_status="bogus-value")
        mock_get.return_value = source
        mock_repo_query.return_value = [self._command_row()]

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        assert response.json()["embedding"]["status"] == "not_embedded"

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_detail_returns_embedding_payload_without_count_query(
        self, mock_get, client
    ):
        """T2-4: the polling/detail path reads only the denormalized counter -
        it must not run a count() against source_embedding."""
        source = self._source_with(
            embedding_status="running",
            embedded_chunks=7,
            total_chunks=9,
        )
        mock_get.return_value = source

        with patch(
            "api.routers.sources.repo_query",
            new=AsyncMock(return_value=["notebook:1"]),
        ) as repo:
            response = client.get("/api/sources/source:1")

        assert response.status_code == 200
        body = response.json()
        assert body["embedding"]["status"] == "running"
        assert body["embedded_chunks"] == 7
        # Only the notebook association query may run - no chunk counting.
        for call in repo.await_args_list:
            assert "count()" not in call.args[0]
        assert source.get_embedded_chunks.await_count == 0


class TestGetSourceNotFound:
    """GET /sources/{id} must return 404 (not 500) for a missing/deleted source.
    `Source.get()` raises NotFoundError rather than returning None, so the handler
    must map it to 404 instead of catching it in its generic `except`."""

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_get_missing_source_returns_404(self, mock_get, client):
        from open_notebook.exceptions import NotFoundError

        mock_get.side_effect = NotFoundError("source with id source:gone not found")

        response = client.get("/api/sources/source:gone")

        assert response.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


class TestTitleSortUsesAlias:
    """Regression for sort_by=title returning a 500 (v1.11 release testing).

    source.title carries a SEARCH (BM25) index and SurrealDB's planner
    fails ORDER BY on such a column with "No iterator has been found".
    The router must therefore sort by the computed `title_sort` alias,
    never by the raw indexed column.
    """

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_sort_by_title_orders_by_alias(self, mock_query, client):
        mock_query.return_value = []

        response = client.get("/api/sources?sort_by=title")

        assert response.status_code == 200
        query = mock_query.call_args[0][0]
        assert "ORDER BY title_sort" in query
        assert "AS title_sort" in query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_all_sort_fields_return_200(self, mock_query, client):
        mock_query.return_value = []
        for field in ["type", "title", "created", "updated", "insights_count", "embedded"]:
            response = client.get(f"/api/sources?sort_by={field}")
            assert response.status_code == 200, f"sort_by={field}"

    def test_invalid_sort_field_returns_400(self, client):
        response = client.get("/api/sources?sort_by=bogus")
        assert response.status_code == 400


class TestEmbeddingStatusBackfillFallback:
    """Sources marked completed by an early backfill (migration 27 without
    counters) must not surface '0 chunks embedded' - the status endpoint
    resolves the real chunk count for that shape."""

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_completed_without_counters_resolves_chunk_count(self, mock_get, client):
        source = MagicMock()
        source.command = None  # legacy branch: no command status lookup
        source.embedding_status = "completed"
        source.embedding_error = None
        source.embedding_command = None
        source.embedded_chunks = None  # backfill wrote status only
        source.total_chunks = None
        source.get_embedded_chunks = AsyncMock(return_value=42)
        mock_get.return_value = source

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        embedding = response.json()["embedding"]
        assert embedding["status"] == "completed"
        assert embedding["embedded_chunks"] == 42
        source.get_embedded_chunks.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    async def test_completed_with_counters_skips_count_query(self, mock_get, client):
        """Rows with real counters never pay the count() fallback."""
        source = MagicMock()
        source.command = None
        source.embedding_status = "completed"
        source.embedding_error = None
        source.embedding_command = None
        source.embedded_chunks = 7
        source.total_chunks = 7
        source.get_embedded_chunks = AsyncMock()
        mock_get.return_value = source

        response = client.get("/api/sources/source:1/status")

        assert response.status_code == 200
        embedding = response.json()["embedding"]
        assert embedding["status"] == "completed"
        assert embedding["embedded_chunks"] == 7
        source.get_embedded_chunks.assert_not_awaited()


class TestSourceTitlesEndpoint:
    """GET /sources/titles resolves display titles for chat references."""

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_batch_with_filename_fallback(self, mock_repo_query, client):
        mock_repo_query.return_value = [
            {"id": "source:abc", "title": "My Paper", "asset": None},
            {
                "id": "source:def",
                "title": None,
                "asset": {"file_path": "/data/uploads/report.pdf", "url": None},
            },
        ]

        response = client.get("/api/sources/titles?ids=abc,def")

        assert response.status_code == 200
        data = response.json()
        assert data == [
            {"id": "source:abc", "title": "My Paper"},
            {"id": "source:def", "title": "report.pdf"},
        ]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_skip_missing_ids(self, mock_repo_query, client):
        mock_repo_query.return_value = [
            {"id": "source:abc", "title": "Found", "asset": None},
        ]

        response = client.get("/api/sources/titles?ids=abc,gone")

        assert response.status_code == 200
        assert response.json() == [{"id": "source:abc", "title": "Found"}]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_null_when_no_title_and_no_asset(self, mock_repo_query, client):
        mock_repo_query.return_value = [
            {"id": "source:abc", "title": None, "asset": None},
        ]

        response = client.get("/api/sources/titles?ids=abc")

        assert response.status_code == 200
        assert response.json() == [{"id": "source:abc", "title": None}]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_reject_more_than_50_ids(self, mock_repo_query, client):
        ids = ",".join(f"id{i}" for i in range(51))

        response = client.get(f"/api/sources/titles?ids={ids}")

        assert response.status_code == 400
        mock_repo_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_accept_exactly_50_ids(self, mock_repo_query, client):
        mock_repo_query.return_value = [
            {"id": f"source:id{i}", "title": f"Title {i}", "asset": None}
            for i in range(50)
        ]
        ids = ",".join(f"id{i}" for i in range(50))

        response = client.get(f"/api/sources/titles?ids={ids}")

        assert response.status_code == 200
        assert len(response.json()) == 50
        assert len(mock_repo_query.await_args.args[1]["ids"]) == 50

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_reject_empty_id_list(self, mock_repo_query, client):
        response = client.get("/api/sources/titles?ids=,")

        assert response.status_code == 400
        mock_repo_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_reject_malformed_ids_with_colons(self, mock_repo_query, client):
        """note:xyz / source:a:b must map to 400, not a RecordID ValueError 500."""
        for bad_ids in ("note:xyz", "abc,source:a:b", "source:"):
            response = client.get(f"/api/sources/titles?ids={bad_ids}")

            assert response.status_code == 400, bad_ids
        mock_repo_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_titles_use_parameterized_query_with_record_ids(
        self, mock_repo_query, client
    ):
        mock_repo_query.return_value = []

        response = client.get("/api/sources/titles?ids=abc,source:def")

        assert response.status_code == 200
        called_query = mock_repo_query.await_args.args[0]
        # Parameterized: ids only ever reach the query through $ids
        assert "WHERE id IN $ids" in called_query
        assert "abc" not in called_query and "def" not in called_query
        bound_ids = mock_repo_query.await_args.args[1]["ids"]
        # Bare chat-reference ids get the source: table prefix, existing
        # full record ids are passed through unchanged.
        assert sorted(str(r) for r in bound_ids) == ["source:abc", "source:def"]
