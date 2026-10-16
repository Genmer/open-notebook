"""Shared LLM layer for the project-environment verification pipeline.

Used by both the API routers (polish / lane re-verify / suggest rewrite /
generic paragraph) and the verify_project_env command. Must never import
from api/ — the worker loads commands without the API package.
"""

import asyncio
import os
import re
from typing import Any, Dict, List, Optional, Type

from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser
from loguru import logger
from pydantic import BaseModel, Field

from open_notebook.ai.industry_pool import industry_hint_for, industry_profile_for
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.domain.ga_anchor_cache import GaAnchorCache
from open_notebook.domain.project_env import DEFAULT_INDUSTRY
from open_notebook.domain.project_env_rules import (
    ERA_SPECIFIC_TECHS,
    GA_ANCHORS,
    MONTH_RE,
    check_ga_ordering,
    is_month,
    is_valid_tech_name,
    lookup_ga_month,
    month_index,
)
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content
from open_notebook.utils.web_search import snippets_text, web_search

# Must cover one full _invoke_json attempt: 2 model calls (thinking models on
# long quotes run 30s+ each) plus the 8s rate-limit backoff between them.
LANE_TIMEOUT_SECONDS = 120
LANE_ATTEMPTS = 2


class CallBudget:
    """Counts LLM calls; the command hard-stops at the cap. Cap is read from
    the env at construction so tests/ops can tune it without a restart."""

    def __init__(self, cap: Optional[int] = None):
        if cap is None:
            try:
                cap = int(os.getenv("PROJECT_ENV_LLM_CALL_CAP", "200"))
            except ValueError:
                cap = 200
        self.cap = cap
        self.used = 0

    @property
    def exhausted(self) -> bool:
        return self.used >= self.cap

    def spend(self) -> None:
        self.used += 1


def _env_model(var: str) -> Optional[str]:
    return os.getenv(var, "").strip() or None


def get_lane_models() -> Dict[str, Optional[str]]:
    """Lane model ids from env overrides; None means the default chat model."""
    return {
        "A": _env_model("PROJECT_ENV_VERIFY_MODEL_A"),
        "B": _env_model("PROJECT_ENV_VERIFY_MODEL_B"),
        "C": _env_model("PROJECT_ENV_VERIFY_MODEL_C"),
    }


def get_correction_model() -> Optional[str]:
    return _env_model("PROJECT_ENV_CORRECTOR_MODEL")


def get_light_model() -> Optional[str]:
    return _env_model("PROJECT_ENV_LIGHT_MODEL")


def get_max_correction_rounds() -> int:
    try:
        value = int(os.getenv("PROJECT_ENV_MAX_CORRECTION_ROUNDS", "2"))
    except ValueError:
        value = 2
    return max(1, min(4, value))


# --- parsed output shapes ---


class ExtractedClaim(BaseModel):
    quote: str
    field: str
    type: str = "semantic"


class ExtractedClaims(BaseModel):
    claims: List[ExtractedClaim] = []


class LaneVerdict(BaseModel):
    verdict: str
    issues: List[str] = []


class MockDraft(BaseModel):
    name: str = ""
    background: str = ""
    period_start: str = ""
    period_end: str = ""
    tech_background: str = ""
    tuning_process: str = ""
    problems_solutions: str = ""
    my_role: str = ""
    scale: str = ""


class PrdParseDraft(BaseModel):
    """Candidate project-env fields extracted from a PRD document. No scale
    field by design: Pydantic hard-drops it, so personnel/money/user-scale
    numbers cannot survive the parse even if the model tries."""

    name: str = ""
    period_start: str = ""
    period_end: str = ""
    industry: str = ""
    keywords: List[str] = []
    background: str = ""
    tech_background: str = ""
    tuning_process: str = ""
    problems_solutions: str = ""
    my_role: str = ""


def _allowed_verdicts(lane: str, mode: str = "material") -> set:
    """Lanes only ever judge pass/fail. Unknown GA anchors resolve through
    the multi-level pipeline (static -> cache -> web) and, failing that, the
    prompt's plausibility rule — a table bounce (off_table) is never allowed."""
    return {"pass", "fail"}


def _strip_fences(content: str) -> str:
    content = clean_thinking_content(content).strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", content, re.DOTALL)
    if fenced:
        content = fenced.group(1).strip()
    return content


# Provider rate limits (HTTP 429 / Bailian code 1302) clear after a pause;
# retrying immediately only burns the attempt inside the same limited window.
_RATE_LIMIT_MARKERS = ("429", "rate limit", "1302")
RATE_LIMIT_BACKOFF_SECONDS = (8, 20)

# Shared meter across every pipeline LLM call: concurrent lane calls starting
# as a burst are what trip the provider rate limit in the first place.
LLM_CALL_MIN_INTERVAL_SECONDS = 1.5
_LLM_PACE_LOCK: Optional[asyncio.Lock] = None
_LLM_PACE_LAST = 0.0

# Hard ceiling per model call — a network drop mid-call would otherwise leave
# the awaiting coroutine (and its worker command) hung forever. Must stay well
# above real generation time: an 18-item materials bundle has been observed
# taking ~9 minutes on the default provider.
LLM_CALL_TIMEOUT_SECONDS = 900


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _RATE_LIMIT_MARKERS)


async def _pace_llm_calls() -> None:
    global _LLM_PACE_LOCK, _LLM_PACE_LAST
    if _LLM_PACE_LOCK is None:
        _LLM_PACE_LOCK = asyncio.Lock()
    async with _LLM_PACE_LOCK:
        now = asyncio.get_running_loop().time()
        wait = _LLM_PACE_LAST + LLM_CALL_MIN_INTERVAL_SECONDS - now
        if wait > 0:
            await asyncio.sleep(wait)
            _LLM_PACE_LAST += LLM_CALL_MIN_INTERVAL_SECONDS
        else:
            _LLM_PACE_LAST = now


def _emit_stage(on_stage: Optional[Any], stage: str) -> None:
    """Fire the optional stage progress callback. Stage events are pure
    progress cosmetics — a raising callback must never break the render."""
    if on_stage is None:
        return
    try:
        on_stage(stage)
    except Exception as e:
        logger.warning(f"on_stage callback failed for stage {stage!r}: {e}")


async def _invoke_json(
    template: str,
    data: Dict[str, Any],
    result_model: Type[BaseModel],
    model_id: Optional[str],
    budget: Optional[CallBudget] = None,
    validator: Optional[Any] = None,
    max_tokens: int = 4096,
    on_delta: Optional[Any] = None,
    on_stage: Optional[Any] = None,
) -> Optional[BaseModel]:
    """Render + call + parse, one retry with parser feedback. Returns None
    when both attempts fail (call or parse); never raises for model issues.

    on_delta (sync callback, text piece per LLM streaming chunk) switches the
    model call from ainvoke to astream — same timeout, same parse/validator/
    retry loop; None keeps the byte-identical ainvoke path.

    on_stage (sync callback, stage name string; guarded, never breaks the
    render) mirrors on_delta for the no-token-yet window: "waiting" fires
    before EVERY attempt enters the model call (pacing lock / queueing /
    connect), "thinking" on the first stream chunk before any text delta and
    "generating" on the first text delta (streaming branch only, each once).
    None disables stage reporting entirely."""
    parser: PydanticOutputParser = PydanticOutputParser(pydantic_object=result_model)
    payload = dict(data)
    for attempt in range(2):
        if budget is not None:
            if budget.exhausted:
                return None
            budget.spend()
        try:
            # Before EVERY attempt's model call — the pace lock below can hold
            # a burst for tens of seconds, which is exactly when the caller
            # needs a "still alive" signal.
            _emit_stage(on_stage, "waiting")
            await _pace_llm_calls()
            prompt = Prompter(prompt_template=template, parser=parser).render(  # type: ignore[arg-type]
                data=payload
            )
            prov = await provision_langchain_model_with_info(
                prompt, model_id, "chat", max_tokens=max_tokens
            )
            if on_delta is not None:
                # Provisioned chat models carry streaming=False (Esperanto's
                # to_langchain passes it through; langchain-core treats that as
                # a hard opt-out — astream would yield ONE whole-content chunk
                # via the invoke fallback). Same throwaway-copy flip as the
                # chat graph's stream_tokens path: re-enable streaming for
                # THIS call only, prov.langchain_model stays untouched.
                stream_model = prov.langchain_model.model_copy(
                    update={"streaming": True}
                )

                async def _consume_stream() -> str:
                    parts: List[str] = []
                    thinking_sent = False
                    generating_sent = False
                    async for chunk in stream_model.astream(prompt):
                        delta = extract_text_content(chunk.content)
                        if delta:
                            if not generating_sent:
                                generating_sent = True
                                _emit_stage(on_stage, "generating")
                            parts.append(delta)
                            on_delta(delta)
                        elif not thinking_sent and not generating_sent:
                            # First chunk(s) with no visible text yet: a
                            # thinking model reasoning before its first token.
                            thinking_sent = True
                            _emit_stage(on_stage, "thinking")
                    return "".join(parts)

                raw_content = await asyncio.wait_for(
                    _consume_stream(), timeout=LLM_CALL_TIMEOUT_SECONDS
                )
                content = _strip_fences(raw_content)
            else:
                raw = await asyncio.wait_for(
                    prov.langchain_model.ainvoke(prompt),
                    timeout=LLM_CALL_TIMEOUT_SECONDS,
                )
                content = _strip_fences(extract_text_content(raw.content))
            parsed = parser.parse(content)
            if validator is not None:
                payload["previous_error"] = str(validator(parsed))
                if payload["previous_error"]:
                    continue
            return parsed
        except ConfigurationError:
            raise  # permanent (no model configured) — must not be retried away
        except Exception as e:
            logger.warning(
                f"LLM call for {template} failed (attempt {attempt + 1}): {e}"
            )
            if _is_rate_limit_error(e) and attempt < len(RATE_LIMIT_BACKOFF_SECONDS):
                await asyncio.sleep(RATE_LIMIT_BACKOFF_SECONDS[attempt])
            payload["previous_error"] = f"previous output unusable: {e}"
    return None


# --- evidence + anchors ---


async def gather_evidence(quote: str) -> str:
    """Lane A evidence pack: text + vector search over the local KB, top 5 each."""
    from open_notebook.domain.notebook import text_search, vector_search

    excerpts: List[str] = []
    for finder in (text_search, vector_search):
        try:
            hits = await finder(quote, results=5)
        except Exception as e:
            logger.warning(f"KB search failed for lane A evidence: {e}")
            continue
        for hit in hits or []:
            content = str(hit.get("content") or "")
            if content:
                excerpts.append(content[:600])
    if not excerpts:
        return "(本地知识库中未检索到相关材料)"
    return "\n\n".join(
        f"[证据 {i + 1}]\n{excerpt}" for i, excerpt in enumerate(excerpts)
    )


# --- multi-level GA anchor resolution (静态表 → 缓存 → 联网 → 常识) ---


_GA_NUMERIC_RE = re.compile(r"(20\d{2})\s*[.\-/\s]\s*(\d{1,2})(?:\s*月|\b)")
_GA_CN_RE = re.compile(r"(20\d{2})\s*年\s*(\d{1,2})\s*月")
_GA_MONTH_NAME_RE = re.compile(
    r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\.?\s+(20\d{2})",
    re.IGNORECASE,
)
_MONTH_NAMES = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def _valid_ga(year: int, month: int) -> Optional[str]:
    if 1 <= month <= 12:
        return f"{year:04d}.{month:02d}"
    return None


def extract_ga_month(text: str) -> Optional[str]:
    """Heuristic GA month from search-result text: first month-shaped date in
    reading order (YYYY.MM / YYYY-MM-DD / 2024年10月 / October 2024). Best
    effort — the lane still sanity-checks the verdict against the window."""
    text = str(text or "")
    for match in _GA_CN_RE.finditer(text):
        ga = _valid_ga(int(match.group(1)), int(match.group(2)))
        if ga:
            return ga
    for match in _GA_NUMERIC_RE.finditer(text):
        ga = _valid_ga(int(match.group(1)), int(match.group(2)))
        if ga:
            return ga
    for match in _GA_MONTH_NAME_RE.finditer(text):
        ga = _valid_ga(int(match.group(2)), _MONTH_NAMES[match.group(1)[:3].lower()])
        if ga:
            return ga
    return None


class GaResolution(BaseModel):
    ga: Optional[str] = None
    confidence: str = "web"
    reasoning: str = ""


async def resolve_ga_with_llm(
    tech: str, version: str, snippets: str, budget: Optional[CallBudget] = None
) -> Optional[GaResolution]:
    """GaResolution when the light model answered — ga=None means it judged
    the snippets insufficient. None only when the call itself failed."""
    if not snippets or not snippets.strip():
        return None

    def _validate(parsed: BaseModel) -> str:
        if isinstance(parsed, GaResolution) and parsed.ga and not is_month(parsed.ga):
            return "ga must be in YYYY.MM format or null"
        return ""

    data = {
        "tech": tech,
        "version": version,
        "snippets": snippets[:4000],
    }
    parsed = await _invoke_json(
        "project_env/ga_resolver",
        data,
        GaResolution,
        get_light_model(),
        budget,
        validator=_validate,
    )
    if isinstance(parsed, GaResolution):
        return parsed
    return None


async def fetch_ga_anchor_online(
    tech: str, version: str, budget: Optional[CallBudget] = None
) -> Optional[Dict[str, str]]:
    """Web-search level: look up the GA month of one tech+version. Never
    raises; None when the search fails or no month-shaped date is found."""
    query = f"{tech} {version} release date GA"
    try:
        results = await web_search(query, max_results=5)
    except Exception as e:  # web_search already never raises; belt and braces
        logger.warning(f"GA web lookup failed for {tech} {version}: {e}")
        return None
    if not results:
        return None
    snippets = snippets_text(results)
    ga: Optional[str] = None
    confidence = "web"
    try:
        resolution = await resolve_ga_with_llm(tech, version, snippets, budget)
    except Exception as e:
        logger.warning(f"GA LLM resolution failed for {tech} {version}: {e}")
        resolution = None
    if resolution is not None:
        # ga=None (or malformed) is the model judging the snippets insufficient —
        # respect that verdict; never mine a date out of stray timestamps.
        if resolution.ga and is_month(resolution.ga):
            ga = resolution.ga
    else:
        # light model unavailable: heuristic last resort, flagged "heuristic" so
        # callers treat it as reference only, never a hard fail.
        try:
            ga = extract_ga_month(snippets)
            confidence = "heuristic"
        except Exception as e:  # heuristic parsing must never break the pipeline
            logger.warning(f"GA month extraction failed for {tech} {version}: {e}")
            return None

    if not ga:
        return None
    source = str(results[0].get("url") or "")
    return {"ga": ga, "source": f"web:{source}"[:300], "confidence": confidence}


async def cache_ga_anchor(tech: str, version: str, anchor: Dict[str, str]) -> None:
    """Best-effort write of one web-resolved anchor; races on the unique
    index or a DB outage cost only the cache, never the run."""
    try:
        row = GaAnchorCache(
            tech=tech,
            version=version,
            ga=anchor["ga"],
            source=anchor.get("source", ""),
            confidence=anchor.get("confidence", "web"),
        )
        await row.save()
    except Exception as e:
        logger.warning(f"ga_anchor_cache write failed for {tech} {version}: {e}")


async def resolve_ga_anchor(
    tech: str, version: str, budget: Optional[CallBudget] = None
) -> Optional[Dict[str, str]]:
    """One tech+version through the resolution levels: static table, then the
    ga_anchor_cache table, then a web lookup (hit is cached for next time).
    Returns {ga, source, confidence} or None when every level misses."""
    key = (tech or "").strip().lower()
    ver = (version or "").strip().lstrip("vV")
    if not key or not ver:
        return None
    static = lookup_ga_month(GA_ANCHORS.get(key) or {}, ver)
    if static:
        return {"ga": static, "source": "static_table", "confidence": "curated"}
    cached = await GaAnchorCache.lookup(key, ver)
    if cached and is_month(cached.ga):
        return {
            "ga": cached.ga,
            "source": cached.source or "cache",
            "confidence": cached.confidence,
        }
    online = await fetch_ga_anchor_online(key, ver, budget)
    if online:
        await cache_ga_anchor(key, ver, online)
        return online
    return None


async def anchors_table_for(quote: str) -> str:
    """Anchor subset relevant to the quote: static-table rows first, then
    dynamic (cache/web) resolution for every pair the static table cannot
    date. Dynamic rows carry their source so lane B can weigh them."""
    lowered = str(quote or "").lower()
    lines: List[str] = []
    for tech, versions in GA_ANCHORS.items():
        if tech in lowered:
            lines.extend(f"{tech} {version}: {ga}" for version, ga in versions.items())
    for match in VERSION_RE.finditer(str(quote or "")):
        tech = match.group(1).strip().lower()
        if not is_valid_tech_name(tech):
            continue
        version = match.group(2)
        if lookup_ga_month(GA_ANCHORS.get(tech) or {}, version):
            continue  # already covered by the static rows above
        anchor = await resolve_ga_anchor(tech, version)
        if anchor:
            lines.append(f"{tech} {version}: {anchor['ga']} (来源: {anchor['source']})")
    return "\n".join(lines) or "(锚点表中未找到该技术)"


def anchors_compact() -> str:
    return "\n".join(
        f"{tech} {version}: {ga}"
        for tech, versions in GA_ANCHORS.items()
        for version, ga in versions.items()
    )


# --- lane verification (A/B/C, shared by command and rewrite endpoint) ---


async def verify_point_lane(
    lane: str,
    quote: str,
    field: str,
    context: Dict[str, Any],
    budget: Optional[CallBudget] = None,
    lane_model: Optional[str] = None,
    mode: str = "material",
) -> Dict[str, Any]:
    """One lane verdict for one claim. Each attempt gets its own timeout;
    after one retry, model/parse failures degrade to verdict 'error' — never
    guess pass. ConfigurationError (no model configured) is the exception: it
    propagates so the caller can stop permanently instead of retrying."""
    allowed = _allowed_verdicts(lane, mode)

    def _validate(parsed: BaseModel) -> str:
        verdict = getattr(parsed, "verdict", "")
        return "" if verdict in allowed else f"verdict must be one of {sorted(allowed)}"

    data: Dict[str, Any] = {
        "quote": quote,
        "field": field,
        "period_start": context.get("period_start", ""),
        "period_end": context.get("period_end", ""),
        "narrative": context.get("narrative", ""),
        "my_role": context.get("my_role", ""),
        "anchor_table": anchors_compact(),
        "mode": mode,
    }
    if lane == "A":
        data["evidence"] = await gather_evidence(quote)
    if lane == "B":
        data["anchor_subset"] = await anchors_table_for(quote)

    parsed: Optional[BaseModel] = None
    for _attempt in range(LANE_ATTEMPTS):
        try:
            parsed = await asyncio.wait_for(
                _invoke_json(
                    f"project_env/verify_{lane.lower()}",
                    dict(data),
                    LaneVerdict,
                    lane_model,
                    budget,
                    validator=_validate,
                ),
                timeout=LANE_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            # One _invoke_json attempt already wraps 2 model calls plus a
            # rate-limit backoff, so this budget must cover all of it.
            logger.warning(
                f"Lane {lane} attempt timed out after {LANE_TIMEOUT_SECONDS}s "
                f"(quote: {quote[:60]!r})"
            )
            parsed = None
            continue
        except ConfigurationError:
            raise  # permanent misconfiguration must not be retried away
        except Exception as e:
            return {"verdict": "error", "issues": [str(e)]}
        if parsed is not None:
            break

    if parsed is None:
        return {
            "verdict": "error",
            "issues": ["model call or parsing failed after retry"],
        }
    if not isinstance(parsed, LaneVerdict):
        return {
            "verdict": "error",
            "issues": ["unexpected lane output shape"],
        }
    return {"verdict": parsed.verdict, "issues": parsed.issues}


# --- paragraph-level claim helpers ---


# Verification granularity is one natural paragraph; longer ones are split on
# sentence boundaries so a single claim never dwarfs the lane context budget.
PARAGRAPH_MAX_CHARS = 800


def split_paragraphs(text: str) -> List[str]:
    """Split text into paragraph-level claim units: newline paragraphs, with
    >800-char ones greedily repacked by sentence (。) up to the cap. A sentence
    without 。 that still exceeds the cap stays one oversized unit."""
    text = str(text or "")
    if not text.strip():
        return []
    units: List[str] = []
    for paragraph in text.split("\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if len(paragraph) <= PARAGRAPH_MAX_CHARS:
            units.append(paragraph)
            continue
        sentences = [s for s in re.split(r"(?<=[。])", paragraph) if s]
        chunk = ""
        for sentence in sentences:
            if chunk and len(chunk) + len(sentence) > PARAGRAPH_MAX_CHARS:
                units.append(chunk)
                chunk = ""
            if len(sentence) > PARAGRAPH_MAX_CHARS:
                # no usable boundary inside: keep the oversized sentence whole
                units.append(sentence)
                continue
            chunk += sentence
        if chunk:
            units.append(chunk)
    return units


def _find_verbatim(text: str, quote: str) -> Optional[str]:
    """Locate quote inside text tolerating whitespace differences; returns the
    exact original substring (or None) so downstream replaces stay byte-exact."""
    chars = [c for c in quote if not c.isspace()]
    if not text or not chars:
        return None
    pattern = r"\s*".join(re.escape(c) for c in chars)
    match = re.search(pattern, text)
    return match.group(0) if match else None


def _era_violations(
    quote: str, period_start: str, skip: Optional[set] = None
) -> List[str]:
    """Era-specific techs mentioned without a version number: VERSION_RE never
    turns a bare name into a pair, so scan the quote directly (word boundary)."""
    if not is_month(period_start):
        return []
    lowered = str(quote or "").lower()
    skip = skip or set()
    messages: List[str] = []
    for key, earliest in ERA_SPECIFIC_TECHS.items():
        if key in skip:
            continue
        if not re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", lowered):
            continue
        if month_index(earliest) > month_index(period_start):
            messages.append(
                f"{key} 是时代专属性新技术（最早出现于 {earliest}），"
                f"晚于项目开始时间 ({period_start})"
            )
    return messages


def prescreen_quote(quote: str, period_start: str) -> Dict[str, Any]:
    """Static-anchor pre-screen over EVERY technology+version pair in a
    paragraph: any GA violation fails the whole point. Pairs without an
    anchor stay undated here — the async multi-level prescreen below (or the
    lanes' plausibility rule) handles them, never an off_table block."""
    messages: List[str] = []
    statuses: List[str] = []
    seen: set = set()
    for match in VERSION_RE.finditer(str(quote or "")):
        tech = match.group(1).strip()
        if not is_valid_tech_name(tech):
            continue
        seen.add(tech.lower())
        result = check_ga_ordering(tech, match.group(2), period_start)
        statuses.append(result.get("status", "unspecified"))
        message = result.get("message")
        if message:
            messages.append(str(message))
    era_messages = _era_violations(quote, period_start, skip=seen)
    if era_messages:
        statuses.append("fail")
        messages.extend(era_messages)
    if "fail" in statuses:
        status = "fail"
    elif "off_table" in statuses:
        status = "unknown"
    elif statuses:
        status = "pass"
    else:
        status = "unspecified"
    return {"status": status, "message": "; ".join(messages)}


async def prescreen_point_anchors(quote: str, period_start: str) -> Dict[str, Any]:
    """Multi-level pre-screen for one point: static table first, then the
    ga_anchor_cache, then web lookup for pairs the static table cannot date.
    Status "fail" when any resolved anchor violates the window, "pass" when
    every found anchor is on/before period_start, "unknown" when some pair
    stayed undated (lane B judges plausibility), "unspecified" with no pairs.
    Never returns "off_table" — undated pairs never block a point."""
    messages: List[str] = []
    resolved_any = False
    undated_any = False
    failed_any = False
    anchors: Dict[str, Dict[str, str]] = {}
    seen: set = set()
    for match in VERSION_RE.finditer(str(quote or "")):
        tech = match.group(1).strip()
        if not is_valid_tech_name(tech):
            continue
        seen.add(tech.lower())
        version = match.group(2)
        result = check_ga_ordering(tech, version, period_start)
        status = result.get("status")
        if status == "fail":
            failed_any = True
            messages.append(str(result.get("message")))
            resolved_any = True
            continue
        if status == "pass":
            resolved_any = True
            continue
        if status == "unspecified":
            continue
        # off_table in the static table: escalate to the dynamic levels
        anchor = await resolve_ga_anchor(tech, version)
        if anchor and is_month(str(anchor.get("ga") or "")):
            anchors[f"{tech.lower()} {version}"] = anchor
            if str(anchor.get("confidence") or "") == "heuristic":
                # unverified heuristic date: lane-B reference only
                undated_any = True
            else:
                resolved_any = True
                if is_month(period_start) and month_index(
                    str(anchor["ga"])
                ) > month_index(period_start):
                    failed_any = True
                    messages.append(
                        f"{tech.lower()} {version} GA ({anchor['ga']}) is after "
                        f"project start ({period_start})"
                    )
                elif not is_month(period_start):
                    undated_any = True
        else:
            undated_any = True
    era_messages = _era_violations(quote, period_start, skip=seen)
    if era_messages:
        failed_any = True
        messages.extend(era_messages)
    if failed_any:
        status = "fail"
    elif undated_any:
        status = "unknown"
    elif resolved_any:
        status = "pass"
    else:
        status = "unspecified"
    return {"status": status, "message": "; ".join(messages), "anchors": anchors}


# --- correction / removal / polish / mock ---


class SuggestRewrite(BaseModel):
    suggestion: str
    explanation: str


async def suggest_rewrite(
    quote: str,
    field: str,
    issues: List[str],
    context: Dict[str, Any],
) -> Optional[SuggestRewrite]:
    """LLM suggestion for rewriting a whole failed paragraph, or None."""
    data = {
        "quote": quote,
        "field": field,
        "issues": issues,
        "narrative": context.get("narrative", ""),
        "period_start": context.get("period_start", ""),
        "period_end": context.get("period_end", ""),
    }
    parsed = await _invoke_json(
        "project_env/suggest_rewrite",
        data,
        SuggestRewrite,
        get_correction_model(),
        max_tokens=4096,
    )
    return parsed if isinstance(parsed, SuggestRewrite) else None


async def correct_point(
    quote: str,
    field: str,
    issues: List[str],
    context: Dict[str, Any],
    budget: Optional[CallBudget] = None,
) -> Optional[str]:
    """Corrected replacement sentence for a failed claim, or None."""
    data = {
        "quote": quote,
        "field": field,
        "issues": issues,
        "narrative": context.get("narrative", ""),
        "period_start": context.get("period_start", ""),
        "period_end": context.get("period_end", ""),
    }
    if budget is not None:
        if budget.exhausted:
            return None
        budget.spend()
    try:
        prompt = Prompter(prompt_template="project_env/corrector").render(data=data)
        prov = await provision_langchain_model_with_info(
            prompt, get_correction_model(), "chat", max_tokens=4096
        )
        raw = await prov.langchain_model.ainvoke(prompt)
        corrected = clean_thinking_content(extract_text_content(raw.content)).strip()
        return corrected or None
    except ConfigurationError:
        raise
    except Exception as e:
        logger.warning(f"correct_point failed: {e}")
        return None


async def render_polish(
    background: str, name: Optional[str] = None, tech_background: Optional[str] = None
) -> str:
    prompt = Prompter(prompt_template="project_env/polish").render(
        data={
            "background": background,
            "name": name,
            "tech_background": tech_background,
        }
    )
    prov = await provision_langchain_model_with_info(
        prompt, get_light_model(), "chat", max_tokens=4096
    )
    raw = await prov.langchain_model.ainvoke(prompt)
    polished = clean_thinking_content(extract_text_content(raw.content)).strip()
    if not polished:
        raise ValueError("polish returned empty output")
    return polished


async def render_generic_paragraph(
    name: str,
    period_start: Optional[str],
    period_end: Optional[str],
    source_type: str,
    candidate: Dict[str, Any],
    industry: Optional[str] = None,
) -> str:
    """Stateless generation of the reusable generic paragraph; never persisted
    by this call — the user reviews and saves it via PUT."""
    prompt = Prompter(prompt_template="project_env/generic_paragraph").render(
        data={
            "name": name,
            "period_start": period_start or "",
            "period_end": period_end or "",
            "source_type": source_type,
            "industry": (industry or "").strip(),
            "fields": [
                {"field": field, "text": str(text or "")}
                for field, text in candidate.items()
                if str(text or "").strip()
            ],
        }
    )
    prov = await provision_langchain_model_with_info(
        prompt, get_light_model(), "chat", max_tokens=4096
    )
    raw = await prov.langchain_model.ainvoke(prompt)
    paragraph = clean_thinking_content(extract_text_content(raw.content)).strip()
    if not paragraph:
        raise ValueError("generic paragraph returned empty output")
    return paragraph


class FixedPartsDraft(BaseModel):
    """Fill-in-the-blank fixed parts for one exam essay. Derived only from the
    candidate's own project material — never from model essays."""

    abstract: str = ""
    background: str = ""
    closing: str = ""


async def render_fixed_parts(
    name: str,
    period_start: Optional[str],
    period_end: Optional[str],
    source_type: str,
    candidate: Dict[str, Any],
    industry: Optional[str] = None,
) -> Dict[str, str]:
    """Stateless generation of the three fixed parts (abstract / background /
    closing) as fill-in-the-blank text; never persisted by this call — the user
    reviews and saves them into the writing-desk draft.

    Red line (ADR-017): the prompt context is ONLY the ProjectEnv material
    fields passed in `candidate` — no source retrieval, no notebook context,
    so marked model essays are unreachable by construction."""

    def _validate(parts: FixedPartsDraft) -> str:
        for slot in ("abstract", "background", "closing"):
            if not getattr(parts, slot).strip():
                return f"{slot} is empty"
        return ""

    data: Dict[str, Any] = {
        "name": name,
        "period_start": period_start or "",
        "period_end": period_end or "",
        "source_type": source_type,
        "industry": (industry or "").strip(),
        "fields": [
            {"field": field, "text": str(text or "")}
            for field, text in candidate.items()
            if str(text or "").strip()
        ],
    }
    parsed = await _invoke_json(
        "project_env/fixed_parts",
        data,
        FixedPartsDraft,
        get_light_model(),
        None,
        validator=_validate,
    )
    if parsed is None or not isinstance(parsed, FixedPartsDraft):
        raise ValueError("fixed parts returned unusable output")
    return {
        "abstract": parsed.abstract.strip(),
        "background": parsed.background.strip(),
        "closing": parsed.closing.strip(),
    }


# PRD 解析的五个叙述字段：prd_seed 只由这些键组成（period/keywords/industry
# 不进 seed，走各端点自己的通道）
PRD_SEED_FIELDS = (
    "background",
    "tech_background",
    "tuning_process",
    "problems_solutions",
    "my_role",
)


def prd_seed_has_narrative(prd_seed: Optional[Dict[str, str]]) -> bool:
    return any(
        str((prd_seed or {}).get(field) or "").strip() for field in PRD_SEED_FIELDS
    )


async def parse_prd_draft(prd_text: str) -> Optional[PrdParseDraft]:
    """Stateless PRD -> candidate-fields extraction; no CallBudget (single
    call, API-side timeout governs). ConfigurationError propagates."""

    def _validate(parsed: PrdParseDraft) -> str:
        for field in ("period_start", "period_end"):
            value = getattr(parsed, field).strip()
            if value and not MONTH_RE.match(value):
                return f"{field} must use the YYYY.MM format"
        return ""

    parsed = await _invoke_json(
        "project_env/prd_parse",
        {"prd_text": prd_text},
        PrdParseDraft,
        get_light_model(),
        max_tokens=8192,
        validator=_validate,
    )
    return parsed if isinstance(parsed, PrdParseDraft) else None


def _legal_window_for_template() -> Dict[str, str]:
    from open_notebook.domain.project_env_rules import legal_window

    return legal_window()


async def render_mock(
    keywords: List[str],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
    feedback: Optional[str] = None,
) -> Optional[MockDraft]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        "feedback": feedback or "",
        **window,
    }
    parsed = await _invoke_json(
        "project_env/mock_generate", data, MockDraft, None, budget
    )
    return parsed if isinstance(parsed, MockDraft) else None


async def render_prd_draft(
    keywords: List[str],
    prd_seed: Dict[str, str],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
    feedback: Optional[str] = None,
) -> Optional[MockDraft]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "prd_seed": prd_seed,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        "feedback": feedback or "",
        **window,
    }
    parsed = await _invoke_json(
        "project_env/draft_from_prd", data, MockDraft, None, budget, max_tokens=8192
    )
    return parsed if isinstance(parsed, MockDraft) else None


# --- material/route candidate generation (素材生成步骤) ---


class MaterialItem(BaseModel):
    category: str
    title: str
    text: str
    tags: List[str] = []


class MaterialsBundle(BaseModel):
    items: List[MaterialItem] = []


class RoutePeriod(BaseModel):
    start: str = ""
    end: str = ""


class RouteProposal(BaseModel):
    title: str = ""
    summary: str = ""
    tech_stack: List[str] = []
    scale: str = ""
    role: str = ""
    highlights: List[str] = []
    period: RoutePeriod = Field(default_factory=RoutePeriod)


class RoutesBundle(BaseModel):
    routes: List[RouteProposal] = []


async def generate_materials(
    keywords: List[str],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
) -> Optional[MaterialsBundle]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        **window,
    }
    # 18 条素材候选是全管线最大的单次 JSON 输出，4096 上限会截断它
    parsed = await _invoke_json(
        "project_env/materials_generate",
        data,
        MaterialsBundle,
        None,
        budget,
        max_tokens=8192,
    )
    return parsed if isinstance(parsed, MaterialsBundle) else None


async def generate_routes(
    keywords: List[str],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
) -> Optional[RoutesBundle]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        **window,
    }
    parsed = await _invoke_json(
        "project_env/routes_generate", data, RoutesBundle, None, budget
    )
    return parsed if isinstance(parsed, RoutesBundle) else None


async def render_materials_draft(
    keywords: List[str],
    selected_items: List[Dict[str, Any]],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
    feedback: Optional[str] = None,
) -> Optional[MockDraft]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "selected_items": [
            {
                "category": str(item.get("category") or ""),
                "title": str(item.get("title") or ""),
                "text": str(item.get("text") or ""),
            }
            for item in selected_items
        ],
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        "feedback": feedback or "",
        **window,
    }
    parsed = await _invoke_json(
        "project_env/draft_from_materials", data, MockDraft, None, budget
    )
    return parsed if isinstance(parsed, MockDraft) else None


async def render_route_draft(
    keywords: List[str],
    route: Dict[str, Any],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    industry: Optional[str] = None,
    budget: Optional[CallBudget] = None,
    feedback: Optional[str] = None,
) -> Optional[MockDraft]:
    window = _legal_window_for_template()
    resolved_industry = (industry or "").strip() or DEFAULT_INDUSTRY
    data: Dict[str, Any] = {
        "keywords": keywords,
        "route": route,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "industry": resolved_industry,
        "industry_hint": industry_hint_for(resolved_industry),
        "industry_profile": industry_profile_for(resolved_industry),
        "feedback": feedback or "",
        **window,
    }
    parsed = await _invoke_json(
        "project_env/draft_from_route", data, MockDraft, None, budget
    )
    return parsed if isinstance(parsed, MockDraft) else None


async def compress_draft(
    draft: Dict[str, Any], budget: Optional[CallBudget] = None
) -> Optional[Dict[str, Any]]:
    """One rewrite round that compacts a >20-claim mock draft."""
    if budget is not None:
        if budget.exhausted:
            return None
        budget.spend()
    try:
        prompt = Prompter(prompt_template="project_env/compress").render(
            data={"draft": draft}
        )
        prov = await provision_langchain_model_with_info(
            prompt, get_light_model(), "chat", max_tokens=4096
        )
        raw = await prov.langchain_model.ainvoke(prompt)
        content = _strip_fences(extract_text_content(raw.content))
        parser: PydanticOutputParser = PydanticOutputParser(pydantic_object=MockDraft)
        parsed = parser.parse(content)
        return parsed.model_dump()
    except Exception as e:
        logger.warning(f"compress_draft failed: {e}")
        return None


# --- two-stage claim extraction ---

VERSION_RE = re.compile(r"([A-Za-z][A-Za-z0-9+#. ]{1,30}?)\s*[vV]?(\d+(?:\.\d+){1,3})")
_METRIC_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:万|百万|亿|%|qps|QPS|tps|TPS|ms|GB|TB|PB|亿条|万条|条/秒)"
)
_PARAM_RE = re.compile(r"(?:参数|阈值|超时|并发|缓存|批大小|窗口)\s*[:：为]?\s*\d+")


def extract_claims_regex(fields: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Stage 1: regex must-capture at paragraph granularity — one paragraph
    yields at most one claim, typed by the highest-priority hit (version >
    metric > param); the quote is the whole paragraph."""
    claims: List[Dict[str, Any]] = []
    for field, text in fields.items():
        for paragraph in split_paragraphs(str(text or "")):
            has_valid_version = any(
                is_valid_tech_name(match.group(1).strip())
                for match in VERSION_RE.finditer(paragraph)
            )
            if has_valid_version:
                claim_type = "version"
            elif _METRIC_RE.search(paragraph):
                claim_type = "metric"
            elif _PARAM_RE.search(paragraph):
                claim_type = "param"
            else:
                continue
            claims.append({"quote": paragraph, "field": field, "type": claim_type})
    return claims


def dedup_claims(claims: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set = set()
    unique: List[Dict[str, Any]] = []
    for claim in claims:
        key = (
            claim.get("field"),
            re.sub(r"\s+", "", str(claim.get("quote", ""))),
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(claim)
    return unique


async def extract_claims_llm(
    fields: Dict[str, Any], budget: Optional[CallBudget] = None
) -> List[Dict[str, Any]]:
    """Stage 2: LLM supplements semantic (and exempt-marked narrative)
    claims the regexes cannot see."""
    data = {
        "fields": [
            {"field": field, "text": str(text or "")[:4000]}
            for field, text in fields.items()
            if str(text or "").strip()
        ]
    }
    parsed = await _invoke_json(
        "project_env/extract_claims", data, ExtractedClaims, get_light_model(), budget
    )
    if not isinstance(parsed, ExtractedClaims):
        return []
    return [claim.model_dump() for claim in parsed.claims]
