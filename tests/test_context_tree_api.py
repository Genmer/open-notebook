"""Tests for GET /notebooks/{id}/context-tree (chat context picker feed).

repo_query is faked with seeded rows; the endpoint assembles folder groups,
memberships and notebook sources in one payload.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

NOTEBOOK_ID = "notebook:n1"
VIEW_ID = "source_view:v1"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _seed_rows():
    return {
        "groups": [
            {"id": "source_group:g1", "name": "论文", "parent_id": None},
            {"id": "source_group:g2", "name": "范文", "parent_id": "source_group:g1"},
        ],
        "members": [
            {"source_id": "source:s1", "group_id": "source_group:g1"},
            {"source_id": "source:s2", "group_id": "source_group:g2"},
            {"source_id": "source:other", "group_id": "source_group:g1"},
        ],
        "source_ids": ["source:s1", "source:s2"],
        "sources": [
            {
                "id": "source:s2",
                "title": "范文 A",
                "updated": "2026-09-20",
                "embedded": False,
                "embedding_status": "failed",
            },
            {
                "id": "source:s1",
                "title": "宝典",
                "updated": "2026-09-21",
                "embedded": True,
                "embedding_status": "completed",
            },
        ],
        "insights": [{"source": "source:s1", "cnt": 3}],
    }


class TestContextTree:
    def test_tree_with_view_groups_and_membership_filtering(self, client):
        rows = _seed_rows()
        source_queries: list[str] = []

        async def repo_query(sql, params=None):
            if "FROM source_group WHERE source_view" in sql:
                return rows["groups"]
            if "FROM source_group_member" in sql:
                return rows["members"]
            if "FROM reference" in sql:
                return rows["source_ids"]
            if "FROM source_insight" in sql:
                return rows["insights"]
            if "FROM source WHERE" in sql:
                source_queries.append(sql)
                return rows["sources"]
            raise AssertionError(f"Unexpected query: {sql[:120]!r}")

        with patch("api.routers.notebooks.repo_query", new=repo_query), patch(
            "api.routers.notebooks.Notebook"
        ) as mock_notebook:
            mock_notebook.get = AsyncMock(return_value=object())
            response = client.get(
                f"/api/notebooks/{NOTEBOOK_ID}/context-tree?view_id={VIEW_ID}"
            )

        assert response.status_code == 200
        body = response.json()

        assert [g["name"] for g in body["groups"]] == ["论文", "范文"]
        assert body["groups"][1]["parent_id"] == "source_group:g1"

        # source:other belongs to a folder but not to this notebook: filtered.
        assert [m["source_id"] for m in body["memberships"]] == [
            "source:s1",
            "source:s2",
        ]

        assert [s["id"] for s in body["sources"]] == ["source:s2", "source:s1"]
        assert body["sources"][1]["insights_count"] == 3
        assert body["sources"][0]["insights_count"] == 0

        # Embed-state fields ride along with every source row: the SQL derives
        # `embedded` from the source_embedding table (no bool column on source),
        # and embedding_status reflects each source's real state.
        assert len(source_queries) == 1
        assert "AS embedded" in source_queries[0]
        assert "source_embedding" in source_queries[0]
        assert "embedding_status" in source_queries[0]
        # s2 failed embedding -> unembedded with 'failed' status
        assert body["sources"][0]["embedded"] is False
        assert body["sources"][0]["embedding_status"] == "failed"
        # s1 embedded -> true with 'completed' status
        assert body["sources"][1]["embedded"] is True
        assert body["sources"][1]["embedding_status"] == "completed"

    def test_tree_without_view_has_no_groups(self, client):
        rows = _seed_rows()

        async def repo_query(sql, params=None):
            if "FROM reference" in sql:
                return rows["source_ids"]
            if "FROM source_insight" in sql:
                return []
            if "FROM source WHERE" in sql:
                return rows["sources"][:1]
            raise AssertionError(f"Unexpected query: {sql[:120]!r}")

        with patch("api.routers.notebooks.repo_query", new=repo_query), patch(
            "api.routers.notebooks.Notebook"
        ) as mock_notebook:
            mock_notebook.get = AsyncMock(return_value=object())
            response = client.get(f"/api/notebooks/{NOTEBOOK_ID}/context-tree")

        assert response.status_code == 200
        body = response.json()
        assert body["groups"] == []
        assert body["memberships"] == []
        assert len(body["sources"]) == 1
        # Embed-state passthrough without a view: s2 is the failed/unembedded one
        assert body["sources"][0]["embedded"] is False
        assert body["sources"][0]["embedding_status"] == "failed"

    def test_empty_notebook_returns_groups_only(self, client):
        async def repo_query(sql, params=None):
            if "FROM source_group WHERE source_view" in sql:
                return []
            if "FROM reference" in sql:
                return []
            raise AssertionError(f"Unexpected query: {sql[:120]!r}")

        with patch("api.routers.notebooks.repo_query", new=repo_query), patch(
            "api.routers.notebooks.Notebook"
        ) as mock_notebook:
            mock_notebook.get = AsyncMock(return_value=object())
            response = client.get(
                f"/api/notebooks/{NOTEBOOK_ID}/context-tree?view_id={VIEW_ID}"
            )

        assert response.status_code == 200
        body = response.json()
        assert body["sources"] == []
        assert body["memberships"] == []
