"""Source annotation domain: personal reading marks anchored to source content.

PDR-003: one merged entity (highlight + comment + note). An annotation is an
anchor (text quote and/or PDF rectangle set) plus color/line style plus an
optional body; display position is a property of the body, not a separate
kind. Anchors are stored as plain dicts matching the FLEXIBLE object columns
so DB rows round-trip without nested-model revalidation.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, ClassVar, Dict, List, Optional, Union

from loguru import logger
from pydantic import field_validator, model_validator
from surrealdb import RecordID

from open_notebook.config import DATA_FOLDER
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError

ANNOTATION_COLORS = ("gold", "fern", "plum", "slate", "clay")
LINE_STYLES = ("wavy", "straight")
DISPLAY_POSITIONS = ("hover", "inline", "margin", "overview")
BODY_MAX_CHARS = 4000
QUOTE_MAX_CHARS = 5000

# Keep in sync with api/data_transfer_service.EXPORTS_FOLDER (importing that
# module here would drag the command-service layer into the domain layer).
ANNOTATION_BACKUP_FOLDER = os.path.join(DATA_FOLDER, "exports")

ANNOTATION_SETTINGS_ID = "open_notebook:annotation_settings"
_COLOR_NAME_MAX_CHARS = 30


def _validate_pdf_anchor_dict(value: Dict[str, Any]) -> Dict[str, Any]:
    page = value.get("page")
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise InvalidInputError("pdf_anchor.page must be an integer >= 1")
    quads = value.get("quads")
    if not isinstance(quads, list) or not quads:
        raise InvalidInputError("pdf_anchor.quads must be a non-empty list")
    for quad in quads:
        if not isinstance(quad, dict) or not all(
            isinstance(quad.get(k), (int, float)) for k in ("x1", "y1", "x2", "y2")
        ):
            raise InvalidInputError(
                "pdf_anchor.quads entries must be {x1,y1,x2,y2} numbers"
            )
    return value


def _validate_text_anchor_dict(value: Dict[str, Any]) -> Dict[str, Any]:
    quote = value.get("quote")
    if not isinstance(quote, str) or not quote.strip():
        raise InvalidInputError("text_anchor.quote must be a non-empty string")
    if len(quote) > QUOTE_MAX_CHARS:
        raise InvalidInputError(
            f"text_anchor.quote exceeds {QUOTE_MAX_CHARS} characters"
        )
    return value


class SourceAnnotation(ObjectModel):
    table_name: ClassVar[str] = "source_annotation"
    nullable_fields: ClassVar[set[str]] = {
        "body",
        "display_position",
        "quote",
        "text_anchor",
        "pdf_anchor",
        "page",
        "start_offset",
    }

    source: Union[str, RecordID]
    color: str
    line_style: str
    body: Optional[str] = None
    display_position: Optional[str] = None
    quote: Optional[str] = None
    text_anchor: Optional[Dict[str, Any]] = None
    pdf_anchor: Optional[Dict[str, Any]] = None
    page: Optional[int] = None
    start_offset: Optional[int] = None

    @field_validator("source", mode="before")
    @classmethod
    def parse_source_ref(cls, value: Any) -> Any:
        if isinstance(value, str) and value:
            return ensure_record_id(value)
        return value

    @field_validator("text_anchor", mode="before")
    @classmethod
    def coerce_text_anchor(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return _validate_text_anchor_dict(value)
        return value

    @field_validator("pdf_anchor", mode="before")
    @classmethod
    def coerce_pdf_anchor(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return _validate_pdf_anchor_dict(value)
        return value

    @model_validator(mode="after")
    def enforce_annotation_rules(self) -> "SourceAnnotation":
        if self.color not in ANNOTATION_COLORS:
            raise InvalidInputError(
                f"color must be one of {', '.join(ANNOTATION_COLORS)}"
            )
        if self.line_style not in LINE_STYLES:
            raise InvalidInputError(
                f"line_style must be one of {', '.join(LINE_STYLES)}"
            )
        if not self.text_anchor and not self.pdf_anchor:
            raise InvalidInputError(
                "at least one anchor is required (text_anchor or pdf_anchor)"
            )
        if self.display_position is not None:
            if self.display_position not in DISPLAY_POSITIONS:
                raise InvalidInputError(
                    f"display_position must be one of {', '.join(DISPLAY_POSITIONS)}"
                )
            if not (self.body and self.body.strip()):
                raise InvalidInputError(
                    "display_position requires a body (nothing to position)"
                )
        if self.body and len(self.body) > BODY_MAX_CHARS:
            raise InvalidInputError(f"body exceeds {BODY_MAX_CHARS} characters")
        if self.quote and len(self.quote) > QUOTE_MAX_CHARS:
            raise InvalidInputError(f"quote exceeds {QUOTE_MAX_CHARS} characters")
        # Flat convenience fields stay consistent with the anchor payloads.
        if self.pdf_anchor:
            self.page = int(self.pdf_anchor["page"])
        if self.text_anchor:
            offsets = self.text_anchor.get("start_offset")
            if isinstance(offsets, int):
                self.start_offset = offsets
            if not self.quote:
                self.quote = self.text_anchor["quote"]
        return self

    @classmethod
    async def get_for_source(
        cls, source_id: str, page: Optional[int] = None
    ) -> List["SourceAnnotation"]:
        """Annotations for one source; page filter backs PDF lazy loading."""
        try:
            params: Dict[str, Any] = {"source_id": ensure_record_id(source_id)}
            query = "SELECT * FROM source_annotation WHERE source = $source_id"
            if page is not None:
                query += " AND page = $page"
                params["page"] = page
            query += " ORDER BY page asc, start_offset asc, created asc"
            rows = await repo_query(query, params)
            return [cls(**row) for row in rows]
        except InvalidInputError:
            raise
        except Exception as e:
            logger.error(f"Error fetching annotations for {source_id}: {e}")
            raise DatabaseOperationError("Failed to fetch annotations")

    @classmethod
    async def count_for_source(cls, source_id: str) -> int:
        try:
            rows = await repo_query(
                "SELECT count() AS total FROM source_annotation "
                "WHERE source = $source_id GROUP BY total",
                {"source_id": ensure_record_id(source_id)},
            )
            return int(rows[0]["total"]) if rows else 0
        except InvalidInputError:
            raise
        except Exception as e:
            logger.error(f"Error counting annotations for {source_id}: {e}")
            raise DatabaseOperationError("Failed to count annotations")


def build_annotation_backup_payload(
    source: Any, annotations: List[SourceAnnotation]
) -> Dict[str, Any]:
    """PDR-003 ruling 6/8: snapshot + full annotations, P2-importer compatible.

    page_count is a lower bound (max annotated page + 1) because Source assets
    carry no page-count field; the basis is declared so the P2 import precheck
    can treat it as the coarse arm only (quote sampling stays the main check).
    """
    asset_url = None
    asset = getattr(source, "asset", None)
    if asset is not None:
        asset_url = getattr(asset, "url", None)
    max_page = max((a.page or 0) for a in annotations) if annotations else 0
    return {
        "version": 1,
        "kind": "source_annotations_backup",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": {
            "id": str(getattr(source, "id", "")),
            "title": getattr(source, "title", None),
            "url": asset_url,
            "created": str(getattr(source, "created", None) or ""),
        },
        "page_count": max_page + 1,
        "page_count_basis": "max_annotated_page_plus_one",
        "annotation_count": len(annotations),
        "annotations": [a.model_dump(mode="json") for a in annotations],
    }


async def backup_source_annotations(source: Any) -> Optional[str]:
    """Write the pre-delete backup JSON; returns the path, or None to skip.

    PDR-003 ruling 8: called from Source.delete() before super().delete() so
    every delete path (API endpoint, group cascade, notebook exclusive delete)
    is covered. Zero annotations -> no file. Backup failures must not block
    the delete: the annotations are about to be cascade-removed anyway, and
    holding the delete hostage to disk state would trade a rare lost backup
    for a much worse stuck-delete.
    """
    try:
        annotations = await SourceAnnotation.get_for_source(str(source.id))
        if not annotations:
            return None
        payload = build_annotation_backup_payload(source, annotations)
        os.makedirs(ANNOTATION_BACKUP_FOLDER, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        source_key = str(source.id).replace(":", "-")
        path = os.path.join(
            ANNOTATION_BACKUP_FOLDER,
            f"annotations-backup_{source_key}_{stamp}.json",
        )
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        logger.info(f"Backed up {len(annotations)} annotations to {path}")
        return path
    except Exception as e:  # noqa: BLE001 - see docstring: never block delete
        logger.warning(
            f"Annotation backup failed for {source.id}: {e}. "
            "Continuing with source deletion."
        )
        return None


async def get_annotation_settings() -> Dict[str, Any]:
    """Color-semantics naming singleton; empty names fall back to i18n defaults."""
    try:
        rows = await repo_query(
            "SELECT * FROM $id", {"id": ensure_record_id(ANNOTATION_SETTINGS_ID)}
        )
    except Exception as e:
        logger.error(f"Error reading annotation settings: {e}")
        raise DatabaseOperationError("Failed to read annotation settings")
    names: Dict[str, str] = {}
    if rows:
        names = dict(rows[0].get("color_names") or {})
    return {"id": ANNOTATION_SETTINGS_ID, "color_names": names}


async def save_annotation_settings(color_names: Dict[str, str]) -> Dict[str, Any]:
    """Persist custom color names (overrides only; defaults live in i18n)."""
    cleaned: Dict[str, str] = {}
    for color, name in (color_names or {}).items():
        if color not in ANNOTATION_COLORS:
            raise InvalidInputError(
                f"unknown color '{color}' (expected one of {', '.join(ANNOTATION_COLORS)})"
            )
        if not isinstance(name, str) or not name.strip():
            raise InvalidInputError(f"color name for '{color}' cannot be empty")
        if len(name) > _COLOR_NAME_MAX_CHARS:
            raise InvalidInputError(
                f"color name for '{color}' exceeds {_COLOR_NAME_MAX_CHARS} characters"
            )
        cleaned[color] = name.strip()
    try:
        await repo_query(
            f"UPSERT {ANNOTATION_SETTINGS_ID} MERGE $data;",
            {
                "data": {
                    "color_names": cleaned,
                    "updated": datetime.now(timezone.utc).isoformat(),
                }
            },
        )
    except InvalidInputError:
        raise
    except Exception as e:
        logger.error(f"Error saving annotation settings: {e}")
        raise DatabaseOperationError("Failed to save annotation settings")
    return {"id": ANNOTATION_SETTINGS_ID, "color_names": cleaned}
