"""Model essay library marks (软考范文库标记) and the red-line isolation filter.

A mark references a source or a source_group by id only (no content copies).
The effective set — directly marked sources plus every source that is a member
of a marked group's subtree, defensively capped at MAX_GROUP_DEPTH levels below
the marked root (R8) — is computed at read time, so filing changes follow
automatically.

Red line: marked essay text must never reach an AI generation context. The
three filter landing points (text_search/vector_search, Notebook.get_context,
build_notebook_context) all resolve through get_marked_source_ids(). The only
sanctioned exception channels are single-source chat (build_source_context,
not filtered) and reading a source by id (get_essay_full_text /
GET /api/sources/{id}).
"""

from dataclasses import dataclass, field
from typing import Any, ClassVar, Dict, List, Optional, Tuple, Union

from loguru import logger
from pydantic import field_validator
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.domain.source_grouping import MAX_GROUP_DEPTH


class ModelEssayMark(ObjectModel):
    table_name: ClassVar[str] = "model_essay_mark"
    nullable_fields: ClassVar[set[str]] = {"source", "source_group"}

    target_type: str  # "source" | "source_group", enforced by the service layer
    source: Optional[Union[str, RecordID]] = None
    source_group: Optional[Union[str, RecordID]] = None

    @field_validator("source", "source_group", mode="before")
    @classmethod
    def parse_record_refs(cls, value):
        if isinstance(value, str) and value:
            return ensure_record_id(value)
        return value


@dataclass
class MarkState:
    """Resolved mark state, shared by the filter and the essay-marks API."""

    # live, directly marked source ids ("source:<key>")
    direct_source_ids: set[str] = field(default_factory=set)
    # live marked group ids ("source_group:<key>")
    marked_group_ids: set[str] = field(default_factory=set)
    # member source id -> covering marked group ids
    via_group_ids: Dict[str, List[str]] = field(default_factory=dict)
    # marks whose target no longer exists: {id, target_type, target_id}
    dangling_marks: List[Dict[str, str]] = field(default_factory=list)

    @property
    def effective_source_ids(self) -> set[str]:
        return self.direct_source_ids | set(self.via_group_ids.keys())


def _children_map(group_rows: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    children: Dict[str, List[str]] = {}
    for row in group_rows or []:
        gid = row.get("id")
        parent = row.get("parent")
        if gid is None or parent is None:
            continue
        children.setdefault(str(parent), []).append(str(gid))
    return children


def _collect_subtree_ids_bounded(
    children: Dict[str, List[str]], root_id: str
) -> List[str]:
    """Subtree of root_id capped at MAX_GROUP_DEPTH levels below the marked
    root. The write path enforces the same cap on absolute tree depth; this
    guards group rows that bypassed it."""
    subtree = [root_id]
    level = [root_id]
    for _ in range(MAX_GROUP_DEPTH):
        level = [child for node in level for child in children.get(node, [])]
        if not level:
            break
        subtree.extend(level)
    return subtree


async def _load_mark_state() -> MarkState:
    """Read marks, groups and membership, and resolve the effective set.

    Dangling references (deleted source/group) are collected for the cleanup
    endpoint, not raised — retrieval must not be interrupted by them (the
    migration 41 EVENT cascade is the first cleanup layer). Any database
    failure propagates: callers are fail-closed filter points.
    """
    state = MarkState()

    mark_rows = await repo_query(
        "SELECT id, target_type, source, source_group FROM model_essay_mark"
    )
    # (mark_id, target_type, target_id)
    marks: List[Tuple[str, str, str]] = []
    for row in mark_rows or []:
        target_type = row.get("target_type")
        if target_type == "source":
            ref = row.get("source")
        elif target_type == "source_group":
            ref = row.get("source_group")
        else:
            logger.warning(
                f"Ignoring model_essay_mark row with unknown target_type: {row}"
            )
            continue
        marks.append(
            (str(row.get("id") or ""), str(target_type), str(ref) if ref else "")
        )

    group_rows = await repo_query("SELECT id, parent FROM source_group")
    children = _children_map(group_rows)
    live_group_ids = {
        str(row["id"]) for row in group_rows or [] if row.get("id") is not None
    }

    candidate_source_ids = {target for _, tt, target in marks if tt == "source"}
    live_source_ids: set[str] = set()
    if candidate_source_ids:
        rows = await repo_query(
            "SELECT VALUE id FROM source WHERE id IN $ids",
            {"ids": [ensure_record_id(sid) for sid in sorted(candidate_source_ids)]},
        )
        live_source_ids = {str(row) for row in rows or []}

    for mark_id, target_type, target_id in marks:
        if target_type == "source":
            if target_id and target_id in live_source_ids:
                state.direct_source_ids.add(target_id)
            else:
                state.dangling_marks.append(
                    {
                        "id": mark_id,
                        "target_type": target_type,
                        "target_id": target_id,
                    }
                )
        else:
            if target_id in live_group_ids:
                state.marked_group_ids.add(target_id)
            else:
                state.dangling_marks.append(
                    {
                        "id": mark_id,
                        "target_type": target_type,
                        "target_id": target_id,
                    }
                )

    for gid in sorted(state.marked_group_ids):
        subtree = _collect_subtree_ids_bounded(children, gid)
        member_rows = await repo_query(
            "SELECT VALUE in FROM source_group_member WHERE out IN $ids",
            {"ids": [ensure_record_id(g) for g in subtree]},
        )
        for row in member_rows or []:
            sid = str(row)
            covered = state.via_group_ids.setdefault(sid, [])
            if gid not in covered:
                covered.append(gid)

    return state


async def get_marked_source_ids() -> set[str]:
    """生效集合：直接标记的来源 ∪ 被标记文件夹子树内全部成员来源。

    All ids are normalized "source:<key>" strings. Deleted targets are skipped
    silently. Fail-closed: database failures propagate so the filter landing
    points fail instead of returning unfiltered results."""
    state = await _load_mark_state()
    return state.effective_source_ids


def _is_excluded(parent_id: Any, excluded: set[str]) -> bool:
    """True when parent_id names a source in the effective set.

    Every source-shaped row of fn::text_search / fn::vector_search (title,
    full-text, chunk, insight) carries parent_id = source.id (migrations 24/25);
    note rows carry a note id and must never match."""
    if not parent_id or not excluded:
        return False
    pid = str(parent_id)
    return pid.startswith("source:") and pid in excluded


async def get_essay_full_text(source_id: str) -> Dict[str, Any]:
    """范文库全文唯一许可出口：阅读模式/雷同检测按 id 读全文用，不受红线过滤影响。"""
    from open_notebook.domain.notebook import Source

    source = await Source.get(source_id)
    return await source.get_context(context_size="long")
