"""Agent domain: predefined chat personas bound to a model and sampling params.

PDR-004: an agent is a named system prompt plus optional model / temperature /
max_tokens overrides. Sessions reference agents by id string
(``chat_session.agent``, same shape as ``model_override``); dangling ids
resolve to the default assistant at execute time, so deleting an agent never
cascades to sessions.
"""

from typing import Any, ClassVar, Dict, Optional, Union

from pydantic import field_validator, model_validator
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import InvalidInputError

NAME_MAX_CHARS = 100
DESCRIPTION_MAX_CHARS = 500
SYSTEM_PROMPT_MAX_CHARS = 32000


class Agent(ObjectModel):
    table_name: ClassVar[str] = "agent"
    nullable_fields: ClassVar[set[str]] = {
        "description",
        "model",
        "temperature",
        "max_tokens",
    }

    name: str
    system_prompt: str
    description: Optional[str] = None
    model: Optional[Union[str, RecordID]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    enabled: bool = True
    sort_order: int = 0

    @field_validator("model", mode="before")
    @classmethod
    def parse_model_ref(cls, value: Any) -> Any:
        # Rows come back with RecordID, API payloads with "model:xxx" strings;
        # normalize both to RecordID so equality checks and saves agree.
        if isinstance(value, str) and value:
            return ensure_record_id(value)
        return value

    @model_validator(mode="after")
    def enforce_agent_rules(self) -> "Agent":
        if not self.name.strip():
            raise InvalidInputError("name cannot be empty")
        if len(self.name) > NAME_MAX_CHARS:
            raise InvalidInputError(f"name exceeds {NAME_MAX_CHARS} characters")
        if not self.system_prompt.strip():
            raise InvalidInputError("system_prompt cannot be empty")
        if len(self.system_prompt) > SYSTEM_PROMPT_MAX_CHARS:
            raise InvalidInputError(
                f"system_prompt exceeds {SYSTEM_PROMPT_MAX_CHARS} characters"
            )
        if (
            self.description is not None
            and len(self.description) > DESCRIPTION_MAX_CHARS
        ):
            raise InvalidInputError(
                f"description exceeds {DESCRIPTION_MAX_CHARS} characters"
            )
        if self.temperature is not None and not 0 <= self.temperature <= 2:
            raise InvalidInputError("temperature must be between 0 and 2")
        if self.max_tokens is not None and self.max_tokens <= 0:
            raise InvalidInputError("max_tokens must be positive")
        return self

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        if data.get("model"):
            data["model"] = ensure_record_id(data["model"])
        return data

    @property
    def model_id(self) -> Optional[str]:
        return str(self.model) if self.model else None
