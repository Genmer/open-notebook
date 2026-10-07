"""Project environment legacy-text cleaner (存量环境禁词清洗).

Pure functions, zero LLM / zero DB: the prompt-layer ban (prompts/project_env/
*.jinja: 人员/规模/资金 三类禁写) only constrains newly generated content, so
environments produced before the ban can still carry it in their main fields,
mock drafts and verified snapshots. The cleaner removes every *sentence* that
hits one of the three categories — never a rewrite, so the remaining text
stays grammatically whole and the operation is idempotent.

The ``scale`` field is the one whole-field exception: it IS the 「项目规模」式
段落, so any non-empty scale (in every container) is cleared outright instead
of sentence-filtered — sentence filtering would leave 规模残渣 like
「平台最终接入内部应用23个」 behind.

Execution is intentionally NOT wired into any API endpoint: cleaning must not
go through PUT (TEXT_FIELDS edits re-trigger LLM verification). A maintainer
runs scripts/clean_project_env_forbidden_words.py against the ORM instead,
after reviewing the dry-run diff.

Anti-false-positive boundaries (each pinned by a test in
tests/test_project_env_cleaner.py):

1. Numeric-free team narration survives (「我带领项目团队完成核心攻关」「组织
   各事业部需求调研」): my_role duty sentences and the exam's first-person
   responsibility thread depend on them — 项目团队/团队 are context words,
   never exact-banned.
2. Capacity numbers survive (「支持2000人同时在线」「500并发下P95响应稳定」):
   并发/吞吐/数据规模 are the quantified backbone of the essay; a 数词+人 hit
   needs a personnel context word in the same sentence.
3. 「投入40人月」 survives (negative lookahead blocks 人 followed by 均/月/工);
   「人均处理单量提升」 survives (no numeral directly before 人).
4. Role sentences survive (「我在本项目中担任项目负责人兼系统架构师…」).
5. Amount-free funds wording survives (「公司自筹资金」「培训成本居高不下」
   「满足合同指标要求」「一次性投入」): funds context words without any
   numeral, and bare 合同 is not a context word (合同价/合同额/合同金额 are).
6. Funds die on an amount anchor (元/块钱/￥) OR a funds context word with any
   numeral — 「投资500万」「全年算力成本同比下降29%」 are removed (essay-level
   effect data like 29% belongs in the essay, never in an environment field).
7. User scale dies only with a user-context word × numeral or an N+用户 suffix
   (「月活跃用户达6500人」「注册用户12万人」); amount-free sentences like
   「全公司员工均为最终用户」 survive.

Known non-goals (registered, not handled): the materials candidate store is
not cleaned — its texts are only consumed during a pending generation, and
fresh generation is constrained by the prompt-layer ban above.
"""

import re
from typing import Dict, List, Optional

from open_notebook.domain.project_env import TEXT_FIELDS, ProjectEnv

# Exact banned phrases: the phrase itself is a violation, zero false positives
# (whole sentence dies). 口径 aligned with the frontend stat filter
# (frontend/src/lib/utils/env-structure.ts FORBIDDEN_STAT_PHRASES) but the
# mechanisms differ: sentence-level cleaning here vs card-level filtering there.
_PERSONNEL_PHRASES = (
    "团队规模",
    "团队人数",
    "人员规模",
    "人员数量",
    "人员构成",
    "团队成员",
    "岗位编制",
)
_FUNDS_PHRASES = ("合同金额", "合同额", "中标金额", "投资额")
# 话题宣告词: the sentence announces the banned topic itself.
_SCALE_PHRASES = ("项目规模", "用户规模")

FORBIDDEN_PHRASES = _PERSONNEL_PHRASES + _FUNDS_PHRASES + _SCALE_PHRASES

# Split *after* sentence-ending punctuation (lookbehind keeps the delimiter
# attached to the sentence before it, so filtering + joining is lossless).
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？；\n!?;])")

# Dict containers holding TEXT_FIELDS-shaped strings: the pending mock draft
# and the frozen injection source (only verified_snapshot is ever injected).
_DICT_CONTAINERS = ("draft_content", "verified_snapshot")

# --- pattern rules: numeric pattern AND category context word must co-occur
# --- within one sentence for the sentence to be banned. All precompiled.

# 人员: numeral (Arabic or Chinese) + 人, NOT followed by 均/月/工 (protects
# 「40人月」「人均」); 「N名」 must be followed by a role word (protects 「第一名」).
_PERSON_COUNT_RE = re.compile(
    r"(?:\d{1,7}(?:,\d{3})*(?:\.\d+)?|[一二两三四五六七八九十百]{1,4})"
    r"\s*(?:万多?|[十百]?余|多)?\s*人(?![均月工])"
    r"|\d{1,4}\s*名(?=工程师|架构师|开发|测试|运维|成员|专家|经理|负责人|设计|产品)"
)
_PERSON_CONTEXT_RE = re.compile(r"团队|人员|员工|成员|岗位|人手|人力|编制|队伍")

# 资金: an amount needs a 元/块钱 anchor (or ￥/¥) — 「千万级请求」 is safe.
_FUNDS_AMOUNT_RE = re.compile(
    r"(?:\d[\d,]*(?:\.\d+)?|[一二两三四五六七八九十百千]{1,6})"
    r"\s*(?:万多?|亿|千万|百万)?\s*(?:余|多)?(?:元|块钱)"
    r"|[￥¥]\s*[\d,]+(?:\.\d+)?"
)
_FUNDS_CONTEXT_RE = re.compile(
    r"成本|预算|造价|报价|合同价|合同额|合同金额|中标金额|中标价|投资额|投资|回款|经费|融资|资金"
)

# 规模: user-base context words × numeral; or a numeral directly suffixed 用户
# (covers 「12万+用户」「服务百万用户」).
_SCALE_CONTEXT_RE = re.compile(
    r"用户量|用户数|注册用户|月活跃用户|日活跃用户|月活|日活|活跃用户|在线用户|付费用户|注册企业"
)
_SCALE_USER_RE = re.compile(
    r"[\d一二两三四五六七八九十百千]{1,7}(?:万多?|亿|千万|百万)?\s*(?:余|多)?\s*\+?\s*(?:个\s*)?用户"
)
_HAS_NUMERAL_RE = re.compile(r"\d|[一二两三四五六七八九十百千]")


def _is_personnel(sentence: str) -> bool:
    return any(p in sentence for p in _PERSONNEL_PHRASES) or bool(
        _PERSON_COUNT_RE.search(sentence) and _PERSON_CONTEXT_RE.search(sentence)
    )


def _is_funds(sentence: str) -> bool:
    return (
        any(p in sentence for p in _FUNDS_PHRASES)
        or bool(_FUNDS_AMOUNT_RE.search(sentence))
        or bool(_FUNDS_CONTEXT_RE.search(sentence) and _HAS_NUMERAL_RE.search(sentence))
    )


def _is_scale(sentence: str) -> bool:
    return (
        any(p in sentence for p in _SCALE_PHRASES)
        or bool(_SCALE_USER_RE.search(sentence))
        or bool(_SCALE_CONTEXT_RE.search(sentence) and _HAS_NUMERAL_RE.search(sentence))
    )


def _has_forbidden(text: str) -> bool:
    return _is_personnel(text) or _is_funds(text) or _is_scale(text)


def _sentences(text: str) -> List[str]:
    """Split into sentence pieces, gluing whitespace-only pieces (the newline
    between two sentences) to the piece before them, so trailing whitespace
    dies with its sentence instead of leaking into the cleaned text."""
    merged: List[str] = []
    for piece in _SENTENCE_SPLIT.split(text):
        if merged and piece and not piece.strip():
            merged[-1] += piece
        else:
            merged.append(piece)
    return merged


def clean_text(text: Optional[str]) -> str:
    """Drop every sentence hitting one of the three categories; keep the rest
    verbatim (original order, delimiters included). The whitespace gap a
    dropped sentence leaves behind is consumed from the next survivor. All
    sentences banned -> ""; None/empty -> "". Idempotent: the output hits no
    rule, so a second run returns it unchanged (whitespace included)."""
    if not text:
        return ""
    kept: List[str] = []
    strip_next = False
    for sentence in _sentences(text):
        if not sentence:
            continue
        if _has_forbidden(sentence):
            strip_next = True
            continue
        if strip_next:
            sentence = sentence.lstrip()
            strip_next = False
        kept.append(sentence)
    return "".join(kept)


def removed_sentences(text: Optional[str]) -> List[str]:
    """The sentences clean_text would drop, in order — for diff display."""
    if not text:
        return []
    return [s for s in _sentences(text) if s and _has_forbidden(s)]


def _plan_container(mapping: Dict[str, object]) -> Dict[str, Dict[str, str]]:
    changed: Dict[str, Dict[str, str]] = {}
    for field in TEXT_FIELDS:
        value = mapping.get(field)
        if not isinstance(value, str):
            continue
        if field == "scale":
            # scale 字段整段即「规模段落」：句级过滤会残留规模残渣，非空即整段清空
            if value:
                changed[field] = {"before": value, "after": ""}
            continue
        cleaned = clean_text(value)
        if cleaned != value:
            changed[field] = {"before": value, "after": cleaned}
    return changed


def plan_env_cleaning(
    env: ProjectEnv,
) -> Dict[str, Dict[str, Dict[str, str]]]:
    """Preview of every field the cleaner would change, keyed by container
    ("main" | "draft_content" | "verified_snapshot"). Only changed fields are
    listed; an empty dict means nothing to clean. Never mutates the env.
    scale fields (any container) always show a whole-field replacement."""
    main_source: Dict[str, object] = {
        field: getattr(env, field) for field in TEXT_FIELDS
    }
    plan = {"main": _plan_container(main_source)}
    for container in _DICT_CONTAINERS:
        mapping = getattr(env, container)
        if isinstance(mapping, dict):
            plan[container] = _plan_container(mapping)
    return {container: fields for container, fields in plan.items() if fields}


def apply_env_cleaning(env: ProjectEnv) -> int:
    """Clean the three containers in place and return the number of changed
    fields. status, name, keywords, generic_paragraph (user content) and every
    non-TEXT_FIELDS key of the dict containers are left untouched, and no
    verification is triggered. scale is cleared whole in every container."""
    plan = plan_env_cleaning(env)
    for field, change in plan.get("main", {}).items():
        setattr(env, field, change["after"])
    for container in _DICT_CONTAINERS:
        mapping = getattr(env, container)
        for field, change in plan.get(container, {}).items():
            mapping[field] = change["after"]
    return sum(len(fields) for fields in plan.values())
