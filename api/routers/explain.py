from typing import List, Optional

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from api.explain_service import explain_failed_command
from open_notebook.exceptions import InvalidInputError, OpenNotebookError

router = APIRouter()


class ExplainHistoryItem(BaseModel):
    role: str
    content: str


class ExplainRequest(BaseModel):
    resource_type: str = Field(..., description='Must be "failed_command"')
    resource_id: str = Field(..., description="Command id to explain")
    question: Optional[str] = Field(None, description="Follow-up question")
    history: List[ExplainHistoryItem] = Field(default_factory=list)
    locale: str = Field("en-US", description="UI locale for the answer language")
    refresh: bool = Field(False, description="Bypass the explanation cache")


class ExplainSuggestion(BaseModel):
    action: str
    label_key: str


class ExplainFact(BaseModel):
    label_key: str
    value: str


class RecoveryInfo(BaseModel):
    recovered: bool
    detail: str


class ExplainResponse(BaseModel):
    mode: str
    classification: Optional[str] = None
    explanation_markdown: str
    suggestions: List[ExplainSuggestion] = Field(default_factory=list)
    facts: List[ExplainFact] = Field(default_factory=list)
    recovery: Optional[RecoveryInfo] = None
    degraded: bool = False
    from_cache: bool = False


@router.post("/explain", response_model=ExplainResponse)
async def explain_failure(request: ExplainRequest):
    """Explain a failed background task (and answer follow-ups) with the qa model.

    Only 404 (unknown command) and 400 (bad resource_type) can escape;
    model-side problems degrade into a 200 rule-based answer.
    """
    try:
        if request.resource_type != "failed_command":
            raise InvalidInputError(
                f"Unsupported resource_type: {request.resource_type}"
            )
        result = await explain_failed_command(
            command_id=request.resource_id,
            question=request.question,
            history=[item.model_dump() for item in request.history],
            locale=request.locale,
            refresh=request.refresh,
        )
        return ExplainResponse(**result)

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error explaining command {request.resource_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to explain command failure")
