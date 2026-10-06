"""Tests for the chat context preferences API (migration 31, the GET/PUT
/api/notebooks/{id}/context-preferences endpoints and the cascade cleanup
DELETEs that purge chat_context_pref rows). DB access is stubbed at
repo_query, following the test_source_groups_api.py pattern."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from open_notebook.domain.base import ObjectModel
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.domain.source_grouping import SourceGroup, SourceView
from open_notebook.exceptions import NotFoundError

MIGRATIONS_DIR = Path("open_notebook/database/migrations")
NOTEBOOK_ID = "notebook:nb1"
FOLDER_ID = "source_group:g1"
SOURCE_ID = "source:s1"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _pref_row(source: str = SOURCE_ID, mode: str = "off"):
    return {
        "id": "chat_context_pref:abc123",
        "source": source,
        "mode": mode,
    }


class TestMigration31:
    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "31.surrealql").is_file()
        assert (MIGRATIONS_DIR / "31_down.surrealql").is_file()

    def test_manager_registers_migration_31(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 31
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "chat_context_pref" in manager.up_migrations[30].sql
        assert "REMOVE TABLE" in manager.down_migrations[30].sql

    def test_up_defines_schemaless_table(self):
        sql = (MIGRATIONS_DIR / "31.surrealql").read_text()
        assert "DEFINE TABLE IF NOT EXISTS chat_context_pref SCHEMALESS" in sql

    def test_down_removes_table(self):
        sql = (MIGRATIONS_DIR / "31_down.surrealql").read_text()
        assert "REMOVE TABLE IF EXISTS chat_context_pref;" in sql


class TestGetContextPreferences:
    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_get_empty_prefs(self, mock_get, repo_query, client):
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        response = client.get(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            headers={"Accept": "application/json"},
        )

        assert response.status_code == 200
        assert response.json() == {"prefs": {}}
        assert "folder IS NONE" in repo_query.await_args.args[0]
        assert "folder" not in repo_query.await_args.args[1]

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_get_returns_stored_modes_by_source_id(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = MagicMock()
        repo_query.return_value = [
            _pref_row("source:s1", "off"),
            _pref_row("source:s2", "full"),
        ]

        response = client.get(f"/api/notebooks/{NOTEBOOK_ID}/context-preferences")

        assert response.status_code == 200
        assert response.json() == {"prefs": {"source:s1": "off", "source:s2": "full"}}

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_get_without_folder_id_scopes_ungrouped_bucket(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        response = client.get(f"/api/notebooks/{NOTEBOOK_ID}/context-preferences")

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        params = repo_query.await_args.args[1]
        assert "folder IS NONE" in query
        assert "folder = $folder" not in query
        assert str(params["notebook"]) == NOTEBOOK_ID
        assert "folder" not in params

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_get_with_folder_id_binds_group_record(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = MagicMock()
        repo_query.return_value = [_pref_row()]

        response = client.get(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            params={"folder_id": FOLDER_ID},
        )

        assert response.status_code == 200
        query = repo_query.await_args.args[0]
        params = repo_query.await_args.args[1]
        assert "folder = $folder" in query
        assert str(params["folder"]) == FOLDER_ID

    @pytest.mark.asyncio
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_get_missing_notebook_returns_404(self, mock_get, client):
        mock_get.side_effect = NotFoundError("notebook not found")

        response = client.get(f"/api/notebooks/{NOTEBOOK_ID}/context-preferences")

        assert response.status_code == 404


class TestSaveContextPreferences:
    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_put_upserts_selection_and_reports_count(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        response = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": FOLDER_ID,
                "selections": [{"source_id": SOURCE_ID, "mode": "off"}],
            },
        )

        assert response.status_code == 200
        assert response.json() == {"saved": 1}
        sql = repo_query.await_args.args[0]
        params = repo_query.await_args.args[1]
        assert "UPSERT" in sql
        assert "created = IF created IS NONE" in sql
        assert params["mode"] == "off"
        assert str(params["source"]) == SOURCE_ID
        assert str(params["notebook"]) == NOTEBOOK_ID
        assert str(params["folder"]) == FOLDER_ID
        # Deterministic record id scoped to the (notebook, folder, source) key
        assert str(params["pref"]).startswith("chat_context_pref:")

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_put_then_get_reads_back(self, mock_get, repo_query, client):
        """PUT writes the row, a following GET resolves it into prefs."""
        mock_get.return_value = MagicMock()
        repo_query.side_effect = [
            [],  # UPSERT on PUT
            [_pref_row(SOURCE_ID, "insights")],  # SELECT on GET
        ]

        saved = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": FOLDER_ID,
                "selections": [{"source_id": SOURCE_ID, "mode": "insights"}],
            },
        )
        read = client.get(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            params={"folder_id": FOLDER_ID},
        )

        assert saved.status_code == 200
        assert saved.json() == {"saved": 1}
        assert read.status_code == 200
        assert read.json() == {"prefs": {SOURCE_ID: "insights"}}

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_put_overwrite_updates_same_record(
        self, mock_get, repo_query, client
    ):
        """Same (notebook, folder, source) twice: same pref id, latest mode wins."""
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        first = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": FOLDER_ID,
                "selections": [{"source_id": SOURCE_ID, "mode": "off"}],
            },
        )
        second = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": FOLDER_ID,
                "selections": [{"source_id": SOURCE_ID, "mode": "full"}],
            },
        )

        assert first.status_code == 200
        assert second.status_code == 200
        first_params = repo_query.await_args_list[0].args[1]
        second_params = repo_query.await_args_list[1].args[1]
        assert first_params["pref"] == second_params["pref"]
        assert first_params["mode"] == "off"
        assert second_params["mode"] == "full"

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_put_null_folder_id_targets_ungrouped_bucket(
        self, mock_get, repo_query, client
    ):
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        response = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": None,
                "selections": [{"source_id": SOURCE_ID, "mode": "full"}],
            },
        )

        assert response.status_code == 200
        params = repo_query.await_args.args[1]
        assert params["folder"] is None

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_put_batch_saves_all(self, mock_get, repo_query, client):
        mock_get.return_value = MagicMock()
        repo_query.return_value = []

        response = client.put(
            f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
            json={
                "folder_id": FOLDER_ID,
                "selections": [
                    {"source_id": "source:s1", "mode": "off"},
                    {"source_id": "source:s2", "mode": "insights"},
                    {"source_id": "source:s3", "mode": "full"},
                ],
            },
        )

        assert response.status_code == 200
        assert response.json() == {"saved": 3}
        assert repo_query.await_count == 3

    @pytest.mark.asyncio
    async def test_put_invalid_mode_returns_400(self, client):
        with patch.object(Notebook, "get", new_callable=AsyncMock):
            response = client.put(
                f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
                json={
                    "folder_id": FOLDER_ID,
                    "selections": [{"source_id": SOURCE_ID, "mode": "bogus"}],
                },
            )

        assert response.status_code == 400
        assert "bogus" in response.json()["detail"]

    @pytest.mark.asyncio
    @patch("api.routers.notebook_context_prefs.repo_query", new_callable=AsyncMock)
    async def test_put_missing_notebook_returns_404(self, repo_query, client):
        with patch.object(Notebook, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = NotFoundError("notebook not found")
            response = client.put(
                f"/api/notebooks/{NOTEBOOK_ID}/context-preferences",
                json={
                    "folder_id": FOLDER_ID,
                    "selections": [{"source_id": SOURCE_ID, "mode": "off"}],
                },
            )

        assert response.status_code == 404
        repo_query.assert_not_awaited()


def _group_row(group_id: str, parent: str = None):
    return {
        "id": group_id,
        "source_view": "source_view:v1",
        "name": group_id.split(":")[1],
        "parent": parent,
        "created": "2026-01-01T00:00:00",
        "updated": "2026-01-01T00:00:00",
    }


class TestCascadeCleanup:
    """Deleting a notebook / source / folder must purge its chat_context_pref
    rows. The DELETE statements only run against a live DB in production, so
    the tests assert the issued SQL with repo_query stubbed."""

    @pytest.mark.asyncio
    @patch.object(ObjectModel, "delete", new_callable=AsyncMock)
    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    async def test_source_delete_sweeps_chat_context_pref(
        self, repo_query, _super_delete
    ):
        source = Source(id=SOURCE_ID)

        await source.delete()

        queries = [call.args[0] for call in repo_query.await_args_list]
        assert "DELETE source_embedding WHERE source = $source_id" in queries
        assert "DELETE source_insight WHERE source = $source_id" in queries
        assert "DELETE chat_context_pref WHERE source = $source_id" in queries

    @pytest.mark.asyncio
    @patch.object(ObjectModel, "delete", new_callable=AsyncMock)
    @patch.object(Notebook, "get_notes", new_callable=AsyncMock)
    @patch.object(Notebook, "get_chat_sessions", new_callable=AsyncMock)
    @patch("open_notebook.domain.notebook.repo_query", new_callable=AsyncMock)
    async def test_notebook_delete_sweeps_chat_context_pref(
        self, repo_query, _sessions, _notes, _super_delete
    ):
        _sessions.return_value = []
        _notes.return_value = []
        repo_query.return_value = [{"count": 0}]
        notebook = Notebook(id=NOTEBOOK_ID, name="nb", description="d")

        await notebook.delete()

        pref_calls = [
            call
            for call in repo_query.await_args_list
            if "DELETE chat_context_pref" in call.args[0]
        ]
        assert len(pref_calls) == 1
        assert "WHERE notebook = $notebook_id" in pref_calls[0].args[0]
        assert str(pref_calls[0].args[1]["notebook_id"]) == NOTEBOOK_ID

    @pytest.mark.asyncio
    @patch("api.routers.sources.Source.get", new_callable=AsyncMock)
    @patch("api.routers.sources.repo_query", new_callable=AsyncMock)
    async def test_delete_source_endpoint_sweeps_chat_context_pref(
        self, repo_query, mock_source_get, client
    ):
        source = MagicMock()
        source.delete = AsyncMock(return_value=True)
        mock_source_get.return_value = source
        repo_query.return_value = []

        response = client.delete(f"/api/sources/{SOURCE_ID}")

        assert response.status_code == 200
        assert source.delete.await_count == 1
        queries = [call.args[0] for call in repo_query.await_args_list]
        assert queries == [
            "DELETE source_group_member WHERE in = $sid",
            "DELETE reference WHERE in = $sid",
            "DELETE source_embedding WHERE source = $sid",
            "DELETE source_insight WHERE source = $sid",
            "DELETE chat_context_pref WHERE source = $sid",
        ]
        assert str(repo_query.await_args_list[-1].args[1]["sid"]) == SOURCE_ID

    @pytest.mark.asyncio
    @patch.object(SourceView, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_view_sweeps_chat_context_pref(
        self, repo_query, mock_view_get, client
    ):
        mock_view_get.return_value = SourceView(
            id="source_view:v1", name="Custom", view_type="custom"
        )
        repo_query.side_effect = [
            ["source_group:g1", "source_group:g2"],  # group ids of the view
            [],  # DELETE memberships + prefs
            [],  # DELETE groups
            [],  # DELETE view
        ]

        response = client.delete("/api/views/source_view:v1")

        assert response.status_code == 200
        assert repo_query.await_count == 4
        merged = repo_query.await_args_list[1].args[0]
        assert "DELETE source_group_member WHERE out IN" in merged
        assert (
            "DELETE chat_context_pref WHERE folder IN "
            "(SELECT VALUE id FROM source_group WHERE source_view = $view)" in merged
        )
        assert str(repo_query.await_args_list[1].args[1]["view"]) == "source_view:v1"

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_group_ungroup_branch_sweeps_chat_context_pref(
        self, repo_query, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))
        repo_query.side_effect = [
            [
                _group_row("source_group:g1"),
                _group_row("source_group:g2", "source_group:g1"),
            ],
            [],  # merged memberships + groups + prefs
        ]

        response = client.delete("/api/groups/source_group:g1")

        assert response.status_code == 200
        assert repo_query.await_count == 2
        merged = repo_query.await_args_list[1].args[0]
        assert "DELETE source_group WHERE id IN $subtree" in merged
        assert "DELETE chat_context_pref WHERE folder IN $subtree" in merged
        assert len(repo_query.await_args_list[1].args[1]["subtree"]) == 2

    @pytest.mark.asyncio
    @patch.object(SourceGroup, "get", new_callable=AsyncMock)
    @patch.object(Source, "get", new_callable=AsyncMock)
    @patch("api.source_group_service.repo_query", new_callable=AsyncMock)
    async def test_delete_group_cascade_branch_sweeps_chat_context_pref(
        self, repo_query, mock_source_get, mock_group_get, client
    ):
        mock_group_get.return_value = SourceGroup(**_group_row("source_group:g1"))
        source = MagicMock()
        source.delete = AsyncMock(return_value=True)
        mock_source_get.return_value = source
        repo_query.side_effect = [
            [
                _group_row("source_group:g1"),
                _group_row("source_group:g2", "source_group:g1"),
            ],
            ["source:s1"],  # member source ids
            [],  # membership sweep
            [],  # merged groups + prefs delete
        ]

        response = client.delete("/api/groups/source_group:g1?delete_sources=true")

        assert response.status_code == 200
        assert repo_query.await_count == 4
        merged = repo_query.await_args_list[3].args[0]
        assert "DELETE source_group WHERE id IN $subtree" in merged
        assert "DELETE chat_context_pref WHERE folder IN $subtree" in merged
        subtree = repo_query.await_args_list[3].args[1]["subtree"]
        assert [str(ref) for ref in subtree] == [
            "source_group:g1",
            "source_group:g2",
        ]
