"""Tests for the source grouping API (views + groups + membership), migration
29 and the grouping filter params on GET /sources. DB access is stubbed at
repo_query."""

import os
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.command_service import CommandService
from api.source_group_service import (
    _assert_move_is_valid,
    _clone_physical_file,
    _copy_title,
    copy_sources_to_group,
    move_members_to_group,
)
from open_notebook.domain.notebook import Asset, Source
from open_notebook.domain.source_grouping import (
    MAX_GROUP_DEPTH,
    SourceGroup,
    SourceView,
    collect_subtree_ids,
    compute_group_depth,
    compute_subtree_height,
)
from open_notebook.exceptions import InvalidInputError, NotFoundError

MIGRATIONS_DIR = Path("open_notebook/database/migrations")
VIEW_ID = "source_view:v1"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _group_row(group_id: str, parent: str = None, name: str = None, view: str = VIEW_ID):
    return {
        "id": group_id,
        "source_view": view,
        "name": name or group_id.split(":")[1],
        "parent": parent,
        "created": "2026-01-01T00:00:00",
        "updated": "2026-01-01T00:00:00",
    }


def _view(group_id_view: str = VIEW_ID, name: str = "Custom", view_type: str = "custom"):
    return SourceView(id=group_id_view, name=name, view_type=view_type)


async def _capture_save(self):
    if self.id is None:
        table = self.__class__.table_name
        self.id = f"{table}:new1"
    if self.created is None:
        self.created = datetime(2026, 1, 1)
    if self.updated is None:
        self.updated = datetime(2026, 1, 1)


class TestMigration29:
    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "29.surrealql").is_file()
        assert (MIGRATIONS_DIR / "29_down.surrealql").is_file()

    def test_manager_registers_migration_29(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 29
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "source_group_member" in manager.up_migrations[28].sql
        assert "REMOVE EVENT" in manager.down_migrations[28].sql

    def test_up_defines_tables_relation_and_cleanup_event(self):
        sql = (MIGRATIONS_DIR / "29.surrealql").read_text()
        assert "DEFINE TABLE IF NOT EXISTS source_view SCHEMAFULL" in sql
        assert "DEFINE TABLE IF NOT EXISTS source_group SCHEMAFULL" in sql
        assert "TYPE RELATION" in sql
        assert "FROM source TO source_group" in sql
        assert "DEFINE EVENT IF NOT EXISTS source_membership_cleanup ON TABLE source" in sql

    def test_down_removes_event_then_tables_deepest_first(self):
        lines = [
            line
            for line in (MIGRATIONS_DIR / "29_down.surrealql").read_text().splitlines()
            if line.strip()
        ]
        assert lines[0].startswith("REMOVE EVENT")
        assert lines[1].endswith("source_group_member;")
        assert lines[2].endswith("source_group;")
        assert lines[3].endswith("source_view;")


class TestGroupTreeHelpers:
    def _chain(self):
        return [
            SourceGroup(**_group_row("source_group:g1")),
            SourceGroup(**_group_row("source_group:g2", parent="source_group:g1")),
            SourceGroup(**_group_row("source_group:g3", parent="source_group:g2")),
        ]

    def test_collect_subtree_ids_includes_self_and_descendants(self):
        groups = self._chain()
        assert collect_subtree_ids(groups, "source_group:g2") == [
            "source_group:g2",
            "source_group:g3",
        ]
        assert len(collect_subtree_ids(groups, "source_group:g1")) == 3

    def test_depth_and_height(self):
        groups = self._chain()
        assert compute_group_depth(groups, "source_group:g3") == 3
        assert compute_group_depth(groups, "source_group:g1") == 1
        assert compute_subtree_height(groups, "source_group:g1") == 3
        assert compute_subtree_height(groups, "source_group:g3") == 1

    def test_move_pushing_subtree_past_depth_rejected(self):
        groups = [
            SourceGroup(**_group_row("source_group:n1")),
            SourceGroup(**_group_row("source_group:n2", parent="source_group:n1")),
            SourceGroup(**_group_row("source_group:n3", parent="source_group:n2")),
            SourceGroup(**_group_row("source_group:n4", parent="source_group:n3")),
            SourceGroup(**_group_row("source_group:r")),
            SourceGroup(**_group_row("source_group:x", parent="source_group:r")),
            SourceGroup(**_group_row("source_group:y", parent="source_group:x")),
        ]
        # Moving r (height 3) under n4 would put y at depth 7
        with pytest.raises(InvalidInputError):
            _assert_move_is_valid(groups, "source_group:r", "source_group:n4")
        # Under n2 the same subtree tops out at depth 5 - allowed
        _assert_move_is_valid(groups, "source_group:r", "source_group:n2")

    def test_move_under_own_descendant_rejected(self):
        groups = self._chain()
        with pytest.raises(InvalidInputError):
            _assert_move_is_valid(groups, "source_group:g1", "source_group:g3")

    def test_self_parent_rejected(self):
        groups = self._chain()
        with pytest.raises(InvalidInputError):
            _assert_move_is_valid(groups, "source_group:g1", "source_group:g1")

    def test_valid_move_passes(self):
        groups = self._chain()
        groups.append(SourceGroup(**_group_row("source_group:x")))
        _assert_move_is_valid(groups, "source_group:x", "source_group:g1")


class TestViewsApi:
    @pytest.mark.asyncio
    @patch("api.source_group_service.ensure_default_views", new_callable=AsyncMock)
    @patch.object(SourceView, "get_all", new_callable=AsyncMock)
    async def test_list_views_marks_defaults_and_creates_them(
        self, mock_get_all, mock_ensure, client
    ):
        mock_get_all.return_value = [
            SourceView(id="source_view:custom1", name="Custom", view_type="custom"),
            _view("source_view:ai_content", "AI Content", "ai_content"),
        ]

        response = client.get("/api/views")

        assert response.status_code == 200
        views = response.json()
        by_id = {v["id"]: v for v in views}
        assert by_id["source_view:ai_content"]["is_default"] is True
        assert by_id["source_view:ai_content"]["view_type"] == "ai_content"
        assert by_id["source_view:custom1"]["is_default"] is False
        mock_ensure.assert_awaited_once()

    @pytest.mark.asyncio
    @patch.object(SourceView, "save", autospec=True, side_effect=_capture_save)
    async def test_create_view_strips_name_returns_201(self, _mock_save, client):
        response = client.post(
            "/api/views", json={"name": "  Research  ", "view_type": "custom"}
        )

        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Research"
        assert body["view_type"] == "custom"
        assert body["is_default"] is False

    @pytest.mark.asyncio
    async def test_create_view_rejects_blank_name(self, client):
        response = client.post("/api/views", json={"name": "   ", "view_type": "custom"})
        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_update_missing_view_returns_404(self, mock_get, client):
        mock_get.side_effect = NotFoundError("source_view not found")

        response = client.patch("/api/views/source_view:gone", json={"name": "X"})

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceView, "save", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_update_view_strips_name(self, mock_get, _mock_save, client):
        mock_get.return_value = _view()

        response = client.patch(f"/api/views/{VIEW_ID}", json={"name": " Renamed "})

        assert response.status_code == 200
        assert response.json()["name"] == "Renamed"

    @pytest.mark.asyncio
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_default_view_returns_400(self, repo_query, client):
        response = client.delete("/api/views/source_view:ai_content")

        assert response.status_code == 400
        repo_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_delete_custom_view_removes_groups_and_memberships(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = _view()
        repo_query.side_effect = [
            ["source_group:g1", "source_group:g2"],  # group ids of the view
            [],  # DELETE memberships
            [],  # DELETE groups
            [],  # DELETE view
        ]

        response = client.delete(f"/api/views/{VIEW_ID}")

        assert response.status_code == 200
        assert response.json() == {"deleted_groups": 2}
        queries = [call.args[0] for call in repo_query.await_args_list]
        assert any("DELETE source_group_member" in q for q in queries)
        assert any("DELETE source_group WHERE source_view" in q for q in queries)

    @pytest.mark.asyncio
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_delete_missing_view_returns_404(self, mock_get, _repo, client):
        mock_get.side_effect = NotFoundError("source_view not found")

        response = client.delete("/api/views/source_view:gone")

        assert response.status_code == 404


class TestGroupsApi:
    @pytest.mark.asyncio
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_list_groups_maps_source_count(self, mock_get, repo_query, client):
        mock_get.return_value = _view()
        repo_query.return_value = [
            {**_group_row("source_group:g1"), "source_count": 3},
            {
                **_group_row("source_group:g2", parent="source_group:g1"),
                "source_count": 0,
            },
        ]

        response = client.get(f"/api/views/{VIEW_ID}/groups")

        assert response.status_code == 200
        groups = response.json()
        assert groups[0] == {
            "id": "source_group:g1",
            "view_id": VIEW_ID,
            "name": "g1",
            "parent_id": None,
            "source_count": 3,
            "created": "2026-01-01T00:00:00",
            "updated": "2026-01-01T00:00:00",
        }
        assert groups[1]["parent_id"] == "source_group:g1"
        assert groups[1]["source_count"] == 0
        # One query with a correlated count - no N+1 per group
        assert repo_query.await_count == 1
        query = repo_query.await_args.args[0]
        assert "source_group_member WHERE out = $parent.id" in query
        assert "source_view = $view" in query

    @pytest.mark.asyncio
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_missing_view_returns_404(self, mock_get, client):
        mock_get.side_effect = NotFoundError("source_view not found")

        response = client.post(
            "/api/views/source_view:zzz/groups", json={"name": "New"}
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_missing_parent_returns_404(
        self, mock_view_get, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        mock_group_get.side_effect = NotFoundError("source_group not found")

        response = client.post(
            f"/api/views/{VIEW_ID}/groups",
            json={"name": "New", "parent_id": "source_group:gone"},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_duplicate_under_parent_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        repo_query.return_value = [
            _group_row("source_group:p1", name="Parent"),
            _group_row("source_group:c1", parent="source_group:p1", name="Child"),
        ]
        mock_group_get.return_value = SourceGroup(
            **_group_row("source_group:p1", name="Parent")
        )

        response = client.post(
            f"/api/views/{VIEW_ID}/groups",
            json={"name": "Child", "parent_id": "source_group:p1"},
        )

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_root_duplicate_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        repo_query.return_value = [_group_row("source_group:gA", name="A")]

        response = client.post(f"/api/views/{VIEW_ID}/groups", json={"name": "A"})

        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_beyond_depth_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        chain = [_group_row("source_group:g1")]
        for i in range(2, MAX_GROUP_DEPTH + 1):
            chain.append(_group_row(f"source_group:g{i}", parent=f"source_group:g{i-1}"))
        repo_query.return_value = chain
        mock_group_get.return_value = SourceGroup(
            **_group_row(f"source_group:g{MAX_GROUP_DEPTH}")
        )

        response = client.post(
            f"/api/views/{VIEW_ID}/groups",
            json={"name": "Deep", "parent_id": f"source_group:g{MAX_GROUP_DEPTH}"},
        )

        assert response.status_code == 400
        assert "depth" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "save", autospec=True, side_effect=_capture_save)
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_create_group_returns_201(
        self, mock_view_get, repo_query, mock_group_get, _mock_save, client
    ):
        mock_view_get.return_value = _view()
        repo_query.return_value = []
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))

        response = client.post(
            f"/api/views/{VIEW_ID}/groups",
            json={"name": "New", "parent_id": "source_group:g1"},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["id"] == "source_group:new1"
        assert body["parent_id"] == "source_group:g1"
        assert body["source_count"] == 0


class TestUpdateGroupApi:
    @staticmethod
    def _chain_rows():
        rows = [_group_row("source_group:g1")]
        for i in (2, 3):
            rows.append(_group_row(f"source_group:g{i}", parent=f"source_group:g{i-1}"))
        return rows

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_move_under_descendant_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        repo_query.return_value = self._chain_rows()

        async def get_by_id(group_id):
            return SourceGroup(**_group_row(group_id))

        mock_group_get.side_effect = get_by_id

        response = client.patch(
            "/api/groups/source_group:g1",
            json={"parent_id": "source_group:g3"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_self_parent_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        repo_query.return_value = self._chain_rows()

        async def get_by_id(group_id):
            return SourceGroup(**_group_row(group_id))

        mock_group_get.side_effect = get_by_id

        response = client.patch(
            "/api/groups/source_group:g1",
            json={"parent_id": "source_group:g1"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_move_pushing_subtree_past_depth_returns_400(
        self, mock_view_get, repo_query, mock_group_get, client
    ):
        mock_view_get.return_value = _view()
        # n1..n4 form a chain at depth 1-4; r is a root with child x (height 2)
        rows = [_group_row("source_group:n1")]
        for i in (2, 3, 4):
            rows.append(_group_row(f"source_group:n{i}", parent=f"source_group:n{i-1}"))
        rows.append(_group_row("source_group:r"))
        rows.append(_group_row("source_group:x", parent="source_group:r"))
        repo_query.return_value = rows

        async def get_by_id(group_id):
            return SourceGroup(**_group_row(group_id))

        mock_group_get.side_effect = get_by_id

        response = client.patch(
            "/api/groups/source_group:r",
            json={"parent_id": "source_group:n4"},
        )

        assert response.status_code == 400
        assert "depth" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "save", new_callable=AsyncMock)
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_move_to_new_parent_returns_200(
        self, mock_view_get, repo_query, mock_group_get, _mock_save, client
    ):
        mock_view_get.return_value = _view()
        rows = self._chain_rows()
        rows.append(_group_row("source_group:x"))
        repo_query.side_effect = [
            rows,
            [
                {
                    **_group_row("source_group:x", parent="source_group:g1"),
                    "source_count": 0,
                }
            ],
        ]

        async def get_by_id(group_id):
            return SourceGroup(**_group_row(group_id))

        mock_group_get.side_effect = get_by_id

        response = client.patch(
            "/api/groups/source_group:x",
            json={"parent_id": "source_group:g1"},
        )

        assert response.status_code == 200
        assert response.json()["parent_id"] == "source_group:g1"

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "save", new_callable=AsyncMock)
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_rename_to_sibling_name_returns_400(
        self, mock_view_get, repo_query, mock_group_get, _mock_save, client
    ):
        mock_view_get.return_value = _view()
        repo_query.side_effect = [
            [
                _group_row("source_group:gA", name="A"),
                _group_row("source_group:gB", name="B"),
            ]
        ]

        async def get_by_id(group_id):
            return SourceGroup(**_group_row(group_id))

        mock_group_get.side_effect = get_by_id

        response = client.patch(
            "/api/groups/source_group:gB",
            json={"name": "A"},
        )

        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    async def test_update_missing_group_returns_404(self, mock_group_get, client):
        mock_group_get.side_effect = NotFoundError("source_group not found")

        response = client.patch("/api/groups/source_group:gone", json={"name": "X"})

        assert response.status_code == 404


class TestDeleteGroupApi:
    def _rows(self):
        return [
            _group_row("source_group:g1"),
            _group_row("source_group:g2", parent="source_group:g1"),
        ]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_group_ungroups_sources(self, repo_query, mock_group_get, client):
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))
        repo_query.side_effect = [self._rows(), []]

        response = client.delete("/api/groups/source_group:g1")

        assert response.status_code == 200
        assert response.json() == {"deleted_groups": 2, "deleted_sources": 0}
        # memberships + groups go in a single multi-statement transaction
        assert repo_query.await_count == 2
        transaction = repo_query.await_args_list[1].args[0]
        assert "DELETE source_group_member WHERE out IN $subtree" in transaction
        assert "DELETE source_group WHERE id IN $subtree" in transaction

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch.object(Source, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_group_cascade_deletes_sources(
        self, repo_query, mock_source_get, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))
        source = MagicMock()
        source.delete = AsyncMock(return_value=True)
        mock_source_get.return_value = source
        repo_query.side_effect = [
            self._rows(),
            ["source:s1", "source:s2"],
            [],  # membership sweep
            [],  # group delete
        ]

        response = client.delete(
            "/api/groups/source_group:g1?delete_sources=true"
        )

        assert response.status_code == 200
        assert response.json() == {"deleted_groups": 2, "deleted_sources": 2}
        assert source.delete.await_count == 2

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    async def test_delete_missing_group_returns_404(self, mock_group_get, client):
        mock_group_get.side_effect = NotFoundError("source_group not found")

        response = client.delete("/api/groups/source_group:gone")

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch.object(Source, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_cascade_delete_resumes_after_midway_failure(
        self, repo_query, mock_source_get, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))
        ok_source = MagicMock()
        ok_source.delete = AsyncMock(return_value=True)
        broken_source = MagicMock()
        broken_source.delete = AsyncMock(side_effect=RuntimeError("db gone"))
        repo_query.side_effect = [
            self._rows(),  # attempt 1: subtree
            ["source:s1", "source:s2"],  # attempt 1: members
            self._rows(),  # attempt 2: subtree
            ["source:s1", "source:s2"],  # attempt 2: members (s1 row may linger)
            [],  # attempt 2: membership sweep
            [],  # attempt 2: group delete
        ]
        mock_source_get.side_effect = [
            ok_source,
            broken_source,
            NotFoundError("source not found"),  # s1 already deleted on attempt 1
            ok_source,
        ]

        with pytest.raises(RuntimeError, match="db gone"):
            client.delete("/api/groups/source_group:g1?delete_sources=true")

        # Retry resumes: already-deleted sources are skipped, not double-counted
        response = client.delete("/api/groups/source_group:g1?delete_sources=true")

        assert response.status_code == 200
        assert response.json() == {"deleted_groups": 2, "deleted_sources": 1}
        assert ok_source.delete.await_count == 2
        assert broken_source.delete.await_count == 1
        # The retry still sweeps memberships and removes the groups
        assert "DELETE source_group_member" in repo_query.await_args_list[-2].args[0]
        assert "DELETE source_group WHERE" in repo_query.await_args_list[-1].args[0]


class TestSourcesFilterParams:
    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_group_id_filter_uses_member_subquery(self, repo_query, client):
        repo_query.return_value = []

        response = client.get(
            "/api/sources",
            params={"group_id": "source_group:g1", "view_id": VIEW_ID},
        )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert (
            "id IN (SELECT VALUE in FROM source_group_member WHERE out = $group_id)"
            in query
        )
        params = repo_query.await_args.args[1]
        assert str(params["group_id"]) == "source_group:g1"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_ungrouped_filter_uses_view_subquery(self, repo_query, client):
        repo_query.return_value = []

        response = client.get(
            "/api/sources", params={"ungrouped": "true", "view_id": VIEW_ID}
        )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "id NOT IN (SELECT VALUE in FROM source_group_member" in query
        assert "source_view = $view_id" in query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_source_type_filter_wraps_type_expression(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"source_type": "file"})

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "WHERE" in query
        assert "= $source_type" in query
        assert repo_query.await_args.args[1]["source_type"] == "file"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_invalid_source_type_rejected(self, repo_query, client):
        response = client.get("/api/sources", params={"source_type": "bogus"})

        assert response.status_code == 422

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_view_id_alone_adds_no_filter(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"view_id": VIEW_ID})

        assert response.status_code == 200
        # No top-level WHERE clause between the FROM source and ORDER BY
        after_from = repo_query.await_args.args[0].split("FROM source")[-1]
        assert "WHERE" not in after_from

    def test_group_id_with_ungrouped_rejected(self, client):
        response = client.get(
            "/api/sources",
            params={
                "group_id": "source_group:g1",
                "ungrouped": "true",
                "view_id": VIEW_ID,
            },
        )
        assert response.status_code == 400

    def test_group_id_without_view_id_rejected(self, client):
        response = client.get("/api/sources", params={"group_id": "source_group:g1"})
        assert response.status_code == 400

    def test_ungrouped_without_view_id_rejected(self, client):
        response = client.get("/api/sources", params={"ungrouped": "true"})
        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_filters_stack_with_notebook_filter(self, repo_query, client):
        repo_query.return_value = []

        with patch(
            "api.routers.sources.Notebook.get",
            new=AsyncMock(return_value=MagicMock()),
        ):
            response = client.get(
                "/api/sources",
                params={"notebook_id": "notebook:nb1", "source_type": "link"},
            )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "from reference where out=$notebook_id" in query
        assert "= $source_type" in query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_group_filter_stacks_with_notebook_filter(self, repo_query, client):
        repo_query.return_value = []

        with patch(
            "api.routers.sources.Notebook.get",
            new=AsyncMock(return_value=MagicMock()),
        ):
            response = client.get(
                "/api/sources",
                params={
                    "notebook_id": "notebook:nb1",
                    "group_id": "source_group:g1",
                    "view_id": VIEW_ID,
                },
            )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "source_group_member WHERE out = $group_id" in query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_matches_suffix_case_insensitive(
        self, repo_query, client
    ):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"file_ext": "PDF"})

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "asset.file_path != NONE" in query
        assert (
            "string::ends_with(string::lowercase(asset.file_path), $file_ext_suffix)"
            in query
        )
        assert repo_query.await_args.args[1]["file_ext_suffix"] == ".pdf"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_accepts_leading_dot(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"file_ext": ".Pdf"})

        assert response.status_code == 200
        assert repo_query.await_args.args[1]["file_ext_suffix"] == ".pdf"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_rejects_invalid_characters(self, repo_query, client):
        response = client.get("/api/sources", params={"file_ext": "pd f"})

        assert response.status_code == 400
        repo_query.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_rejects_too_long_extension(
        self, repo_query, client
    ):
        response = client.get("/api/sources", params={"file_ext": "a" * 11})

        assert response.status_code == 400

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_stacks_with_source_type(self, repo_query, client):
        repo_query.return_value = []

        response = client.get(
            "/api/sources", params={"source_type": "file", "file_ext": "pdf"}
        )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert "= $source_type" in query
        assert "string::ends_with(string::lowercase(asset.file_path)" in query
        params = repo_query.await_args.args[1]
        assert params["source_type"] == "file"
        assert params["file_ext_suffix"] == ".pdf"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_other_matches_extension_less_files(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"file_ext": "other"})

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        assert (
            "asset.file_path != NONE AND NOT (string::contains(asset.file_path, '.'))"
            in query
        )
        # 'other' is reserved for the no-suffix bucket — never a literal suffix
        assert "file_ext_suffix" not in repo_query.await_args.args[1]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_returns_empty_list_when_no_match(
        self, repo_query, client
    ):
        repo_query.return_value = []

        response = client.get("/api/sources", params={"file_ext": "pdf"})

        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_ext_filter_rejects_special_characters(
        self, repo_query, client
    ):
        for bad_ext in ("pd/f", "p*d", "ta.gz%", "pd;--"):
            response = client.get("/api/sources", params={"file_ext": bad_ext})
            assert response.status_code == 400, bad_ext
        repo_query.assert_not_awaited()


class TestSourceTypeGroupsApi:
    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_counts_buckets_and_orders_link_text_then_exts(
        self, repo_query, client
    ):
        repo_query.return_value = [
            {"url": "https://example.com"},
            {"file_path": "/uploads/a.pdf"},
            {"file_path": "/uploads/b.PDF"},
            {"file_path": "/uploads/c.docx"},
            {"file_path": "/uploads/noext"},
            {"url": None, "file_path": None},
        ]

        response = client.get("/api/sources/type-groups")

        assert response.status_code == 200
        assert [(g["key"], g["count"]) for g in response.json()] == [
            ("link", 1),
            ("text", 1),
            ("pdf", 2),
            ("docx", 1),
            ("other", 1),
        ]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_ext_ties_break_alphabetically(self, repo_query, client):
        repo_query.return_value = [
            {"file_path": "/uploads/a.pdf"},
            {"file_path": "/uploads/b.docx"},
            {"file_path": "/uploads/c.abc"},
        ]

        response = client.get("/api/sources/type-groups")

        assert [g["key"] for g in response.json()] == ["abc", "docx", "pdf"]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_empty_library_returns_empty_list(self, repo_query, client):
        repo_query.return_value = []

        response = client.get("/api/sources/type-groups")

        assert response.status_code == 200
        assert response.json() == []

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_file_path_takes_priority_over_url_matching_list_expression(
        self, repo_query, client
    ):
        # The list page expression classifies file_path-first; type-groups must agree
        repo_query.return_value = [
            {"url": "https://example.com/a", "file_path": "/uploads/a.pdf"},
        ]

        response = client.get("/api/sources/type-groups")

        assert [(g["key"], g["count"]) for g in response.json()] == [("pdf", 1)]

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_counts_sources_without_asset_as_text_like_list_expression(
        self, repo_query, client
    ):
        # The list expression classifies asset-less sources as text; the
        # aggregation query must not filter them out (real-DB smoke: 1 vs 7)
        repo_query.return_value = [None, None, {"file_path": "/uploads/a.pdf"}]

        response = client.get("/api/sources/type-groups")
        assert [(g["key"], g["count"]) for g in response.json()] == [
            ("text", 2),
            ("pdf", 1),
        ]

        query = repo_query.await_args.args[0]
        assert "WHERE asset != NONE" not in query

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_uses_lightweight_asset_only_projection(self, repo_query, client):
        repo_query.return_value = []

        client.get("/api/sources/type-groups")

        query = repo_query.await_args.args[0]
        assert query == "SELECT VALUE asset FROM source"

    @pytest.mark.asyncio
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_unusable_extensions_bucket_as_other(self, repo_query, client):
        # Timestamp/odd suffixes would 400 when clicked — they must not become keys
        repo_query.return_value = [
            {"file_path": "/uploads/dump.20240115235959"},
            {"file_path": "/uploads/photo.2024-05"},
            {"file_path": "/uploads/x.other"},
            {"file_path": "/uploads/a.pdf"},
        ]

        response = client.get("/api/sources/type-groups")

        assert [(g["key"], g["count"]) for g in response.json()] == [
            ("other", 3),
            ("pdf", 1),
        ]


GROUP_ID = "source_group:g1"
SOURCE_ID = "source:s1"


def _source_row(
    source_id: str = SOURCE_ID,
    title: str = "My Source",
    embedding_status: str = "completed",
) -> Source:
    return Source(
        id=source_id,
        title=title,
        topics=["t1"],
        full_text="body text",
        asset=Asset(file_path="/uploads/doc.pdf"),
        embedding_status=embedding_status,
        total_chunks=4 if embedding_status == "completed" else None,
        embedded_chunks=4 if embedding_status == "completed" else None,
    )


class TestMemberValidation:
    async def _call(self, source_ids):
        with patch.object(SourceGroup, "get", new_callable=AsyncMock) as mock_group:
            mock_group.return_value = SourceGroup(id=GROUP_ID, name="G", source_view=VIEW_ID)
            with patch("api.source_group_service.repo_query", new_callable=AsyncMock):
                await move_members_to_group(GROUP_ID, source_ids)

    @pytest.mark.asyncio
    async def test_empty_ids_rejected(self):
        with pytest.raises(InvalidInputError):
            await self._call([])

    @pytest.mark.asyncio
    async def test_over_100_ids_rejected(self):
        with pytest.raises(InvalidInputError):
            await self._call([f"source:s{i}" for i in range(101)])

    @pytest.mark.asyncio
    async def test_missing_source_rejected_with_id_list(self):
        with patch.object(SourceGroup, "get", new_callable=AsyncMock) as mock_group:
            mock_group.return_value = SourceGroup(id=GROUP_ID, name="G", source_view=VIEW_ID)
            with patch(
                "api.source_group_service.repo_query", new_callable=AsyncMock
            ) as repo_query:
                repo_query.return_value = ["source:s1"]

                with pytest.raises(InvalidInputError) as exc_info:
                    await move_members_to_group(
                        GROUP_ID, ["source:s1", "source:missing1", "source:missing2"]
                    )

        assert "source:missing1" in str(exc_info.value)
        assert "source:missing2" in str(exc_info.value)


class TestMoveMembersApi:
    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_move_replaces_old_membership_in_one_transaction(
        self, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.return_value = ["source:s1"]  # existence check

        response = client.post(
            f"/api/groups/{GROUP_ID}/members",
            json={"source_ids": [SOURCE_ID]},
        )

        assert response.status_code == 200
        assert response.json() == {"moved": 1}
        sql = repo_query.await_args_list[1].args[0]
        # Single-membership semantics: old edges into the view are deleted first
        assert "BEGIN TRANSACTION" in sql
        assert (
            "DELETE source_group_member WHERE in IN $ids AND out IN "
            "(SELECT VALUE id FROM source_group WHERE source_view = $view)" in sql
        )
        assert "FOR $sid IN $ids { RELATE $sid->source_group_member->$group; }" in sql
        assert "COMMIT TRANSACTION" in sql

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    async def test_move_missing_group_returns_404(self, mock_group_get, client):
        mock_group_get.side_effect = NotFoundError("source_group not found")

        response = client.post(
            "/api/groups/source_group:gone/members",
            json={"source_ids": [SOURCE_ID]},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_move_empty_body_list_returns_400(self, _repo, mock_group_get, client):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )

        response = client.post(
            f"/api/groups/{GROUP_ID}/members", json={"source_ids": []}
        )
        assert response.status_code == 400


class TestUngroupMembersApi:
    @pytest.mark.asyncio
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_ungroup_deletes_only_view_memberships(
        self, repo_query, mock_view_get, client
    ):
        mock_view_get.return_value = _view()
        repo_query.side_effect = [
            ["source:s1"],  # existence check
            ["source_group_member:m1", "source_group_member:m2"],  # DELETE result
        ]

        response = client.post(
            f"/api/views/{VIEW_ID}/ungroup",
            json={"source_ids": [SOURCE_ID]},
        )

        assert response.status_code == 200
        assert response.json() == {"removed": 2}
        sql = repo_query.await_args.args[0]
        # RETURN BEFORE is required for DELETE to report the removed rows
        assert "DELETE source_group_member WHERE in IN $ids" in sql
        assert "RETURN BEFORE" in sql
        assert "source_view = $view" in sql
        assert "RELATE" not in sql

    @pytest.mark.asyncio
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_ungroup_missing_view_returns_404(self, mock_view_get, client):
        mock_view_get.side_effect = NotFoundError("source_view not found")

        response = client.post(
            "/api/views/source_view:gone/ungroup",
            json={"source_ids": [SOURCE_ID]},
        )

        assert response.status_code == 404


class TestCopySourcesApi:
    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_copy_completed_source_copies_vectors_and_references(
        self, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.side_effect = [
            ["source:s1"],  # existence check
            ["notebook:nb1", "notebook:nb2"],  # reference targets
            [],  # copy transaction
        ]

        with patch.object(
            Source,
            "get",
            new_callable=AsyncMock,
            return_value=_source_row(),
        ):
            response = client.post(
                f"/api/groups/{GROUP_ID}/copy",
                json={"source_ids": [SOURCE_ID]},
            )

        assert response.status_code == 200
        body = response.json()
        assert len(body["created"]) == 1
        assert body["created"][0].startswith("source:")
        assert body["failed"] == []

        copy_sql = repo_query.await_args_list[2].args[0]
        params = repo_query.await_args_list[2].args[1]
        assert "CREATE $new_id CONTENT $content" in copy_sql
        # The copy lands in the target group
        assert "RELATE $new_id->source_group_member->$group" in copy_sql
        # `order` must stay backticked (keyword)
        assert (
            "INSERT INTO source_embedding SELECT $new_id AS source, `order`, "
            "content, embedding FROM source_embedding WHERE source = $old" in copy_sql
        )
        assert "RELATE $new_id->reference->$nb" in copy_sql
        assert params["content"]["title"] == "My Source (copy)"
        assert params["content"]["embedding_status"] == "completed"
        assert params["content"]["total_chunks"] == 4

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_copy_unembedded_source_skips_vectors_and_chunks(
        self, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.side_effect = [["source:s1"], []]  # exists; no notebooks

        with patch.object(
            Source,
            "get",
            new_callable=AsyncMock,
            return_value=_source_row(embedding_status="not_embedded"),
        ):
            response = client.post(
                f"/api/groups/{GROUP_ID}/copy",
                json={"source_ids": [SOURCE_ID]},
            )

        assert response.status_code == 200
        copy_sql = repo_query.await_args_list[2].args[0]
        params = repo_query.await_args_list[2].args[1]
        assert "source_embedding" not in copy_sql
        assert params["content"]["embedding_status"] == "not_embedded"
        assert "total_chunks" not in params["content"]
        assert "embedded_chunks" not in params["content"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_copy_does_not_copy_insights_or_command(
        self, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.side_effect = [["source:s1"], []]

        with patch.object(
            Source,
            "get",
            new_callable=AsyncMock,
            return_value=_source_row(),
        ):
            await copy_sources_to_group(GROUP_ID, [SOURCE_ID])

        copy_sql = repo_query.await_args_list[2].args[0]
        params = repo_query.await_args_list[2].args[1]
        assert "source_insight" not in copy_sql
        assert "command" not in params["content"]

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch("api.source_group_service._copy_single_source", new_callable=AsyncMock)
    async def test_copy_single_failure_does_not_abort_batch(
        self, mock_copy_single, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.return_value = ["source:s1", "source:s2", "source:s3"]
        mock_copy_single.side_effect = [
            "source:new1",
            RuntimeError("disk exploded"),
            "source:new3",
        ]

        response = client.post(
            f"/api/groups/{GROUP_ID}/copy",
            json={"source_ids": ["source:s1", "source:s2", "source:s3"]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["created"] == ["source:new1", "source:new3"]
        assert len(body["failed"]) == 1
        assert body["failed"][0]["source_id"] == "source:s2"
        assert body["failed"][0]["reason"] == "disk exploded"

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    async def test_copy_missing_group_returns_404(self, mock_group_get, client):
        mock_group_get.side_effect = NotFoundError("source_group not found")

        response = client.post(
            "/api/groups/source_group:gone/copy",
            json={"source_ids": [SOURCE_ID]},
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_copy_title_falls_back_to_basename_then_untitled(
        self, repo_query, mock_group_get
    ):
        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.side_effect = [["source:s1", "source:s2"], [], [], [], []]

        no_title = _source_row(title=None)
        no_title_no_asset = _source_row(title=None)
        no_title_no_asset.asset = None

        with patch.object(Source, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = [no_title, no_title_no_asset]
            result = await copy_sources_to_group(GROUP_ID, ["source:s1", "source:s2"])

        assert result.failed == []
        created_titles = [
            call.args[1]["content"]["title"]
            for call in repo_query.await_args_list
            if len(call.args) > 1 and "content" in call.args[1]
        ]
        assert created_titles == ["doc.pdf (copy)", "Untitled copy"]


class TestClonePhysicalFile:
    @pytest.fixture
    def uploads(self, tmp_path):
        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir()
        original = tmp_path / "doc.pdf"
        original.write_text("content")
        return uploads_dir, original

    def _source_with_file(self, path):
        return Source(
            id=SOURCE_ID,
            title="T",
            asset=Asset(file_path=str(path)),
            embedding_status="not_embedded",
        )

    def test_hard_link_copy_in_uploads(self, uploads, monkeypatch):
        uploads_dir, original = uploads
        monkeypatch.setattr("api.source_group_service.UPLOADS_FOLDER", str(uploads_dir))

        cloned = _clone_physical_file(self._source_with_file(original))

        assert cloned is not None
        assert Path(cloned).is_file()
        assert Path(cloned).parent == uploads_dir
        assert "(copy)" in Path(cloned).name
        assert os.stat(cloned).st_ino == original.stat().st_ino  # same inode

    def test_link_collision_gets_counter_suffix(self, uploads, monkeypatch):
        uploads_dir, original = uploads
        monkeypatch.setattr("api.source_group_service.UPLOADS_FOLDER", str(uploads_dir))
        (uploads_dir / "doc (copy).pdf").write_text("existing")

        first = _clone_physical_file(self._source_with_file(original))
        second = _clone_physical_file(self._source_with_file(original))

        assert first.endswith("doc (copy 2).pdf")
        assert second.endswith("doc (copy 3).pdf")

    def test_link_failure_falls_back_to_full_copy(self, uploads, monkeypatch):
        uploads_dir, original = uploads
        monkeypatch.setattr("api.source_group_service.UPLOADS_FOLDER", str(uploads_dir))

        def link_denied(*args, **kwargs):
            raise OSError("cross-device link not permitted")

        monkeypatch.setattr("api.source_group_service.os.link", link_denied)

        cloned = _clone_physical_file(self._source_with_file(original))

        assert cloned is not None
        assert Path(cloned).is_file()
        assert Path(cloned).read_text() == "content"
        assert os.stat(cloned).st_ino != original.stat().st_ino  # real copy

    def test_total_clone_failure_returns_none(self, uploads, monkeypatch):
        uploads_dir, original = uploads
        monkeypatch.setattr("api.source_group_service.UPLOADS_FOLDER", str(uploads_dir))

        def always_fail(*args, **kwargs):
            raise OSError("no space left on device")

        monkeypatch.setattr("api.source_group_service.os.link", always_fail)
        monkeypatch.setattr(
            "api.source_group_service.shutil.copy2", always_fail
        )

        cloned = _clone_physical_file(self._source_with_file(original))

        assert cloned is None  # copy still proceeds, just without a file

    def test_missing_file_returns_none(self, uploads, monkeypatch):
        uploads_dir, _ = uploads
        monkeypatch.setattr("api.source_group_service.UPLOADS_FOLDER", str(uploads_dir))

        cloned = _clone_physical_file(
            self._source_with_file(uploads_dir / "ghost.pdf")
        )

        assert cloned is None


class TestCopyTransactionFailure:
    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_copy_transaction_failure_unlinks_cloned_file(
        self, repo_query, mock_group_get, client, monkeypatch, tmp_path
    ):
        """When the copy transaction fails, the already-cloned physical file
        must not survive in uploads/ as an orphan with no record behind it."""
        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir()
        original = tmp_path / "doc.pdf"
        original.write_text("content")
        monkeypatch.setattr(
            "api.source_group_service.UPLOADS_FOLDER", str(uploads_dir)
        )

        mock_group_get.return_value = SourceGroup(
            id=GROUP_ID, name="G", source_view=VIEW_ID
        )
        repo_query.side_effect = [
            ["source:s1"],  # existence check
            [],  # no notebook references
            RuntimeError("transaction rolled back"),  # copy transaction
        ]

        source = Source(
            id=SOURCE_ID,
            title="T",
            full_text="body",
            asset=Asset(file_path=str(original)),
            embedding_status="not_embedded",
        )
        with patch.object(
            Source, "get", new_callable=AsyncMock, return_value=source
        ):
            response = client.post(
                f"/api/groups/{GROUP_ID}/copy",
                json={"source_ids": [SOURCE_ID]},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["created"] == []
        assert len(body["failed"]) == 1
        assert body["failed"][0]["source_id"] == SOURCE_ID
        assert "transaction rolled back" in body["failed"][0]["reason"]
        # The clone is gone, the original file is untouched
        assert list(uploads_dir.iterdir()) == []
        assert original.is_file()


class TestCopyTitle:
    def test_title_suffix(self):
        source = _source_row(title="Doc")
        assert _copy_title(source) == "Doc (copy)"

    def test_fallback_basename(self):
        source = _source_row(title=None)
        assert _copy_title(source) == "doc.pdf (copy)"

    def test_fallback_untitled(self):
        source = _source_row(title=None)
        source.asset = None
        assert _copy_title(source) == "Untitled copy"


class TestClassifyApi:
    def _ai_view(self, view_type="ai_content"):
        return SourceView(id=VIEW_ID, name="AI", view_type=view_type)

    @pytest.mark.asyncio
    @patch.object(CommandService, "submit_command_job", new_callable=AsyncMock)
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_submit_returns_202_and_maps_method_from_view_type(
        self, mock_get, repo_query, mock_provision, mock_submit, client
    ):
        mock_get.return_value = self._ai_view()
        repo_query.side_effect = [[{"total": 10}], []]  # source count; no running commands
        mock_submit.return_value = "command:abc123"

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 202
        assert response.json() == {"command_id": "command:abc123"}
        assert mock_submit.await_args.args == (
            "open_notebook",
            "classify_sources",
            {"view_id": VIEW_ID, "method": "content"},
        )

    @pytest.mark.asyncio
    @patch.object(CommandService, "submit_command_job", new_callable=AsyncMock)
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_ai_title_view_maps_to_title_method(
        self, mock_get, repo_query, mock_provision, mock_submit, client
    ):
        mock_get.return_value = self._ai_view("ai_title")
        repo_query.side_effect = [[{"total": 10}], []]
        mock_submit.return_value = "command:def456"

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 202
        assert mock_submit.await_args.args[2]["method"] == "title"

    @pytest.mark.asyncio
    async def test_missing_view_returns_404(self, client):
        with patch.object(SourceView, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = NotFoundError("source_view not found")
            response = client.post("/api/views/source_view:gone/classify")

        assert response.status_code == 404

    @pytest.mark.asyncio
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_custom_view_type_returns_400(
        self, mock_get, _repo, _mock_provision, client
    ):
        mock_get.return_value = self._ai_view("custom")

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 400
        assert "ai_content" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_fewer_than_three_sources_returns_400(
        self, mock_get, repo_query, _mock_provision, client
    ):
        mock_get.return_value = self._ai_view()
        repo_query.side_effect = [[{"total": 2}], []]

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 400
        assert "at least 3" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_unconfigured_llm_returns_422(
        self, mock_get, repo_query, mock_provision, client
    ):
        from open_notebook.exceptions import ConfigurationError

        mock_get.return_value = self._ai_view()
        repo_query.side_effect = [[{"total": 10}], []]
        mock_provision.side_effect = ConfigurationError(
            "No model configured. Please go to Manage → Models."
        )

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 422
        assert "No model configured" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch.object(CommandService, "submit_command_job", new_callable=AsyncMock)
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_running_job_for_same_view_returns_400(
        self, mock_get, repo_query, _mock_provision, mock_submit, client
    ):
        mock_get.return_value = self._ai_view()
        repo_query.side_effect = [
            [{"total": 10}],
            [{"args": {"view_id": VIEW_ID, "method": "content"}}],
        ]

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 400
        assert "already" in response.json()["detail"]
        mock_submit.assert_not_awaited()

    @pytest.mark.asyncio
    @patch.object(CommandService, "submit_command_job", new_callable=AsyncMock)
    @patch("api.source_group_service.provision_langchain_model", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    async def test_running_job_for_other_view_is_allowed(
        self, mock_get, repo_query, _mock_provision, mock_submit, client
    ):
        mock_get.return_value = self._ai_view()
        repo_query.side_effect = [
            [{"total": 10}],
            [{"args": {"view_id": "source_view:other", "method": "title"}}],
        ]
        mock_submit.return_value = "command:new"

        response = client.post(f"/api/views/{VIEW_ID}/classify")

        assert response.status_code == 202
        mock_submit.assert_awaited_once()
