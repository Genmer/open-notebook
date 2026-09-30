"""Business logic for the data export/import feature (job orchestration and
status merges; the heavy lifting lives in commands/data_transfer_commands.py)."""

import asyncio
import hashlib
import json
import os
import shutil
import uuid
import zipfile
from contextlib import suppress
from typing import IO, Any, Dict, List, Optional

from fastapi import UploadFile
from loguru import logger

from api.command_service import CommandService
from api.models import (
    ImportExecuteRequest,
    ImportScanConflictItem,
    ImportScanResponse,
)
from commands.data_transfer_commands import (
    MODEL_CONFIG_TABLES,
    _open_member,
    _parse_member_row,
    _validate_package,
    fingerprint_payload,
    mask_secret,
    record_fingerprint,
    set_transfer_state,
)
from open_notebook.config import DATA_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query, repo_upsert
from open_notebook.exceptions import InvalidInputError
from open_notebook.utils.encryption import decrypt_value, get_fernet

EXPORTS_FOLDER = os.path.join(DATA_FOLDER, "exports")
IMPORTS_FOLDER = os.path.join(DATA_FOLDER, "imports")
# One pending upload at a time: scan overwrites it, execute consumes it.
# Derived from IMPORTS_FOLDER at call time so tests can redirect the folder.
PENDING_SCAN_ZIP_NAME = "pending_scan.zip"
PENDING_SCAN_SIDECAR_NAME = "pending_scan.json"


def pending_zip_path() -> str:
    return os.path.join(IMPORTS_FOLDER, PENDING_SCAN_ZIP_NAME)


def pending_sidecar_path() -> str:
    return os.path.join(IMPORTS_FOLDER, PENDING_SCAN_SIDECAR_NAME)

# state.progress.stage fallbacks for when the command record is gone (the
# command record itself stays authoritative while it exists).
_STAGE_STATUS = {
    "done": "completed",
    "failed": "failed",
    "queued": "queued",
    "idle": "none",
}

# surreal_commands hands back its CommandStatus str-Enum; str() on it yields
# "CommandStatus.COMPLETED" (Py 3.11+), so unwrap .value and map to the wire
# contract. Unrecognized values fall through to the stage fallback.
_COMMAND_STATUS = {
    "new": "queued",
    "running": "running",
    "completed": "completed",
    "failed": "failed",
    "canceled": "failed",
}


def _ensure_folders() -> None:
    os.makedirs(EXPORTS_FOLDER, exist_ok=True)
    os.makedirs(IMPORTS_FOLDER, exist_ok=True)


def _stream_to_file(src: IO[bytes], dst: str) -> None:
    with open(dst, "wb") as out:
        shutil.copyfileobj(src, out)


async def _reject_concurrent(command_name: str) -> None:
    verb = "export" if command_name == "export_data" else "import"
    rows = await repo_query(
        "SELECT id FROM command WHERE app = 'open_notebook' "
        "AND name = $name AND status IN ['new', 'running']",
        {"name": command_name},
    )
    if rows:
        raise InvalidInputError(f"A data {verb} job is already queued or running")


async def start_export(scope: str = "full", include_models: bool = False) -> str:
    await _reject_concurrent("export_data")
    # Reset the state record so the UI immediately leaves the previous run's
    # terminal state.
    await set_transfer_state("export", "queued", 0, "Export queued")
    try:
        command_id = await CommandService.submit_command_job(
            "open_notebook",
            "export_data",
            {
                "include_files": scope != "models",
                "include_models": include_models,
                "scope": scope,
            },
        )
    except Exception as e:
        await set_transfer_state("export", "failed", 100, error=str(e)[:500])
        raise
    return command_id


async def save_import_upload(upload_file: UploadFile) -> str:
    _ensure_folders()
    filename = upload_file.filename or ""
    if not filename.lower().endswith(".zip"):
        raise InvalidInputError("Import package must be a .zip file")
    if not upload_file.size:
        raise InvalidInputError("Import package is empty")
    tmp_path = os.path.join(IMPORTS_FOLDER, f".pending_scan.{uuid.uuid4()}.tmp")
    # Stream to disk, then atomically replace: only one pending package exists
    # at a time and readers never see a half-written zip.
    try:
        await asyncio.to_thread(_stream_to_file, upload_file.file, tmp_path)
        if os.path.getsize(tmp_path) == 0:
            raise InvalidInputError("Import package is empty")
        await asyncio.to_thread(os.replace, tmp_path, pending_zip_path())
    except Exception:
        with suppress(OSError):
            os.unlink(tmp_path)
        raise
    return pending_zip_path()


def _encryption_key_available() -> bool:
    try:
        get_fernet()
        return True
    except ValueError:
        return False


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def _parse_package_for_scan(package_path: str) -> Dict[str, Any]:
    """Zip member parsing for the conflict scan; runs in a worker thread."""
    with zipfile.ZipFile(package_path) as zf:
        manifest = _validate_package(zf)
        rows: Dict[str, List[Dict[str, Any]]] = {}
        for table in MODEL_CONFIG_TABLES:
            table_rows: List[Dict[str, Any]] = []
            with _open_member(zf, table) as member:
                for raw in member:
                    line = raw.decode("utf-8").strip()
                    if not line:
                        continue
                    table_rows.append(_parse_member_row(table, line))
            rows[table] = table_rows
    return {"manifest": manifest, "rows": rows}


def _credential_summary(
    row: Dict[str, Any], plain_key: Optional[str], model_count: int
) -> Dict[str, Any]:
    return {
        "name": row.get("name"),
        "provider": row.get("provider"),
        # Masked preview; null when the key is absent or undecryptable.
        "api_key": mask_secret(plain_key) if plain_key else None,
        "model_count": model_count,
    }


def _model_summary(
    row: Dict[str, Any], credential_names: Dict[str, str]
) -> Dict[str, Any]:
    cred = row.get("credential")
    cred_str = str(cred) if cred else None
    return {
        "name": row.get("name"),
        "provider": row.get("provider"),
        "type": row.get("type"),
        "credential": credential_names.get(cred_str) if cred_str else None,
    }


def _diff_fields(
    table: str,
    local_row: Dict[str, Any],
    pkg_row: Dict[str, Any],
    local_plain: Optional[str] = None,
    pkg_plain: Optional[str] = None,
) -> List[str]:
    local_payload = fingerprint_payload(table, local_row, api_key_plain=local_plain)
    pkg_payload = fingerprint_payload(table, pkg_row, api_key_plain=pkg_plain)
    return sorted(
        field
        for field in pkg_payload
        if local_payload.get(field) != pkg_payload.get(field)
    )


def _credential_conflict(
    rid_str: str,
    local_row: Dict[str, Any],
    pkg_row: Dict[str, Any],
    local_counts: Dict[str, int],
    pkg_counts: Dict[str, int],
) -> Optional[ImportScanConflictItem]:
    pkg_plain = str(pkg_row["api_key"]) if pkg_row.get("api_key") else None
    raw_local = local_row.get("api_key")
    local_plain: Optional[str] = None
    local_readable = True
    if raw_local:
        try:
            local_plain = decrypt_value(str(raw_local))
        except ValueError:
            # An unreadable local key (rotated OPEN_NOTEBOOK_ENCRYPTION_KEY)
            # can only be resolved by the user's skip/overwrite decision.
            local_readable = False
    if local_readable:
        local_fp = record_fingerprint("credential", local_row, api_key_plain=local_plain)
        if local_fp == record_fingerprint("credential", pkg_row, api_key_plain=pkg_plain):
            return None
        diff = _diff_fields("credential", local_row, pkg_row, local_plain, pkg_plain)
    else:
        local_plain = None
        diff = ["api_key"]
    return ImportScanConflictItem(
        kind="credential",
        id=rid_str,
        local=_credential_summary(
            local_row, local_plain, local_counts.get(rid_str, 0)
        ),
        package=_credential_summary(
            pkg_row, pkg_plain, pkg_counts.get(rid_str, 0)
        ),
        diff_fields=diff,
    )


def _model_conflict(
    rid_str: str,
    local_row: Dict[str, Any],
    pkg_row: Dict[str, Any],
    local_cred_names: Dict[str, str],
    pkg_cred_names: Dict[str, str],
) -> Optional[ImportScanConflictItem]:
    if record_fingerprint("model", local_row) == record_fingerprint("model", pkg_row):
        return None
    return ImportScanConflictItem(
        kind="model",
        id=rid_str,
        local=_model_summary(local_row, local_cred_names),
        package=_model_summary(pkg_row, pkg_cred_names),
        diff_fields=_diff_fields("model", local_row, pkg_row),
    )


def _write_scan_sidecar(data: Dict[str, Any]) -> None:
    with open(pending_sidecar_path(), "w", encoding="utf-8") as f:
        json.dump(data, f)


async def scan_import_package(package_path: str) -> ImportScanResponse:
    """Diff the uploaded package's model configuration against the local
    database and park both for the follow-up execute call."""
    await _reject_concurrent("import_data")
    try:
        parsed = await asyncio.to_thread(_parse_package_for_scan, package_path)
    except (ValueError, zipfile.BadZipFile) as e:
        raise InvalidInputError(f"Invalid import package: {e}") from e
    manifest = parsed["manifest"]
    pkg_rows = parsed["rows"]
    if any(r.get("api_key") for r in pkg_rows["credential"]):
        if not _encryption_key_available():
            raise InvalidInputError(
                "This package contains plain-text API keys; set "
                "OPEN_NOTEBOOK_ENCRYPTION_KEY on this instance before importing it"
            )

    local_credentials = {
        str(r.get("id")): r for r in await repo_query("SELECT * FROM credential") or []
    }
    local_models = {
        str(r.get("id")): r for r in await repo_query("SELECT * FROM model") or []
    }
    local_cred_names = {
        rid: str(r.get("name") or "") for rid, r in local_credentials.items()
    }
    pkg_cred_names = {
        str(r.get("id")): str(r.get("name") or "") for r in pkg_rows["credential"]
    }

    def _model_counts(models: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
        counts: Dict[str, int] = {}
        for model in models.values():
            cred = model.get("credential")
            if cred:
                counts[str(cred)] = counts.get(str(cred), 0) + 1
        return counts

    local_counts = _model_counts(local_models)
    pkg_counts = _model_counts({str(r["id"]): r for r in pkg_rows["model"]})

    conflicts: List[ImportScanConflictItem] = []
    for pkg_row in pkg_rows["credential"]:
        rid_str = str(pkg_row["id"])
        local_row = local_credentials.get(rid_str)
        if local_row is not None:
            item = _credential_conflict(
                rid_str, local_row, pkg_row, local_counts, pkg_counts
            )
            if item:
                conflicts.append(item)
    for pkg_row in pkg_rows["model"]:
        rid_str = str(pkg_row["id"])
        local_row = local_models.get(rid_str)
        if local_row is not None:
            item = _model_conflict(
                rid_str, local_row, pkg_row, local_cred_names, pkg_cred_names
            )
            if item:
                conflicts.append(item)

    scan_id = str(uuid.uuid4())
    # Bind the scan ticket to the exact zip bytes: execute refuses to submit
    # anything other than the package these conflicts were computed against.
    package_sha256 = await asyncio.to_thread(_file_sha256, package_path)
    await asyncio.to_thread(
        _write_scan_sidecar,
        {
            "scan_id": scan_id,
            "package_type": manifest.package_type,
            "format_version": manifest.format_version,
            "counts": manifest.counts,
            "package_sha256": package_sha256,
        },
    )
    return ImportScanResponse(
        scan_id=scan_id,
        package_type=manifest.package_type,
        format_version=manifest.format_version,
        counts=manifest.counts,
        conflicts=conflicts,
        decisions_required=len(conflicts),
    )


async def execute_import(request: ImportExecuteRequest) -> str:
    """Submit the previously scanned package with the user's conflict
    decisions; the scan sidecar doubles as the single-use execute ticket."""
    try:
        with open(pending_sidecar_path(), encoding="utf-8") as f:
            sidecar = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise InvalidInputError(
            "No scanned import package found; upload the package again"
        ) from e
    if sidecar.get("scan_id") != request.scan_id:
        raise InvalidInputError(
            "Scan does not match the pending package; upload the package again"
        )
    if not os.path.isfile(pending_zip_path()):
        raise InvalidInputError(
            "The scanned package is missing; upload the package again"
        )
    # The scan_id alone can go stale when a later upload replaces the pending
    # zip but fails its own scan; the content hash closes that gap.
    current_sha256 = await asyncio.to_thread(_file_sha256, pending_zip_path())
    if sidecar.get("package_sha256") != current_sha256:
        raise InvalidInputError(
            "The pending package changed since the scan; upload the package again"
        )

    await _reject_concurrent("import_data")
    await set_transfer_state("import", "queued", 0, "Import queued")
    try:
        command_id = await CommandService.submit_command_job(
            "open_notebook",
            "import_data",
            {
                "package_path": pending_zip_path(),
                "model_decisions": [decision.model_dump() for decision in request.decisions],
            },
        )
    except Exception as e:
        await set_transfer_state("import", "failed", 100, error=str(e)[:500])
        raise
    with suppress(OSError):
        await asyncio.to_thread(os.unlink, pending_sidecar_path())
    return command_id


async def get_transfer_status(kind: str) -> Dict[str, Any]:
    rows = await repo_query(
        "SELECT * FROM $id", {"id": ensure_record_id(f"data_transfer_state:{kind}")}
    )
    state = rows[0] if rows else None
    progress = (state or {}).get("progress") or {}
    response: Dict[str, Any] = {"status": "none"}
    command_id: Optional[str] = (state or {}).get("command_id")
    if command_id:
        response["command_id"] = str(command_id)
        try:
            command = await CommandService.get_command_status(str(command_id))
            status = command.get("status")
        except Exception as e:
            logger.warning(f"Could not look up transfer command {command_id}: {e}")
            status = None
        raw = getattr(status, "value", status) if status is not None else None
        mapped = _COMMAND_STATUS.get(str(raw)) if raw is not None else None
        if mapped:
            # The command record is authoritative for terminal states; the
            # state record drives stage/percent while running.
            response["status"] = mapped
    if response["status"] == "none" and progress:
        response["status"] = _STAGE_STATUS.get(str(progress.get("stage")), "running")
    if progress:
        response["progress"] = {
            "stage": progress.get("stage"),
            "percent": int(progress.get("percent") or 0),
            "message": progress.get("message"),
            "error": progress.get("error"),
            "detail": progress.get("detail"),
            "stages": progress.get("stages"),
        }
    result = (state or {}).get("result")
    if result:
        response["summary"] = result
    return response


async def delete_export_package() -> bool:
    rows = await repo_query(
        "SELECT * FROM $id", {"id": ensure_record_id("data_transfer_state:export")}
    )
    result = (rows[0] if rows else {}).get("result") or {}
    path = result.get("package_path")
    if not path:
        return False
    # Containment check: only ever delete files this feature wrote.
    if not str(os.path.abspath(path)).startswith(
        os.path.abspath(EXPORTS_FOLDER) + os.sep
    ):
        logger.warning(f"Refusing to delete export package outside exports dir: {path}")
        return False
    deleted = os.path.exists(path)
    if deleted:
        await asyncio.to_thread(os.unlink, path)
    # Explicit NONE clears the previous summary/command so the UI resets.
    await repo_upsert(
        "data_transfer_state",
        "data_transfer_state:export",
        {
            "kind": "export",
            "command_id": None,
            "progress": {
                "stage": "idle",
                "percent": 0,
                "message": "",
                "error": None,
            },
            "result": None,
        },
    )
    return deleted
