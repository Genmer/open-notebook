"""Business logic for the data export/import feature (job orchestration and
status merges; the heavy lifting lives in commands/data_transfer_commands.py)."""

import asyncio
import hashlib
import json
import os
import re
import shutil
import time
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
    _notebook_scope_filters,
    _open_member,
    _parse_member_row,
    _resolve_notebook_scope_ids,
    _validate_package,
    fingerprint_payload,
    mask_secret,
    record_fingerprint,
    set_transfer_state,
)
from open_notebook.config import DATA_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query, repo_upsert
from open_notebook.exceptions import InvalidInputError, NotFoundError
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


# --- Chunked import uploads -------------------------------------------------
#
# Packages beyond a few dozen MB get fragile on flaky links as one request:
# any hiccup restarts from zero and the 1 GB middleware ceiling still applies
# per request. The chunked path splits the file client-side, PUTs 8 MB parts
# idempotently, and resumes from whatever parts already sit on disk.

CHUNK_SESSIONS_FOLDER = os.path.join(IMPORTS_FOLDER, "chunk_sessions")
DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024
MIN_CHUNK_SIZE = 512 * 1024
MAX_CHUNK_SIZE = 64 * 1024 * 1024
MAX_TOTAL_CHUNKS = 20_000
# Stale resume sessions older than this are purged whenever a new one starts.
CHUNK_SESSION_MAX_AGE_S = 24 * 3600
_UPLOAD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _chunk_session_dir(upload_id: str) -> str:
    if not _UPLOAD_ID_RE.match(upload_id):
        raise InvalidInputError("Invalid upload id")
    return os.path.join(CHUNK_SESSIONS_FOLDER, upload_id)


def _chunk_session_meta_path(upload_id: str) -> str:
    return os.path.join(_chunk_session_dir(upload_id), "session.json")


def _read_chunk_session(upload_id: str) -> Dict[str, Any]:
    meta_path = _chunk_session_meta_path(upload_id)
    if not os.path.isfile(meta_path):
        raise NotFoundError(f"Unknown chunk upload session {upload_id}")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    # Disk is the truth for resume: list the parts that actually landed.
    parts_dir = _chunk_session_dir(upload_id)
    uploaded = set()
    with suppress(OSError):
        for name in os.listdir(parts_dir):
            match = re.fullmatch(r"(\d+)\.part", name)
            if match:
                uploaded.add(int(match.group(1)))
    meta["uploaded_chunks"] = sorted(uploaded)
    return meta


def _purge_stale_chunk_sessions() -> None:
    """Best-effort cleanup of abandoned resume sessions."""
    now = time.time()
    with suppress(OSError):
        for name in os.listdir(CHUNK_SESSIONS_FOLDER):
            path = os.path.join(CHUNK_SESSIONS_FOLDER, name)
            try:
                if now - os.path.getmtime(path) > CHUNK_SESSION_MAX_AGE_S:
                    shutil.rmtree(path, ignore_errors=True)
            except OSError:
                continue


def create_chunk_session(
    filename: str,
    total_size: int,
    chunk_size: int,
    total_chunks: int,
    client_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Start (or resume) a chunked upload; same client_key reuses its session."""
    _ensure_folders()
    if not filename.lower().endswith(".zip"):
        raise InvalidInputError("Import package must be a .zip file")
    if total_size <= 0:
        raise InvalidInputError("Import package is empty")
    if not MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE:
        raise InvalidInputError(
            f"chunk_size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} bytes"
        )
    if total_chunks != (total_size + chunk_size - 1) // chunk_size:
        raise InvalidInputError("total_chunks does not match total_size/chunk_size")
    if total_chunks > MAX_TOTAL_CHUNKS:
        raise InvalidInputError(
            f"Too many chunks (>{MAX_TOTAL_CHUNKS}); raise chunk_size"
        )

    os.makedirs(CHUNK_SESSIONS_FOLDER, exist_ok=True)
    _purge_stale_chunk_sessions()

    meta = {
        "filename": os.path.basename(filename),
        "total_size": total_size,
        "chunk_size": chunk_size,
        "total_chunks": total_chunks,
        "client_key": client_key,
        "created": time.time(),
    }

    # Resume: an unfinished session for the same client key continues where
    # it stopped (page refresh, retried dialog, network drop).
    if client_key:
        with suppress(OSError):
            for name in os.listdir(CHUNK_SESSIONS_FOLDER):
                candidate = os.path.join(CHUNK_SESSIONS_FOLDER, name, "session.json")
                if not os.path.isfile(candidate):
                    continue
                try:
                    with open(candidate, encoding="utf-8") as f:
                        existing = json.load(f)
                except (OSError, ValueError):
                    continue
                same_file = (
                    existing.get("client_key") == client_key
                    and existing.get("total_size") == total_size
                    and existing.get("chunk_size") == chunk_size
                )
                merged = os.path.join(
                    CHUNK_SESSIONS_FOLDER, name, PENDING_SCAN_ZIP_NAME
                )
                if same_file and not os.path.isfile(merged):
                    return _read_chunk_session(name)

    upload_id = uuid.uuid4().hex
    session_dir = _chunk_session_dir(upload_id)
    os.makedirs(session_dir, exist_ok=True)
    meta["upload_id"] = upload_id
    with open(_chunk_session_meta_path(upload_id), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    meta["uploaded_chunks"] = []
    return meta


def save_import_chunk(
    upload_id: str, index: int, data: bytes, sha256_hex: Optional[str]
) -> Dict[str, Any]:
    meta = _read_chunk_session(upload_id)
    if not 0 <= index < meta["total_chunks"]:
        raise InvalidInputError(f"Chunk index out of range: {index}")
    if len(data) > meta["chunk_size"]:
        raise InvalidInputError("Chunk larger than the declared chunk_size")
    expected_last = meta["total_size"] - meta["chunk_size"] * (meta["total_chunks"] - 1)
    if index == meta["total_chunks"] - 1 and len(data) != expected_last:
        raise InvalidInputError(
            "Final chunk size mismatch: the file changed while uploading?"
        )
    if sha256_hex:
        digest = hashlib.sha256(data).hexdigest()
        if digest != sha256_hex.lower():
            raise InvalidInputError(
                f"Chunk {index} failed integrity check; please resend it"
            )
    part_path = os.path.join(_chunk_session_dir(upload_id), f"{index:06d}.part")
    tmp_path = f"{part_path}.tmp"
    with open(tmp_path, "wb") as out:
        out.write(data)
    os.replace(tmp_path, part_path)
    return {"received": index, "size": len(data)}


def _merge_chunk_session(upload_id: str, meta: Dict[str, Any]) -> str:
    session_dir = _chunk_session_dir(upload_id)
    merged_tmp = os.path.join(session_dir, f".{PENDING_SCAN_ZIP_NAME}.tmp")
    written = 0
    with open(merged_tmp, "wb") as out:
        for index in range(meta["total_chunks"]):
            part_path = os.path.join(session_dir, f"{index:06d}.part")
            with open(part_path, "rb") as part:
                shutil.copyfileobj(part, out)
                written += part.tell()
    if written != meta["total_size"]:
        os.unlink(merged_tmp)
        raise InvalidInputError(
            f"Merged size {written} != declared {meta['total_size']}"
        )
    return merged_tmp


async def complete_chunk_session(
    upload_id: str, sha256_hex: Optional[str] = None
) -> ImportScanResponse:
    """Merge all parts into the pending slot, scan it, drop the session."""
    meta = _read_chunk_session(upload_id)
    missing = [
        index
        for index in range(meta["total_chunks"])
        if not os.path.isfile(
            os.path.join(_chunk_session_dir(upload_id), f"{index:06d}.part")
        )
    ]
    if missing:
        raise InvalidInputError(
            f"Cannot complete: {len(missing)} chunk(s) missing "
            f"(first missing: {missing[0]})"
        )
    merged_tmp = await asyncio.to_thread(_merge_chunk_session, upload_id, meta)
    if sha256_hex:
        actual = await asyncio.to_thread(_file_sha256, merged_tmp)
        if actual != sha256_hex.lower():
            with suppress(OSError):
                os.unlink(merged_tmp)
            raise InvalidInputError("Package integrity check failed (sha256 mismatch)")
    await asyncio.to_thread(os.replace, merged_tmp, pending_zip_path())
    shutil.rmtree(_chunk_session_dir(upload_id), ignore_errors=True)
    return await scan_import_package(pending_zip_path())


def delete_chunk_session(upload_id: str) -> bool:
    session_dir = _chunk_session_dir(upload_id)
    if not os.path.isdir(session_dir):
        return False
    shutil.rmtree(session_dir, ignore_errors=True)
    return True


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


async def start_export(
    scope: str = "full",
    include_models: bool = False,
    notebook_ids: Optional[List[str]] = None,
) -> str:
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
                "notebook_ids": notebook_ids or [],
            },
        )
    except Exception as e:
        await set_transfer_state("export", "failed", 100, error=str(e)[:500])
        raise
    return command_id


# Zip deflate compression observed on ndjson payloads of mixed CJK text and
# float-array vectors; the estimate is a "~" figure, not a promise.
_TEXT_COMPRESSION_RATIO = 0.45
# Sample sizes for the averaging queries: enough for a stable mean, small
# enough to keep the estimate endpoint snappy (vectors are wide rows).
_CHARS_SAMPLE_ROWS = 25
_EMBEDDING_SAMPLE_ROWS = 3


async def _scope_where(
    scope: str, notebook_ids: Optional[List[str]]
) -> Dict[str, tuple]:
    """WHERE clause per table for the requested export scope (estimate path).

    Mirrors the command's notebook-scope filters so the preview matches what
    the package would actually contain.
    """
    if scope != "notebooks":
        return {}
    selected = await _resolve_notebook_scope_ids(notebook_ids or [])
    if not selected:
        raise InvalidInputError("scope='notebooks' requires at least one notebook id")
    selected_rids = [ensure_record_id(v) for v in selected]
    # The notebook→source membership edge is `reference` (in=source,
    # out=notebook — see Notebook.get_sources); SELECT VALUE yields bare
    # values, not {in: ...} row objects.
    sources = [
        str(r)
        for r in await repo_query(
            "SELECT VALUE in FROM reference WHERE out IN $notebooks",
            {"notebooks": selected_rids},
        )
        or []
        if r is not None
    ]
    notes = [
        str(r)
        for r in await repo_query(
            "SELECT VALUE in FROM artifact WHERE out IN $notebooks",
            {"notebooks": selected_rids},
        )
        or []
        if r is not None
    ]
    return _notebook_scope_filters(selected, sources, notes)


async def _count_where(table: str, where: tuple = ("", None)) -> int:
    clause, params = where
    # GROUP ALL is what makes count() aggregate: without it SurrealDB emits
    # one {count: 1} per row and the first row lies (see _count_table).
    sql = f"SELECT VALUE count() FROM {table}"
    if clause:
        sql += f" WHERE {clause}"
    sql += " GROUP ALL"
    rows = await repo_query(sql, params)
    if not rows:
        return 0
    first = rows[0]
    return int(first.get("count") or 0) if isinstance(first, dict) else int(first)


async def estimate_export(
    scope: str = "full", notebook_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Preview of what an export would contain, without touching the worker.

    Exact where cheap (counts, asset file sizes), sampled where the full scan
    would cost more than the answer is worth (text chars, embedding row
    bytes); the package-size figure is marked as an estimate on the wire.
    """
    filters = await _scope_where(scope, notebook_ids)

    source_count = await _count_where("source", filters.get("source", ("", None)))
    note_count = await _count_where("note", filters.get("note", ("", None)))
    notebook_count = await _count_where("notebook", filters.get("notebook", ("", None)))
    insight_count = await _count_where(
        "source_insight", filters.get("source_insight", ("", None))
    )
    embedding_count = await _count_where(
        "source_embedding", filters.get("source_embedding", ("", None))
    )

    # Asset files: pull the asset column only, then stat the files that exist.
    asset_where, asset_params = filters.get("source", ("", None))
    asset_sql = "SELECT asset FROM source"
    if asset_where:
        asset_sql += f" WHERE {asset_where}"
    asset_rows = await repo_query(asset_sql, asset_params) or []

    def _total_asset_bytes() -> tuple:
        total = 0
        found = 0
        for row in asset_rows:
            asset = row.get("asset")
            path = asset.get("file_path", "").strip() if isinstance(asset, dict) else ""
            if not path:
                continue
            try:
                size = os.path.getsize(path)
            except OSError:
                continue
            found += 1
            total += size
        return total, found

    asset_bytes, asset_files = await asyncio.to_thread(_total_asset_bytes)

    # Text volume: mean sampled length x count (a full scan of every
    # full_text would dominate the endpoint's runtime for large libraries).
    chars_where, chars_params = filters.get("source", ("", None))
    chars_sql = "SELECT string::len(full_text) AS l FROM source WHERE full_text != NONE"
    if chars_where:
        chars_sql += f" AND {chars_where}"
    chars_sql += f" LIMIT {_CHARS_SAMPLE_ROWS}"
    sample_rows = await repo_query(chars_sql, chars_params) or []
    mean_chars = (
        sum(int(r.get("l") or 0) for r in sample_rows) / len(sample_rows)
        if sample_rows
        else 0.0
    )
    text_chars = int(mean_chars * source_count)

    # Embedding ndjson bytes: sample a few full rows, serialize them the way
    # the export writer does, average. Vectors dominate the row size.
    emb_where, emb_params = filters.get("source_embedding", ("", None))
    emb_sql = "SELECT * FROM source_embedding"
    if emb_where:
        emb_sql += f" WHERE {emb_where}"
    emb_sql += f" LIMIT {_EMBEDDING_SAMPLE_ROWS}"
    emb_rows = await repo_query(emb_sql, emb_params) or []
    mean_emb_bytes = (
        sum(len(json.dumps(r, default=str)) for r in emb_rows) / len(emb_rows)
        if emb_rows
        else 0.0
    )
    embedding_bytes = int(mean_emb_bytes * embedding_count)

    text_bytes_estimate = int((text_chars + embedding_bytes) * _TEXT_COMPRESSION_RATIO)
    estimated_package_bytes = asset_bytes + text_bytes_estimate

    return {
        "scope": scope,
        "notebook_ids": notebook_ids or [],
        "notebooks": notebook_count,
        "sources": source_count,
        "notes": note_count,
        "insights": insight_count,
        "embeddings": embedding_count,
        "asset_files": asset_files,
        "asset_bytes": asset_bytes,
        "text_chars": text_chars,
        "estimated_package_bytes": estimated_package_bytes,
    }


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
        local_fp = record_fingerprint(
            "credential", local_row, api_key_plain=local_plain
        )
        if local_fp == record_fingerprint(
            "credential", pkg_row, api_key_plain=pkg_plain
        ):
            return None
        diff = _diff_fields("credential", local_row, pkg_row, local_plain, pkg_plain)
    else:
        local_plain = None
        diff = ["api_key"]
    return ImportScanConflictItem(
        kind="credential",
        id=rid_str,
        local=_credential_summary(local_row, local_plain, local_counts.get(rid_str, 0)),
        package=_credential_summary(pkg_row, pkg_plain, pkg_counts.get(rid_str, 0)),
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
                "model_decisions": [
                    decision.model_dump() for decision in request.decisions
                ],
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
