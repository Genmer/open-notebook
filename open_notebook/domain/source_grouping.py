"""Source grouping domain: multi-view organization of sources (views, groups, membership)."""

from datetime import datetime
from typing import Any, ClassVar, Dict, List, Optional, Union

from loguru import logger
from pydantic import field_validator
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import InvalidInputError

DEFAULT_AI_CONTENT_VIEW_ID = "source_view:ai_content"
DEFAULT_AI_TITLE_VIEW_ID = "source_view:ai_title"
DEFAULT_VIEW_IDS = (DEFAULT_AI_CONTENT_VIEW_ID, DEFAULT_AI_TITLE_VIEW_ID)

# parent-chain depth limit (root group = depth 1)
MAX_GROUP_DEPTH = 5

# (fixed id, name, view_type)
_DEFAULT_VIEWS = (
    (DEFAULT_AI_CONTENT_VIEW_ID, "AI Content", "ai_content"),
    (DEFAULT_AI_TITLE_VIEW_ID, "AI Filename", "ai_title"),
)


class SourceView(ObjectModel):
    table_name: ClassVar[str] = "source_view"
    name: str
    view_type: str
    last_classified_at: Optional[datetime] = None
    classify_progress: Optional[Dict[str, Any]] = None


class SourceGroup(ObjectModel):
    table_name: ClassVar[str] = "source_group"
    name: str
    source_view: Union[str, RecordID]
    parent: Optional[Union[str, RecordID]] = None

    @field_validator("source_view", "parent", mode="before")
    @classmethod
    def parse_record_refs(cls, value):
        if isinstance(value, str) and value:
            return ensure_record_id(value)
        return value


async def ensure_default_views() -> None:
    """Idempotently create the two built-in views under their fixed ids."""
    for view_id, name, view_type in _DEFAULT_VIEWS:
        existing = await repo_query(
            "SELECT id FROM $id", {"id": ensure_record_id(view_id)}
        )
        if existing:
            continue
        try:
            await repo_query(
                f"CREATE {view_id} SET name = $name, view_type = $view_type",
                {"name": name, "view_type": view_type},
            )
            logger.info(f"Created default source view {view_id}")
        except Exception:
            # Concurrent boot may have created it first; that's success for us.
            if not await repo_query("SELECT id FROM $id", {"id": ensure_record_id(view_id)}):
                raise


def _parent_map(groups: List[SourceGroup]) -> Dict[str, Optional[str]]:
    return {
        str(group.id): (str(group.parent) if group.parent else None)
        for group in groups
        if group.id
    }


def collect_ancestor_ids(groups: List[SourceGroup], group_id: str) -> List[str]:
    """Ids from group_id's parent up to the root; raises on a parent-chain cycle."""
    parents = _parent_map(groups)
    chain: List[str] = []
    visited = {group_id}
    current = parents.get(group_id)
    while current:
        if current in visited:
            raise InvalidInputError("Group hierarchy contains a cycle")
        chain.append(current)
        visited.add(current)
        current = parents.get(current)
    return chain


def compute_group_depth(groups: List[SourceGroup], group_id: str) -> int:
    """1-based depth of group_id in the tree (root = 1)."""
    return len(collect_ancestor_ids(groups, group_id)) + 1


def collect_subtree_ids(groups: List[SourceGroup], root_id: str) -> List[str]:
    """root_id plus all descendant ids, from an in-memory group list."""
    children: Dict[str, List[str]] = {}
    for group in groups:
        if not group.id or not group.parent:
            continue
        children.setdefault(str(group.parent), []).append(str(group.id))

    subtree = [root_id]
    stack = [root_id]
    while stack:
        for child in children.get(stack.pop(), []):
            subtree.append(child)
            stack.append(child)
    return subtree


def compute_subtree_height(groups: List[SourceGroup], root_id: str) -> int:
    """1-based height: levels from root_id down to its deepest descendant."""
    children: Dict[str, List[str]] = {}
    for group in groups:
        if not group.id or not group.parent:
            continue
        children.setdefault(str(group.parent), []).append(str(group.id))

    height = 0
    level = [root_id]
    while level:
        height += 1
        level = [child for node in level for child in children.get(node, [])]
    return height
