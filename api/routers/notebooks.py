from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.command_service import CommandService
from api.models import (
    ArtifactCreate,
    ArtifactJobResponse,
    ContextTreeGroup,
    ContextTreeMembership,
    ContextTreeSource,
    NotebookContextTreeResponse,
    NotebookCreate,
    NotebookDeletePreview,
    NotebookDeleteResponse,
    NotebookResponse,
    NotebookUpdate,
    RecentlyViewedResponse,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook, Source
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
)

router = APIRouter()


def _last_viewed_sort_key(item: RecentlyViewedResponse) -> str:
    return item.last_viewed_at


async def _stamp_notebook_view(notebook_id: str) -> None:
    # Best-effort write-on-read: recording the view timestamp must never turn a
    # successful read into a 500. Log and move on if the stamp update fails.
    try:
        await repo_query(
            "UPDATE $notebook_id SET last_viewed_at = time::now();",
            {"notebook_id": ensure_record_id(notebook_id)},
        )
    except Exception as e:
        logger.warning(
            f"Failed to stamp last_viewed_at for notebook {notebook_id}: {e}"
        )


def _recently_viewed_notebook(row: dict) -> RecentlyViewedResponse:
    return RecentlyViewedResponse(
        type="notebook",
        id=str(row.get("id", "")),
        title=row.get("title") or row.get("name") or "Untitled notebook",
        last_viewed_at=str(row.get("last_viewed_at", "")),
    )


def _recently_viewed_source(row: dict) -> RecentlyViewedResponse:
    return RecentlyViewedResponse(
        type="source",
        id=str(row.get("id", "")),
        title=row.get("title") or "Untitled source",
        last_viewed_at=str(row.get("last_viewed_at", "")),
    )


@router.get("/notebooks", response_model=List[NotebookResponse])
async def get_notebooks(
    archived: Optional[bool] = Query(None, description="Filter by archived status"),
    order_by: str = Query("updated desc", description="Order by field and direction"),
):
    """Get all notebooks with optional filtering and ordering."""
    try:
        # Normalize through the central validator (SurrealQL injection guard),
        # then apply this endpoint's stricter allowlist: a single clause on one
        # of the sortable notebook fields.
        allowed_fields = {"name", "created", "updated"}
        allowed_message = (
            f"Allowed fields: {', '.join(sorted(allowed_fields))}. "
            "Allowed directions: asc, desc"
        )
        invalid = InvalidInputError(
            f"Invalid order_by: '{order_by}'. {allowed_message}"
        )
        try:
            validated_order_by = Notebook._validate_order_by(order_by)
        except InvalidInputError:
            raise invalid from None
        if (
            "," in validated_order_by
            or validated_order_by.split()[0] not in allowed_fields
        ):
            raise invalid

        # Build the query with counts
        query = f"""
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM notebook
            ORDER BY {validated_order_by}
        """

        result = await repo_query(query)

        # Filter by archived status if specified
        if archived is not None:
            result = [nb for nb in result if nb.get("archived") == archived]

        return [
            NotebookResponse(
                id=str(nb.get("id", "")),
                name=nb.get("name", ""),
                description=nb.get("description", ""),
                archived=nb.get("archived", False),
                created=str(nb.get("created", "")),
                updated=str(nb.get("updated", "")),
                source_count=nb.get("source_count", 0),
                note_count=nb.get("note_count", 0),
            )
            for nb in result
        ]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebooks: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebooks: {str(e)}"
        )


@router.post("/notebooks", response_model=NotebookResponse)
async def create_notebook(notebook: NotebookCreate):
    """Create a new notebook."""
    try:
        new_notebook = Notebook(
            name=notebook.name,
            description=notebook.description,
        )
        await new_notebook.save()

        return NotebookResponse(
            id=new_notebook.id or "",
            name=new_notebook.name,
            description=new_notebook.description,
            archived=new_notebook.archived or False,
            created=str(new_notebook.created),
            updated=str(new_notebook.updated),
            source_count=0,  # New notebook has no sources
            note_count=0,  # New notebook has no notes
        )
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating notebook: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating notebook: {str(e)}"
        )


@router.get("/recently-viewed", response_model=List[RecentlyViewedResponse])
async def get_recently_viewed(
    limit: int = Query(12, ge=1, le=50, description="Number of items to return"),
):
    """Get recently viewed notebooks and sources, newest first."""
    try:
        notebooks = await repo_query(
            """
            SELECT id, name AS title, last_viewed_at
            FROM notebook
            WHERE last_viewed_at != NONE AND last_viewed_at != NULL
            ORDER BY last_viewed_at DESC
            LIMIT $limit
            """,
            {"limit": limit},
        )
        sources = await repo_query(
            """
            SELECT id, title, last_viewed_at
            FROM source
            WHERE last_viewed_at != NONE AND last_viewed_at != NULL
            ORDER BY last_viewed_at DESC
            LIMIT $limit
            """,
            {"limit": limit},
        )

        items = [
            *[_recently_viewed_notebook(nb) for nb in notebooks],
            *[_recently_viewed_source(src) for src in sources],
        ]
        items.sort(key=_last_viewed_sort_key, reverse=True)
        return items[:limit]
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        # Log full context server-side; return a generic message so internal
        # details are not leaked to clients.
        logger.exception(f"Error fetching recently viewed items: {e}")
        raise HTTPException(
            status_code=500, detail="Error fetching recently viewed items"
        )


@router.get(
    "/notebooks/{notebook_id}/delete-preview", response_model=NotebookDeletePreview
)
async def get_notebook_delete_preview(notebook_id: str):
    """Get a preview of what will be deleted when this notebook is deleted."""
    try:
        notebook = await Notebook.get(notebook_id)

        preview = await notebook.get_delete_preview()

        return NotebookDeletePreview(
            notebook_id=str(notebook.id),
            notebook_name=notebook.name,
            note_count=preview["note_count"],
            exclusive_source_count=preview["exclusive_source_count"],
            shared_source_count=preview["shared_source_count"],
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error getting delete preview for notebook {notebook_id}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Error fetching notebook deletion preview: {str(e)}",
        )


@router.get("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def get_notebook(notebook_id: str):
    """Get a specific notebook by ID."""
    try:
        # Query with counts for single notebook
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if not result:
            raise HTTPException(status_code=404, detail="Notebook not found")

        await _stamp_notebook_view(notebook_id)

        nb = result[0]
        return NotebookResponse(
            id=str(nb.get("id", "")),
            name=nb.get("name", ""),
            description=nb.get("description", ""),
            archived=nb.get("archived", False),
            created=str(nb.get("created", "")),
            updated=str(nb.get("updated", "")),
            source_count=nb.get("source_count", 0),
            note_count=nb.get("note_count", 0),
        )
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching notebook: {str(e)}"
        )


@router.put("/notebooks/{notebook_id}", response_model=NotebookResponse)
async def update_notebook(notebook_id: str, notebook_update: NotebookUpdate):
    """Update a notebook."""
    try:
        notebook = await Notebook.get(notebook_id)

        # Update only provided fields
        if notebook_update.name is not None:
            notebook.name = notebook_update.name
        # An explicit "" (or null) clears the description; only an absent
        # field leaves it untouched.
        if "description" in notebook_update.model_fields_set:
            notebook.description = notebook_update.description or ""
        if notebook_update.archived is not None:
            notebook.archived = notebook_update.archived

        await notebook.save()

        # Query with counts after update
        query = """
            SELECT *,
            count(<-reference.in) as source_count,
            count(<-artifact.in) as note_count
            FROM $notebook_id
        """
        result = await repo_query(query, {"notebook_id": ensure_record_id(notebook_id)})

        if result:
            nb = result[0]
            return NotebookResponse(
                id=str(nb.get("id", "")),
                name=nb.get("name", ""),
                description=nb.get("description", ""),
                archived=nb.get("archived", False),
                created=str(nb.get("created", "")),
                updated=str(nb.get("updated", "")),
                source_count=nb.get("source_count", 0),
                note_count=nb.get("note_count", 0),
            )

        # Fallback if query fails
        return NotebookResponse(
            id=notebook.id or "",
            name=notebook.name,
            description=notebook.description,
            archived=notebook.archived or False,
            created=str(notebook.created),
            updated=str(notebook.updated),
            source_count=0,
            note_count=0,
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating notebook: {str(e)}"
        )


@router.post("/notebooks/{notebook_id}/sources/{source_id}")
async def add_source_to_notebook(notebook_id: str, source_id: str):
    """Add an existing source to a notebook (create the reference)."""
    try:
        # Verify the notebook and source exist (raises NotFoundError -> 404)
        await Notebook.get(notebook_id)
        await Source.get(source_id)

        # Check if reference already exists (idempotency)
        existing_ref = await repo_query(
            "SELECT * FROM reference WHERE out = $source_id AND in = $notebook_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        # If reference doesn't exist, create it
        if not existing_ref:
            await repo_query(
                "RELATE $source_id->reference->$notebook_id",
                {
                    "notebook_id": ensure_record_id(notebook_id),
                    "source_id": ensure_record_id(source_id),
                },
            )

        return {"message": "Source linked to notebook successfully"}
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook or source not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error linking source {source_id} to notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error linking source to notebook: {str(e)}"
        )


@router.delete("/notebooks/{notebook_id}/sources/{source_id}")
async def remove_source_from_notebook(notebook_id: str, source_id: str):
    """Remove a source from a notebook (delete the reference)."""
    try:
        # Verify the notebook exists (raises NotFoundError -> 404)
        await Notebook.get(notebook_id)

        # Delete the reference record linking source to notebook
        await repo_query(
            "DELETE FROM reference WHERE out = $notebook_id AND in = $source_id",
            {
                "notebook_id": ensure_record_id(notebook_id),
                "source_id": ensure_record_id(source_id),
            },
        )

        return {"message": "Source removed from notebook successfully"}
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error removing source {source_id} from notebook {notebook_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error removing source from notebook: {str(e)}"
        )


@router.post(
    "/notebooks/{notebook_id}/artifacts", response_model=ArtifactJobResponse
)
async def generate_artifact(notebook_id: str, request: ArtifactCreate):
    """Submit an async study-artifact generation (study guide / FAQ /
    flashcards). The result is stored as an AI note; poll the generic job
    status endpoint GET /api/commands/jobs/{job_id} for progress."""
    try:
        # Verify the notebook exists (raises NotFoundError -> 404)
        await Notebook.get(notebook_id)

        job_id = await CommandService.submit_command_job(
            module_name="open_notebook",
            command_name="generate_artifact",
            command_args={
                "notebook_id": notebook_id,
                "artifact_type": request.artifact_type,
                "instruction": request.instruction,
                "context_config": request.context_config,
            },
        )

        return ArtifactJobResponse(
            job_id=job_id,
            status="submitted",
            artifact_type=request.artifact_type,
            message=f"Artifact '{request.artifact_type}' generation submitted",
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error submitting artifact generation: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Error submitting artifact generation: {str(e)}",
        )


@router.delete("/notebooks/{notebook_id}", response_model=NotebookDeleteResponse)
async def delete_notebook(
    notebook_id: str,
    delete_exclusive_sources: bool = Query(
        False,
        description="Whether to delete sources that belong only to this notebook",
    ),
):
    """
    Delete a notebook with cascade deletion.

    Always deletes all notes associated with the notebook.
    If delete_exclusive_sources is True, also deletes sources that belong only
    to this notebook (not linked to any other notebooks).
    """
    try:
        notebook = await Notebook.get(notebook_id)

        result = await notebook.delete(
            delete_exclusive_sources=delete_exclusive_sources
        )

        return NotebookDeleteResponse(
            message="Notebook deleted successfully",
            deleted_notes=result["deleted_notes"],
            deleted_sources=result["deleted_sources"],
            unlinked_sources=result["unlinked_sources"],
            deleted_chat_sessions=result["deleted_chat_sessions"],
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting notebook {notebook_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting notebook: {str(e)}"
        )


@router.get(
    "/notebooks/{notebook_id}/context-tree",
    response_model=NotebookContextTreeResponse,
)
async def get_notebook_context_tree(
    notebook_id: str,
    view_id: Optional[str] = Query(
        None, description="Folder view whose groups define the tree"
    ),
):
    """Folder tree and every notebook source for the chat context picker.

    One round trip so the picker can render sources that paginated listings
    have not loaded yet; groups/memberships come from the browsed view and
    are empty when the notebook has no folder view.
    """
    try:
        notebook = await Notebook.get(notebook_id)
        if not notebook:
            raise HTTPException(status_code=404, detail="Notebook not found")

        groups: List[ContextTreeGroup] = []
        members_by_source: Dict[str, str] = {}
        if view_id:
            group_rows = (
                await repo_query(
                    "SELECT id, name, parent_id FROM source_group "
                    "WHERE source_view = $view_id;",
                    {"view_id": ensure_record_id(view_id)},
                )
                or []
            )
            group_ids = [ensure_record_id(str(g.get("id"))) for g in group_rows]
            if group_ids:
                member_rows = (
                    await repo_query(
                        "SELECT in AS source_id, out AS group_id "
                        "FROM source_group_member WHERE out IN $group_ids;",
                        {"group_ids": group_ids},
                    )
                    or []
                )
            else:
                member_rows = []
            groups = [
                ContextTreeGroup(
                    id=str(g.get("id")),
                    name=str(g.get("name") or ""),
                    parent_id=str(g.get("parent_id")) if g.get("parent_id") else None,
                )
                for g in group_rows
            ]
            members_by_source = {
                str(m.get("source_id")): str(m.get("group_id")) for m in member_rows
            }

        source_id_rows = (
            await repo_query(
                "SELECT VALUE in FROM reference WHERE out = $notebook_id;",
                {"notebook_id": ensure_record_id(notebook_id)},
            )
            or []
        )
        source_ids = [ensure_record_id(str(sid)) for sid in source_id_rows]
        if not source_ids:
            return NotebookContextTreeResponse(groups=groups)

        source_rows = (
            await repo_query(
                "SELECT id, title, updated, embedding_status, "
                # Same derived-embedded subquery as the sources list endpoint
                # (sources.py): the source table has no embedded boolean column.
                "(SELECT VALUE id FROM source_embedding WHERE source = $parent.id LIMIT 1) != [] AS embedded "
                "FROM source WHERE id IN $source_ids "
                "ORDER BY updated DESC;",
                {"source_ids": source_ids},
            )
            or []
        )
        insight_rows = (
            await repo_query(
                "SELECT source, count() AS cnt FROM source_insight "
                "WHERE source IN $source_ids GROUP BY source;",
                {"source_ids": source_ids},
            )
            or []
        )
        insights_by_source = {
            str(r.get("source")): int(r.get("cnt") or 0) for r in insight_rows
        }

        # Membership edges are notebook-agnostic; keep only sources of this
        # notebook so the picker never renders foreign sources.
        source_id_strs = {str(r.get("id")) for r in source_rows}
        memberships = [
            ContextTreeMembership(source_id=source_id, group_id=group_id)
            for source_id, group_id in members_by_source.items()
            if source_id in source_id_strs
        ]

        return NotebookContextTreeResponse(
            sources=[
                ContextTreeSource(
                    id=str(r.get("id")),
                    title=r.get("title"),
                    insights_count=insights_by_source.get(str(r.get("id")), 0),
                    embedded=bool(r.get("embedded")),
                    embedding_status=r.get("embedding_status"),
                )
                for r in source_rows
            ],
            groups=groups,
            memberships=memberships,
        )
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching context tree: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching context tree: {str(e)}"
        )
