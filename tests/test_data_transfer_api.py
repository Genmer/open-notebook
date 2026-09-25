"""Tests for /api/data-transfer/* endpoints (api/routers/data_transfer.py).

Service seams (repo_query, state writes, command submission) are patched with
AsyncMocks, so no database or worker is touched. The 413 oversized-upload path
is covered by tests/test_max_body_size_middleware.py and is not retested here.
"""

import io
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import UploadFile
from fastapi.testclient import TestClient
from surreal_commands.core.client import CommandStatus

import api.data_transfer_service as svc


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _state_row(
    kind: str,
    stage: str = "done",
    percent: int = 100,
    command_id: str = "command:abc",
    result=None,
    error=None,
):
    return [
        {
            "id": f"data_transfer_state:{kind}",
            "kind": kind,
            "command_id": command_id,
            "progress": {"stage": stage, "percent": percent, "message": "msg", "error": error},
            "result": result,
        }
    ]


class TestStartExport:
    @pytest.mark.asyncio
    async def test_start_export_returns_command_id(self, client):
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=[])
        ), patch.object(
            svc, "set_transfer_state", new=AsyncMock()
        ), patch.object(
            svc.CommandService,
            "submit_command_job",
            new=AsyncMock(return_value="command:abc"),
        ):
            response = client.post("/api/data-transfer/export")

        assert response.status_code == 200
        body = response.json()
        assert body["command_id"] == "command:abc"
        assert "message" in body

    @pytest.mark.asyncio
    async def test_start_export_rejects_concurrent_job(self, client):
        with patch.object(
            svc,
            "repo_query",
            new=AsyncMock(return_value=[{"id": "command:running"}]),
        ):
            response = client.post("/api/data-transfer/export")

        assert response.status_code == 400
        assert "already" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_start_export_writes_failed_state_on_submit_error(self, client):
        states = []
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=[])
        ), patch.object(
            svc,
            "set_transfer_state",
            new=AsyncMock(side_effect=lambda *a, **k: states.append((a, k))),
        ), patch.object(
            svc.CommandService,
            "submit_command_job",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            with pytest.raises(RuntimeError):
                await svc.start_export()

        assert states[-1][0][1] == "failed"


class TestExportStatus:
    @pytest.mark.asyncio
    async def test_status_none_without_state(self, client):
        with patch.object(svc, "repo_query", new=AsyncMock(return_value=[])):
            response = client.get("/api/data-transfer/export/status")

        assert response.status_code == 200
        assert response.json()["status"] == "none"

    @pytest.mark.asyncio
    async def test_status_merges_state_and_command(self, client):
        state = _state_row(
            "export",
            stage="exporting_tables",
            percent=20,
            command_id="command:abc",
            result=None,
        )
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": "running"}),
        ):
            response = client.get("/api/data-transfer/export/status")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "running"
        assert body["command_id"] == "command:abc"
        assert body["progress"]["stage"] == "exporting_tables"
        assert body["progress"]["percent"] == 20

    @pytest.mark.asyncio
    async def test_status_queued_when_command_is_new(self, client):
        state = _state_row("export", stage="queued", percent=0)
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": "new"}),
        ):
            response = client.get("/api/data-transfer/export/status")

        assert response.json()["status"] == "queued"

    @pytest.mark.asyncio
    async def test_status_unwraps_command_status_enum(self, client):
        # get_command_status returns surreal_commands' str-Enum; str() on it
        # is "CommandStatus.COMPLETED", not the wire value.
        state = _state_row("import", stage="done", result={"imported": {}})
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": CommandStatus.COMPLETED}),
        ):
            response = client.get("/api/data-transfer/import/status")

        assert response.status_code == 200
        assert response.json()["status"] == "completed"

    @pytest.mark.asyncio
    async def test_status_maps_canceled_command_to_failed(self, client):
        state = _state_row("export", stage="done")
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": CommandStatus.CANCELED}),
        ):
            response = client.get("/api/data-transfer/export/status")

        assert response.json()["status"] == "failed"

    @pytest.mark.asyncio
    async def test_status_unknown_command_falls_back_to_stage(self, client):
        # A vanished command record yields status="unknown"; the state record's
        # stage must drive the response instead of leaking it.
        state = _state_row("export", stage="done", command_id="command:gone")
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": "unknown"}),
        ):
            response = client.get("/api/data-transfer/export/status")

        assert response.json()["status"] == "completed"


class TestExportDownload:
    @pytest.mark.asyncio
    async def test_download_returns_zip_with_filename(self, client, tmp_path):
        package = tmp_path / "open_notebook_export_1.zip"
        package.write_bytes(b"PK\x03\x04zip")
        state = _state_row(
            "export",
            result={
                "package_path": str(package),
                "package_filename": package.name,
            },
        )
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": "completed"}),
        ):
            response = client.get("/api/data-transfer/export/download")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/zip")
        assert package.name in response.headers["content-disposition"]
        assert response.content == b"PK\x03\x04zip"

    @pytest.mark.asyncio
    async def test_download_404_without_package(self, client):
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=[])
        ):
            response = client.get("/api/data-transfer/export/download")

        assert response.status_code == 404


class TestImport:
    @pytest.mark.asyncio
    async def test_upload_import_starts_job(self, client):
        with patch.object(
            svc,
            "save_import_upload",
            new=AsyncMock(return_value="/tmp/data/imports/x.zip"),
        ), patch.object(
            svc, "start_import", new=AsyncMock(return_value="command:i1")
        ):
            response = client.post(
                "/api/data-transfer/import",
                files={"file": ("pkg.zip", b"PK\x03\x04fake", "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["command_id"] == "command:i1"

    @pytest.mark.asyncio
    async def test_upload_import_rejects_concurrent_job(self, client):
        with patch.object(
            svc,
            "save_import_upload",
            new=AsyncMock(return_value="/tmp/data/imports/x.zip"),
        ), patch.object(
            svc,
            "start_import",
            new=AsyncMock(side_effect=svc.InvalidInputError("A data import job is already queued or running")),
        ):
            response = client.post(
                "/api/data-transfer/import",
                files={"file": ("pkg.zip", b"PK\x03\x04fake", "application/zip")},
            )

        assert response.status_code == 400
        assert "already" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_import_status_returns_summary(self, client):
        state = _state_row(
            "import",
            stage="done",
            result={
                "imported": {"source": 2},
                "skipped": {"note": 1},
                "warnings": ["w"],
            },
        )
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc.CommandService,
            "get_command_status",
            new=AsyncMock(return_value={"status": "completed"}),
        ):
            response = client.get("/api/data-transfer/import/status")

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "completed"
        assert body["summary"]["imported"] == {"source": 2}
        assert body["summary"]["warnings"] == ["w"]


class TestSaveImportUpload:
    @pytest.mark.asyncio
    async def test_streams_upload_to_imports_folder(self, tmp_path):
        payload = b"PK\x03\x04" + b"x" * 100
        upload = UploadFile(
            file=io.BytesIO(payload), filename="pkg.zip", size=len(payload)
        )
        with patch.object(svc, "IMPORTS_FOLDER", new=str(tmp_path)):
            path = await svc.save_import_upload(upload)

        assert path.startswith(str(tmp_path))
        assert path.endswith(".zip")
        with open(path, "rb") as f:
            assert f.read() == payload

    @pytest.mark.asyncio
    async def test_rejects_non_zip_and_empty(self, tmp_path):
        bad = UploadFile(file=io.BytesIO(b"x"), filename="pkg.tar", size=1)
        empty = UploadFile(file=io.BytesIO(b""), filename="pkg.zip", size=0)
        with patch.object(svc, "IMPORTS_FOLDER", new=str(tmp_path)):
            with pytest.raises(svc.InvalidInputError):
                await svc.save_import_upload(bad)
            with pytest.raises(svc.InvalidInputError):
                await svc.save_import_upload(empty)
        assert list(tmp_path.iterdir()) == []


class TestDeleteExportPackage:
    @pytest.mark.asyncio
    async def test_deletes_package_and_resets_state(self, tmp_path):
        exports = tmp_path / "exports"
        exports.mkdir()
        package = exports / "pkg.zip"
        package.write_bytes(b"zip")
        state = _state_row(
            "export", result={"package_path": str(package), "package_filename": "pkg.zip"}
        )
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc, "EXPORTS_FOLDER", new=str(exports)
        ), patch.object(
            svc, "repo_upsert", new=AsyncMock()
        ):
            deleted = await svc.delete_export_package()

        assert deleted is True
        assert not package.exists()

    @pytest.mark.asyncio
    async def test_refuses_paths_outside_exports_folder(self, tmp_path):
        outside = tmp_path / "outside.zip"
        outside.write_bytes(b"zip")
        state = _state_row(
            "export",
            result={"package_path": str(outside), "package_filename": "outside.zip"},
        )
        with patch.object(
            svc, "repo_query", new=AsyncMock(return_value=state)
        ), patch.object(
            svc, "EXPORTS_FOLDER", new=str(tmp_path / "exports")
        ), patch.object(
            svc, "repo_upsert", new=AsyncMock()
        ):
            deleted = await svc.delete_export_package()

        assert deleted is False
        assert outside.exists()

    @pytest.mark.asyncio
    async def test_delete_endpoint_returns_bool(self, client, tmp_path):
        with patch.object(
            svc, "delete_export_package", new=AsyncMock(return_value=True)
        ):
            response = client.delete("/api/data-transfer/export/package")

        assert response.status_code == 200
        assert response.json() == {"deleted": True}
