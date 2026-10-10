"""Essay library mark service (软考范文库标记).

Library assembly, toggle, stats and dangling-mark cleanup for the
/api/ruankao/essay-marks endpoints. Marks store id references only; the
effective set is always computed at read time via the domain module so the
API and the red-line filter share one source of truth.
"""

from typing import Any, Dict, List, Optional, Set

from loguru import logger
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.model_essay_mark import (
    MarkState,
    _collect_subtree_ids_bounded,
    _load_mark_state,
)
from open_notebook.domain.notebook import Source
from open_notebook.domain.source_grouping import (
    DEFAULT_AI_CONTENT_VIEW_ID,
    SourceGroup,
)
from open_notebook.exceptions import InvalidInputError

TARGET_TYPES = ("source", "source_group")


def _validate_target(target_type: str, target_id: str) -> RecordID:
    if target_type not in TARGET_TYPES:
        raise InvalidInputError(
            f"target_type must be one of: {', '.join(TARGET_TYPES)}"
        )
    stripped = (target_id or "").strip()
    if not stripped:
        raise InvalidInputError("target_id cannot be empty")
    try:
        rid = ensure_record_id(stripped)
    except Exception:
        raise InvalidInputError(f"Invalid target_id: {target_id}")
    expected_table = "source_group" if target_type == "source_group" else "source"
    if rid.table_name != expected_table:
        raise InvalidInputError(f"target_id must be a {expected_table} record id")
    return rid


def _stats(state: MarkState) -> Dict[str, int]:
    return {
        "marked_sources": len(state.direct_source_ids),
        "marked_groups": len(state.marked_group_ids),
        "effective_total": len(state.effective_source_ids),
    }


def _extension(asset: Any) -> Optional[str]:
    if not isinstance(asset, dict):
        return None
    file_path = asset.get("file_path") or ""
    if "." not in file_path:
        return None
    return file_path.rsplit(".", 1)[-1].lower()


def _group_depth(by_id: Dict[str, Dict[str, Any]], group_id: str) -> int:
    """1-based depth within the view's group tree, cycle-safe."""
    depth = 1
    seen = {group_id}
    parent = by_id.get(group_id, {}).get("parent")
    while parent is not None and str(parent) not in seen:
        depth += 1
        seen.add(str(parent))
        parent = by_id.get(str(parent), {}).get("parent")
    return depth


async def get_library(view_id: str) -> Dict[str, Any]:
    """Folders + sources of a view with mark state, stats and dangling marks.

    The effective set is global (marks are not view-scoped): a source marked
    through a group of another view still reports as effective here."""
    view = (view_id or "").strip() or DEFAULT_AI_CONTENT_VIEW_ID
    state = await _load_mark_state()

    group_rows = await repo_query(
        "SELECT id, name, parent FROM source_group WHERE source_view = $view "
        "ORDER BY name",
        {"view": ensure_record_id(view)},
    )
    by_id: Dict[str, Dict[str, Any]] = {}
    children: Dict[str, List[str]] = {}
    for row in group_rows or []:
        gid = str(row.get("id"))
        if not gid:
            continue
        by_id[gid] = row
        if row.get("parent") is not None:
            children.setdefault(str(row["parent"]), []).append(gid)

    members_by_group: Dict[str, Set[str]] = {}
    if by_id:
        member_rows = await repo_query(
            "SELECT in, out FROM source_group_member WHERE out IN $ids",
            {"ids": [ensure_record_id(gid) for gid in by_id]},
        )
        for pair in member_rows or []:
            members_by_group.setdefault(str(pair.get("out")), set()).add(
                str(pair.get("in"))
            )

    groups_out: List[Dict[str, Any]] = []
    for gid, row in by_id.items():
        subtree = _collect_subtree_ids_bounded(children, gid)
        subtree_members: Set[str] = set()
        for member_gid in subtree:
            subtree_members |= members_by_group.get(member_gid, set())
        parent = row.get("parent")
        groups_out.append(
            {
                "id": gid,
                "name": str(row.get("name") or ""),
                "parent_id": str(parent) if parent is not None else None,
                "depth": _group_depth(by_id, gid),
                "marked": gid in state.marked_group_ids,
                "effective_count": len(subtree_members & state.effective_source_ids),
            }
        )

    source_rows = await repo_query(
        "SELECT id, title, asset, updated FROM source ORDER BY updated DESC"
    )
    sources_out: List[Dict[str, Any]] = []
    for row in source_rows or []:
        sid = str(row.get("id"))
        if not sid:
            continue
        sources_out.append(
            {
                "id": sid,
                "title": row.get("title"),
                "extension": _extension(row.get("asset")),
                "updated": str(row.get("updated") or ""),
                "marked_direct": sid in state.direct_source_ids,
                "via_group_ids": sorted(state.via_group_ids.get(sid, [])),
            }
        )

    return {
        "stats": _stats(state),
        "groups": groups_out,
        "sources": sources_out,
        "dangling_marks": list(state.dangling_marks),
    }


async def toggle_mark(target_type: str, target_id: str) -> Dict[str, Any]:
    """Flip the mark on one target; creating when absent, removing when present.

    Duplicate rows (concurrent double-toggle before uniqueness could be
    re-checked) are all removed on the off-toggle, keeping the mark state
    single-row — the DB has no unique index on the option record fields."""
    rid = _validate_target(target_type, target_id)
    if target_type == "source":
        await Source.get(str(rid))  # NotFoundError -> 404
    else:
        await SourceGroup.get(str(rid))

    # ref_field comes from the fixed TARGET_TYPES branch, never user input
    ref_field = "source_group" if target_type == "source_group" else "source"
    existing = await repo_query(
        f"SELECT id FROM model_essay_mark WHERE {ref_field} = $target",
        {"target": rid},
    )
    if existing:
        for row in existing:
            await repo_query(
                "DELETE model_essay_mark WHERE id = $id",
                {"id": ensure_record_id(str(row.get("id")))},
            )
        return {"marked": False, "target_type": target_type, "target_id": str(rid)}

    await repo_query(
        "CREATE model_essay_mark SET "
        "target_type = $target_type, source = $source, source_group = $source_group",
        {
            "target_type": target_type,
            "source": rid if target_type == "source" else None,
            "source_group": rid if target_type == "source_group" else None,
        },
    )
    return {"marked": True, "target_type": target_type, "target_id": str(rid)}


async def list_marks(source_id: Optional[str] = None) -> Dict[str, Any]:
    """Mark list + stats + effective set; with source_id, per-source status too."""
    state = await _load_mark_state()
    mark_rows = await repo_query(
        "SELECT id, target_type, source, source_group, created FROM model_essay_mark"
    )
    marks: List[Dict[str, str]] = []
    for row in mark_rows or []:
        target_type = row.get("target_type")
        if target_type == "source":
            target = row.get("source")
        elif target_type == "source_group":
            target = row.get("source_group")
        else:
            logger.warning(f"Ignoring model_essay_mark row: {row}")
            continue
        marks.append(
            {
                "id": str(row.get("id") or ""),
                "target_type": str(target_type or ""),
                "target_id": str(target) if target is not None else "",
                "created": str(row.get("created") or ""),
            }
        )

    source_status: Optional[Dict[str, Any]] = None
    if source_id:
        sid = (source_id or "").strip()
        if ":" not in sid:
            sid = f"source:{sid}"
        source_status = {
            "id": sid,
            "marked_direct": sid in state.direct_source_ids,
            "via_group_ids": sorted(state.via_group_ids.get(sid, [])),
            "effective": sid in state.effective_source_ids,
        }

    return {
        "marks": marks,
        "stats": _stats(state),
        "effective_source_ids": sorted(state.effective_source_ids),
        "source": source_status,
    }


async def cleanup_dangling_marks() -> int:
    """Remove marks whose target no longer exists (manual double safety net
    behind the migration 41 EVENT cascade and the list-level tolerance)."""
    state = await _load_mark_state()
    removed = 0
    for mark in state.dangling_marks:
        if not mark["id"]:
            continue
        await repo_query(
            "DELETE model_essay_mark WHERE id = $id",
            {"id": ensure_record_id(mark["id"])},
        )
        removed += 1
    return removed
