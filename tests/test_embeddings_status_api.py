"""Tests for GET /api/embeddings/status (group-by normalization)."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestEmbeddingStatusEndpoint:
    @pytest.mark.asyncio
    @patch("api.routers.embedding_rebuild.repo_query", new_callable=AsyncMock)
    async def test_group_by_normalization(self, repo_query, client):
        repo_query.return_value = [
            {"embedding_status": "completed", "c": 2},
            {"embedding_status": "failed", "c": 1},
            {"embedding_status": "partial", "c": 1},
            {"embedding_status": "queued", "c": 1},
            {"embedding_status": "running", "c": 1},
            {"embedding_status": None, "c": 3},
        ]

        response = client.get("/api/embeddings/status")

        assert response.status_code == 200
        body = response.json()
        assert body["completed"] == 2
        assert body["queued"] == 1
        assert body["running"] == 1
        assert body["failed"] == 1
        assert body["partial"] == 1
        assert body["not_embedded"] == 3
        # pending = not_embedded + failed + partial
        assert body["pending"] == 5
        assert body["total_sources"] == 9

        query = repo_query.await_args.args[0]
        assert "GROUP BY embedding_status" in query
        assert "string::trim(full_text)" in query

    @pytest.mark.asyncio
    @patch("api.routers.embedding_rebuild.repo_query", new_callable=AsyncMock)
    async def test_empty_database_returns_all_zero(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/embeddings/status")

        assert response.status_code == 200
        assert response.json() == {
            "total_sources": 0,
            "completed": 0,
            "queued": 0,
            "running": 0,
            "failed": 0,
            "partial": 0,
            "not_embedded": 0,
            "pending": 0,
        }

    @pytest.mark.asyncio
    @patch("api.routers.embedding_rebuild.repo_query", new_callable=AsyncMock)
    async def test_unknown_status_counts_as_not_embedded(self, repo_query, client):
        repo_query.return_value = [{"embedding_status": "some-future-status", "c": 4}]

        body = client.get("/api/embeddings/status").json()

        assert body["not_embedded"] == 4
        assert body["pending"] == 4
        assert body["total_sources"] == 4

    @pytest.mark.asyncio
    @patch("api.routers.embedding_rebuild.repo_query", new_callable=AsyncMock)
    async def test_null_group_key_counts_as_not_embedded(self, repo_query, client):
        repo_query.return_value = [{"embedding_status": None, "c": 7}]

        body = client.get("/api/embeddings/status").json()

        assert body["not_embedded"] == 7
        assert body["pending"] == 7

    @pytest.mark.asyncio
    @patch("api.routers.embedding_rebuild.repo_query", new_callable=AsyncMock)
    async def test_legacy_aliased_row_key_still_normalized(self, repo_query, client):
        """Tolerate the aliased row shape in case the driver shape shifts."""
        repo_query.return_value = [{"s": "completed", "c": 5}]

        body = client.get("/api/embeddings/status").json()

        assert body["completed"] == 5
        assert body["pending"] == 0
        assert body["total_sources"] == 5
