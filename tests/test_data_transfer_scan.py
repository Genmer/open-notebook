"""Tests for the model-configuration scan/execute flow: upload → conflict scan
→ execute (api/data_transfer_service.py + /data-transfer endpoints).

Service seams (repo_query, state writes, command submission) are patched with
AsyncMocks; packages are real zips built on disk.
"""

import hashlib
import json
import os
import zipfile
from typing import Any, Dict
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

import api.data_transfer_service as svc
from api.models import ImportExecuteRequest
from open_notebook.utils.encryption import encrypt_value

CREDENTIAL_ID = "credential:c1"
MODEL_ID = "model:m1"

PKG_CREDENTIAL: Dict[str, Any] = {
    "id": CREDENTIAL_ID,
    "name": "Pkg",
    "provider": "vertex",
    "modalities": ["language"],
    "api_key": "sk-pkg-9876543210",
    "config": {"num_ctx": 4096},
}
PKG_MODEL = {
    "id": MODEL_ID,
    "name": "PkgModel",
    "provider": "vertex",
    "type": "language",
    "credential": CREDENTIAL_ID,
    "price_source": "litellm",
}


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


@pytest.fixture
def imports_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "IMPORTS_FOLDER", str(tmp_path))
    return tmp_path


def _sidecar(imports_folder):
    return imports_folder / svc.PENDING_SCAN_SIDECAR_NAME


@pytest.fixture
def encryption_key(monkeypatch):
    import open_notebook.utils.encryption as enc

    monkeypatch.setenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", "scan-test-key")
    monkeypatch.setattr(enc, "_ENCRYPTION_KEY", None)
    return enc


@pytest.fixture
def no_encryption_key(monkeypatch):
    import open_notebook.utils.encryption as enc

    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY", raising=False)
    monkeypatch.delenv("OPEN_NOTEBOOK_ENCRYPTION_KEY_FILE", raising=False)
    monkeypatch.setattr(enc, "_ENCRYPTION_KEY", None)
    # get_fernet() caches its instance; a stale one would outlive the deleted key
    monkeypatch.setattr(enc, "_FERNET", None)
    monkeypatch.setattr(enc, "_FERNET_LEGACY", None)
    return None


def _write_package(
    path,
    credential_rows=(),
    model_rows=(),
    default_row=None,
    package_type="models",
):
    with zipfile.ZipFile(path, "w") as zf:
        for table, rows in (
            ("credential", credential_rows),
            ("model", model_rows),
            ("default_models", [default_row] if default_row else []),
        ):
            if not rows:
                continue
            with zf.open(f"data/{table}.ndjson", "w") as member:
                for row in rows:
                    member.write((json.dumps(row) + "\n").encode("utf-8"))
        manifest = {
            "format_version": 2,
            "app_version": "test",
            "package_type": package_type,
            "counts": {
                "credential": len(credential_rows),
                "model": len(model_rows),
                "default_models": 1 if default_row else 0,
            },
        }
        zf.writestr("manifest.json", json.dumps(manifest))


def _repo_stub(commands=None, credentials=(), models=()):
    async def _query(sql, params=None):
        if sql.startswith("SELECT id FROM command"):
            return commands or []
        if sql == "SELECT * FROM credential":
            return list(credentials)
        if sql == "SELECT * FROM model":
            return list(models)
        raise AssertionError(f"Unexpected query in scan test: {sql[:120]}")

    return _query


def _mask_of(value: str) -> str:
    return "***" + value[-4:]


class TestScanConflicts:
    @pytest.mark.asyncio
    async def test_conflicts_diff_fields_and_masks(
        self, tmp_path, imports_folder, encryption_key
    ):
        package = tmp_path / "models.zip"
        _write_package(
            package,
            credential_rows=[PKG_CREDENTIAL],
            model_rows=[PKG_MODEL],
            default_row={"id": "open_notebook:default_models"},
        )
        local_cred = {
            "id": CREDENTIAL_ID,
            "name": "Local",
            "provider": "openai",
            "modalities": ["language"],
            "api_key": encrypt_value("sk-local-12345678"),
            "config": None,
        }
        local_model = {
            "id": MODEL_ID,
            "name": "LocalModel",
            "provider": "openai",
            "type": "language",
            "credential": CREDENTIAL_ID,
            "price_source": "manual",
        }

        with patch.object(
            svc,
            "repo_query",
            new=_repo_stub(credentials=[local_cred], models=[local_model]),
        ):
            scan = await svc.scan_import_package(str(package))

        assert scan.scan_id
        assert scan.package_type == "models"
        assert scan.format_version == 2
        assert scan.counts == {
            "credential": 1,
            "model": 1,
            "default_models": 1,
        }
        assert scan.decisions_required == len(scan.conflicts) == 2

        cred_item = next(c for c in scan.conflicts if c.kind == "credential")
        assert cred_item.id == CREDENTIAL_ID
        # Masked previews, never plain keys (local key decrypted for masking).
        assert cred_item.local["api_key"] == _mask_of("sk-local-12345678")
        assert cred_item.package["api_key"] == _mask_of("sk-pkg-9876543210")
        assert cred_item.local["model_count"] == 1
        assert cred_item.package["model_count"] == 1
        assert cred_item.default_action == "skip"
        assert set(cred_item.diff_fields) >= {"name", "provider", "api_key", "config"}

        model_item = next(c for c in scan.conflicts if c.kind == "model")
        assert model_item.id == MODEL_ID
        assert model_item.local["credential"] == "Local" or model_item.local["name"]
        assert set(model_item.diff_fields) >= {"name", "provider", "price_source"}

        sidecar = json.loads(_sidecar(imports_folder).read_text(encoding="utf-8"))
        assert sidecar["scan_id"] == scan.scan_id
        assert sidecar["package_type"] == "models"

    @pytest.mark.asyncio
    async def test_same_fingerprint_is_not_a_conflict(
        self, tmp_path, imports_folder, encryption_key
    ):
        package = tmp_path / "models.zip"
        _write_package(
            package, credential_rows=[PKG_CREDENTIAL], model_rows=[PKG_MODEL]
        )
        local_cred = {
            **PKG_CREDENTIAL,
            "api_key": encrypt_value(PKG_CREDENTIAL["api_key"]),
            "created": "2026-01-01T00:00:00Z",
            "updated": "2026-01-02T00:00:00Z",
        }
        local_model = {**PKG_MODEL, "created": "2026-01-01T00:00:00Z"}

        with patch.object(
            svc,
            "repo_query",
            new=_repo_stub(credentials=[local_cred], models=[local_model]),
        ):
            scan = await svc.scan_import_package(str(package))

        assert scan.conflicts == []
        assert scan.decisions_required == 0

    @pytest.mark.asyncio
    async def test_local_decrypt_failure_counts_as_conflict(
        self, tmp_path, imports_folder, encryption_key
    ):
        package = tmp_path / "models.zip"
        _write_package(package, credential_rows=[PKG_CREDENTIAL])
        local_cred = {
            "id": CREDENTIAL_ID,
            "name": "Local",
            "provider": "openai",
            "api_key": encrypt_value("sk-local-12345678"),
        }

        with (
            patch.object(svc, "repo_query", new=_repo_stub(credentials=[local_cred])),
            patch.object(svc, "decrypt_value", side_effect=ValueError("wrong key")),
        ):
            scan = await svc.scan_import_package(str(package))

        assert len(scan.conflicts) == 1
        item = scan.conflicts[0]
        # Unreadable local key: masked preview is null, api_key counts as diff.
        assert item.local["api_key"] is None
        assert item.diff_fields == ["api_key"]


class TestScanGuards:
    @pytest.mark.asyncio
    async def test_scan_rejects_when_import_running(self, tmp_path, imports_folder):
        package = tmp_path / "models.zip"
        _write_package(package, credential_rows=[PKG_CREDENTIAL])

        with patch.object(
            svc,
            "repo_query",
            new=_repo_stub(commands=[{"id": "command:running"}]),
        ):
            with pytest.raises(svc.InvalidInputError, match="already"):
                await svc.scan_import_package(str(package))

    @pytest.mark.asyncio
    async def test_scan_400_without_encryption_key(
        self, client, tmp_path, imports_folder, no_encryption_key
    ):
        package = tmp_path / "models.zip"
        _write_package(package, credential_rows=[PKG_CREDENTIAL])
        payload = package.read_bytes()

        with patch.object(svc, "repo_query", new=_repo_stub()):
            response = client.post(
                "/api/data-transfer/import",
                files={"file": ("models.zip", payload, "application/zip")},
            )

        assert response.status_code == 400
        assert "OPEN_NOTEBOOK_ENCRYPTION_KEY" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_scan_accepts_keyless_package_without_encryption_key(
        self, client, tmp_path, imports_folder, no_encryption_key
    ):
        # A package without API keys stays importable without the env key.
        package = tmp_path / "models.zip"
        keyless = {**PKG_CREDENTIAL, "api_key": None}
        _write_package(package, credential_rows=[keyless], model_rows=[PKG_MODEL])

        with patch.object(svc, "repo_query", new=_repo_stub()):
            response = client.post(
                "/api/data-transfer/import",
                files={"file": ("models.zip", package.read_bytes(), "application/zip")},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["conflicts"] == []
        assert body["counts"]["credential"] == 1

    @pytest.mark.asyncio
    async def test_scan_400_on_corrupt_package(self, client, imports_folder):
        with patch.object(svc, "repo_query", new=_repo_stub()):
            response = client.post(
                "/api/data-transfer/import",
                files={"file": ("broken.zip", b"not a zip", "application/zip")},
            )

        assert response.status_code == 400
        assert "Invalid import package" in response.json()["detail"]


def _write_pending(imports_folder, scan_id="scan-1", zip_bytes=b"PK\x03\x04"):
    """Pending zip plus a sidecar whose package hash matches those bytes."""
    zip_path = os.path.join(str(imports_folder), svc.PENDING_SCAN_ZIP_NAME)
    with open(zip_path, "wb") as f:
        f.write(zip_bytes)
    _sidecar(imports_folder).write_text(
        json.dumps(
            {
                "scan_id": scan_id,
                "package_type": "models",
                "package_sha256": hashlib.sha256(zip_bytes).hexdigest(),
            }
        ),
        encoding="utf-8",
    )
    return zip_path


class TestExecute:
    @pytest.mark.asyncio
    async def test_execute_submits_decisions_and_deletes_sidecar(
        self, tmp_path, imports_folder
    ):
        zip_path = _write_pending(imports_folder)
        submit = AsyncMock(return_value="command:i1")
        request = ImportExecuteRequest(
            scan_id="scan-1",
            decisions=[
                {"kind": "credential", "id": CREDENTIAL_ID, "action": "overwrite"},
                {"kind": "model", "id": MODEL_ID, "action": "skip"},
            ],
        )

        with (
            patch.object(svc, "repo_query", new=AsyncMock(return_value=[])),
            patch.object(svc, "set_transfer_state", new=AsyncMock()),
            patch.object(svc.CommandService, "submit_command_job", new=submit),
        ):
            command_id = await svc.execute_import(request)

        assert command_id == "command:i1"
        args = submit.call_args.args[2]
        assert args["package_path"] == zip_path
        assert args["model_decisions"] == [
            {"kind": "credential", "id": CREDENTIAL_ID, "action": "overwrite"},
            {"kind": "model", "id": MODEL_ID, "action": "skip"},
        ]
        assert not _sidecar(imports_folder).exists()

    @pytest.mark.asyncio
    async def test_execute_rejects_scan_id_mismatch(self, tmp_path, imports_folder):
        _write_pending(imports_folder)
        request = ImportExecuteRequest(scan_id="scan-other")

        with patch.object(svc, "repo_query", new=AsyncMock(return_value=[])):
            with pytest.raises(svc.InvalidInputError, match="upload the package again"):
                await svc.execute_import(request)

    @pytest.mark.asyncio
    async def test_execute_rejects_missing_scan(self, tmp_path, imports_folder):
        request = ImportExecuteRequest(scan_id="scan-1")
        with patch.object(svc, "repo_query", new=AsyncMock(return_value=[])):
            with pytest.raises(svc.InvalidInputError, match="upload the package again"):
                await svc.execute_import(request)

    @pytest.mark.asyncio
    async def test_execute_rejects_zip_swapped_after_scan(
        self, tmp_path, imports_folder, encryption_key
    ):
        # Scan A succeeds; a later upload B atomically replaces the pending zip
        # and fails its own scan. Executing with A's scan_id must not submit B.
        package_a = tmp_path / "a.zip"
        _write_package(package_a, credential_rows=[{**PKG_CREDENTIAL, "name": "A"}])
        with patch.object(svc, "repo_query", new=_repo_stub()):
            scan = await svc.scan_import_package(str(package_a))
        assert _sidecar(imports_folder).exists()

        package_b = tmp_path / "b.zip"
        _write_package(package_b, credential_rows=[{**PKG_CREDENTIAL, "name": "B"}])
        with open(
            os.path.join(str(imports_folder), svc.PENDING_SCAN_ZIP_NAME), "wb"
        ) as f:
            f.write(package_b.read_bytes())

        request = ImportExecuteRequest(
            scan_id=scan.scan_id,
            decisions=[
                {"kind": "credential", "id": CREDENTIAL_ID, "action": "overwrite"}
            ],
        )
        with patch.object(svc, "repo_query", new=_repo_stub()):
            with pytest.raises(svc.InvalidInputError, match="changed since the scan"):
                await svc.execute_import(request)

    @pytest.mark.asyncio
    async def test_execute_rejects_when_import_running(self, tmp_path, imports_folder):
        _write_pending(imports_folder)
        request = ImportExecuteRequest(scan_id="scan-1")
        with patch.object(
            svc,
            "repo_query",
            new=_repo_stub(commands=[{"id": "command:running"}]),
        ):
            with pytest.raises(svc.InvalidInputError, match="already"):
                await svc.execute_import(request)

    @pytest.mark.asyncio
    async def test_execute_endpoint_returns_command_id(
        self, client, tmp_path, imports_folder
    ):
        _write_pending(imports_folder)
        with (
            patch.object(svc, "repo_query", new=AsyncMock(return_value=[])),
            patch.object(svc, "set_transfer_state", new=AsyncMock()),
            patch.object(
                svc.CommandService,
                "submit_command_job",
                new=AsyncMock(return_value="command:i1"),
            ),
        ):
            response = client.post(
                "/api/data-transfer/import/execute",
                json={"scan_id": "scan-1", "decisions": []},
            )

        assert response.status_code == 200
        assert response.json()["command_id"] == "command:i1"


class TestExportBody:
    @pytest.mark.asyncio
    async def test_export_body_passthrough(self, client):
        with (
            patch.object(svc, "repo_query", new=AsyncMock(return_value=[])),
            patch.object(svc, "set_transfer_state", new=AsyncMock()),
            patch.object(
                svc,
                "start_export",
                new=AsyncMock(return_value="command:e1"),
            ) as start,
        ):
            response = client.post(
                "/api/data-transfer/export",
                json={"scope": "models", "include_models": False},
            )

        assert response.status_code == 200
        assert response.json()["command_id"] == "command:e1"
        start.assert_awaited_once_with("models", False)

    @pytest.mark.asyncio
    async def test_export_without_body_defaults_full(self, client):
        with (
            patch.object(svc, "repo_query", new=AsyncMock(return_value=[])),
            patch.object(svc, "set_transfer_state", new=AsyncMock()),
            patch.object(
                svc,
                "start_export",
                new=AsyncMock(return_value="command:e2"),
            ) as start,
        ):
            response = client.post("/api/data-transfer/export")

        assert response.status_code == 200
        start.assert_awaited_once_with("full", False)


class TestMaskSecret:
    def test_long_value_shows_last_four(self):
        assert svc.mask_secret("sk-1234567890") == "***7890"

    def test_short_value_fully_masked(self):
        assert svc.mask_secret("abc") == "***"
        assert svc.mask_secret("") is None
        assert svc.mask_secret(None) is None
