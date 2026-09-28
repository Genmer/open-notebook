"""Aggregated view over the surreal-commands `command` table (Task Center).

The worker already persists every async job into `command`; this service
shapes recent rows into UI-friendly task entries without touching any submit
path. Rich progress is resolved only for `running` rows (embeddings read the
denormalized source counters, transfers read their state record), so the
common list query stays a single table scan.
"""

from typing import Any, Dict, List, Optional

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query

MAX_ERROR_LENGTH = 300
LIST_LIMIT_MAX = 200

# name → task type bucket shown in the UI
TASK_TYPE_BY_COMMAND = {
    "run_transformation": "insight",
    "embed_source": "embedding",
    "rebuild_embeddings": "embedding",
    "embed_note": "embedding",
    "embed_insight": "embedding",
    "process_source": "processing",
    "import_data": "data_transfer",
    "export_data": "data_transfer",
}

VALID_STATUSES = {"new", "queued", "running", "completed", "failed", "canceled"}


def _task_type(name: str) -> str:
    return TASK_TYPE_BY_COMMAND.get(name, "other")


def _truncate_error(message: Optional[str]) -> Optional[str]:
    if not message:
        return None
    text = str(message)
    if len(text) <= MAX_ERROR_LENGTH:
        return text
    return text[:MAX_ERROR_LENGTH]


def _timestamp(value: Any) -> Optional[str]:
    if value is None:
        return None
    return str(value)


async def _resolve_targets(rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map source ids to their titles for friendlier task targets."""
    source_ids: set[str] = set()
    for row in rows:
        args = row.get("args") or {}
        sid = args.get("source_id")
        if sid:
            source_ids.add(str(sid))
    if not source_ids:
        return {}
    titles: Dict[str, str] = {}
    try:
        rows_out = await repo_query(
            "SELECT id, title FROM source WHERE id IN $ids",
            {"ids": [ensure_record_id(sid) for sid in source_ids]},
        )
        for row in rows_out or []:
            if row.get("title"):
                titles[str(row["id"])] = str(row["title"])
    except Exception as e:
        logger.warning(f"Could not resolve task target titles: {e}")
    return titles


async def _enrich_progress(
    name: str, row: Dict[str, Any], targets: Dict[str, str]
) -> Optional[Dict[str, Any]]:
    """Progress is only knowable for running jobs; everything else returns None."""
    args = row.get("args") or {}
    if name == "embed_source":
        sid = args.get("source_id")
        if not sid:
            return None
        try:
            rows = await repo_query(
                "SELECT embedding_status, embedded_chunks, total_chunks "
                "FROM $sid",
                {"sid": ensure_record_id(str(sid))},
            )
        except Exception as e:
            logger.warning(f"Could not read embedding progress for {sid}: {e}")
            return None
        if not rows:
            return None
        src = rows[0]
        embedded = int(src.get("embedded_chunks") or 0)
        total = int(src.get("total_chunks") or 0)
        return {
            "kind": "embedding",
            "embedded_chunks": embedded,
            "total_chunks": total,
            "percent": int(embedded / total * 100) if total > 0 else None,
        }
    if name in ("import_data", "export_data"):
        kind = "import" if name == "import_data" else "export"
        try:
            rows = await repo_query(
                "SELECT progress FROM $rid",
                {"rid": ensure_record_id(f"data_transfer_state:{kind}")},
            )
        except Exception as e:
            logger.warning(f"Could not read transfer state for {name}: {e}")
            return None
        if not rows:
            return None
        progress = rows[0].get("progress") or {}
        return {
            "kind": "data_transfer",
            "stage": progress.get("stage"),
            "percent": int(progress.get("percent") or 0),
            "message": progress.get("message"),
        }
    return None


async def _status_counts() -> Dict[str, int]:
    try:
        rows = await repo_query(
            "SELECT status, count() AS n FROM command GROUP BY status"
        )
    except Exception as e:
        logger.warning(f"Could not count command statuses: {e}")
        return {}
    counts: Dict[str, int] = {}
    for row in rows or []:
        status = str(row.get("status") or "unknown")
        counts[status] = int(row.get("n") or 0)
    return counts


async def list_tasks(
    name: Optional[str] = None,
    status: Optional[str] = None,
    task_type: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    """Recent commands shaped for the Task Center page."""
    limit = max(1, min(limit, LIST_LIMIT_MAX))
    offset = max(0, offset)

    clauses: List[str] = []
    params: Dict[str, Any] = {"lim": limit, "off": offset}
    if name:
        clauses.append("name = $name")
        params["name"] = name
    if status:
        clauses.append("status = $status")
        params["status"] = status
    where = f"WHERE {' AND '.join(clauses)} " if clauses else ""

    rows = await repo_query(
        f"""
        SELECT id, name, args, status, error_message, created, updated
        FROM command {where}
        ORDER BY created DESC LIMIT $lim START AT $off
        """,
        params,
    ) or []

    if task_type:
        rows = [r for r in rows if _task_type(str(r.get("name") or "")) == task_type]

    targets = await _resolve_targets(rows)

    tasks: List[Dict[str, Any]] = []
    for row in rows:
        command_name = str(row.get("name") or "")
        args = row.get("args") or {}
        sid = args.get("source_id")
        tasks.append(
            {
                "id": str(row["id"]),
                "name": command_name,
                "type": _task_type(command_name),
                "target": targets.get(str(sid)) if sid else None,
                "status": str(row.get("status") or "unknown"),
                "progress": (
                    await _enrich_progress(command_name, row, targets)
                    if str(row.get("status")) == "running"
                    else None
                ),
                "error_message": _truncate_error(row.get("error_message")),
                "created": _timestamp(row.get("created")),
                "updated": _timestamp(row.get("updated")),
            }
        )

    counts = await _status_counts()
    active = counts.get("new", 0) + counts.get("queued", 0) + counts.get("running", 0)
    return {
        "tasks": tasks,
        "total": len(tasks),
        "counts": {**counts, "active": active},
    }
