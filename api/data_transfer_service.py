"""Business logic for the data export/import feature (job orchestration and
status merges; the heavy lifting lives in commands/data_transfer_commands.py)."""

import asyncio
import os
import shutil
import uuid
from contextlib import suppress
from typing import IO, Any, Dict, Optional

from fastapi import UploadFile
from loguru import logger

from api.command_service import CommandService
from commands.data_transfer_commands import set_transfer_state
from open_notebook.config import DATA_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query, repo_upsert
from open_notebook.exceptions import InvalidInputError

EXPORTS_FOLDER = os.path.join(DATA_FOLDER, "exports")
IMPORTS_FOLDER = os.path.join(DATA_FOLDER, "imports")

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


async def start_export() -> str:
    await _reject_concurrent("export_data")
    # Reset the state record so the UI immediately leaves the previous run's
    # terminal state.
    await set_transfer_state("export", "queued", 0, "Export queued")
    try:
        command_id = await CommandService.submit_command_job(
            "open_notebook", "export_data", {"include_files": True}
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
    path = os.path.join(IMPORTS_FOLDER, f"{uuid.uuid4()}.zip")
    # Stream to disk: the request body is already capped by the upload
    # middleware, but holding the whole zip in memory is still unnecessary.
    try:
        await asyncio.to_thread(_stream_to_file, upload_file.file, path)
        if os.path.getsize(path) == 0:
            raise InvalidInputError("Import package is empty")
    except Exception:
        with suppress(OSError):
            os.unlink(path)
        raise
    return path


async def start_import(package_path: str) -> str:
    await _reject_concurrent("import_data")
    await set_transfer_state("import", "queued", 0, "Import queued")
    try:
        command_id = await CommandService.submit_command_job(
            "open_notebook", "import_data", {"package_path": package_path}
        )
    except Exception as e:
        await set_transfer_state("import", "failed", 100, error=str(e)[:500])
        raise
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
