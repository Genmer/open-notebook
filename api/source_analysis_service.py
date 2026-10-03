"""Section analysis for the PDF outline AI feature.

One synchronous endpoint backing "analyze this section with AI" in the
source-file viewer: fetch nothing (the client sends the extracted section
text), render the source_analysis prompt and call the transformation model.
Unlike the explain service there is NO degraded fallback — a model failure is
an error the user retries; the only thing they clicked was this analysis.
"""

import asyncio
from typing import Any, Awaitable, Callable, Dict, Optional

from ai_prompter import Prompter
from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from api.explain_service import _language_for_locale
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import ExternalServiceError, NotFoundError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

# Hard cap on the section text sent to the model. Past this the analysis
# quality collapses anyway; the response flags the truncation so the UI can
# disclose it.
MAX_SECTION_CHARS = 60000

# Generous ceiling (matches explain's model gate style; section analysis runs
# on the transformation slot). asyncio.wait_for maps the expiry to a 502.
SECTION_ANALYSIS_TIMEOUT_SECONDS = 300

# Delta callback for the streaming variant: receives each incremental piece
# of model output as it arrives (used by the async command to persist a live
# progress stream).
DeltaCallback = Callable[[str], Awaitable[None]]


async def _stream_invoke(
    model: Any, payload: list, on_delta: DeltaCallback
) -> Any:
    """Consume the model's token stream, forwarding deltas and returning the
    aggregated message (usage_metadata lands on the summed final chunk)."""
    chunks = []
    async for chunk in model.astream(payload):
        chunks.append(chunk)
        delta = extract_text_content(chunk.content)
        if delta:
            await on_delta(delta)
    if not chunks:
        raise ExternalServiceError("Model returned an empty stream for section analysis")
    aggregated = chunks[0]
    for chunk in chunks[1:]:
        aggregated = aggregated + chunk
    return aggregated


async def analyze_source_section(
    source_id: str,
    section_title: str,
    section_text: str,
    page_start: Optional[int],
    page_end: Optional[int],
    locale: str,
    on_delta: Optional[DeltaCallback] = None,
) -> Dict[str, Any]:
    """Analyze one document section; raises OpenNotebookError on failure.

    With `on_delta` the model is consumed as a token stream and every
    incremental piece of output is awaited into the callback — the async
    command uses this to persist a live progress stream."""
    # 404 gate: the analysis UI can outlive a deleted source. NotFoundError is
    # mapped to HTTP 404 by the global handler (api/main.py).
    source = await Source.get(source_id)
    if not source:
        raise NotFoundError(f"Source {source_id} not found")

    truncated = len(section_text) > MAX_SECTION_CHARS
    effective_text = section_text[:MAX_SECTION_CHARS]

    page_range = None
    if page_start is not None and page_end is not None:
        page_range = f"{page_start}-{page_end}"
    elif page_start is not None:
        page_range = str(page_start)

    prompt = Prompter(prompt_template="source_analysis/section").render(
        data={
            "section_title": section_title,
            "section_text": effective_text,
            "page_range": page_range,
            "language": _language_for_locale(locale),
        }
    )

    provisioned = None
    ai_message = None
    try:
        provisioned = await provision_langchain_model_with_info(
            prompt, None, "transformation"
        )
        # DashScope/GLM-style providers reject a messages array without a
        # user turn — mirror chat.py's System+Human shape.
        payload = [
            SystemMessage(content=prompt),
            HumanMessage(
                content=(
                    f"Analyze the section \"{section_title}\" now, "
                    "following the OUTPUT FORMAT exactly."
                )
            ),
        ]
        if on_delta is None:
            ai_message = await asyncio.wait_for(
                asyncio.to_thread(provisioned.langchain_model.invoke, payload),
                timeout=SECTION_ANALYSIS_TIMEOUT_SECONDS,
            )
        else:
            ai_message = await asyncio.wait_for(
                _stream_invoke(provisioned.langchain_model, payload, on_delta),
                timeout=SECTION_ANALYSIS_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as e:
        logger.warning(f"Section analysis timed out for source {source_id}")
        await record_llm_usage(
            model=provisioned,
            ai_message=None,
            call_type="source_section_analysis",
            correlation_id=source_id,
            success=False,
            error=str(e) or "timeout",
        )
        raise ExternalServiceError(
            f"Section analysis timed out after {SECTION_ANALYSIS_TIMEOUT_SECONDS}s"
        ) from e
    except Exception as e:
        # Provisioning/model failures propagate as their OpenNotebookError
        # subclass (ConfigurationError → 422 with the Manage → Models hint;
        # provider errors → 502). No degraded fallback by design.
        await record_llm_usage(
            model=provisioned,
            ai_message=None,
            call_type="source_section_analysis",
            correlation_id=source_id,
            success=False,
            error=str(e),
        )
        raise

    analysis = clean_thinking_content(extract_text_content(ai_message.content))
    await record_llm_usage(
        model=provisioned,
        ai_message=ai_message,
        call_type="source_section_analysis",
        correlation_id=source_id,
    )

    return {
        "analysis_markdown": analysis,
        "model_name": provisioned.model_name,
        "provider": provisioned.provider,
        "truncated": truncated,
    }
