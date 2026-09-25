"""Data export/import commands: package notebooks, sources, notes, groups and
their files/vectors into one zip and restore them into another environment.

Key invariants (ADR-011):
- Progress lives in data_transfer_state:{export,import}; surreal-commands has
  no native progress API.
- Writes are inline-id CREATE/RELATE SQL (or UPSERT MERGE for singleton configs),
  never domain save() (Source.save drops embedding progress fields, Note.save
  submits embed jobs).
- Import skips whole records by id for data/edges: existing files, embeddings
  and edges are never touched; singleton config records (content_settings,
  default_prompts) are safely merged with whitelisted fields.
"""

import asyncio
import hashlib
import json
import os
import re
import time
import zipfile
from contextlib import nullcontext, suppress
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as pkg_version
from typing import (
    Any,
    AsyncIterator,
    ContextManager,
    Dict,
    Iterator,
    List,
    Optional,
    Set,
    Tuple,
)

import numpy as np
from loguru import logger
from pydantic import BaseModel, Field, ValidationError
from surreal_commands import CommandInput, CommandOutput, command
from surrealdb import RecordID

from open_notebook.ai.models import DefaultModels
from open_notebook.config import DATA_FOLDER, UPLOADS_FOLDER
from open_notebook.database.repository import (
    ensure_record_id,
    repo_query,
)
from open_notebook.domain.source_grouping import DEFAULT_VIEW_IDS, ensure_default_views

# Package-validation errors (bad manifest, unsupported version, illegal member
# name) are permanent ValueErrors; transient DB errors retry safely because
# both commands are idempotent (fresh tmp zip / id-skip semantics).
TRANSFER_RETRY_CONFIG = {
    "max_attempts": 3,
    "wait_strategy": "exponential_jitter",
    "wait_min": 5,
    "wait_max": 60,
    "stop_on": [ValueError],
    "retry_log_level": "warning",
}

FORMAT_VERSION = 1
EXPORT_BATCH = 500
WRITE_BATCH = 100
COPY_CHUNK = 1024 * 1024

EXPORTS_FOLDER = os.path.join(DATA_FOLDER, "exports")

DEFAULT_MAX_IMPORT_UNCOMPRESSED_MB = 4096

# Import write order keeps referenced records (views/groups) ahead of their
# dependents; SurrealDB does not enforce it but logs stay reviewable.
DATA_TABLES = (
    "notebook",
    "transformation",
    "source_view",
    "source_group",
    "source",
    "source_insight",
    "note",
)
EDGE_TABLES = ("reference", "artifact", "source_group_member")
EMBEDDING_TABLE = "source_embedding"
# Single-record tables living at fixed ids (open_notebook:<table>), not at
# <table>:<key>; export reads them with LIMIT 1 and import MERGEs unconditionally.
CONFIG_TABLES = ("content_settings", "default_prompts")
ALL_TABLES = DATA_TABLES + EDGE_TABLES + (EMBEDDING_TABLE,) + CONFIG_TABLES

# The query layer physically excludes credential/model_usage/command/
# chat_session/refers_to: none of them appears in any query string below.
SOURCE_EXPORT_COLUMNS = (
    "id, asset, title, topics, full_text, last_viewed_at, embedding_status, "
    "embedding_error, total_chunks, embedded_chunks, created, updated"
)
EMBEDDING_EXPORT_COLUMNS = "id, source, order, content, embedding"

EXPORT_STAGES = {
    "collecting": (0, 10),
    "exporting_tables": (10, 30),
    "copying_files": (40, 25),
    "exporting_embeddings": (65, 25),
    "packaging": (90, 9),
}

IMPORT_STAGES = {
    "validating": (0, 8),
    "precheck": (8, 7),
    "metadata": (15, 25),
    "files": (40, 20),
    "embeddings": (60, 25),
    "relations": (85, 10),
}

# Field whitelist for both directions; keys outside it are dropped on import.
TABLE_FIELDS: Dict[str, Tuple[str, ...]] = {
    "notebook": ("name", "description", "archived", "created", "updated"),
    "source": (
        "asset",
        "title",
        "topics",
        "full_text",
        "last_viewed_at",
        "embedding_status",
        "embedding_error",
        "total_chunks",
        "embedded_chunks",
        "created",
        "updated",
    ),
    "source_insight": (
        "source",
        "insight_type",
        "content",
        "embedding",
        "created",
        "updated",
    ),
    "note": (
        "title",
        "note_type",
        "summary",
        "content",
        "embedding",
        "created",
        "updated",
    ),
    "transformation": (
        "name",
        "title",
        "description",
        "prompt",
        "apply_default",
        "model_id",
        "created",
        "updated",
    ),
    "source_view": ("name", "view_type", "last_classified_at", "created", "updated"),
    "source_group": ("name", "source_view", "parent", "created", "updated"),
    EMBEDDING_TABLE: ("source", "order", "content", "embedding"),
    "content_settings": (
        "default_content_processing_engine_doc",
        "default_content_processing_engine_url",
        "default_embedding_option",
        "auto_delete_files",
        "docling_ocr",
        "docling_formulas",
        "docling_vision",
        "youtube_preferred_languages",
        "chunk_size",
        "chunk_overlap",
        "min_chunk_size",
        "embedding_batch_size",
        "usage_tracking_enabled",
    ),
    "default_prompts": (
        "transformation_instructions",
    ),
}
ASSET_FIELDS = ("file_path", "url")

RECORD_FIELDS: Dict[str, Set[str]] = {
    "source_insight": {"source"},
    "transformation": {"model_id"},
    "source_group": {"source_view", "parent"},
    EMBEDDING_TABLE: {"source"},
}
DATETIME_FIELDS = {"created", "updated", "last_viewed_at", "last_classified_at"}

SOURCE_ID_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")

# Zip member whitelist; anything else rejects the whole package (zip-slip etc).
_MEMBER_PATTERNS = (
    re.compile(r"^manifest\.json$"),
    re.compile(r"^data/[a-z_]+\.ndjson$"),
    re.compile(r"^files/[A-Za-z0-9_-]{1,128}/[^/\\]+$"),
)


class ExportDataInput(CommandInput):
    include_files: bool = True


class ExportDataOutput(CommandOutput):
    success: bool
    package_path: Optional[str] = None
    package_size_bytes: int = 0
    counts: Dict[str, int] = {}
    files_skipped: int = 0
    processing_time: float = 0.0
    error_message: Optional[str] = None


class ImportDataInput(CommandInput):
    package_path: str


class ImportDataOutput(CommandOutput):
    success: bool
    imported: Dict[str, int] = {}
    skipped: Dict[str, int] = {}
    warnings: List[str] = []
    processing_time: float = 0.0
    error_message: Optional[str] = None


class ManifestFileEntry(BaseModel):
    sha256: str
    size: int


class ManifestEmbedding(BaseModel):
    model_id: Optional[str] = None
    dominant_dimension: Optional[int] = None


class PackageManifest(BaseModel):
    format_version: int
    app_version: str = "unknown"
    exported_at: Optional[str] = None
    embedding: ManifestEmbedding = Field(default_factory=ManifestEmbedding)
    counts: Dict[str, int] = Field(default_factory=dict)
    files: Dict[str, ManifestFileEntry] = Field(default_factory=dict)


def get_command_id(input_data: CommandInput) -> str:
    if input_data.execution_context:
        return str(input_data.execution_context.command_id)
    return "unknown"


def _rid_sql(record_id: RecordID) -> str:
    """Render a RecordID as safe SQL text (angle quoting covers keys SurrealDB
    would not parse bare)."""
    key = str(record_id.id)
    table = str(record_id.table_name)
    if not re.fullmatch(r"[A-Za-z0-9_]+", key):
        key = f"⟨{key}⟩"
    return f"{table}:{key}"


async def set_transfer_state(
    kind: str,
    stage: str,
    percent: int,
    message: str = "",
    error: Optional[str] = None,
    command_id: Optional[str] = None,
    result: Optional[Dict[str, Any]] = None,
) -> None:
    """Best-effort progress write; a failure here must not kill the job."""
    # SET assigns each field wholesale; repo_upsert's MERGE would deep-merge
    # nested objects, leaving stale keys inside a fresh result (e.g. an empty
    # imported dict from a no-op rerun keeping the previous run's counts).
    assignments = ["kind = $kind", "progress = $progress"]
    params: Dict[str, Any] = {
        "target": ensure_record_id(f"data_transfer_state:{kind}"),
        "kind": kind,
        "progress": {
            "stage": stage,
            "percent": percent,
            "message": message,
            "error": error,
        },
    }
    if command_id:
        assignments.append("command_id = $command_id")
        params["command_id"] = command_id
    if result is not None:
        assignments.append("result = $result")
        params["result"] = result
    try:
        await repo_query(f"UPSERT $target SET {', '.join(assignments)}", params)
    except Exception as e:
        logger.warning(f"Failed to update data_transfer_state:{kind}: {e}")


def _stage_percent(
    stages: Dict[str, Tuple[int, int]], stage: str, done: int, total: int
) -> int:
    base, span = stages[stage]
    if total <= 0:
        return base
    return base + int(span * done / total)


def _app_version() -> str:
    try:
        return pkg_version("open-notebook")
    except PackageNotFoundError:
        return "unknown"


def _max_import_uncompressed_bytes() -> int:
    raw = os.environ.get("OPEN_NOTEBOOK_MAX_IMPORT_UNCOMPRESSED_MB", "").strip()
    try:
        mb = float(raw) if raw else DEFAULT_MAX_IMPORT_UNCOMPRESSED_MB
    except ValueError:
        mb = DEFAULT_MAX_IMPORT_UNCOMPRESSED_MB
    if mb <= 0:
        mb = DEFAULT_MAX_IMPORT_UNCOMPRESSED_MB
    return int(mb * 1024 * 1024)


async def _current_embedding_model_id() -> Optional[str]:
    try:
        defaults = await DefaultModels.get_instance()
        return defaults.default_embedding_model or None
    except Exception as e:
        logger.warning(f"Could not read default embedding model: {e}")
        return None


def _file_sha256(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


async def _count_table(table: str) -> int:
    rows = await repo_query(f"SELECT VALUE count() FROM {table} GROUP ALL")
    if not rows:
        return 0
    first = rows[0]
    if isinstance(first, dict):
        return int(first.get("count") or 0)
    return int(first)


async def _fetch_record_row(table: str) -> Optional[Dict[str, Any]]:
    rows = await repo_query(f"SELECT * FROM open_notebook:{table} LIMIT 1")
    return rows[0] if rows else None


async def _iter_paged(
    columns: str,
    table: str,
    where: str = "",
    base_params: Optional[Dict[str, Any]] = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Keyset pagination (RecordID comparison, verified on SurrealDB 2.6.5)."""
    last: Optional[RecordID] = None
    while True:
        params = dict(base_params or {})
        clauses = [where] if where else []
        if last is not None:
            clauses.append("id > $last")
            params["last"] = last
        params["limit"] = EXPORT_BATCH
        where_sql = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = (
            await repo_query(
                f"SELECT {columns} FROM {table}{where_sql} ORDER BY id LIMIT $limit",
                params,
            )
            or []
        )
        for row in rows:
            yield row
        if len(rows) < EXPORT_BATCH:
            return
        last = ensure_record_id(str(rows[-1]["id"]))


def _export_row(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"id": str(row.get("id"))}
    allowed = TABLE_FIELDS[table]
    for key, value in row.items():
        if key != "id" and key in allowed:
            payload[key] = value
    return payload


def _write_ndjson_line(member: Any, payload: Dict[str, Any]) -> None:
    member.write((json.dumps(payload, default=str) + "\n").encode("utf-8"))


@command("export_data", app="open_notebook", retry=TRANSFER_RETRY_CONFIG)
async def export_data_command(input_data: ExportDataInput) -> ExportDataOutput:
    start = time.time()
    cmd_id = get_command_id(input_data)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"open_notebook_export_{ts}.zip"
    tmp_path = os.path.join(EXPORTS_FOLDER, f".export_{ts}.zip.tmp")
    final_path = os.path.join(EXPORTS_FOLDER, filename)

    counts: Dict[str, int] = {}
    files_manifest: Dict[str, Dict[str, Any]] = {}
    file_refs: List[Tuple[str, str]] = []  # (source id key, absolute file path)
    files_skipped = 0
    lengths: List[int] = []

    await set_transfer_state("export", "starting", 0, command_id=cmd_id)
    try:
        await asyncio.to_thread(os.makedirs, EXPORTS_FOLDER, exist_ok=True)

        await set_transfer_state(
            "export", "collecting", EXPORT_STAGES["collecting"][0]
        )
        for i, table in enumerate(ALL_TABLES):
            if table in CONFIG_TABLES:
                counts[table] = 1 if await _fetch_record_row(table) else 0
            else:
                counts[table] = await _count_table(table)
            await set_transfer_state(
                "export",
                "collecting",
                _stage_percent(EXPORT_STAGES, "collecting", i + 1, len(ALL_TABLES)),
                f"Collecting metadata (tables {i + 1}/{len(ALL_TABLES)})",
            )

        export_tables = DATA_TABLES + EDGE_TABLES
        with zipfile.ZipFile(
            tmp_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6
        ) as zf:
            await set_transfer_state(
                "export", "exporting_tables", EXPORT_STAGES["exporting_tables"][0]
            )
            for i, table in enumerate(export_tables):
                if table == "source":
                    columns, where, params = SOURCE_EXPORT_COLUMNS, "", None
                elif table == "source_view":
                    columns = "*"
                    where = "id NOT IN $defaults"
                    params = {
                        "defaults": [ensure_record_id(v) for v in DEFAULT_VIEW_IDS]
                    }
                else:
                    columns, where, params = "*", "", None
                columns = "id, in, out" if table in EDGE_TABLES else columns
                written = 0
                with zf.open(f"data/{table}.ndjson", "w") as member:
                    async for row in _iter_paged(columns, table, where, params):
                        written += 1
                        if table in EDGE_TABLES:
                            payload = {
                                "in": str(row.get("in")),
                                "out": str(row.get("out")),
                            }
                        else:
                            payload = _export_row(table, row)
                            if table == "source":
                                asset = row.get("asset")
                                file_path = (
                                    asset.get("file_path", "").strip()
                                    if isinstance(asset, dict)
                                    else ""
                                )
                                if file_path:
                                    rid = ensure_record_id(str(row["id"]))
                                    file_refs.append((str(rid.id), file_path))
                        _write_ndjson_line(member, payload)
                # counts must describe the package contents, not the source
                # table (source_view rows are filtered down on export).
                counts[table] = written
                await set_transfer_state(
                    "export",
                    "exporting_tables",
                    _stage_percent(
                        EXPORT_STAGES, "exporting_tables", i + 1, len(export_tables)
                    ),
                    f"Exporting {table} ({i + 1}/{len(export_tables)})",
                )

            for table in CONFIG_TABLES:
                row = await _fetch_record_row(table)
                written = 0
                if row is not None:
                    with zf.open(f"data/{table}.ndjson", "w") as member:
                        _write_ndjson_line(member, _export_row(table, row))
                        written = 1
                counts[table] = written

            if input_data.include_files:
                await set_transfer_state(
                    "export", "copying_files", EXPORT_STAGES["copying_files"][0]
                )
                total_files = len(file_refs)
                for idx, (sid_key, file_path) in enumerate(file_refs):
                    basename = os.path.basename(file_path)
                    if not SOURCE_ID_KEY_RE.match(sid_key) or not basename:
                        files_skipped += 1
                        continue
                    if not await asyncio.to_thread(os.path.isfile, file_path):
                        files_skipped += 1
                        continue
                    digest = await asyncio.to_thread(_file_sha256, file_path)
                    size = await asyncio.to_thread(os.path.getsize, file_path)
                    arcname = f"files/{sid_key}/{basename}"
                    await asyncio.to_thread(zf.write, file_path, arcname)
                    files_manifest[arcname] = {"sha256": digest, "size": size}
                    await set_transfer_state(
                        "export",
                        "copying_files",
                        _stage_percent(
                            EXPORT_STAGES, "copying_files", idx + 1, total_files
                        ),
                        f"Copying files ({idx + 1}/{total_files})",
                    )
            else:
                await set_transfer_state(
                    "export",
                    "copying_files",
                    EXPORT_STAGES["copying_files"][0],
                    "Skipping files (data-only export)",
                )

            await set_transfer_state(
                "export",
                "exporting_embeddings",
                EXPORT_STAGES["exporting_embeddings"][0],
            )
            total_chunks = counts.get(EMBEDDING_TABLE, 0)
            written = 0
            with zf.open(f"data/{EMBEDDING_TABLE}.ndjson", "w") as member:
                async for row in _iter_paged(
                    EMBEDDING_EXPORT_COLUMNS, EMBEDDING_TABLE
                ):
                    vec = row.get("embedding")
                    if isinstance(vec, list):
                        lengths.append(len(vec))
                    _write_ndjson_line(
                        member,
                        {
                            "id": str(row.get("id")),
                            "source": str(row.get("source")),
                            "order": row.get("order"),
                            "content": row.get("content"),
                            "embedding": vec,
                        },
                    )
                    written += 1
                    if written % EXPORT_BATCH == 0:
                        await set_transfer_state(
                            "export",
                            "exporting_embeddings",
                            _stage_percent(
                                EXPORT_STAGES,
                                "exporting_embeddings",
                                written,
                                total_chunks,
                            ),
                            f"Exporting embeddings ({written}/{total_chunks})",
                        )

            await set_transfer_state(
                "export", "packaging", EXPORT_STAGES["packaging"][0], "Packaging"
            )
            dominant = int(np.argmax(np.bincount(lengths))) if lengths else 0
            manifest: Dict[str, Any] = {
                "format_version": FORMAT_VERSION,
                "app_version": _app_version(),
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "embedding": {
                    "model_id": await _current_embedding_model_id(),
                    "dominant_dimension": dominant or None,
                },
                "counts": {**counts, "files": len(files_manifest)},
                "files": files_manifest,
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))

        await asyncio.to_thread(os.replace, tmp_path, final_path)
        package_size = await asyncio.to_thread(os.path.getsize, final_path)

        result = {
            "package_path": final_path,
            "package_filename": filename,
            "package_size_bytes": package_size,
            "counts": manifest["counts"],
            "files_skipped": files_skipped,
            "embedding_model_id": manifest["embedding"]["model_id"],
            "embedding_dimension": manifest["embedding"]["dominant_dimension"],
            "exported_at": manifest["exported_at"],
        }
        await set_transfer_state(
            "export",
            "done",
            100,
            f"Export complete: {counts.get('source', 0)} sources, "
            f"{counts.get(EMBEDDING_TABLE, 0)} chunks, {len(files_manifest)} files",
            result=result,
        )
        logger.info(f"[export] wrote {final_path} ({package_size} bytes)")
        return ExportDataOutput(
            success=True,
            package_path=final_path,
            package_size_bytes=package_size,
            counts=manifest["counts"],
            files_skipped=files_skipped,
            processing_time=time.time() - start,
        )
    except Exception as e:
        await set_transfer_state("export", "failed", 100, error=str(e)[:500])
        with suppress(OSError):
            await asyncio.to_thread(os.unlink, tmp_path)
        raise


def _parse_member_row(table: str, line: str) -> Dict[str, Any]:
    try:
        row = json.loads(line)
    except json.JSONDecodeError as e:
        raise ValueError(f"Corrupted ndjson row in data/{table}.ndjson: {e}") from e
    if not isinstance(row, dict):
        raise ValueError(f"Invalid row in data/{table}.ndjson (not an object)")
    if table in EDGE_TABLES:
        for side in ("in", "out"):
            value = row.get(side)
            if not isinstance(value, str) or not value:
                raise ValueError(f"Edge row in data/{table}.ndjson missing '{side}'")
            try:
                ensure_record_id(value)
            except Exception as e:
                raise ValueError(
                    f"Invalid record id {value!r} in data/{table}.ndjson"
                ) from e
        return row
    rid_value = row.get("id")
    if not isinstance(rid_value, str) or not rid_value:
        raise ValueError(f"Row in data/{table}.ndjson missing 'id'")
    try:
        rid = ensure_record_id(rid_value)
    except Exception as e:
        raise ValueError(
            f"Invalid record id {rid_value!r} in data/{table}.ndjson"
        ) from e
    if table in CONFIG_TABLES:
        # Config records live at open_notebook:<table>, so the generic
        # table-name check below does not apply.
        if rid_value != f"open_notebook:{table}":
            raise ValueError(
                f"Row id {rid_value!r} does not belong to open_notebook:{table}"
            )
        return row
    if str(rid.table_name) != table:
        raise ValueError(f"Row id {rid_value!r} does not belong to table {table}")
    return row


def _open_member(
    zf: zipfile.ZipFile, table: str
) -> ContextManager[Iterator[bytes]]:
    """Line iterator over data/<table>.ndjson; empty when the member is absent."""
    member = f"data/{table}.ndjson"
    if member not in zf.namelist():
        return nullcontext(iter(()))
    return zf.open(member)


def _prepare_import_row(
    table: str, row: Dict[str, Any], warnings: List[str]
) -> Dict[str, Any]:
    allowed = TABLE_FIELDS[table]
    record_fields = RECORD_FIELDS.get(table, set())
    prepared: Dict[str, Any] = {}
    for key, value in row.items():
        if key == "id":
            continue
        if key not in allowed:
            warnings.append(f"{table}: dropped field '{key}' (not in whitelist)")
            continue
        if value is None:
            # None means unset; SCHEMAFULL non-optional fields reject NONE.
            continue
        if key == "asset" and isinstance(value, dict):
            value = {k: v for k, v in value.items() if k in ASSET_FIELDS}
        elif key in record_fields and isinstance(value, str):
            try:
                value = ensure_record_id(value)
            except Exception as e:
                raise ValueError(
                    f"Invalid record reference {value!r} for {table}.{key}"
                ) from e
        elif key in DATETIME_FIELDS and isinstance(value, str):
            try:
                value = datetime.fromisoformat(value)
            except ValueError:
                warnings.append(
                    f"{table}: unparseable {key}, using database default"
                )
                continue
        prepared[key] = value
    return prepared


def _build_create_sql(
    table: str, batch: List[Tuple[RecordID, Dict[str, Any]]]
) -> Tuple[str, Dict[str, Any]]:
    statements: List[str] = []
    params: Dict[str, Any] = {}
    for i, (rid, row) in enumerate(batch):
        assignments = []
        for field, value in row.items():
            param = f"p{i}_{field}"
            params[param] = value
            assignments.append(f"{field} = ${param}")
        statements.append(f"CREATE {_rid_sql(rid)} SET {', '.join(assignments)};")
    return "\n".join(statements), params


async def _write_create_batch(
    table: str,
    batch: List[Tuple[RecordID, Dict[str, Any]]],
    imported: Dict[str, int],
) -> None:
    sql, params = _build_create_sql(table, batch)
    await repo_query(sql, params)
    imported[table] = imported.get(table, 0) + len(batch)


def _extract_member(zf: zipfile.ZipFile, member: str, dst: str) -> str:
    digest = hashlib.sha256()
    with zf.open(member) as src, open(dst, "wb") as out:
        while True:
            chunk = src.read(COPY_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
            out.write(chunk)
    return digest.hexdigest()


def _unique_upload_path(filename: str) -> str:
    # Lazy import: api.routers.sources would pull the FastAPI layer into the
    # worker process at module import time.
    from api.routers.sources import generate_unique_filename

    return generate_unique_filename(filename, UPLOADS_FOLDER)


def _validate_package(zf: zipfile.ZipFile) -> PackageManifest:
    names = zf.namelist()
    for name in names:
        if ".." in name.split("/") or "\\" in name or name.startswith("/"):
            raise ValueError(f"Unsafe package member name: {name!r}")
        if not any(p.match(name) for p in _MEMBER_PATTERNS):
            raise ValueError(f"Unexpected package member: {name!r}")
        if name.startswith("data/"):
            table = name[len("data/") : -len(".ndjson")]
            if table not in ALL_TABLES:
                raise ValueError(f"Unknown data table in package: {table!r}")
    if "manifest.json" not in names:
        raise ValueError("Package is missing manifest.json")
    try:
        manifest = PackageManifest.model_validate(json.loads(zf.read("manifest.json")))
    except (json.JSONDecodeError, ValidationError) as e:
        raise ValueError(f"Invalid manifest.json: {e}") from e
    if manifest.format_version != FORMAT_VERSION:
        raise ValueError(
            f"Unsupported package format_version {manifest.format_version} "
            f"(expected {FORMAT_VERSION})"
        )
    total = sum(info.file_size for info in zf.infolist())
    if total > _max_import_uncompressed_bytes():
        raise ValueError(f"Package uncompressed size {total} exceeds the import limit")
    return manifest


def _endpoint_known(
    rid_str: str,
    existing_ids: Dict[str, Set[str]],
    package_ids: Dict[str, Set[Any]],
) -> bool:
    table = rid_str.partition(":")[0]
    return rid_str in existing_ids.get(table, set()) or rid_str in package_ids.get(
        table, set()
    )


def _imported_this_run(
    rid_str: str,
    existing_ids: Dict[str, Set[str]],
    package_ids: Dict[str, Set[Any]],
) -> bool:
    table = rid_str.partition(":")[0]
    return (
        table in DATA_TABLES
        and rid_str in package_ids.get(table, set())
        and rid_str not in existing_ids.get(table, set())
    )


async def _embedding_consistency_warnings(
    manifest: PackageManifest, warnings: List[str]
) -> None:
    pkg_model = manifest.embedding.model_id
    current = await _current_embedding_model_id()
    if pkg_model and current and pkg_model != current:
        warnings.append(
            f"Package was embedded with {pkg_model} but this environment defaults "
            f"to {current}; similarity search may be inconsistent"
        )
    elif pkg_model and not current:
        warnings.append(
            "No default embedding model configured here; imported vectors may "
            "not match newly generated ones"
        )
    pkg_dim = manifest.embedding.dominant_dimension
    if pkg_dim:
        # Pull raw lengths and bincount client-side: GROUP BY on an aliased
        # expression collapses in this SurrealDB version.
        rows = await repo_query(
            f"SELECT VALUE array::len(embedding) FROM {EMBEDDING_TABLE} LIMIT 2000"
        )
        raw_lengths: List[Any] = rows or []
        lengths = [int(r) for r in raw_lengths if isinstance(r, (int, float))]
        if lengths:
            target_dim = int(np.argmax(np.bincount(lengths)))
            if target_dim != pkg_dim:
                warnings.append(
                    f"Package embedding dimension {pkg_dim} differs from this "
                    f"environment's dominant dimension {target_dim}"
                )


@command("import_data", app="open_notebook", retry=TRANSFER_RETRY_CONFIG)
async def import_data_command(input_data: ImportDataInput) -> ImportDataOutput:
    start = time.time()
    cmd_id = get_command_id(input_data)
    imported: Dict[str, int] = {}
    skipped: Dict[str, int] = {}
    warnings: List[str] = []
    permanent = False
    completed = False
    await set_transfer_state("import", "starting", 0, command_id=cmd_id)
    try:
        # Default views are excluded from export but groups may reference them.
        await ensure_default_views()

        with zipfile.ZipFile(input_data.package_path) as zf:
            names = set(zf.namelist())
            await set_transfer_state("import", "validating", 0, "Validating package")
            manifest = _validate_package(zf)

            # Full parse pass: any failure below happens before a single write.
            package_ids: Dict[str, Set[Any]] = {}
            transformation_models: Set[str] = set()
            for table in ALL_TABLES:
                ids: Set[Any] = set()
                with _open_member(zf, table) as member:
                    for raw in member:
                        line = raw.decode("utf-8").strip()
                        if not line:
                            continue
                        row = _parse_member_row(table, line)
                        if table in EDGE_TABLES:
                            ids.add((str(row["in"]), str(row["out"])))
                        else:
                            ids.add(str(row["id"]))
                            if table == "transformation" and row.get("model_id"):
                                transformation_models.add(str(row["model_id"]))
                package_ids[table] = ids
            await set_transfer_state(
                "import", "validating", IMPORT_STAGES["validating"][0] +
                IMPORT_STAGES["validating"][1], "Validating package"
            )

            await set_transfer_state("import", "precheck", IMPORT_STAGES["precheck"][0])
            existing_ids: Dict[str, Set[str]] = {}
            for table in DATA_TABLES + (EMBEDDING_TABLE,):
                rows = await repo_query(f"SELECT VALUE id FROM {table}")
                existing_ids[table] = {str(r) for r in rows or []}
            existing_pairs: Dict[str, Set[Any]] = {}
            for edge in EDGE_TABLES:
                rows = await repo_query(f"SELECT in, out FROM {edge}")
                existing_pairs[edge] = {
                    (str(r.get("in")), str(r.get("out"))) for r in rows or []
                }

            # Estimates for the progress message only; embeddings are counted
            # for real in their stage (rows skip for id AND source reasons).
            total_import = total_skip = 0
            for table in DATA_TABLES:
                ids = package_ids.get(table, set())
                to_import = len(ids - existing_ids.get(table, set()))
                skipped[table] = len(ids) - to_import
                total_import += to_import
                total_skip += skipped[table]
            est_embedding = len(
                package_ids.get(EMBEDDING_TABLE, set())
                - existing_ids.get(EMBEDDING_TABLE, set())
            )
            total_import += est_embedding
            total_skip += (
                len(package_ids.get(EMBEDDING_TABLE, set())) - est_embedding
            )
            for edge in EDGE_TABLES:
                pairs = package_ids.get(edge, set())
                to_import = len(pairs - existing_pairs.get(edge, set()))
                skipped[edge] = len(pairs) - to_import
                total_import += to_import
                total_skip += skipped[edge]
            await set_transfer_state(
                "import",
                "precheck",
                IMPORT_STAGES["precheck"][0] + IMPORT_STAGES["precheck"][1],
                f"Precheck: {total_import} to import, {total_skip} to skip",
            )

            await _embedding_consistency_warnings(manifest, warnings)
            if transformation_models:
                rows = await repo_query("SELECT VALUE id FROM model")
                known = {str(r) for r in rows or []}
                missing = transformation_models - known
                if missing:
                    warnings.append(
                        "Transformation model(s) not found in this environment: "
                        + ", ".join(sorted(missing))
                    )

            imported_source_ids: Set[str] = set()
            pending_files: List[Tuple[str, str, Optional[str]]] = []  # (id, key, url)
            package_file_keys = {
                key.split("/")[1] for key in manifest.files if key.startswith("files/")
            }

            await set_transfer_state("import", "metadata", IMPORT_STAGES["metadata"][0])
            for i, table in enumerate(DATA_TABLES):
                if f"data/{table}.ndjson" not in names:
                    continue
                batch: List[Tuple[RecordID, Dict[str, Any]]] = []
                with _open_member(zf, table) as member:
                    for raw in member:
                        line = raw.decode("utf-8").strip()
                        if not line:
                            continue
                        row = _parse_member_row(table, line)
                        rid = ensure_record_id(row["id"])
                        if str(rid) in existing_ids.get(table, set()):
                            continue
                        prepared = _prepare_import_row(table, row, warnings)
                        if table == "source":
                            url = None
                            asset = prepared.pop("asset", None)
                            if isinstance(asset, dict):
                                url = asset.get("url")
                                if url:
                                    prepared["asset"] = {"url": url}
                            # The source-env file_path is meaningless here; the
                            # files stage rewrites it after extraction.
                            key = str(rid.id)
                            if key in package_file_keys:
                                pending_files.append((str(rid), key, url))
                            imported_source_ids.add(str(rid))
                        batch.append((rid, prepared))
                        if len(batch) >= WRITE_BATCH:
                            await _write_create_batch(table, batch, imported)
                            batch = []
                    if batch:
                        await _write_create_batch(table, batch, imported)
                await set_transfer_state(
                    "import",
                    "metadata",
                    _stage_percent(
                        IMPORT_STAGES, "metadata", i + 1, len(DATA_TABLES)
                    ),
                    f"Writing {table} ({i + 1}/{len(DATA_TABLES)})",
                )

            # Config records merge unconditionally into the fixed target id:
            # MERGE keeps target fields absent from the package untouched, and
            # absent members (older packages) simply iterate to nothing.
            for table in CONFIG_TABLES:
                with _open_member(zf, table) as member:
                    for raw in member:
                        line = raw.decode("utf-8").strip()
                        if not line:
                            continue
                        row = _parse_member_row(table, line)
                        prepared = _prepare_import_row(table, row, warnings)
                        if not prepared:
                            continue
                        target_rid = ensure_record_id(f"open_notebook:{table}")
                        await repo_query(
                            f"UPSERT {target_rid} MERGE $data;",
                            {"data": prepared},
                        )
                        imported[table] = imported.get(table, 0) + 1

            await set_transfer_state("import", "files", IMPORT_STAGES["files"][0])
            for idx, (source_id, key, url) in enumerate(pending_files):
                prefix = f"files/{key}/"
                for member_name in list(manifest.files):
                    if not member_name.startswith(prefix):
                        continue
                    entry = manifest.files[member_name]
                    if member_name not in names:
                        warnings.append(
                            f"Package file {member_name} listed in manifest but "
                            f"missing; source {source_id} keeps asset.url"
                        )
                        continue
                    name = member_name[len(prefix) :]
                    dst = await asyncio.to_thread(_unique_upload_path, name)
                    digest = await asyncio.to_thread(
                        _extract_member, zf, member_name, dst
                    )
                    if digest != entry.sha256:
                        with suppress(OSError):
                            await asyncio.to_thread(os.unlink, dst)
                        warnings.append(
                            f"sha256 mismatch for {member_name}; file skipped, "
                            f"source {source_id} keeps asset.url"
                        )
                        continue
                    await repo_query(
                        "UPDATE $id SET asset = $asset",
                        {
                            "id": ensure_record_id(source_id),
                            "asset": {"file_path": dst, "url": url},
                        },
                    )
                await set_transfer_state(
                    "import",
                    "files",
                    _stage_percent(
                        IMPORT_STAGES, "files", idx + 1, len(pending_files)
                    ),
                    f"Saving files ({idx + 1}/{len(pending_files)})",
                )

            await set_transfer_state(
                "import", "embeddings", IMPORT_STAGES["embeddings"][0]
            )
            if f"data/{EMBEDDING_TABLE}.ndjson" in names:
                batch = []
                with _open_member(zf, EMBEDDING_TABLE) as member:
                    for raw in member:
                        line = raw.decode("utf-8").strip()
                        if not line:
                            continue
                        row = _parse_member_row(EMBEDDING_TABLE, line)
                        rid = ensure_record_id(row["id"])
                        # Chunks of a skipped source and already-present rows
                        # are skipped whole (id-skip semantics).
                        if str(rid) in existing_ids.get(EMBEDDING_TABLE, set()) or str(
                            row.get("source")
                        ) not in imported_source_ids:
                            skipped[EMBEDDING_TABLE] = (
                                skipped.get(EMBEDDING_TABLE, 0) + 1
                            )
                            continue
                        prepared = _prepare_import_row(EMBEDDING_TABLE, row, warnings)
                        batch.append((rid, prepared))
                        if len(batch) >= WRITE_BATCH:
                            await _write_create_batch(EMBEDDING_TABLE, batch, imported)
                            batch = []
                    if batch:
                        await _write_create_batch(EMBEDDING_TABLE, batch, imported)

            await set_transfer_state(
                "import", "relations", IMPORT_STAGES["relations"][0]
            )
            for i, edge in enumerate(EDGE_TABLES):
                if f"data/{edge}.ndjson" not in names:
                    continue
                pairs = existing_pairs.get(edge, set())
                statements: List[str] = []
                with _open_member(zf, edge) as member:
                    for raw in member:
                        line = raw.decode("utf-8").strip()
                        if not line:
                            continue
                        row = _parse_member_row(edge, line)
                        in_rid = ensure_record_id(row["in"])
                        out_rid = ensure_record_id(row["out"])
                        pair = (str(in_rid), str(out_rid))
                        if pair in pairs:
                            continue
                        # Records we did not create keep their edges untouched;
                        # dangling endpoints from malformed packages are warned.
                        if not _imported_this_run(
                            str(in_rid), existing_ids, package_ids
                        ):
                            skipped[edge] = skipped.get(edge, 0) + 1
                            warnings.append(
                                f"Skipped {edge} edge {pair[0]} -> {pair[1]}: "
                                f"in endpoint was not imported this run"
                            )
                            continue
                        if not _endpoint_known(
                            str(in_rid), existing_ids, package_ids
                        ) or not _endpoint_known(
                            str(out_rid), existing_ids, package_ids
                        ):
                            skipped[edge] = skipped.get(edge, 0) + 1
                            warnings.append(
                                f"Skipped {edge} edge {pair[0]} -> {pair[1]}: "
                                f"endpoint not in package or database"
                            )
                            continue
                        statements.append(
                            f"RELATE {_rid_sql(in_rid)}->{edge}->{_rid_sql(out_rid)};"
                        )
                        pairs.add(pair)
                        if len(statements) >= WRITE_BATCH:
                            await repo_query("\n".join(statements))
                            imported[edge] = imported.get(edge, 0) + WRITE_BATCH
                            statements = []
                    if statements:
                        await repo_query("\n".join(statements))
                        imported[edge] = imported.get(edge, 0) + len(statements)
                await set_transfer_state(
                    "import",
                    "relations",
                    _stage_percent(IMPORT_STAGES, "relations", i + 1, len(EDGE_TABLES)),
                    f"Linking {edge} ({i + 1}/{len(EDGE_TABLES)})",
                )

        completed = True
        result = {
            "imported": imported,
            "skipped": skipped,
            "warnings": warnings,
            "embedding_model_id": manifest.embedding.model_id,
            "embedding_dimension": manifest.embedding.dominant_dimension,
        }
        # Report what was actually written, not the precheck estimate: edges
        # with dangling endpoints are skipped at write time (precheck counts
        # them as import candidates).
        await set_transfer_state(
            "import",
            "done",
            100,
            f"Import complete: {sum(imported.values())} imported, "
            f"{sum(skipped.values())} skipped",
            result=result,
        )
        logger.info(f"[import] done: imported={imported} skipped={skipped}")
        return ImportDataOutput(
            success=True,
            imported=imported,
            skipped=skipped,
            warnings=warnings,
            processing_time=time.time() - start,
        )
    except ValueError as e:
        permanent = True
        await set_transfer_state("import", "failed", 100, error=str(e)[:500])
        raise
    except Exception as e:
        await set_transfer_state("import", "failed", 100, error=str(e)[:500])
        raise
    finally:
        # Keep the zip for the retry layer on transient failures only.
        if completed or permanent:
            with suppress(OSError):
                await asyncio.to_thread(os.unlink, input_data.package_path)
