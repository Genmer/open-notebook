"""Project environment domain (软考项目环境).

A project_env is a reusable project setting for exam-essay writing: a period,
a source type (real | mock) and five narrative fields. Status lifecycle:
pending -> verified | needs_review | failed; only the verified_snapshot is
ever injected into chat prompts.
"""

from datetime import datetime
from typing import Any, ClassVar, Dict, List, Optional

from pydantic import model_validator

from open_notebook.domain.base import ObjectModel
from open_notebook.domain.project_env_rules import MONTH_RE, SOURCE_TYPES
from open_notebook.exceptions import InvalidInputError

NAME_MAX_CHARS = 100

STATUSES = ("pending", "verified", "needs_review", "failed")

TEXT_FIELDS = (
    "background",
    "tech_background",
    "tuning_process",
    "problems_solutions",
    "my_role",
    "scale",
)

# Editing any of these invalidates verification and re-triggers a full run.
VERIFICATION_TRIGGER_FIELDS = (
    "background",
    "tech_background",
    "tuning_process",
    "problems_solutions",
    "my_role",
    "scale",
    "period_start",
    "period_end",
)


class ProjectEnv(ObjectModel):
    table_name: ClassVar[str] = "project_env"
    nullable_fields: ClassVar[set[str]] = {
        "keywords",
        "tuning_process",
        "problems_solutions",
        "my_role",
        "scale",
        "draft_content",
        "verified_snapshot",
        "pending_claims",
        "time_adjusted",
        "ai_assisted",
        "verification_progress",
        "verification_token",
        "active_job_id",
    }

    def _prepare_save_data(self) -> Dict[str, Any]:
        # Progress is written only by the fenced conditional UPDATE in the
        # verify command; a full-field save here would replay a stale in-memory
        # {} over the live progress. Drop it from every save.
        data = super()._prepare_save_data()
        data.pop("verification_progress", None)
        return data

    name: str
    background: str = ""
    period_start: str = ""
    period_end: str = ""
    source_type: str
    keywords: Optional[List[str]] = None
    tech_background: str = ""
    tuning_process: Optional[str] = None
    problems_solutions: Optional[str] = None
    my_role: Optional[str] = None
    scale: Optional[str] = None
    status: str = "pending"
    draft_content: Optional[Dict[str, Any]] = None
    verified_snapshot: Optional[Dict[str, Any]] = None
    pending_claims: Optional[List[Dict[str, Any]]] = None
    time_adjusted: Optional[Dict[str, Any]] = None
    ai_assisted: Optional[Dict[str, Any]] = None
    verification_progress: Optional[Dict[str, Any]] = None
    verification_token: Optional[str] = None
    active_job_id: Optional[str] = None

    @model_validator(mode="after")
    def enforce_project_env_rules(self) -> "ProjectEnv":
        if not self.name.strip():
            raise InvalidInputError("name cannot be empty")
        if len(self.name) > NAME_MAX_CHARS:
            raise InvalidInputError(f"name exceeds {NAME_MAX_CHARS} characters")
        if self.source_type not in SOURCE_TYPES:
            raise InvalidInputError(
                f"source_type must be one of {', '.join(SOURCE_TYPES)}"
            )
        if self.status not in STATUSES:
            raise InvalidInputError(f"status must be one of {', '.join(STATUSES)}")
        for period in (self.period_start, self.period_end):
            if period and not MONTH_RE.match(period):
                raise InvalidInputError(
                    f"period '{period}' must use the YYYY.MM format"
                )
        return self

    def candidate_fields(self) -> Dict[str, Any]:
        """The candidate text under verification: draft_content while a mock
        run is pending, the main fields once promoted (or for real sources)."""
        source: Any = self
        if self.source_type == "mock" and self.draft_content:
            source = self.draft_content
        if isinstance(source, dict):
            return {field: source.get(field) for field in TEXT_FIELDS}
        return {field: getattr(source, field, None) for field in TEXT_FIELDS}

    def text_for(self, field: str) -> str:
        return str(self.candidate_fields().get(field) or "")

    def apply_candidate_text(self, field: str, text: str) -> None:
        """Write a corrected text back to whichever object currently holds the
        candidate (draft_content for a pending mock, main field otherwise)."""
        if self.source_type == "mock" and self.draft_content:
            self.draft_content[field] = text
        else:
            setattr(self, field, text)

    def build_snapshot(self) -> Dict[str, Any]:
        """Freeze the (already verified) candidate into the injection source."""
        candidate = self.candidate_fields()
        snapshot: Dict[str, Any] = {
            "name": self.name,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "source_type": self.source_type,
            "frozen_at": datetime.now().isoformat(),
        }
        snapshot.update(candidate)
        return snapshot

    def promote_draft(self) -> None:
        """Copy a verified mock draft into the main text fields."""
        if self.draft_content:
            for field in TEXT_FIELDS:
                value = self.draft_content.get(field)
                setattr(self, field, value if isinstance(value, str) else None)
