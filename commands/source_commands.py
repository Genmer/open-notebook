import time
from typing import Any, Dict, List, Optional

from langchain_core.runnables import RunnableConfig
from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Source
from open_notebook.domain.transformation import Transformation
from open_notebook.exceptions import (
    ConfigurationError,
    ContextLengthExceededError,
    IncompleteGenerationError,
    InvalidInputError,
    NotFoundError,
)

try:
    from open_notebook.graphs.source import source_graph
    from open_notebook.graphs.transformation import graph as transform_graph
except ImportError as e:
    logger.error(f"Failed to import graphs: {e}")
    raise ValueError("graphs not available")


class SourceProcessingInput(CommandInput):
    source_id: str
    content_state: Dict[str, Any]
    notebook_ids: List[str]
    transformations: List[str]
    embed: bool


class SourceProcessingOutput(CommandOutput):
    success: bool
    source_id: str
    embedded_chunks: int = 0
    insights_created: int = 0
    processing_time: float
    error_message: Optional[str] = None


@command(
    "process_source",
    app="open_notebook",
    retry={
        "max_attempts": 15,  # Handle deep queues (workaround for SurrealDB v2 transaction conflicts)
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 120,  # Allow queue to drain
        "stop_on": [
            ValueError,
            ConfigurationError,
            ContextLengthExceededError,
            IncompleteGenerationError,
            NotFoundError,
        ],  # Don't retry validation/config errors, incomplete generations, or a
        # record deleted mid-processing (NotFoundError means "missing", never a
        # DB failure: ObjectModel.get raises DatabaseOperationError for those)
        "retry_log_level": "debug",  # Avoid log noise during transaction conflicts
    },
)
async def process_source_command(
    input_data: SourceProcessingInput,
) -> SourceProcessingOutput:
    """
    Process source content using the source_graph workflow
    """
    start_time = time.time()

    try:
        logger.info(f"Starting source processing for source: {input_data.source_id}")
        logger.info(f"Notebook IDs: {input_data.notebook_ids}")
        logger.info(f"Transformations: {input_data.transformations}")
        logger.info(f"Embed: {input_data.embed}")

        # 1. Load transformation objects from IDs
        transformations = []
        for trans_id in input_data.transformations:
            logger.info(f"Loading transformation: {trans_id}")
            try:
                transformation = await Transformation.get(trans_id)
            except NotFoundError as e:
                # Same as a deleted source below: permanent, not transient.
                raise ValueError(f"Transformation '{trans_id}' no longer exists") from e
            if not transformation:
                raise ValueError(f"Transformation '{trans_id}' not found")
            transformations.append(transformation)

        logger.info(f"Loaded {len(transformations)} transformations")

        # 2. Get existing source record to update its command field
        try:
            source = await Source.get(input_data.source_id)
        except NotFoundError as e:
            # The source was removed after this job was queued (e.g. a sync tool
            # deleted it, or the record was cleaned up). The job can never
            # succeed: raise a permanent error (ValueError is in `stop_on`) so
            # surreal-commands marks it failed instead of spending 15 retries
            # with exponential backoff, which starves every job behind it.
            raise ValueError(
                f"Source '{input_data.source_id}' no longer exists "
                "(deleted before processing?)"
            ) from e
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # Update source with command reference
        source.command = (
            ensure_record_id(input_data.execution_context.command_id)
            if input_data.execution_context
            else None
        )
        await source.save()

        logger.info(f"Updated source {source.id} with command reference")

        # 3. Process source with all notebooks
        logger.info(f"Processing source with {len(input_data.notebook_ids)} notebooks")

        # Execute source_graph with all notebooks.
        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        result = await source_graph.ainvoke(  # type: ignore[call-overload]
            {
                "content_state": input_data.content_state,
                "notebook_ids": input_data.notebook_ids,  # Use notebook_ids (plural) as expected by SourceState
                "apply_transformations": transformations,
                "embed": input_data.embed,
                "source_id": input_data.source_id,  # Add the source_id to the state
            }
        )

        processed_source = result["source"]

        # 4. Gather processing results (notebook associations handled by source_graph)
        # Note: embedding is fire-and-forget (async job), so we can't query the
        # count here — it hasn't completed yet. The embed_source_command logs
        # the actual count when it finishes.
        insights_list = await processed_source.get_insights()
        insights_created = len(insights_list)

        processing_time = time.time() - start_time
        embed_status = "submitted" if input_data.embed else "skipped"
        logger.info(
            f"Successfully processed source: {processed_source.id} in {processing_time:.2f}s"
        )
        logger.info(f"Created {insights_created} insights, embedding {embed_status}")

        return SourceProcessingOutput(
            success=True,
            source_id=str(processed_source.id),
            embedded_chunks=0,
            insights_created=insights_created,
            processing_time=processing_time,
        )

    except IncompleteGenerationError as e:
        logger.error(
            f"Generation failed (permanent) for source {input_data.source_id}: {e}"
        )
        raise  # Preserve failed job status; stop_on prevents automatic retries.
    except NotFoundError as e:
        # E.g. the source was deleted while extraction ran (save_source re-reads
        # it). Permanent: stop_on prevents retries that would starve the queue.
        logger.error(
            f"Source processing failed (permanent), record no longer exists: {e}"
        )
        raise
    except ValueError as e:
        # Validation errors are permanent failures. Re-raise so surreal-commands
        # marks the job as `failed` (stop_on=[ValueError] already prevents
        # pointless retries). Returning a success=False result instead marks the
        # job `completed` (is_success() checks job status, not the payload),
        # which hid extraction failures and left the source without a retryable
        # `failed` status in the UI.
        logger.error(f"Source processing failed (permanent): {e}")
        raise
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        logger.debug(f"Transient error processing source {input_data.source_id}: {e}")
        raise


# =============================================================================
# RUN TRANSFORMATION COMMAND
# =============================================================================


class RunTransformationInput(CommandInput):
    """Input for running a transformation on an existing source."""

    source_id: str
    transformation_id: str


class RunTransformationOutput(CommandOutput):
    """Output from transformation command."""

    success: bool
    source_id: str
    transformation_id: str
    processing_time: float
    error_message: Optional[str] = None


@command(
    "run_transformation",
    app="open_notebook",
    retry={
        "max_attempts": 5,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 60,
        "stop_on": [
            ValueError,
            ConfigurationError,
            ContextLengthExceededError,
            IncompleteGenerationError,
            InvalidInputError,
            NotFoundError,
        ],  # Don't retry validation/config errors, incomplete generations, or
        # a source/transformation deleted before the job ran
        "retry_log_level": "warning",
    },
)
async def run_transformation_command(
    input_data: RunTransformationInput,
) -> RunTransformationOutput:
    """
    Run a transformation on an existing source to generate an insight.

    This command runs the transformation graph which:
    1. Loads the source and transformation
    2. Calls the LLM to generate insight content
    3. Creates the insight via create_insight command (fire-and-forget)

    Use this command for UI-triggered insight generation to avoid blocking
    the HTTP request while the LLM processes.

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """
    start_time = time.time()

    try:
        logger.info(
            f"Running transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}"
        )

        # Load source
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # Load transformation
        transformation = await Transformation.get(input_data.transformation_id)
        if not transformation:
            raise ValueError(
                f"Transformation '{input_data.transformation_id}' not found"
            )

        # Run transformation graph (includes LLM call + insight creation).
        # LangGraph accepts a partial state dict at runtime, but its typed
        # overloads require the full state type (langgraph typing limitation).
        await transform_graph.ainvoke(  # type: ignore[call-overload]
            input=dict(source=source, transformation=transformation),
            config=RunnableConfig(configurable={"model_id": transformation.model_id}),
        )

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully ran transformation {input_data.transformation_id} "
            f"on source {input_data.source_id} in {processing_time:.2f}s"
        )

        return RunTransformationOutput(
            success=True,
            source_id=input_data.source_id,
            transformation_id=input_data.transformation_id,
            processing_time=processing_time,
        )

    except (IncompleteGenerationError, InvalidInputError, NotFoundError) as e:
        # e.g. the source has no text to transform
        logger.error(
            f"Generation failed (permanent) for transformation "
            f"{input_data.transformation_id} on source {input_data.source_id}: {e}"
        )
        raise  # Preserve failed job status; stop_on prevents automatic retries.
    except ValueError as e:
        # Validation errors are permanent - raise so surreal-commands marks the
        # command failed instead of 'completed' (the UI tracks insight jobs by
        # command status; a soft success=False would look finished forever).
        processing_time = time.time() - start_time
        logger.error(
            f"Failed to run transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}: {e}"
        )
        raise
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        logger.debug(
            f"Transient error running transformation {input_data.transformation_id} "
            f"on source {input_data.source_id}: {e}"
        )
        raise


class AnalyzeSectionInput(CommandInput):
    source_id: str
    section_title: str
    section_text: str
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    locale: str = "en"


class AnalyzeSectionOutput(CommandOutput):
    success: bool
    analysis_markdown: str = ""
    model_name: Optional[str] = None
    provider: Optional[str] = None
    truncated: bool = False
    processing_time: float = 0.0
    error_message: Optional[str] = None


# Streaming progress lives in section_analysis_state:<command_id> — same
# pattern as data_transfer_commands.set_transfer_state (surreal-commands has
# no native progress API). The record is deleted once the command settles so
# the table never accumulates history.
SECTION_STATE_FLUSH_SECONDS = 0.4
SECTION_STATE_STREAM_TAIL_CHARS = 4000
SECTION_ANALYSIS_EXPECTED_CHARS = 4000


def _section_state_rid(command_id: str):
    """State record id for one analysis run.

    Command ids look like "command:xyz"; the state key must carry exactly
    one colon, so only the key part (or a colonless fallback) is reused.
    Mirrors the reader in api.task_service._enrich_progress.
    """
    key = str(ensure_record_id(command_id).id) if ":" in command_id else command_id
    return ensure_record_id(f"section_analysis_state:{key}")


async def _set_section_state(
    command_id: str,
    stage: str,
    percent: int,
    message: str = "",
    stream_tail: Optional[str] = None,
) -> None:
    """Best-effort progress write; a failure here must not kill the job."""
    progress: Dict[str, Any] = {"stage": stage, "percent": percent, "message": message}
    if stream_tail is not None:
        progress["stream_tail"] = stream_tail
    try:
        await repo_query(
            "UPSERT $target SET progress = $progress, updated = time::now()",
            {
                "target": _section_state_rid(command_id),
                "progress": progress,
            },
        )
    except Exception as e:
        logger.warning(f"Failed to update section_analysis_state:{command_id}: {e}")


async def _clear_section_state(command_id: str) -> None:
    try:
        await repo_query("DELETE $target", {"target": _section_state_rid(command_id)})
    except Exception as e:
        logger.warning(
            f"Failed to delete section_analysis_state:{command_id}: {e}"
        )


@command(
    "analyze_source_section",
    app="open_notebook",
    retry={
        "max_attempts": 3,
        "wait_strategy": "exponential_jitter",
        "wait_min": 2,
        "wait_max": 30,
        "stop_on": [ValueError, NotFoundError],
    },
)
async def analyze_section_command(input_data: AnalyzeSectionInput) -> AnalyzeSectionOutput:
    """
    Analyze one document section with the transformation model (the PDF
    outline "AI analysis" button). Model output streams token-by-token into
    section_analysis_state so the Task Center live inspector can render a
    real progress stream while the analysis is being written.
    """
    start_time = time.time()
    command_id = (
        str(input_data.execution_context.command_id)
        if input_data.execution_context
        else "unknown"
    )

    try:
        await _set_section_state(command_id, "fetching", 5, "Loading section context")
        # Lazy import keeps the FastAPI layer out of this module's import graph
        # (same rationale as _unique_upload_path in data_transfer_commands).
        from api.source_analysis_service import analyze_source_section

        buffered: List[str] = []
        last_flush = time.monotonic()

        async def on_delta(delta: str) -> None:
            nonlocal last_flush
            buffered.append(delta)
            now = time.monotonic()
            if now - last_flush < SECTION_STATE_FLUSH_SECONDS:
                return
            last_flush = now
            text = "".join(buffered)
            percent = min(
                90, 20 + int(min(1.0, len(text) / SECTION_ANALYSIS_EXPECTED_CHARS) * 70)
            )
            await _set_section_state(
                command_id,
                "streaming",
                percent,
                "Model is analyzing the section",
                stream_tail=text[-SECTION_STATE_STREAM_TAIL_CHARS:],
            )

        await _set_section_state(
            command_id, "prompting", 15, "Preparing the analysis prompt"
        )
        result = await analyze_source_section(
            source_id=input_data.source_id,
            section_title=input_data.section_title,
            section_text=input_data.section_text,
            page_start=input_data.page_start,
            page_end=input_data.page_end,
            locale=input_data.locale,
            on_delta=on_delta,
        )
        processing_time = time.time() - start_time
        logger.info(
            f"Section analysis for {input_data.source_id} "
            f"({input_data.section_title!r}) finished in {processing_time:.2f}s"
        )
        return AnalyzeSectionOutput(
            success=True,
            analysis_markdown=result["analysis_markdown"],
            model_name=result.get("model_name"),
            provider=result.get("provider"),
            truncated=result.get("truncated", False),
            processing_time=processing_time,
        )
    except Exception as e:
        logger.error(
            f"Section analysis failed for {input_data.source_id} "
            f"({input_data.section_title!r}): {e}"
        )
        raise
    finally:
        await _clear_section_state(command_id)
