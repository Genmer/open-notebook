from typing import Literal, cast

from fastapi import APIRouter, HTTPException
from loguru import logger

from api.models import SettingsResponse, SettingsUpdate
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.exceptions import (
    InvalidInputError,
    OpenNotebookError,
)
from open_notebook.utils.embedding_config import (
    refresh_embedding_params,
    resolve_params,
    validate_params,
)

router = APIRouter()


def _settings_response(settings: ContentSettings) -> SettingsResponse:
    """Raw DB values (None = follow env/default) plus read-only effective values."""
    effective = resolve_params(settings)
    return SettingsResponse(
        default_content_processing_engine_doc=settings.default_content_processing_engine_doc,
        default_content_processing_engine_url=settings.default_content_processing_engine_url,
        default_embedding_option=settings.default_embedding_option,
        auto_delete_files=settings.auto_delete_files,
        docling_ocr=settings.docling_ocr,
        docling_formulas=settings.docling_formulas,
        docling_vision=settings.docling_vision,
        youtube_preferred_languages=settings.youtube_preferred_languages,
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
        min_chunk_size=settings.min_chunk_size,
        embedding_batch_size=settings.embedding_batch_size,
        usage_tracking_enabled=settings.usage_tracking_enabled,
        effective_chunk_size=effective.chunk_size,
        effective_chunk_overlap=effective.chunk_overlap,
        effective_min_chunk_size=effective.min_chunk_size,
        effective_embedding_batch_size=effective.embedding_batch_size,
    )


@router.get("/settings", response_model=SettingsResponse)
async def get_settings():
    """Get all application settings."""
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]

        return _settings_response(settings)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching settings: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error fetching settings"
        )


@router.put("/settings", response_model=SettingsResponse)
async def update_settings(settings_update: SettingsUpdate):
    """Update application settings."""
    try:
        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]

        # Update only provided fields
        if settings_update.default_content_processing_engine_doc is not None:
            # Cast to proper literal type
            settings.default_content_processing_engine_doc = cast(
                Literal["auto", "docling", "simple"],
                settings_update.default_content_processing_engine_doc,
            )
        if settings_update.default_content_processing_engine_url is not None:
            settings.default_content_processing_engine_url = cast(
                Literal["auto", "firecrawl", "jina", "crawl4ai", "simple"],
                settings_update.default_content_processing_engine_url,
            )
        if settings_update.default_embedding_option is not None:
            settings.default_embedding_option = cast(
                Literal["ask", "always", "never"],
                settings_update.default_embedding_option,
            )
        if settings_update.auto_delete_files is not None:
            settings.auto_delete_files = cast(
                Literal["yes", "no"], settings_update.auto_delete_files
            )
        if settings_update.docling_ocr is not None:
            settings.docling_ocr = settings_update.docling_ocr
        if settings_update.docling_formulas is not None:
            settings.docling_formulas = settings_update.docling_formulas
        if settings_update.docling_vision is not None:
            settings.docling_vision = settings_update.docling_vision
        if settings_update.youtube_preferred_languages is not None:
            settings.youtube_preferred_languages = (
                settings_update.youtube_preferred_languages
            )
        if settings_update.chunk_size is not None:
            settings.chunk_size = settings_update.chunk_size
        if settings_update.chunk_overlap is not None:
            settings.chunk_overlap = settings_update.chunk_overlap
        if settings_update.min_chunk_size is not None:
            settings.min_chunk_size = settings_update.min_chunk_size
        if settings_update.embedding_batch_size is not None:
            settings.embedding_batch_size = settings_update.embedding_batch_size
        if settings_update.usage_tracking_enabled is not None:
            settings.usage_tracking_enabled = settings_update.usage_tracking_enabled

        # Cross-field validation needs the merged values, so it happens after
        # the per-field merge and before persisting.
        validate_params(resolve_params(settings))

        await settings.update()
        await refresh_embedding_params(settings)

        return _settings_response(settings)
    except HTTPException:
        raise
    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating settings: {str(e)}")
        raise HTTPException(
            status_code=500, detail="Error updating settings"
        )
