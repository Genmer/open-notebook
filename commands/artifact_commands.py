"""Notebook-level study artifact generation (study guide / FAQ / flashcards /
essay draft).

Follows the process_source_command pattern: a surreal-commands async job that
calls the LLM and persists the result. The generated artifact is stored as a
regular AI note (markdown for study guides / FAQs, JSON for flashcards), so it
is automatically embedded by embed_note and covered by data export/import.

The notebook context is assembled with build_notebook_context, which reuses
Source.get_context / Note.get_context and speaks the same context_config
protocol as the chat UI.
"""

import json
import time
from typing import Any, Dict, Optional

from ai_prompter import Prompter
from langchain_core.messages import HumanMessage
from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.domain.notebook import Note, Notebook
from open_notebook.exceptions import (
    ConfigurationError,
    ContextLengthExceededError,
)
from open_notebook.utils.context_builder import build_notebook_context
from open_notebook.utils.text_utils import extract_text_content

# artifact_type -> prompts/artifact/<type>.jinja. Keep in sync with the
# Literal["study_guide", "faq", "flashcards", "essay_draft"] in the API
# request model.
ARTIFACT_TYPES = ("study_guide", "faq", "flashcards", "essay_draft")

MAX_FLASHCARDS = 100


class ArtifactGenerationInput(CommandInput):
    notebook_id: str
    artifact_type: str
    instruction: Optional[str] = None
    # Same protocol as POST /chat/context: {"sources": {id: status},
    # "notes": {id: status}} with "not in" / "insights" / "full content".
    context_config: Optional[Dict[str, Any]] = None


class ArtifactGenerationOutput(CommandOutput):
    success: bool
    notebook_id: str
    artifact_type: str
    note_id: Optional[str] = None
    processing_time: float
    error_message: Optional[str] = None


def _render_context_text(context_data: Dict[str, Any]) -> str:
    """Flatten build_notebook_context output into a single prompt text block."""
    blocks = []
    for source in context_data.get("sources", []):
        if not isinstance(source, dict):
            continue
        parts = [f"### Source: {source.get('title') or 'Untitled'}"]
        insights = source.get("insights") or []
        for insight in insights:
            if isinstance(insight, dict) and insight.get("content"):
                parts.append(f"- Insight: {insight['content']}")
        full_text = source.get("full_text")
        if isinstance(full_text, str) and full_text.strip():
            parts.append(full_text)
        blocks.append("\n".join(parts))
    for note in context_data.get("notes", []):
        if not isinstance(note, dict):
            continue
        content = note.get("content")
        if isinstance(content, str) and content.strip():
            blocks.append(f"### Note: {note.get('title') or 'Untitled'}\n{content}")
    return "\n\n".join(blocks).strip()


def _parse_flashcards(raw: str) -> str:
    """Extract and validate a flashcard JSON array from the LLM output.

    Returns the canonical JSON string stored as the note content. Raises
    ValueError (a permanent failure, not retried) when no valid card array
    can be recovered.
    """
    text = raw.strip()
    # Strip a wrapping ```json ... ``` fence if the model added one.
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1 :]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
        text = text.strip()

    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Model output does not contain a flashcard JSON array")
    try:
        cards = json.loads(text[start : end + 1])
    except json.JSONDecodeError as e:
        raise ValueError(f"Flashcard output is not valid JSON: {e}")

    if not isinstance(cards, list) or not cards:
        raise ValueError("Flashcard output is empty or not a list")
    if len(cards) > MAX_FLASHCARDS:
        cards = cards[:MAX_FLASHCARDS]

    normalized = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        front = str(card.get("front") or "").strip()
        back = str(card.get("back") or "").strip()
        if front and back:
            normalized.append({"front": front, "back": back})
    if not normalized:
        raise ValueError("Flashcard output contains no cards with front and back")
    return json.dumps(normalized, ensure_ascii=False, indent=2)


@command(
    "generate_artifact",
    app="open_notebook",
    retry={
        "max_attempts": 5,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 60,
        # Validation/config errors are permanent: don't burn retries on them.
        "stop_on": [ValueError, ConfigurationError, ContextLengthExceededError],
        "retry_log_level": "warning",
    },
)
async def generate_artifact_command(
    input_data: ArtifactGenerationInput,
) -> ArtifactGenerationOutput:
    """Generate a study artifact (study guide, FAQ, flashcards or essay
    draft) for a notebook from the selected context and store it as a note."""
    start_time = time.time()

    if input_data.artifact_type not in ARTIFACT_TYPES:
        raise ValueError(
            f"Unknown artifact_type '{input_data.artifact_type}'. "
            f"Expected one of: {', '.join(ARTIFACT_TYPES)}"
        )

    try:
        logger.info(
            f"Generating {input_data.artifact_type} artifact for notebook "
            f"{input_data.notebook_id}"
        )

        notebook = await Notebook.get(input_data.notebook_id)

        context_data, _ = await build_notebook_context(
            notebook, input_data.context_config
        )
        context_text = _render_context_text(context_data)
        if not context_text:
            raise ValueError("No context selected: include at least one source or note")

        # User instruction is passed as a plain render variable, never as
        # Jinja template source (see docs/7-DEVELOPMENT/security.md).
        prompt = Prompter(
            prompt_template=f"artifact/{input_data.artifact_type}"
        ).render(
            data={
                "notebook": notebook,
                "context": context_text,
                "instruction": (input_data.instruction or "").strip(),
            }
        )

        prov = await provision_langchain_model_with_info(
            prompt, None, "chat", max_tokens=8192
        )
        response = await prov.langchain_model.ainvoke([HumanMessage(content=prompt)])
        content = extract_text_content(response.content)

        await record_llm_usage(
            model=prov,
            ai_message=response,
            call_type="artifact",
            correlation_id=input_data.notebook_id,
        )

        title_prefix = {
            "study_guide": "Study Guide",
            "faq": "FAQ",
            "flashcards": "Flashcards",
            "essay_draft": "Essay Draft",
        }[input_data.artifact_type]
        title = f"{title_prefix}: {notebook.name}"

        if input_data.artifact_type == "flashcards":
            note_content = _parse_flashcards(content)
        else:
            note_content = content.strip()
            if not note_content:
                raise ValueError("Model returned empty artifact content")

        note = Note(title=title, content=note_content, note_type="ai")
        await note.save()  # Also submits embed_note (fire-and-forget)
        await note.add_to_notebook(input_data.notebook_id)

        processing_time = time.time() - start_time
        logger.info(
            f"Created {input_data.artifact_type} artifact note {note.id} in "
            f"{processing_time:.2f}s"
        )
        return ArtifactGenerationOutput(
            success=True,
            notebook_id=input_data.notebook_id,
            artifact_type=input_data.artifact_type,
            note_id=str(note.id) if note.id else None,
            processing_time=processing_time,
        )
    except ValueError:
        # Permanent failure: re-raise so the job is marked failed (see
        # process_source_command for why success=False would hide it).
        raise
    except Exception as e:
        logger.error(f"Artifact generation failed: {e}")
        raise
