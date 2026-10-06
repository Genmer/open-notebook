"""Shared LLM layer for the project-environment verification pipeline.

Used by both the API routers (polish / lane re-verify / claim removal) and
the verify_project_env command. Must never import from api/ — the worker
loads commands without the API package.
"""

import asyncio
import os
import re
from typing import Any, Dict, List, Optional, Type

from ai_prompter import Prompter
from langchain_core.output_parsers.pydantic import PydanticOutputParser
from loguru import logger
from pydantic import BaseModel

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.domain.project_env_rules import GA_ANCHORS
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

LANE_TIMEOUT_SECONDS = 30
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


_ALLOWED_VERDICTS = {
    "A": {"pass", "fail"},
    "B": {"pass", "fail", "off_table"},
    "C": {"pass", "fail"},
}


def _strip_fences(content: str) -> str:
    content = clean_thinking_content(content).strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", content, re.DOTALL)
    if fenced:
        content = fenced.group(1).strip()
    return content


async def _invoke_json(
    template: str,
    data: Dict[str, Any],
    result_model: Type[BaseModel],
    model_id: Optional[str],
    budget: Optional[CallBudget],
    validator: Optional[Any] = None,
) -> Optional[BaseModel]:
    """Render + call + parse, one retry with parser feedback. Returns None
    when both attempts fail (call or parse); never raises for model issues."""
    parser: PydanticOutputParser = PydanticOutputParser(pydantic_object=result_model)
    payload = dict(data)
    for attempt in range(2):
        if budget is not None:
            if budget.exhausted:
                return None
            budget.spend()
        try:
            prompt = Prompter(prompt_template=template, parser=parser).render(  # type: ignore[arg-type]
                data=payload
            )
            prov = await provision_langchain_model_with_info(
                prompt, model_id, "chat", max_tokens=4096
            )
            raw = await prov.langchain_model.ainvoke(prompt)
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


def anchors_table_for(quote: str) -> str:
    """Anchor subset relevant to the quote (empty when nothing matches)."""
    lowered = quote.lower()
    lines: List[str] = []
    for tech, versions in GA_ANCHORS.items():
        if tech in lowered:
            lines.extend(f"{tech} {version}: {ga}" for version, ga in versions.items())
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
) -> Dict[str, Any]:
    """One lane verdict for one claim. Each attempt gets its own timeout;
    after one retry, model/parse failures degrade to verdict 'error' — never
    guess pass. ConfigurationError (no model configured) is the exception: it
    propagates so the caller can stop permanently instead of retrying."""
    allowed = _ALLOWED_VERDICTS.get(lane, {"pass", "fail"})

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
    }
    if lane == "A":
        data["evidence"] = await gather_evidence(quote)
    if lane == "B":
        data["anchor_subset"] = anchors_table_for(quote)

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


# --- correction / removal / polish / mock ---


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
            prompt, get_correction_model(), "chat", max_tokens=1024
        )
        raw = await prov.langchain_model.ainvoke(prompt)
        corrected = clean_thinking_content(extract_text_content(raw.content)).strip()
        return corrected or None
    except ConfigurationError:
        raise
    except Exception as e:
        logger.warning(f"correct_point failed: {e}")
        return None


async def remove_supporting_text(text: str, quote: str) -> Optional[str]:
    """Light LLM removal of the statement supporting a dismissed claim.
    None means the call failed — callers fall back to regex removal."""
    try:
        prompt = Prompter(prompt_template="project_env/remove_supporting").render(
            data={"text": text, "quote": quote}
        )
        prov = await provision_langchain_model_with_info(
            prompt, get_light_model(), "chat", max_tokens=2048
        )
        raw = await prov.langchain_model.ainvoke(prompt)
        cleaned = clean_thinking_content(extract_text_content(raw.content)).strip()
        return cleaned or None
    except Exception as e:
        logger.warning(f"remove_supporting_text failed: {e}")
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


def _legal_window_for_template() -> Dict[str, str]:
    from open_notebook.domain.project_env_rules import legal_window

    return legal_window()


async def render_mock(
    keywords: List[str],
    name: Optional[str],
    period_start: Optional[str],
    period_end: Optional[str],
    budget: Optional[CallBudget] = None,
    feedback: Optional[str] = None,
) -> Optional[MockDraft]:
    window = _legal_window_for_template()
    data: Dict[str, Any] = {
        "keywords": keywords,
        "name": name or "",
        "fixed_period_start": period_start or "",
        "fixed_period_end": period_end or "",
        "feedback": feedback or "",
        **window,
    }
    parsed = await _invoke_json(
        "project_env/mock_generate", data, MockDraft, None, budget
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
    """Stage 1: regex must-capture of version / metric / param claims."""
    claims: List[Dict[str, Any]] = []
    for field, text in fields.items():
        text = str(text or "")
        if not text.strip():
            continue
        for match in VERSION_RE.finditer(text):
            claims.append(
                {
                    "quote": _sentence_around(text, match.start()),
                    "field": field,
                    "type": "version",
                }
            )
        for match in _METRIC_RE.finditer(text):
            claims.append(
                {
                    "quote": _sentence_around(text, match.start()),
                    "field": field,
                    "type": "metric",
                }
            )
        for match in _PARAM_RE.finditer(text):
            claims.append(
                {
                    "quote": _sentence_around(text, match.start()),
                    "field": field,
                    "type": "param",
                }
            )
    return claims


def _sentence_around(text: str, idx: int) -> str:
    start = (
        max(
            text.rfind("。", 0, idx), text.rfind("\n", 0, idx), text.rfind("；", 0, idx)
        )
        + 1
    )
    ends = [
        pos
        for pos in (text.find("。", idx), text.find("\n", idx), text.find("；", idx))
        if pos != -1
    ]
    end = min(ends) + 1 if ends else len(text)
    return text[start:end].strip()


def dedup_claims(claims: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set = set()
    unique: List[Dict[str, Any]] = []
    for claim in claims:
        key = (
            claim.get("field"),
            re.sub(r"\s+", "", str(claim.get("quote", "")))[:120],
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
