"""
Runtime embedding/vectorization parameters resolved as DB > env > default.

Values used to be frozen at import time from environment variables; they are
now held in a module-level snapshot that callers refresh (API startup,
settings update, embedding commands) so changes apply without a restart.
"""

import os
from dataclasses import dataclass
from typing import Any, Optional

from loguru import logger

DEFAULT_CHUNK_SIZE = 400  # chunk_overlap default derives from this: 15% -> 60
DEFAULT_MIN_CHUNK_SIZE = 5
DEFAULT_EMBEDDING_BATCH_SIZE = 50

_PARAM_FIELDS = (
    "chunk_size",
    "chunk_overlap",
    "min_chunk_size",
    "embedding_batch_size",
)


@dataclass(frozen=True)
class EmbeddingParams:
    chunk_size: int
    chunk_overlap: int
    min_chunk_size: int
    embedding_batch_size: int


def _chunk_size_from_env() -> int:
    raw = os.getenv("OPEN_NOTEBOOK_CHUNK_SIZE")
    if not raw:
        return DEFAULT_CHUNK_SIZE
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            f"Invalid OPEN_NOTEBOOK_CHUNK_SIZE value: '{raw}'. "
            f"Using default: {DEFAULT_CHUNK_SIZE}"
        )
        return DEFAULT_CHUNK_SIZE
    if value < 100:
        logger.warning(
            f"OPEN_NOTEBOOK_CHUNK_SIZE ({value}) is too small. "
            f"Using minimum value of 100."
        )
        return 100
    if value > 8192:
        logger.warning(
            f"OPEN_NOTEBOOK_CHUNK_SIZE ({value}) is very large. "
            f"This may cause issues with some embedding models."
        )
    logger.info(f"Using custom chunk size: {value} tokens")
    return value


def _parse_env_overlap() -> Optional[int]:
    """Validated OPEN_NOTEBOOK_CHUNK_OVERLAP, or None when unset/invalid."""
    raw = os.getenv("OPEN_NOTEBOOK_CHUNK_OVERLAP")
    if not raw:
        return None
    try:
        overlap = int(raw)
    except ValueError:
        logger.warning(
            f"Invalid OPEN_NOTEBOOK_CHUNK_OVERLAP value: '{raw}'. "
            f"Using 15% of chunk size."
        )
        return None
    if overlap < 0:
        logger.warning(
            f"OPEN_NOTEBOOK_CHUNK_OVERLAP ({overlap}) cannot be negative. Using 0."
        )
        return 0
    return overlap


def _derive_overlap(chunk_size: int, explicit: Optional[int]) -> int:
    """Overlap = explicit value, defaulting to 15% of the final chunk size."""
    if explicit is None:
        return int(chunk_size * 0.15)
    if explicit >= chunk_size:
        logger.warning(
            f"Chunk overlap ({explicit}) cannot be >= chunk size "
            f"({chunk_size}). Using {int(chunk_size * 0.15)}."
        )
        return int(chunk_size * 0.15)
    logger.info(f"Using custom chunk overlap: {explicit} tokens")
    return explicit


def _resolve(db: dict) -> EmbeddingParams:
    """Layered resolution: DB value (when set) > env > default.

    The overlap default is 15% of the FINAL chunk size, so chunk_size must be
    resolved before overlap is derived (chunk_size=1500 -> overlap=225).
    DB overlaps are NOT clamped: they come from validated user input and must
    reach validate_params, which turns overlap >= chunk_size into a 422
    instead of silently rewriting the stored value.
    """
    chunk_size = db.get("chunk_size")
    if chunk_size is None:
        chunk_size = _chunk_size_from_env()

    db_overlap = db.get("chunk_overlap")
    if db_overlap is not None:
        overlap = db_overlap
    else:
        overlap = _derive_overlap(chunk_size, _parse_env_overlap())

    min_chunk_size = db.get("min_chunk_size")
    if min_chunk_size is None:
        min_chunk_size = _min_chunk_size_from_env()

    batch_size = db.get("embedding_batch_size")
    if batch_size is None:
        batch_size = _batch_size_from_env()

    return EmbeddingParams(
        chunk_size=chunk_size,
        chunk_overlap=overlap,
        min_chunk_size=min_chunk_size,
        embedding_batch_size=batch_size,
    )


def _from_env() -> EmbeddingParams:
    return _resolve({})


def _min_chunk_size_from_env() -> int:
    raw = os.getenv("OPEN_NOTEBOOK_MIN_CHUNK_SIZE")
    if raw is None:
        return DEFAULT_MIN_CHUNK_SIZE
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            f"Invalid OPEN_NOTEBOOK_MIN_CHUNK_SIZE value: '{raw}'. "
            f"Using default: {DEFAULT_MIN_CHUNK_SIZE}"
        )
        return DEFAULT_MIN_CHUNK_SIZE
    if value < 0:
        logger.warning(
            f"OPEN_NOTEBOOK_MIN_CHUNK_SIZE ({value}) cannot be negative. Using 0."
        )
        return 0
    return value


def _batch_size_from_env() -> int:
    raw = os.getenv("OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE", "50").strip()
    try:
        value = int(raw)
        if value < 1:
            raise ValueError
        return value
    except ValueError:
        logger.warning(
            f"Invalid OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE='{raw}'; "
            f"falling back to {DEFAULT_EMBEDDING_BATCH_SIZE}"
        )
        return DEFAULT_EMBEDDING_BATCH_SIZE


_params: Optional[EmbeddingParams] = None


def get_embedding_params() -> EmbeddingParams:
    if _params is None:
        return _from_env()
    return _params


def resolve_params(settings: Any = None) -> EmbeddingParams:
    """Combine env values with non-None DB fields; settings is read-only."""
    if settings is None:
        return _resolve({})
    db = {
        field: value
        for field in _PARAM_FIELDS
        if (value := getattr(settings, field, None)) is not None
    }
    return _resolve(db)


def validate_params(params: EmbeddingParams) -> None:
    from open_notebook.exceptions import ConfigurationError

    if params.chunk_size < 100:
        raise ConfigurationError(
            f"Chunk size must be at least 100, got {params.chunk_size}"
        )
    if not 0 <= params.chunk_overlap < params.chunk_size:
        raise ConfigurationError(
            f"Chunk overlap must be >= 0 and < chunk size "
            f"({params.chunk_size}), got {params.chunk_overlap}"
        )
    if params.min_chunk_size < 0:
        raise ConfigurationError(
            f"Minimum chunk size must be >= 0, got {params.min_chunk_size}"
        )
    if params.embedding_batch_size < 1:
        raise ConfigurationError(
            f"Embedding batch size must be >= 1, got {params.embedding_batch_size}"
        )


async def refresh_embedding_params(settings: Any = None) -> EmbeddingParams:
    """Reload params from DB into the snapshot; never raises (fail-open)."""
    global _params
    try:
        if settings is None:
            from open_notebook.domain.content_settings import ContentSettings

            settings = await ContentSettings.get_instance()
        resolved = resolve_params(settings)
        validate_params(resolved)
    except Exception as e:
        logger.warning(
            f"Failed to refresh embedding params, keeping previous values: {e}"
        )
        return get_embedding_params()
    _params = resolved
    logger.debug(f"Embedding params refreshed: {resolved}")
    return resolved


def reset_embedding_params_cache() -> None:
    global _params
    _params = None
