"""Question-workbench generation pipeline (软考题目工作台生成).

Three stateless render functions — breakdown (论点矩阵) / q2_points (问题2
要点) / outline (论点提纲) — behind POST /api/ruankao/questions/generate.
Lives in open_notebook/ai (not api/) and must never import from api/: the
worker loads commands without the API package (project_env_pipeline 同款
模块纪律). Reuses the shared _invoke_json renderer/call/parse loop.

Red line (ADR-017): the prompt context is ONLY the exam metadata passed by
the caller — title / year / domain / the three question prompts — plus the
candidate's own note. No retrieval, no notebook context, no model-essay
text: model essays are unreachable by construction.

The ONE sanctioned extension is render_question_essay (整篇生成): it
additionally receives the candidate's own project-environment context —
the text rendered by api.project_env_service.render_project_env_context
(the same verified-snapshot gate chat uses) — because a full essay draft
needs the user's own project facts. Still no retrieval, no notebook, no
model-essay text.
"""

import asyncio
import re
from typing import Any, Dict, List, Optional

from ai_prompter import Prompter
from loguru import logger
from pydantic import BaseModel, Field

from open_notebook.ai.industry_pool import industry_hint_for
from open_notebook.ai.project_env_pipeline import (
    _emit_stage,
    _invoke_json,
    _pace_llm_calls,
    get_light_model,
)
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.domain.project_env import ProjectEnv
from open_notebook.domain.ruankao_concept_cache import RuankaoConceptCache
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content
from open_notebook.utils.web_search import snippets_text, web_search

# --- parsed output shapes (validator targets; api/ mirrors the response) ---


class QuestionBreakdownAngle(BaseModel):
    name: str = ""
    thesis_hint: str = ""
    material_match: str = ""
    difficulty: str = ""
    similarity_risk: str = ""


class QuestionBreakdownDraft(BaseModel):
    """4-6 candidate argument angles for one exam question."""

    angles: List[QuestionBreakdownAngle] = Field(default_factory=list)
    combo_advice: str = ""


class QuestionQ2Point(BaseModel):
    heading: str = ""
    detail: str = ""


class QuestionQ2PointsDraft(BaseModel):
    """Method-point skeleton for the question-2 paragraph."""

    framework: str = ""
    points: List[QuestionQ2Point] = Field(default_factory=list)
    outline_hint: str = ""


class QuestionOutlineParagraph(BaseModel):
    role: str = ""
    outline: str = ""
    data_anchors: List[str] = Field(default_factory=list)


class QuestionOutlineDraft(BaseModel):
    """Two-paragraph argument outline (q2 + q3)."""

    paragraphs: List[QuestionOutlineParagraph] = Field(default_factory=list)


# kind → max_tokens 常量表（设计稿裁决 0-3）：outline 用 6144 而非 8192，
# 规避「部分供应商单次输出上限低于 8192」的验证义务；两段 ~500 字提纲 +
# data_anchors + JSON 结构开销 ≈ ≤4000 tokens，6144 足够且留余量。validator
# 因截断失败（502）时在这一处一行可调。
QUESTION_KIND_MAX_TOKENS: Dict[str, int] = {
    "breakdown": 4096,
    "q2_points": 4096,
    "outline": 6144,
}

_DIFFICULTY_LEVELS = ("easy", "medium", "hard")
_RISK_LEVELS = ("low", "medium", "high")


# --- validators (fed back to the model as previous_error on retry) ---


def _validate_breakdown(parsed: QuestionBreakdownDraft) -> str:
    if not 4 <= len(parsed.angles) <= 6:
        return f"angles must contain 4-6 items, got {len(parsed.angles)}"
    for angle in parsed.angles:
        if not angle.name.strip():
            return "every angle needs a name"
        if not angle.thesis_hint.strip():
            return "every angle needs a thesis_hint"
        if angle.difficulty not in _DIFFICULTY_LEVELS:
            return f"difficulty must be one of {list(_DIFFICULTY_LEVELS)}"
        if angle.similarity_risk not in _RISK_LEVELS:
            return f"similarity_risk must be one of {list(_RISK_LEVELS)}"
    if not parsed.combo_advice.strip():
        return "combo_advice is empty"
    return ""


def _validate_q2_points(parsed: QuestionQ2PointsDraft) -> str:
    if not parsed.framework.strip():
        return "framework is empty"
    if not 3 <= len(parsed.points) <= 5:
        return f"points must contain 3-5 items, got {len(parsed.points)}"
    for point in parsed.points:
        if not point.heading.strip():
            return "every point needs a heading"
        if not point.detail.strip():
            return "every point needs a detail"
    if not parsed.outline_hint.strip():
        return "outline_hint is empty"
    return ""


def _validate_outline(parsed: QuestionOutlineDraft) -> str:
    roles = {paragraph.role for paragraph in parsed.paragraphs}
    if len(parsed.paragraphs) != 2 or roles != {"q2", "q3"}:
        return (
            "paragraphs must be exactly 2 items with roles covering q2 and q3, "
            f"got {len(parsed.paragraphs)} item(s), roles={sorted(roles)}"
        )
    for paragraph in parsed.paragraphs:
        if not paragraph.outline.strip():
            return "every paragraph needs an outline"
        if not paragraph.data_anchors:
            return "every paragraph needs data_anchors"
    return ""


# --- shared context builder ---


def _question_data(
    title: str,
    year: str,
    domain: str,
    q1: str,
    q2: str,
    q3: str,
    note: str,
) -> Dict[str, Any]:
    """Template context whitelist (红线，模板条款由后端测试 A8 防删)：ONLY
    the five exam-metadata fields + the candidate's own note (三问原文与备注
    逐字透传). Adding any retrieval/notebook/essay-shaped variable here would
    violate ADR-017."""
    return {
        "title": title,
        "year": (year or "").strip(),
        "domain": (domain or "").strip(),
        "q1": q1 or "",
        "q2": q2 or "",
        "q3": q3 or "",
        "note": note or "",
    }


# --- render functions (stateless; raise ValueError on unusable output) ---


async def render_question_breakdown(
    title: str,
    year: str = "",
    domain: str = "",
    q1: str = "",
    q2: str = "",
    q3: str = "",
    note: str = "",
    on_delta: Optional[Any] = None,
    on_stage: Optional[Any] = None,
) -> Dict[str, Any]:
    """Candidate argument angles for one exam question; never persisted by
    this call — the user picks, combines and rewrites in the workbench."""
    parsed = await _invoke_json(
        "ruankao/question_breakdown",
        _question_data(title, year, domain, q1, q2, q3, note),
        QuestionBreakdownDraft,
        get_light_model(),
        None,
        validator=_validate_breakdown,
        max_tokens=QUESTION_KIND_MAX_TOKENS["breakdown"],
        on_delta=on_delta,
        on_stage=on_stage,
    )
    if parsed is None or not isinstance(parsed, QuestionBreakdownDraft):
        raise ValueError("question breakdown returned unusable output")
    return {
        "angles": [angle.model_dump() for angle in parsed.angles],
        "combo_advice": parsed.combo_advice.strip(),
    }


async def resolve_concept_knowledge(
    title: str, q2: str, domain: str = ""
) -> Optional[str]:
    """Resolve authoritative concept points for Question-2 via local cache or web search.
    Per ADR-017, this operates strictly on generic public concepts (never touches model essays).
    """
    clean_title = re.sub(r"^论\s*", "", title).strip()
    clean_title = re.sub(
        r"(?:的设计与实现|的设计与应用|架构设计与实践|的设计|的应用|及其应用)$",
        "",
        clean_title,
    ).strip()
    concept_key = clean_title or title
    if not concept_key:
        return None

    # 1. 优先查本地知识库缓存
    try:
        cached = await RuankaoConceptCache.lookup_many([concept_key])
        if cached and concept_key in cached:
            item = cached[concept_key]
            def_text = item.get("definition") or ""
            points = item.get("key_points") or []
            pts_str = "；".join(points) if isinstance(points, list) else str(points)
            logger.info(f"Hit Ruankao concept cache for: {concept_key}")
            return f"概念定义：{def_text}\n核心考点组成：{pts_str}"
    except Exception as e:
        logger.warning(f"Ruankao concept cache lookup error: {e}")

    # 2. 未命中时执行实时联网搜索核验
    query = f"{concept_key} 软考 概念 组成 理论"
    try:
        results = await web_search(query, max_results=3)
        if results:
            snippets = snippets_text(results)
            # 简单提炼第一条权威摘要
            first_snip = results[0].get("snippet", "")
            definition = first_snip[:200]
            # 异步回写本地知识库缓存，下次直接复用
            try:
                new_cache = RuankaoConceptCache(
                    name=concept_key,
                    category=domain or "软考核心概念",
                    definition=definition,
                    key_points=[r.get("title", "") for r in results[:3]],
                    source=f"web:{results[0].get('url', '')}"[:200],
                )
                await new_cache.save()
                logger.info(f"Saved new Ruankao concept cache for: {concept_key}")
            except Exception as save_err:
                logger.warning(f"Failed to cache ruankao concept: {save_err}")
            return f"权威联网核验参考：\n{snippets[:400]}"
    except Exception as e:
        logger.warning(f"Web search for concept {concept_key} failed: {e}")

    return None


async def render_question_q2_points(
    title: str,
    year: str = "",
    domain: str = "",
    q1: str = "",
    q2: str = "",
    q3: str = "",
    note: str = "",
    on_delta: Optional[Any] = None,
    on_stage: Optional[Any] = None,
) -> Dict[str, Any]:
    """Method-point skeleton for the question-2 paragraph; never persisted by
    this call — the prose itself must be written by the candidate."""
    effective_note = note or ""
    try:
        verified_concept = await resolve_concept_knowledge(title, q2, domain)
        if verified_concept:
            prefix = "【权威概念规范与要点（经联网核验/知识库）】"
            if effective_note:
                effective_note = f"{effective_note}\n\n{prefix}\n{verified_concept}"
            else:
                effective_note = f"{prefix}\n{verified_concept}"
    except Exception as e:
        logger.warning(f"Concept verification error in q2_points: {e}")

    parsed = await _invoke_json(
        "ruankao/question_q2_points",
        _question_data(title, year, domain, q1, q2, q3, effective_note),
        QuestionQ2PointsDraft,
        get_light_model(),
        None,
        validator=_validate_q2_points,
        max_tokens=QUESTION_KIND_MAX_TOKENS["q2_points"],
        on_delta=on_delta,
        on_stage=on_stage,
    )
    if parsed is None or not isinstance(parsed, QuestionQ2PointsDraft):
        raise ValueError("question q2 points returned unusable output")
    return {
        "framework": parsed.framework.strip(),
        "points": [point.model_dump() for point in parsed.points],
        "outline_hint": parsed.outline_hint.strip(),
    }


async def render_question_outline(
    title: str,
    year: str = "",
    domain: str = "",
    q1: str = "",
    q2: str = "",
    q3: str = "",
    note: str = "",
    on_delta: Optional[Any] = None,
    on_stage: Optional[Any] = None,
) -> Dict[str, Any]:
    """Two-paragraph argument outline (q2 + q3); never persisted by this
    call — thesis sentences are candidates the candidate rewrites."""
    parsed = await _invoke_json(
        "ruankao/question_outline",
        _question_data(title, year, domain, q1, q2, q3, note),
        QuestionOutlineDraft,
        get_light_model(),
        None,
        validator=_validate_outline,
        max_tokens=QUESTION_KIND_MAX_TOKENS["outline"],
        on_delta=on_delta,
        on_stage=on_stage,
    )
    if parsed is None or not isinstance(parsed, QuestionOutlineDraft):
        raise ValueError("question outline returned unusable output")
    return {
        "paragraphs": [paragraph.model_dump() for paragraph in parsed.paragraphs],
    }


# --- 整篇生成 (full essay draft): bare-text streaming, no JSON parse ---

# 一篇 2200~2800 字论文 + 摘要 ≈ ≤6000 tokens，8192 留足余量（无 JSON 结构
# 开销、无 validator 重试，不需要 _invoke_json 的 parse 循环）。
QUESTION_ESSAY_MAX_TOKENS = 8192

# 与路由侧 QUESTION_GENERATE_TIMEOUT_SECONDS 同值的有界超时：路由的 wait_for
# 先到点，这里的是保护直接调用方（worker/命令侧）不挂死的内层下界——与
# _invoke_json 内层 LLM_CALL_TIMEOUT_SECONDS 同款双保险布局。
QUESTION_ESSAY_TIMEOUT_SECONDS = 600


async def render_question_essay(
    title: str,
    env_id: str = "",
    env_context: str = "",
    year: str = "",
    domain: str = "",
    q1: str = "",
    q2: str = "",
    q3: str = "",
    note: str = "",
    model_id: Optional[str] = None,
    extra_instructions: str = "",
    on_delta: Optional[Any] = None,
    on_stage: Optional[Any] = None,
) -> str:
    """One full essay draft (整篇论文初稿) for one exam question, grounded in
    the candidate's own project environment — the only render in this module
    that takes env context (ADR-017's extension: the user's own project-env
    data; still no retrieval / notebook / model-essay text).

    Bare-text streaming (quick_chat 同款, 非 JSON 产物不走 _invoke_json):
    provision → throwaway streaming=True copy → astream → extract_text_content,
    returns the full plain-text draft; raises ValueError when the model yields
    nothing usable. env_id is used ONLY to resolve the stored industry for the
    ADR-019 hint (fetch failure degrades to no hint, never breaks the render).
    model_id: explicit model override (None = system default chat model; the
    caller resolves the agent-binding priority). extra_instructions: the
    selected 提示词模板 (agent system_prompt) — style/emphasis requirements
    that the template renders BELOW the red lines, never above them.
    """
    industry = ""
    if env_id:
        try:
            env = await ProjectEnv.get(env_id)
            industry = str(getattr(env, "industry", "") or "")
        except Exception as e:
            # 行业提示纯锦上添花：取不到就按池外行业处理（hint 为空，模板条件
            # 行不渲染），正文语境以 env_context 文本为准。
            logger.warning(f"Project env {env_id} industry lookup failed: {e}")

    data: Dict[str, Any] = {
        **_question_data(title, year, domain, q1, q2, q3, note),
        "env_context": (env_context or "").strip(),
        "industry_hint": industry_hint_for(industry),
        "extra_instructions": (extra_instructions or "").strip(),
    }

    _emit_stage(on_stage, "waiting")
    await _pace_llm_calls()
    prompt = Prompter(prompt_template="ruankao/question_essay").render(  # type: ignore[arg-type]
        data=data
    )
    # 整篇论文是长文旗舰产物：不走 get_light_model() 的廉价模型覆盖旋钮
    # （那是给三个短 JSON 辅助产品的成本开关）；显式 model_id（考生选择或
    # 智能体绑定）直通 provision 解析，None = 系统默认聊天模型。
    prov = await provision_langchain_model_with_info(
        prompt, model_id, "chat", max_tokens=QUESTION_ESSAY_MAX_TOKENS
    )
    # Provisioned chat models carry streaming=False (Esperanto's to_langchain
    # passes it through; langchain-core treats that as a hard opt-out) — same
    # throwaway-copy flip as _invoke_json's streaming branch and quick_chat.
    stream_model = prov.langchain_model.model_copy(update={"streaming": True})

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
                if on_delta is not None:
                    on_delta(delta)
            elif not thinking_sent and not generating_sent:
                # First chunk(s) with no visible text yet: a thinking model
                # reasoning before its first token.
                thinking_sent = True
                _emit_stage(on_stage, "thinking")
        return "".join(parts)

    raw_content = await asyncio.wait_for(
        _consume_stream(), timeout=QUESTION_ESSAY_TIMEOUT_SECONDS
    )
    content = clean_thinking_content(raw_content).strip()
    if not content:
        raise ValueError("question essay returned empty output")
    return content
