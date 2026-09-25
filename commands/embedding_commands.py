import time
from typing import (
    Any,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    Tuple,
    TypedDict,
)

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command, submit_command

from open_notebook.ai.models import model_manager
from open_notebook.database.repository import ensure_record_id, repo_insert, repo_query
from open_notebook.domain.notebook import Note, Source, SourceInsight
from open_notebook.exceptions import ConfigurationError, ContextLengthExceededError
from open_notebook.utils.chunking import ContentType, chunk_text, detect_content_type
from open_notebook.utils.embedding import (
    generate_embedding,
    iter_embedding_batches,
)
from open_notebook.utils.embedding_config import refresh_embedding_params

# NOTE: `stop_on` below can never trigger in practice — each command catches
# ValueError internally and returns success=False instead of raising, so the
# retry layer never sees it. Kept as-is on purpose; to be revisited in a
# dedicated error-handling PR.
EMBED_RETRY_CONFIG = {
    "max_attempts": 5,
    "wait_strategy": "exponential_jitter",
    "wait_min": 1,
    "wait_max": 60,
    "stop_on": [
        ValueError,
        ConfigurationError,
        ContextLengthExceededError,
    ],  # Don't retry validation/config errors
    "retry_log_level": "warning",
}


def get_command_id(input_data: CommandInput) -> str:
    """Extract command_id from input_data's execution context, or return 'unknown'."""
    if input_data.execution_context:
        return str(input_data.execution_context.command_id)
    return "unknown"


_TERMINAL_COMMAND_STATUSES = {"failed", "canceled", "completed"}


async def _owning_command_is_stale(command_id: str) -> bool:
    """Stale running is judged by the owning command's real status: a terminal
    or vanished command can never finish its run. A transient lookup failure
    counts as alive so we never double-embed."""
    try:
        rows = await repo_query(
            "SELECT status FROM type::thing($command_id)",
            {"command_id": command_id},
        )
    except Exception as e:
        logger.warning(f"Failed to look up owning command {command_id}: {e}")
        return False
    return not rows or str(rows[0].get("status")) in _TERMINAL_COMMAND_STATUSES


async def _collect_stale_running_sources() -> Dict[str, str]:
    """Sources stuck in 'running' whose owning command is terminal or gone are
    unrecoverable; map them to their stale command id for an optimistic-lock
    claim during a missing-mode rebuild."""
    rows = await repo_query(
        """
        SELECT id, embedding_command FROM source
        WHERE embedding_status = 'running'
        AND full_text != NONE AND string::trim(full_text) != ''
        """
    )
    stale: Dict[str, str] = {}
    for row in rows or []:
        owner = str(row.get("embedding_command") or "")
        if owner and not await _owning_command_is_stale(owner):
            continue
        stale[str(row["id"])] = owner
    return stale


class RebuildItems(TypedDict):
    sources: List[str]
    notes: List[str]
    insights: List[str]
    # source id -> owning command id ('' when the source has none)
    stale_sources: Dict[str, str]


async def _embed_record(
    input_data: CommandInput,
    *,
    kind: str,
    record_id: str,
    embed: Callable[[], Awaitable[Tuple[Dict[str, Any], str]]],
) -> Tuple[Optional[Dict[str, Any]], float, Optional[str]]:
    """
    Shared core for the embed_* commands: run the embedding work with the
    common logging and error-handling epilogue.

    Args:
        input_data: The command input (used for command_id logging).
        kind: Record kind for log messages ("note", "insight", "source").
        record_id: The record being embedded.
        embed: Async callable doing the actual load/validate/embed/write work.
            Returns (extra_output_fields, success_log_detail).

    Returns:
        (extra_output_fields, processing_time, error_message)
        extra_output_fields is None and error_message is set on permanent
        (ValueError) failure. Transient failures re-raise so the retry layer
        can handle them.
    """
    start_time = time.time()

    # Pick up current DB/env vectorization params before any embedding work.
    await refresh_embedding_params()

    try:
        logger.info(f"Starting embedding for {kind}: {record_id}")

        extra_fields, log_detail = await embed()

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully embedded {kind} {record_id}{log_detail} in {processing_time:.2f}s"
        )
        return extra_fields, processing_time, None

    except ValueError as e:
        # Permanent failure - don't retry
        processing_time = time.time() - start_time
        cmd_id = get_command_id(input_data)
        logger.error(f"Failed to embed {kind} {record_id} (command: {cmd_id}): {e}")
        return None, processing_time, str(e)
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        cmd_id = get_command_id(input_data)
        logger.debug(
            f"Transient error embedding {kind} {record_id} (command: {cmd_id}): {e}"
        )
        raise


async def _embed_markdown_record(
    input_data: CommandInput,
    *,
    label: str,
    record_id: str,
    loader: Callable[[str], Awaitable[Any]],
) -> Tuple[Dict[str, Any], str]:
    """
    Load a record, validate its content, embed it as markdown and UPSERT the
    embedding back onto the record. Shared by embed_note and embed_insight.
    """
    # 1. Load record
    record = await loader(record_id)
    if not record:
        raise ValueError(f"{label} '{record_id}' not found")

    if not record.content or not record.content.strip():
        raise ValueError(f"{label} '{record_id}' has no content to embed")

    # 2. Generate embedding (auto-chunks + mean pools if needed)
    # Notes and insights are typically markdown content
    cmd_id = get_command_id(input_data)
    embedding = await generate_embedding(
        record.content, content_type=ContentType.MARKDOWN, command_id=cmd_id
    )

    # 3. UPSERT embedding into the record
    await repo_query(
        "UPDATE $record_id SET embedding = $embedding",
        {
            "record_id": ensure_record_id(record_id),
            "embedding": embedding,
        },
    )

    return {}, ""


class RebuildEmbeddingsInput(CommandInput):
    mode: Literal["existing", "all", "missing"]
    include_sources: bool = True
    include_notes: bool = True
    include_insights: bool = True


class RebuildEmbeddingsOutput(CommandOutput):
    success: bool
    total_items: int
    jobs_submitted: int  # Count of embedding commands submitted
    failed_submissions: int  # Count of items that failed to submit
    sources_submitted: int = 0
    notes_submitted: int = 0
    insights_submitted: int = 0
    processing_time: float
    error_message: Optional[str] = None


class CreateInsightInput(CommandInput):
    """Input for creating a source insight with automatic retry on conflicts."""

    source_id: str
    insight_type: str
    content: str


class CreateInsightOutput(CommandOutput):
    """Output from insight creation command."""

    success: bool
    insight_id: Optional[str] = None
    processing_time: float
    error_message: Optional[str] = None


class EmbedNoteInput(CommandInput):
    """Input for embedding a single note."""

    note_id: str


class EmbedNoteOutput(CommandOutput):
    """Output from note embedding command."""

    success: bool
    note_id: str
    processing_time: float
    error_message: Optional[str] = None


class EmbedInsightInput(CommandInput):
    """Input for embedding a single source insight."""

    insight_id: str


class EmbedInsightOutput(CommandOutput):
    """Output from insight embedding command."""

    success: bool
    insight_id: str
    processing_time: float
    error_message: Optional[str] = None


class EmbedSourceInput(CommandInput):
    """Input for embedding a source (creates multiple chunk embeddings)."""

    source_id: str


class EmbedSourceOutput(CommandOutput):
    """Output from source embedding command."""

    success: bool
    source_id: str
    chunks_created: int
    processing_time: float
    error_message: Optional[str] = None
    embedding_status: Optional[str] = None
    embedded_chunks: int = 0


@command("embed_note", app="open_notebook", retry=EMBED_RETRY_CONFIG)
async def embed_note_command(input_data: EmbedNoteInput) -> EmbedNoteOutput:
    """
    Generate and store embedding for a single note.

    Uses the unified embedding pipeline with automatic chunking and mean pooling
    for notes that exceed the chunk size limit.

    Flow:
    1. Load Note by ID
    2. Generate embedding via generate_embedding() (auto-chunks + mean pools if needed)
    3. UPSERT note embedding in database

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """

    async def embed() -> Tuple[Dict[str, Any], str]:
        return await _embed_markdown_record(
            input_data,
            label="Note",
            record_id=input_data.note_id,
            loader=Note.get,
        )

    _, processing_time, error_message = await _embed_record(
        input_data,
        kind="note",
        record_id=input_data.note_id,
        embed=embed,
    )

    return EmbedNoteOutput(
        success=error_message is None,
        note_id=input_data.note_id,
        processing_time=processing_time,
        error_message=error_message,
    )


@command("embed_insight", app="open_notebook", retry=EMBED_RETRY_CONFIG)
async def embed_insight_command(input_data: EmbedInsightInput) -> EmbedInsightOutput:
    """
    Generate and store embedding for a single source insight.

    Uses the unified embedding pipeline with automatic chunking and mean pooling
    for insights that exceed the chunk size limit.

    Flow:
    1. Load SourceInsight by ID
    2. Generate embedding via generate_embedding() (auto-chunks + mean pools if needed)
    3. UPSERT insight embedding in database

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """

    async def embed() -> Tuple[Dict[str, Any], str]:
        return await _embed_markdown_record(
            input_data,
            label="Insight",
            record_id=input_data.insight_id,
            loader=SourceInsight.get,
        )

    _, processing_time, error_message = await _embed_record(
        input_data,
        kind="insight",
        record_id=input_data.insight_id,
        embed=embed,
    )

    return EmbedInsightOutput(
        success=error_message is None,
        insight_id=input_data.insight_id,
        processing_time=processing_time,
        error_message=error_message,
    )


@command("embed_source", app="open_notebook", retry=EMBED_RETRY_CONFIG)
async def embed_source_command(input_data: EmbedSourceInput) -> EmbedSourceOutput:
    """
    Generate and store embeddings for a source document.

    Creates multiple chunk embeddings stored in the source_embedding table,
    inserted batch by batch so the source's denormalized progress fields
    (embedding_status/embedded_chunks/...) reflect real progress.

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors);
      embedding batches whose own retries are exhausted raise ValueError
      so the command lands in a terminal partial/failed state instead of
      re-running from scratch.
    """

    async def _mark_state(
        source: Source, status: str, error: Optional[str] = None, **kwargs: Any
    ) -> None:
        await source.set_embedding_state(
            status=status, error=error, command_id=cmd_id, best_effort=True, **kwargs
        )

    async def embed() -> Tuple[Dict[str, Any], str]:
        # 1. Load source
        source = await Source.get(input_data.source_id)
        if not source:
            raise ValueError(f"Source '{input_data.source_id}' not found")

        # A live command owning this source (running or queued) must not be
        # double-run: touching the source here would delete embeddings the
        # owner is writing. Same-command retries carry the same id and are not
        # skipped; a stale owner is taken over instead of blocking forever.
        if (
            source.embedding_status in ("running", "queued")
            and source.embedding_command
            and str(source.embedding_command) != cmd_id
        ):
            owner = str(source.embedding_command)
            if not await _owning_command_is_stale(owner):
                logger.info(
                    f"Skipping embed_source for {input_data.source_id}: "
                    f"owned by active command {owner} ({source.embedding_status})"
                )
                return (
                    {
                        "chunks_created": 0,
                        "embedding_status": source.embedding_status,
                        "embedded_chunks": 0,
                    },
                    ": skipped (owned by another command)",
                )
            logger.info(
                f"Taking over embed_source for {input_data.source_id}: "
                f"owning command {owner} is stale"
            )

        if not source.full_text or not source.full_text.strip():
            await _mark_state(source, "failed", "Source has no text to embed")
            raise ValueError(f"Source '{input_data.source_id}' has no text to embed")

        # 2. DELETE existing embeddings (idempotency)
        logger.debug(f"Deleting existing embeddings for source {input_data.source_id}")
        await repo_query(
            "DELETE source_embedding WHERE source = $source_id",
            {"source_id": ensure_record_id(input_data.source_id)},
        )

        # 3. Detect content type from file path if available
        file_path = source.asset.file_path if source.asset else None
        content_type = detect_content_type(source.full_text, file_path)
        logger.debug(f"Detected content type: {content_type.value}")

        # 4. Chunk text using appropriate splitter
        chunks = chunk_text(source.full_text, content_type=content_type)
        total_chunks = len(chunks)

        # Log chunk statistics for debugging
        chunk_sizes = [len(c) for c in chunks]
        logger.info(
            f"Created {total_chunks} chunks for source {input_data.source_id} "
            f"(sizes: min={min(chunk_sizes) if chunk_sizes else 0}, "
            f"max={max(chunk_sizes) if chunk_sizes else 0}, "
            f"avg={sum(chunk_sizes) // len(chunk_sizes) if chunk_sizes else 0} chars)"
        )

        if total_chunks == 0:
            await _mark_state(source, "failed", "No chunks created after splitting text")
            raise ValueError("No chunks created after splitting text")

        # 5. Reset progress before the first batch
        await _mark_state(
            source, "running", error=None, total_chunks=total_chunks, embedded_chunks=0
        )

        # 6. Embed batch by batch, inserting each batch so progress is real
        embedded_so_far = 0
        try:
            async for batch_embeddings in iter_embedding_batches(
                chunks, command_id=cmd_id
            ):
                start_index = embedded_so_far
                batch_chunks = chunks[start_index : start_index + len(batch_embeddings)]
                if len(batch_embeddings) != len(batch_chunks):
                    raise ValueError(
                        f"Embedding count mismatch: got {len(batch_embeddings)} "
                        f"embeddings for {len(batch_chunks)} chunks"
                    )

                records = [
                    {
                        "source": ensure_record_id(input_data.source_id),
                        "order": start_index + idx,
                        "content": chunk,
                        "embedding": embedding,
                    }
                    for idx, (chunk, embedding) in enumerate(
                        zip(batch_chunks, batch_embeddings)
                    )
                ]
                logger.debug(f"Inserting {len(records)} source_embedding records")
                await repo_insert("source_embedding", records)
                embedded_so_far += len(records)

                await _mark_state(
                    source, "running", embedded_chunks=embedded_so_far
                )
        except ValueError as e:
            # Permanent (bad input / missing config) - terminal state; retrying
            # cannot fix it (stop_on includes ValueError anyway).
            status = "partial" if embedded_so_far > 0 else "failed"
            await _mark_state(source, status, error=str(e))
            raise
        except RuntimeError as e:
            # Batch retries exhausted inside the embedding pipeline - permanent,
            # don't burn the command-level retry budget re-running everything.
            status = "partial" if embedded_so_far > 0 else "failed"
            await _mark_state(source, status, error=str(e))
            raise ValueError(
                f"Embedding failed permanently for source {input_data.source_id}: {e}"
            ) from e
        except Exception as e:
            # Transient - the command-level retry re-runs embed(), which resets
            # progress. Keep status=running so the UI keeps polling instead of
            # freezing on a fake "failed" during the retry backoff (and users
            # aren't tempted into a concurrent manual retry). Accepted edge: if
            # the retry budget is exhausted the command ends success=False while
            # the source stays running - a manual retry rescues it.
            await _mark_state(source, "running", error=str(e))
            raise

        await _mark_state(
            source,
            "completed",
            error=None,
            embedded_chunks=embedded_so_far,
            total_chunks=total_chunks,
        )

        return (
            {
                "chunks_created": embedded_so_far,
                "embedding_status": "completed",
                "embedded_chunks": embedded_so_far,
            },
            f": {embedded_so_far} chunks",
        )

    cmd_id = get_command_id(input_data)
    extra_fields, processing_time, error_message = await _embed_record(
        input_data,
        kind="source",
        record_id=input_data.source_id,
        embed=embed,
    )

    fields = extra_fields or {}
    return EmbedSourceOutput(
        success=error_message is None,
        source_id=input_data.source_id,
        chunks_created=fields.get("chunks_created", 0),
        processing_time=processing_time,
        error_message=error_message,
        embedding_status=fields.get("embedding_status"),
        embedded_chunks=fields.get("embedded_chunks", 0),
    )


@command("create_insight", app="open_notebook", retry=EMBED_RETRY_CONFIG)
async def create_insight_command(
    input_data: CreateInsightInput,
) -> CreateInsightOutput:
    """
    Create a source insight with automatic retry on transaction conflicts.

    This command wraps the CREATE source_insight operation with retry logic
    to handle SurrealDB transaction conflicts that occur during batch imports
    when multiple parallel transformations try to create insights concurrently.

    Flow:
    1. CREATE source_insight record in database
    2. Submit embed_insight command (fire-and-forget) for async embedding
    3. Return the insight_id

    Retry Strategy:
    - Retries up to 5 times for transient failures (network, timeout, etc.)
    - Uses exponential-jitter backoff (1-60s)
    - Does NOT retry permanent failures (ValueError for validation errors)
    """
    start_time = time.time()

    try:
        logger.info(
            f"Creating insight for source {input_data.source_id}: "
            f"type={input_data.insight_type}"
        )

        # 1. Create insight record in database
        result = await repo_query(
            """
            CREATE source_insight CONTENT {
                "source": $source_id,
                "insight_type": $insight_type,
                "content": $content
            };
            """,
            {
                "source_id": ensure_record_id(input_data.source_id),
                "insight_type": input_data.insight_type,
                "content": input_data.content,
            },
        )

        if not result or len(result) == 0:
            raise ValueError("Failed to create insight - no result returned")

        insight_id = str(result[0].get("id", ""))
        if not insight_id:
            raise ValueError("Failed to create insight - no ID in result")

        # 2. Submit embedding command (fire-and-forget)
        submit_command(
            "open_notebook",
            "embed_insight",
            {"insight_id": insight_id},
        )
        logger.debug(f"Submitted embed_insight command for {insight_id}")

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully created insight {insight_id} for source "
            f"{input_data.source_id} in {processing_time:.2f}s"
        )

        return CreateInsightOutput(
            success=True,
            insight_id=insight_id,
            processing_time=processing_time,
        )

    except ValueError as e:
        # Permanent failure - don't retry
        processing_time = time.time() - start_time
        cmd_id = get_command_id(input_data)
        logger.error(
            f"Failed to create insight for source {input_data.source_id} "
            f"(command: {cmd_id}): {e}"
        )
        return CreateInsightOutput(
            success=False,
            processing_time=processing_time,
            error_message=str(e),
        )
    except Exception as e:
        # Transient failure - will be retried (surreal-commands logs final failure)
        cmd_id = get_command_id(input_data)
        logger.debug(
            f"Transient error creating insight for source {input_data.source_id} "
            f"(command: {cmd_id}): {e}"
        )
        raise


async def collect_items_for_rebuild(
    mode: str,
    include_sources: bool,
    include_notes: bool,
    include_insights: bool,
) -> RebuildItems:
    """
    Collect items to rebuild based on mode and include flags.

    Returns:
        RebuildItems with 'sources', 'notes', 'insights' lists plus
        'stale_sources' (missing mode only): running sources whose owning
        command is terminal/gone, mapped to that stale command id.
    """
    items: RebuildItems = {
        "sources": [],
        "notes": [],
        "insights": [],
        "stale_sources": {},
    }

    if include_sources:
        if mode == "missing":
            # Only sources missing an embedding (or whose last attempt failed)
            result = await repo_query(
                """
                SELECT VALUE id FROM source
                WHERE full_text != NONE AND string::trim(full_text) != ''
                AND (embedding_status IS NONE OR embedding_status IN ['not_embedded', 'failed', 'partial'])
                """
            )
            items["sources"] = [str(item) for item in result] if result else []
            # Stuck-in-running sources under a dead command would otherwise be
            # unreachable from missing mode forever
            items["stale_sources"] = await _collect_stale_running_sources()
            items["sources"].extend(items["stale_sources"])
        elif mode == "existing":
            # Query sources with embeddings (via source_embedding table)
            result = await repo_query(
                """
                RETURN array::distinct(
                    SELECT VALUE source.id
                    FROM source_embedding
                    WHERE embedding != none AND array::len(embedding) > 0
                )
                """
            )
            # RETURN returns the array directly as the result (not nested)
            if result:
                items["sources"] = [str(item) for item in result]
            else:
                items["sources"] = []
        else:  # mode == "all"
            # Query all sources with non-empty content
            result = await repo_query(
                "SELECT id FROM source WHERE full_text != none AND string::trim(full_text) != ''"
            )
            items["sources"] = [str(item["id"]) for item in result] if result else []

        logger.info(f"Collected {len(items['sources'])} sources for rebuild")

    if include_notes and mode != "missing":
        if mode == "existing":
            # Query notes with embeddings
            result = await repo_query(
                "SELECT id FROM note WHERE embedding != none AND array::len(embedding) > 0"
            )
        else:  # mode == "all"
            # Query all notes with non-empty content
            result = await repo_query(
                "SELECT id FROM note WHERE content != none AND string::trim(content) != ''"
            )

        items["notes"] = [str(item["id"]) for item in result] if result else []
        logger.info(f"Collected {len(items['notes'])} notes for rebuild")

    if include_insights and mode != "missing":
        if mode == "existing":
            # Query insights with embeddings
            result = await repo_query(
                "SELECT id FROM source_insight WHERE embedding != none AND array::len(embedding) > 0"
            )
        else:  # mode == "all"
            # Query all insights with non-empty content
            result = await repo_query(
                "SELECT id FROM source_insight WHERE content != none AND string::trim(content) != ''"
            )

        items["insights"] = [str(item["id"]) for item in result] if result else []
        logger.info(f"Collected {len(items['insights'])} insights for rebuild")

    return items


def _submit_embedding_jobs(
    kind: str, command_name: str, id_field: str, item_ids: List[str]
) -> Tuple[int, int]:
    """
    Submit one embedding command per item, logging progress every 50 items.

    Returns:
        (submitted_count, failed_count)
    """
    logger.info(f"\nSubmitting {len(item_ids)} {kind} embedding jobs...")
    submitted = 0
    failed = 0
    for idx, item_id in enumerate(item_ids, 1):
        try:
            submit_command(
                "open_notebook",
                command_name,
                {id_field: item_id},
            )
            submitted += 1

            if idx % 50 == 0 or idx == len(item_ids):
                logger.info(f"  Progress: {idx}/{len(item_ids)} {kind} jobs submitted")

        except Exception as e:
            logger.error(f"Failed to submit {command_name} for {item_id}: {e}")
            failed += 1

    return submitted, failed


async def _claim_and_submit_sources(
    source_ids: List[str],
    coordinator_id: str,
    stale_running: Optional[Dict[str, str]] = None,
) -> Tuple[int, int]:
    """
    Atomically claim pending sources then submit one embed_source per claim.

    The conditional UPDATE doubles as the claim: a concurrent or duplicate
    rebuild can't re-claim sources already queued by this path (double-click
    protection). Only ids returned by the UPDATE are submitted. The claim
    stamps the coordinator's command id so a manual trigger during the
    queued->running window can't start a second concurrent embed.

    stale_running maps sources stuck in 'running' under a dead command to that
    stale command id; they are claimed with an optimistic lock (the owner must
    still match) so a live owner is never stolen.

    Returns:
        (submitted_count, failed_count)
    """
    if not source_ids:
        return 0, 0

    # 'unknown' (no execution context) must not be stored as a command id
    command_set = (
        ", embedding_command = $coordinator_id"
        if coordinator_id != "unknown"
        else ""
    )
    params: Dict[str, Any] = {
        "ids": [ensure_record_id(source_id) for source_id in source_ids]
    }
    if coordinator_id != "unknown":
        params["coordinator_id"] = ensure_record_id(coordinator_id)

    claimed = await repo_query(
        f"""
        UPDATE source SET embedding_status = 'queued'{command_set}, embedding_error = NONE
        WHERE id IN $ids
        AND (embedding_status IS NONE OR embedding_status IN ['not_embedded', 'failed', 'partial'])
        RETURN id
        """,
        params,
    )
    claimed_ids = [str(row["id"]) for row in claimed or []]

    # Group by expected stale owner so one parameterized UPDATE covers each set
    grouped: Dict[str, List[str]] = {}
    for source_id, owner in (stale_running or {}).items():
        grouped.setdefault(owner, []).append(source_id)

    for owner, group_ids in grouped.items():
        # Optimistic lock: claim only while the source still points at the
        # exact stale command we verified during collection
        owner_clause = (
            "AND embedding_command = $owner"
            if owner
            else "AND embedding_command IS NONE"
        )
        group_params: Dict[str, Any] = {
            "ids": [ensure_record_id(source_id) for source_id in group_ids]
        }
        if coordinator_id != "unknown":
            group_params["coordinator_id"] = ensure_record_id(coordinator_id)
        if owner:
            group_params["owner"] = ensure_record_id(owner)
        rows = await repo_query(
            f"""
            UPDATE source SET embedding_status = 'queued'{command_set}, embedding_error = NONE
            WHERE id IN $ids AND embedding_status = 'running' {owner_clause}
            RETURN id
            """,
            group_params,
        )
        claimed_ids.extend(str(row["id"]) for row in rows or [])

    logger.info(
        f"Claimed {len(claimed_ids)}/{len(source_ids)} sources for embedding"
    )

    submitted = 0
    failed = 0
    for source_id in claimed_ids:
        try:
            submit_command(
                "open_notebook",
                "embed_source",
                {"source_id": source_id},
            )
            submitted += 1
        except Exception as e:
            # Otherwise the source would sit in 'queued' with no job behind it.
            logger.error(f"Failed to submit embed_source for {source_id}: {e}")
            await repo_query(
                "UPDATE $source_id SET embedding_status = 'failed', embedding_error = $error",
                {
                    "source_id": ensure_record_id(source_id),
                    "error": str(e)[:500],
                },
            )
            failed += 1

    return submitted, failed


@command("rebuild_embeddings", app="open_notebook", retry=None)
async def rebuild_embeddings_command(
    input_data: RebuildEmbeddingsInput,
) -> RebuildEmbeddingsOutput:
    """
    Rebuild embeddings for sources, notes, and/or insights.

    This command submits individual embedding jobs for each item:
    - embed_source for sources
    - embed_note for notes
    - embed_insight for insights

    The command returns after submitting all jobs. Actual embedding
    happens asynchronously via the individual commands (which have
    their own retry strategies).

    Retry Strategy:
    - Retries disabled (retry=None) for this coordinator command
    - Individual embed_* commands handle their own retries
    """
    start_time = time.time()

    try:
        logger.info("=" * 60)
        logger.info(f"Starting embedding rebuild with mode={input_data.mode}")
        logger.info(
            f"Include: sources={input_data.include_sources}, notes={input_data.include_notes}, insights={input_data.include_insights}"
        )
        logger.info("=" * 60)

        # Check embedding model availability (fail fast)
        EMBEDDING_MODEL = await model_manager.get_embedding_model()
        if not EMBEDDING_MODEL:
            raise ValueError(
                "No embedding model configured. Please configure one in the Models section."
            )

        logger.info(f"Embedding model configured: {EMBEDDING_MODEL}")

        # Collect items to process (returns IDs only)
        items = await collect_items_for_rebuild(
            input_data.mode,
            input_data.include_sources,
            input_data.include_notes,
            input_data.include_insights,
        )

        total_items = (
            len(items["sources"]) + len(items["notes"]) + len(items["insights"])
        )
        logger.info(f"Total items to rebuild: {total_items}")

        if total_items == 0:
            logger.warning("No items found to rebuild")
            return RebuildEmbeddingsOutput(
                success=True,
                total_items=0,
                jobs_submitted=0,
                failed_submissions=0,
                processing_time=time.time() - start_time,
            )

        # Submit one embedding command per item, per kind
        if input_data.mode == "missing":
            sources_submitted, sources_failed = await _claim_and_submit_sources(
                items["sources"], get_command_id(input_data), items["stale_sources"]
            )
        else:
            sources_submitted, sources_failed = _submit_embedding_jobs(
                "source", "embed_source", "source_id", items["sources"]
            )
        notes_submitted, notes_failed = _submit_embedding_jobs(
            "note", "embed_note", "note_id", items["notes"]
        )
        insights_submitted, insights_failed = _submit_embedding_jobs(
            "insight", "embed_insight", "insight_id", items["insights"]
        )
        failed_submissions = sources_failed + notes_failed + insights_failed

        processing_time = time.time() - start_time
        jobs_submitted = sources_submitted + notes_submitted + insights_submitted

        logger.info("=" * 60)
        logger.info("REBUILD JOBS SUBMITTED")
        logger.info(f"  Total jobs submitted: {jobs_submitted}/{total_items}")
        logger.info(f"  Sources: {sources_submitted}")
        logger.info(f"  Notes: {notes_submitted}")
        logger.info(f"  Insights: {insights_submitted}")
        logger.info(f"  Failed submissions: {failed_submissions}")
        logger.info(f"  Submission time: {processing_time:.2f}s")
        logger.info("  Note: Actual embedding happens asynchronously")
        logger.info("=" * 60)

        return RebuildEmbeddingsOutput(
            success=True,
            total_items=total_items,
            jobs_submitted=jobs_submitted,
            failed_submissions=failed_submissions,
            sources_submitted=sources_submitted,
            notes_submitted=notes_submitted,
            insights_submitted=insights_submitted,
            processing_time=processing_time,
        )

    except Exception as e:
        processing_time = time.time() - start_time
        logger.error(f"Rebuild embeddings failed: {e}")
        logger.exception(e)

        return RebuildEmbeddingsOutput(
            success=False,
            total_items=0,
            jobs_submitted=0,
            failed_submissions=0,
            processing_time=processing_time,
            error_message=str(e),
        )
