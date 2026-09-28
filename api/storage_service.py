"""Storage usage estimation for the Storage settings page.

Two complementary views:
- Database estimates: SurrealDB cannot report per-table byte sizes, so text is
  approximated from character counts and vectors from f64 width. These are
  estimates by construction; the UI labels them as such.
- Disk measurements: real os.scandir walks over the data folder's known
  subdirectories (uploads, podcasts, exports, tiktoken cache, langgraph db).

The export-size estimate prefers the last real package size when one exists
and otherwise extrapolates from the sampled compression behaviour of the
exporter (vectors ~40%, prose ~32% of raw bytes).
"""

import json
import os
from typing import Any, Dict, Optional, Tuple

from loguru import logger

from open_notebook.config import (
    DATA_FOLDER,
    PODCASTS_FOLDER,
    TIKTOKEN_CACHE_DIR,
    UPLOADS_FOLDER,
    sqlite_folder,
)

# Keep in sync with api/data_transfer_service.EXPORTS_FOLDER (importing that
# module here would drag the command-service layer into every storage call).
EXPORTS_FOLDER = os.path.join(DATA_FOLDER, "exports")

# Average UTF-8 bytes per character for mixed-language notebooks (CJK runs 3,
# ASCII 1; real libraries land near the middle). Explicitly an approximation.
BYTES_PER_CHAR = 2
# SurrealDB stores numbers as f64.
BYTES_PER_VECTOR_FLOAT = 8

# Exporter zip compression observed across real packages: vector JSON and
# prose NDJSON each compress to roughly these fractions of their raw size.
ESTIMATED_VECTOR_COMPRESSION = 0.40
ESTIMATED_TEXT_COMPRESSION = 0.32


def _dir_stats(path: str) -> Tuple[int, int]:
    """Real (bytes, file_count) under a directory; (0, 0) when absent."""
    total = 0
    files = 0
    root = os.path.abspath(path)
    if not os.path.isdir(root):
        return 0, 0
    for current, _dirs, names in os.walk(root):
        for name in names:
            try:
                total += os.path.getsize(os.path.join(current, name))
                files += 1
            except OSError:
                continue
    return total, files


async def _text_table_stats(table: str, field: str = "content") -> Dict[str, Any]:
    """Row count + estimated text bytes for one table.

    Two queries: string::len() rejects NONE, so the byte estimate filters to
    text-bearing rows while the count stays the table's real row count.
    """
    from open_notebook.database.repository import repo_query

    count_rows = await repo_query(f"SELECT count() AS n FROM {table} GROUP ALL")
    count = int((count_rows[0] if count_rows else {}).get("n") or 0)

    char_rows = await repo_query(
        f"SELECT math::sum(string::len({field})) AS chars FROM {table} "
        f"WHERE {field} != NONE GROUP ALL"
    )
    chars = int((char_rows[0] if char_rows else {}).get("chars") or 0)
    return {
        "count": count,
        "estimated_bytes": chars * BYTES_PER_CHAR,
    }


async def _embedding_stats() -> Dict[str, Any]:
    from open_notebook.database.repository import repo_query

    rows = await repo_query(
        "SELECT count() AS n, math::sum(array::len(embedding)) AS dims "
        "FROM source_embedding WHERE embedding != NONE GROUP ALL"
    )
    row = rows[0] if rows else {}
    count = int(row.get("n") or 0)
    dims = int(row.get("dims") or 0)
    return {
        "count": count,
        "estimated_bytes": dims * BYTES_PER_VECTOR_FLOAT,
        "dimensions": count and dims // count or 0,
    }


def _disk_sections() -> Dict[str, Any]:
    sections: Dict[str, Dict[str, Any]] = {}
    known = 0
    for key, path in (
        ("uploads", UPLOADS_FOLDER),
        ("podcasts", PODCASTS_FOLDER),
        ("exports", EXPORTS_FOLDER),
        ("tiktoken_cache", TIKTOKEN_CACHE_DIR),
        ("sqlite", sqlite_folder),
    ):
        size, files = _dir_stats(path)
        known += size
        sections[key] = {"bytes": size, "files": files}
    total, total_files = _dir_stats(DATA_FOLDER)
    sections["other"] = {
        "bytes": max(0, total - known),
        "files": max(0, total_files - sum(s["files"] for s in sections.values())),
    }
    return {
        "root": os.path.abspath(DATA_FOLDER),
        "total_bytes": total,
        "sections": sections,
    }


async def _last_package_size() -> Optional[int]:
    from open_notebook.database.repository import repo_query

    try:
        rows = await repo_query(
            "SELECT result.package_size_bytes FROM data_transfer_state:export"
        )
    except Exception as e:
        logger.warning(f"Could not read last export size: {e}")
        return None
    if not rows:
        return None
    size = (rows[0] or {}).get("result", {}).get("package_size_bytes")
    return int(size) if size else None


async def _export_estimate(
    text_bytes: int, vector_bytes: int, upload_bytes: int
) -> Dict[str, Any]:
    """Prefer the real last package size; otherwise extrapolate from sampled
    compression ratios (vectors ≈ 40%, prose ≈ 32%; uploaded files are stored
    about as-is)."""
    last = await _last_package_size()
    if last:
        return {
            "basis": "last_package",
            "estimated_bytes": last,
        }
    estimated = int(
        vector_bytes * ESTIMATED_VECTOR_COMPRESSION
        + text_bytes * ESTIMATED_TEXT_COMPRESSION
        + upload_bytes
    )
    return {
        "basis": "estimated",
        "estimated_bytes": estimated,
    }


async def get_storage_summary() -> Dict[str, Any]:
    sources = await _text_table_stats("source", "full_text")
    insights = await _text_table_stats("source_insight", "content")
    notes = await _text_table_stats("note", "content")
    embeddings = await _embedding_stats()

    database_bytes = (
        sources["estimated_bytes"]
        + insights["estimated_bytes"]
        + notes["estimated_bytes"]
        + embeddings["estimated_bytes"]
    )
    disk = _disk_sections()
    upload_bytes = disk["sections"]["uploads"]["bytes"]

    text_bytes = sources["estimated_bytes"] + insights["estimated_bytes"]
    export_estimate = await _export_estimate(text_bytes, embeddings["estimated_bytes"], upload_bytes)

    return {
        "database": {
            "sources": sources,
            "insights": insights,
            "notes": notes,
            "embeddings": embeddings,
            "estimated_bytes": database_bytes,
        },
        "disk": disk,
        "export_estimate": export_estimate,
        "totals": {
            "database_bytes": database_bytes,
            "disk_bytes": disk["total_bytes"],
        },
    }


def _serialize_summary(summary: Dict[str, Any]) -> Dict[str, Any]:
    """JSON-safe pass (os.walk returns plain ints; kept for symmetry)."""
    return json.loads(json.dumps(summary, default=str))


async def collect_storage_summary() -> Dict[str, Any]:
    try:
        summary = await get_storage_summary()
    except Exception as e:
        logger.error(f"Failed to build storage summary: {e}")
        raise
    return _serialize_summary(summary)
