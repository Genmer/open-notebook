"""Source annotation CRUD + color-semantics settings (PDR-003).

Single-row writes only — no surreal-commands queueing (ruling in the plan §5.2).
MVP normalizes display_position to NULL on every POST/PUT regardless of what
the client sends; P1 introduces the position picker and drops the
normalization (PDR-003 ruling 9).
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.models import (
    AnnotationSettingsPayload,
    AnnotationSettingsResponse,
    SourceAnnotationCreate,
    SourceAnnotationResponse,
    SourceAnnotationUpdate,
)
from open_notebook.domain.notebook import Source
from open_notebook.domain.source_annotation import (
    SourceAnnotation,
    get_annotation_settings,
    save_annotation_settings,
)
from open_notebook.exceptions import (
    InvalidInputError,
    NotFoundError,
    OpenNotebookError,
)

router = APIRouter()


def _to_response(annotation: SourceAnnotation) -> SourceAnnotationResponse:
    return SourceAnnotationResponse(
        id=str(annotation.id),
        source=str(annotation.source),
        color=annotation.color,
        line_style=annotation.line_style,
        body=annotation.body,
        display_position=annotation.display_position,
        quote=annotation.quote,
        text_anchor=annotation.text_anchor,
        pdf_anchor=annotation.pdf_anchor,
        page=annotation.page,
        start_offset=annotation.start_offset,
        created=str(annotation.created),
        updated=str(annotation.updated),
    )


@router.get("/source-annotations", response_model=List[SourceAnnotationResponse])
async def list_source_annotations(
    source_id: str = Query(..., description="Source to list annotations for"),
    page: Optional[int] = Query(
        None, ge=1, description="Filter to one page (PDF lazy loading)"
    ),
):
    """List annotations for a source, optionally narrowed to one page."""
    try:
        annotations = await SourceAnnotation.get_for_source(source_id, page=page)
        return [_to_response(a) for a in annotations]
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error listing annotations: {e}")
        raise HTTPException(status_code=500, detail=f"Error listing annotations: {e}")


@router.post("/source-annotations", response_model=SourceAnnotationResponse)
async def create_source_annotation(payload: SourceAnnotationCreate):
    """Create an annotation; source must exist and at least one anchor is required."""
    try:
        await Source.get(payload.source_id)
        annotation = SourceAnnotation(
            source=payload.source_id,
            color=payload.color,
            line_style=payload.line_style,
            body=payload.body if payload.body and payload.body.strip() else None,
            # MVP: position picker ships in P1; persist NULL no matter what.
            display_position=None,
            quote=payload.quote,
            text_anchor=payload.text_anchor.model_dump()
            if payload.text_anchor
            else None,
            pdf_anchor=payload.pdf_anchor.model_dump() if payload.pdf_anchor else None,
        )
        await annotation.save()
        return _to_response(annotation)
    except HTTPException:
        raise
    except (InvalidInputError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating annotation: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating annotation: {e}")


@router.put(
    "/source-annotations/{annotation_id}", response_model=SourceAnnotationResponse
)
async def update_source_annotation(annotation_id: str, payload: SourceAnnotationUpdate):
    """Partial update; last write wins and `updated` is refreshed by save()."""
    try:
        annotation = await SourceAnnotation.get(annotation_id)

        updates = payload.model_dump(exclude_unset=True)
        for field in (
            "color",
            "line_style",
            "body",
            "quote",
            "text_anchor",
            "pdf_anchor",
        ):
            if field in updates:
                setattr(annotation, field, updates[field])
        if "display_position" in updates:
            # MVP normalization (see module docstring).
            annotation.display_position = None

        await annotation.save()
        return _to_response(annotation)
    except HTTPException:
        raise
    except (InvalidInputError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Annotation not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating annotation: {e}")
        raise HTTPException(status_code=500, detail=f"Error updating annotation: {e}")


@router.delete("/source-annotations/{annotation_id}")
async def delete_source_annotation(annotation_id: str):
    """Delete one annotation (merged entity: no child cascade)."""
    try:
        annotation = await SourceAnnotation.get(annotation_id)
        await annotation.delete()
        return {"success": True, "id": annotation_id}
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Annotation not found")
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting annotation: {e}")
        raise HTTPException(status_code=500, detail=f"Error deleting annotation: {e}")


@router.get("/annotation-settings", response_model=AnnotationSettingsResponse)
async def read_annotation_settings():
    """Color-semantics naming singleton (custom overrides; defaults are i18n)."""
    try:
        return AnnotationSettingsResponse(**await get_annotation_settings())
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error reading annotation settings: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error reading annotation settings: {e}"
        )


@router.put("/annotation-settings", response_model=AnnotationSettingsResponse)
async def write_annotation_settings(payload: AnnotationSettingsPayload):
    try:
        return AnnotationSettingsResponse(
            **await save_annotation_settings(payload.color_names)
        )
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error saving annotation settings: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error saving annotation settings: {e}"
        )
