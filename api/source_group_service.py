"""Business logic for source grouping: views, hierarchical groups, membership."""

import os
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger
from surrealdb import RecordID

from api.command_service import CommandService
from api.models import (
    CopyFailure,
    CopyToGroupResponse,
    GroupDeleteResponse,
    SourceGroupResponse,
    SourceGroupUpdate,
    SourceViewResponse,
)
from open_notebook.ai.provision import provision_langchain_model
from open_notebook.config import UPLOADS_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Source
from open_notebook.domain.source_grouping import (
    DEFAULT_VIEW_IDS,
    MAX_GROUP_DEPTH,
    SourceGroup,
    SourceView,
    collect_ancestor_ids,
    collect_subtree_ids,
    compute_group_depth,
    compute_subtree_height,
    ensure_default_views,
)
from open_notebook.exceptions import InvalidInputError, NotFoundError

_SOURCE_COUNT_PROJECTION = (
    "(SELECT VALUE count() FROM source_group_member WHERE out = $parent.id GROUP ALL)[0].count ?? 0"
)

_CLASSIFIABLE_VIEW_TYPES = {"ai_content": "content", "ai_title": "title"}
_CLASSIFY_COMMAND = "classify_sources"
_MIN_CLASSIFY_SOURCES = 3


def _to_record_id(raw: str, table: str) -> RecordID:
    value = raw if raw.startswith(f"{table}:") else f"{table}:{raw}"
    try:
        return ensure_record_id(value)
    except Exception:
        raise InvalidInputError(f"Invalid {table} id: {raw}")


def _normalized_name(name: Optional[str]) -> str:
    stripped = (name or "").strip()
    if not stripped or len(stripped) > 100:
        raise InvalidInputError("Name must be 1-100 characters")
    return stripped


def _view_response(view: SourceView) -> SourceViewResponse:
    view_id = str(view.id)
    return SourceViewResponse(
        id=view_id,
        name=view.name,
        view_type=view.view_type,
        is_default=view_id in DEFAULT_VIEW_IDS,
        last_classified_at=(
            view.last_classified_at.isoformat() if view.last_classified_at else None
        ),
        classify_progress=view.classify_progress,
        created=str(view.created) if view.created else None,
        updated=str(view.updated) if view.updated else None,
    )


async def _get_view_or_404(view_id: str) -> SourceView:
    # ObjectModel.get expects a plain "table:key" string, not a RecordID
    view_str = str(_to_record_id(view_id, "source_view"))
    try:
        return await SourceView.get(view_str)
    except InvalidInputError:
        raise
    except NotFoundError:
        raise
    except Exception as e:
        logger.error(f"Error fetching source view {view_id}: {e}")
        raise NotFoundError(f"Source view {view_id} not found")


async def _get_group_or_404(group_id: str) -> SourceGroup:
    group_str = str(_to_record_id(group_id, "source_group"))
    try:
        return await SourceGroup.get(group_str)
    except InvalidInputError:
        raise
    except NotFoundError:
        raise
    except Exception as e:
        logger.error(f"Error fetching source group {group_id}: {e}")
        raise NotFoundError(f"Source group {group_id} not found")


async def _groups_of_view(view_id: str) -> List[SourceGroup]:
    rows = await repo_query(
        "SELECT * FROM source_group WHERE source_view = $view",
        {"view": _to_record_id(view_id, "source_view")},
    )
    return [SourceGroup(**row) for row in rows or []]


async def list_views() -> List[SourceViewResponse]:
    await ensure_default_views()
    views = await SourceView.get_all()
    defaults = [v for v in views if str(v.id) in DEFAULT_VIEW_IDS]
    customs = sorted(
        (v for v in views if str(v.id) not in DEFAULT_VIEW_IDS),
        key=lambda v: (str(v.created) if v.created else "", str(v.id)),
    )
    return [_view_response(v) for v in defaults + customs]


async def create_view(name: str, view_type: str) -> SourceViewResponse:
    view = SourceView(name=_normalized_name(name), view_type=view_type)
    await view.save()
    return _view_response(view)


async def update_view(view_id: str, name: Optional[str]) -> SourceViewResponse:
    view = await _get_view_or_404(view_id)
    view.name = _normalized_name(name)
    await view.save()
    return _view_response(view)


async def delete_view(view_id: str) -> Dict[str, int]:
    if _to_record_id(view_id, "source_view") in [
        ensure_record_id(vid) for vid in DEFAULT_VIEW_IDS
    ]:
        raise InvalidInputError("Default views cannot be deleted")
    await _get_view_or_404(view_id)

    view_param = _to_record_id(view_id, "source_view")
    rows = await repo_query(
        "SELECT VALUE id FROM source_group WHERE source_view = $view",
        {"view": view_param},
    )
    deleted_groups = len(rows or [])
    # Memberships first so no edge outlives its group.
    await repo_query(
        "DELETE source_group_member WHERE out IN (SELECT VALUE id FROM source_group WHERE source_view = $view)",
        {"view": view_param},
    )
    await repo_query(
        "DELETE source_group WHERE source_view = $view", {"view": view_param}
    )
    await repo_query("DELETE $view_id", {"view_id": view_param})
    return {"deleted_groups": deleted_groups}


async def list_groups(view_id: str) -> List[SourceGroupResponse]:
    await _get_view_or_404(view_id)
    rows = await repo_query(
        f"""
        SELECT *, {_SOURCE_COUNT_PROJECTION} AS source_count
        FROM source_group WHERE source_view = $view
        ORDER BY created ASC, id ASC
        """,
        {"view": _to_record_id(view_id, "source_view")},
    )
    return [_group_row_to_response(row) for row in rows or []]


def _group_row_to_response(row: Dict[str, Any]) -> SourceGroupResponse:
    parent = row.get("parent")
    return SourceGroupResponse(
        id=str(row["id"]),
        view_id=str(row.get("source_view")),
        name=row.get("name"),
        parent_id=str(parent) if parent else None,
        source_count=int(row.get("source_count") or 0),
        created=str(row["created"]) if row.get("created") else None,
        updated=str(row["updated"]) if row.get("updated") else None,
    )


async def create_group(
    view_id: str, name: str, parent_id: Optional[str]
) -> SourceGroupResponse:
    await _get_view_or_404(view_id)
    group_name = _normalized_name(name)

    parent: Optional[SourceGroup] = None
    parent_ref: Optional[RecordID] = None
    if parent_id:
        parent = await _get_group_or_404(parent_id)
        if str(parent.source_view) != str(_to_record_id(view_id, "source_view")):
            raise InvalidInputError("Parent group belongs to a different view")
        parent_ref = ensure_record_id(str(parent.id))

    groups = await _groups_of_view(view_id)
    _assert_name_free(groups, group_name, parent_ref)
    if parent is not None:
        depth = compute_group_depth(groups, str(parent.id)) + 1
        if depth > MAX_GROUP_DEPTH:
            raise InvalidInputError(
                f"Group nesting exceeds the maximum depth of {MAX_GROUP_DEPTH}"
            )

    group = SourceGroup(
        name=group_name, source_view=_to_record_id(view_id, "source_view"), parent=parent_ref
    )
    await group.save()
    return SourceGroupResponse(
        id=str(group.id),
        view_id=str(group.source_view),
        name=group.name,
        parent_id=str(group.parent) if group.parent else None,
        source_count=0,
        created=str(group.created) if group.created else None,
        updated=str(group.updated) if group.updated else None,
    )


def _assert_name_free(
    groups: List[SourceGroup], name: str, parent_ref: Optional[RecordID]
) -> None:
    for group in groups:
        group_parent = str(group.parent) if group.parent else None
        wanted = str(parent_ref) if parent_ref else None
        if group.name == name and group_parent == wanted:
            raise InvalidInputError(
                "A group with this name already exists at this level"
            )


async def update_group(
    group_id: str, update: SourceGroupUpdate
) -> SourceGroupResponse:
    group = await _get_group_or_404(group_id)
    groups = await _groups_of_view(str(group.source_view))
    group_ref = ensure_record_id(str(group.id))

    if "parent_id" in update.model_fields_set:
        parent_ref: Optional[RecordID] = None
        if update.parent_id:
            parent = await _get_group_or_404(update.parent_id)
            if str(parent.source_view) != str(group.source_view):
                raise InvalidInputError("Parent group belongs to a different view")
            parent_ref = ensure_record_id(str(parent.id))
            _assert_move_is_valid(groups, str(group.id), str(parent.id))
        group.parent = parent_ref

    if update.name is not None:
        new_name = _normalized_name(update.name)
        siblings = [
            g
            for g in groups
            if str(g.id) != str(group.id)
            and (str(g.parent) if g.parent else None)
            == (str(group.parent) if group.parent else None)
        ]
        if any(g.name == new_name for g in siblings):
            raise InvalidInputError(
                "A group with this name already exists at this level"
            )
        group.name = new_name

    await group.save()

    rows = await repo_query(
        f"""
        SELECT *, {_SOURCE_COUNT_PROJECTION} AS source_count
        FROM $group_id
        """,
        {"group_id": group_ref},
    )
    return _group_row_to_response(rows[0])


def _assert_move_is_valid(
    groups: List[SourceGroup], group_id: str, new_parent_id: str
) -> None:
    """Reject self/descendant parents (cycle) and moves pushing the subtree past depth 5."""
    ancestors = collect_ancestor_ids(groups, new_parent_id)
    if new_parent_id == group_id or group_id in ancestors:
        raise InvalidInputError("Cannot move a group under itself or its descendants")

    new_depth = len(ancestors) + 2  # parent depth + 1
    height = compute_subtree_height(groups, group_id)
    if new_depth - 1 + height > MAX_GROUP_DEPTH:
        raise InvalidInputError(
            f"Group nesting exceeds the maximum depth of {MAX_GROUP_DEPTH}"
        )


async def delete_group(group_id: str, delete_sources: bool) -> GroupDeleteResponse:
    group = await _get_group_or_404(group_id)
    groups = await _groups_of_view(str(group.source_view))
    subtree_ids = [
        ensure_record_id(gid)
        for gid in collect_subtree_ids(groups, str(group.id))
    ]

    deleted_sources = 0
    if delete_sources:
        member_rows = await repo_query(
            "SELECT VALUE in FROM source_group_member WHERE out IN $subtree",
            {"subtree": subtree_ids},
        )
        for row in member_rows or []:
            try:
                source = await Source.get(str(row))
            except NotFoundError:
                continue
            await source.delete()
            deleted_sources += 1
        # Sources deleted above clean their memberships via EVENT; sweep any
        # leftovers (pre-event rows) so groups can't dangle.
        await repo_query(
            "DELETE source_group_member WHERE out IN $subtree",
            {"subtree": subtree_ids},
        )
        await repo_query(
            "DELETE source_group WHERE id IN $subtree", {"subtree": subtree_ids}
        )
    else:
        # Members are dropped, sources stay ungrouped: single implicit transaction.
        await repo_query(
            "DELETE source_group_member WHERE out IN $subtree; "
            "DELETE source_group WHERE id IN $subtree;",
            {"subtree": subtree_ids},
        )

    return GroupDeleteResponse(
        deleted_groups=len(subtree_ids), deleted_sources=deleted_sources
    )


_MAX_MEMBERS_BATCH = 100


async def _validated_source_ids(source_ids: List[str]) -> List[RecordID]:
    """Strip/convert ids, enforcing the 1..100 batch size and existence."""
    if not source_ids:
        raise InvalidInputError("source_ids must contain at least 1 id")
    if len(source_ids) > _MAX_MEMBERS_BATCH:
        raise InvalidInputError(
            f"source_ids must contain at most {_MAX_MEMBERS_BATCH} ids"
        )

    refs: List[RecordID] = []
    for raw in source_ids:
        stripped = (raw or "").strip()
        if not stripped:
            raise InvalidInputError("source_ids contains an empty id")
        refs.append(_to_record_id(stripped, "source"))

    rows = await repo_query(
        "SELECT VALUE id FROM source WHERE id IN $ids", {"ids": refs}
    )
    found = {str(row) for row in rows or []}
    missing = [str(ref) for ref in refs if str(ref) not in found]
    if missing:
        raise InvalidInputError(f"Sources not found: {', '.join(missing)}")
    return refs


def _member_scope(view_ref: RecordID, suffix: str = "") -> str:
    # One membership per source per view: replace all edges into the view's
    # groups before relating to the target group.
    return (
        "DELETE source_group_member WHERE in IN $ids AND out IN "
        f"(SELECT VALUE id FROM source_group WHERE source_view = $view){suffix}"
    )


async def move_members_to_group(
    group_id: str, source_ids: List[str]
) -> Dict[str, int]:
    group = await _get_group_or_404(group_id)
    view_ref = ensure_record_id(str(group.source_view))
    group_ref = ensure_record_id(str(group.id))
    refs = await _validated_source_ids(source_ids)

    # Plain multi-statement queries are not atomic in SurrealDB; the explicit
    # transaction keeps the delete+relate pair from leaving half-moved sources.
    await repo_query(
        f"BEGIN TRANSACTION; {_member_scope(view_ref)}; "
        "FOR $sid IN $ids { RELATE $sid->source_group_member->$group; }; "
        "COMMIT TRANSACTION;",
        {"ids": refs, "view": view_ref, "group": group_ref},
    )
    return {"moved": len(refs)}


async def ungroup_members(view_id: str, source_ids: List[str]) -> Dict[str, int]:
    view_ref = _to_record_id(view_id, "source_view")
    await _get_view_or_404(view_id)
    refs = await _validated_source_ids(source_ids)

    # RETURN BEFORE: plain DELETE returns no rows through the driver, so the
    # count would always be 0 without it.
    rows = await repo_query(
        _member_scope(view_ref, " RETURN BEFORE"), {"ids": refs, "view": view_ref}
    )
    return {"removed": len(rows or [])}


def _copy_title(source: Source) -> str:
    if source.title:
        return f"{source.title} (copy)"
    file_path = (source.asset.file_path if source.asset else None) or ""
    basename = os.path.basename(file_path) if file_path else ""
    return f"{basename} (copy)" if basename else "Untitled copy"


def _clone_physical_file(source: Source) -> Optional[str]:
    """Hard-link the source's file under a " (copy)" name, falling back to a
    full copy; returns None so the copied source ships without a file."""
    file_path = source.asset.file_path if source.asset else None
    if not file_path:
        return None
    old_path = Path(file_path)
    if not old_path.is_file():
        return None

    stem, suffix = old_path.stem, old_path.suffix
    counter = 1
    while True:
        name = (
            f"{stem} (copy){suffix}"
            if counter == 1
            else f"{stem} (copy {counter}){suffix}"
        )
        candidate = Path(UPLOADS_FOLDER) / name
        try:
            os.link(old_path, candidate)
            return str(candidate)
        except FileExistsError:
            counter += 1
        except OSError:
            # Cross-device or link-restricted filesystems: full copy instead.
            try:
                shutil.copy2(old_path, candidate)
                return str(candidate)
            except OSError as e:
                logger.warning(f"Failed to clone file {file_path} for a source copy: {e}")
                return None


def _truncate_reason(reason: str) -> str:
    return reason if len(reason) <= 200 else reason[:200]


async def copy_sources_to_group(
    group_id: str, source_ids: List[str]
) -> CopyToGroupResponse:
    group = await _get_group_or_404(group_id)
    group_ref = ensure_record_id(str(group.id))
    refs = await _validated_source_ids(source_ids)

    created: List[str] = []
    failed: List[CopyFailure] = []
    for ref in refs:
        try:
            new_id = await _copy_single_source(ref, group_ref)
            created.append(new_id)
        except Exception as e:
            # One bad source must not abort the batch.
            logger.warning(f"Failed to copy source {ref} to group {group_id}: {e}")
            failed.append(
                CopyFailure(
                    source_id=str(ref), reason=_truncate_reason(str(e))
                )
            )
    return CopyToGroupResponse(created=created, failed=failed)


async def _copy_single_source(ref: RecordID, group_ref: RecordID) -> str:
    old_id = str(ref)
    try:
        source = await Source.get(old_id)
    except Exception as e:
        raise RuntimeError(f"Source not found: {e}") from e

    new_asset: Dict[str, Any] = (
        source.asset.model_dump(exclude_none=True) if source.asset else {}
    )
    cloned_path = _clone_physical_file(source)
    if source.asset and source.asset.file_path:
        if cloned_path:
            new_asset["file_path"] = cloned_path
        else:
            new_asset.pop("file_path", None)

    completed = source.embedding_status == "completed"
    new_id = f"source:{uuid.uuid4().hex}"
    content: Dict[str, Any] = {
        "title": _copy_title(source),
        "topics": source.topics or [],
        "full_text": source.full_text,
        "asset": new_asset,
        # Only completed embeddings carry trustworthy chunk counts to copy.
        "embedding_status": "completed" if completed else "not_embedded",
    }
    if completed:
        content["total_chunks"] = source.total_chunks
        content["embedded_chunks"] = source.embedded_chunks

    refs = await repo_query(
        "SELECT VALUE out FROM reference WHERE in = $old", {"old": ref}
    )
    # SELECT VALUE returns plain ids (parse_record_ids normalizes them to str)
    notebook_refs = [ensure_record_id(str(row)) for row in refs or []]

    # Client-side id lets CREATE be the first statement; the explicit
    # transaction is required (plain multi-statement queries roll back nothing
    # on failure). `order` is a keyword and must stay backticked.
    statements = [
        "CREATE $new_id CONTENT $content;",
        "RELATE $new_id->source_group_member->$group;",
    ]

    params: Dict[str, Any] = {
        "new_id": ensure_record_id(new_id),
        "content": content,
        "group": group_ref,
        "old": ref,
    }
    if notebook_refs:
        statements.append(
            "FOR $nb IN $notebooks { RELATE $new_id->reference->$nb; };"
        )
        params["notebooks"] = notebook_refs
    if completed:
        statements.append(
            "INSERT INTO source_embedding SELECT $new_id AS source, `order`, "
            "content, embedding FROM source_embedding WHERE source = $old;"
        )
    sql = "BEGIN TRANSACTION; " + " ".join(statements) + " COMMIT TRANSACTION;"
    try:
        await repo_query(sql, params)
    except Exception:
        # The copy record never landed; without this the cloned file would be
        # an orphan in uploads/ pointing at nothing
        if cloned_path:
            Path(cloned_path).unlink(missing_ok=True)
        raise
    return new_id


async def classify_view(view_id: str) -> Dict[str, str]:
    """Validate and submit an AI classification job for the view; returns the
    command id for polling. The command itself runs in the worker."""
    view = await _get_view_or_404(view_id)
    method = _CLASSIFIABLE_VIEW_TYPES.get(view.view_type)
    if not method:
        raise InvalidInputError(
            "Only AI views (ai_content / ai_title) can be auto-classified"
        )

    count_rows = await repo_query("SELECT count() AS total FROM source GROUP ALL")
    source_count = int(count_rows[0]["total"]) if count_rows else 0
    if source_count < _MIN_CLASSIFY_SOURCES:
        raise InvalidInputError(
            f"AI classification needs at least {_MIN_CLASSIFY_SOURCES} sources"
        )

    # Fail fast on a missing default chat model instead of a doomed background job.
    await provision_langchain_model("classify availability probe", None, "chat")

    await _reject_concurrent_classification(view_id)

    command_id = await CommandService.submit_command_job(
        "open_notebook",
        _CLASSIFY_COMMAND,
        {"view_id": str(view.id), "method": method},
    )
    return {"command_id": command_id}


async def _reject_concurrent_classification(view_id: str) -> None:
    rows = await repo_query(
        "SELECT args FROM command WHERE app = 'open_notebook' "
        "AND name = 'classify_sources' AND status IN ['new', 'running']"
    )
    for row in rows or []:
        if (row.get("args") or {}).get("view_id") == view_id:
            raise InvalidInputError(
                "A classification job is already queued or running for this view"
            )
