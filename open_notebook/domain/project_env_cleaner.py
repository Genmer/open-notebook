"""Project environment legacy-text cleaner (存量环境禁词清洗).

Pure functions, zero LLM / zero DB: the prompt-layer ban (prompts/project_env/
*.jinja: 合同金额/团队人数/团队规模也不写) only constrains newly generated
content, so environments produced before the ban can still carry the banned
phrases in their main fields, mock drafts and verified snapshots. The cleaner
removes every *sentence* that carries a banned phrase — never a rewrite, so
the remaining text stays grammatically whole and the operation is idempotent.

Execution is intentionally NOT wired into any API endpoint: cleaning must not
go through PUT (TEXT_FIELDS edits re-trigger LLM verification). A maintainer
runs scripts/clean_project_env_forbidden_words.py against the ORM instead,
after reviewing the dry-run diff.
"""

import re
from typing import Dict, List, Optional

from open_notebook.domain.project_env import TEXT_FIELDS, ProjectEnv

# Same set the frontend stat filter uses (frontend/src/lib/utils/env-structure.ts
# FORBIDDEN_STAT_PHRASES). README item 4 names 合同金额/团队规模; 团队人数 is the
# same ban written the other way (prompt: 团队人数/团队规模也不写).
FORBIDDEN_PHRASES = ("合同金额", "团队规模", "团队人数")

# Split *after* sentence-ending punctuation (lookbehind keeps the delimiter
# attached to the sentence before it, so filtering + joining is lossless).
_SENTENCE_SPLIT = re.compile(r"(?<=[。！？；\n!?;])")

# Dict containers holding TEXT_FIELDS-shaped strings: the pending mock draft
# and the frozen injection source (only verified_snapshot is ever injected).
_DICT_CONTAINERS = ("draft_content", "verified_snapshot")


def _has_forbidden(text: str) -> bool:
    return any(phrase in text for phrase in FORBIDDEN_PHRASES)


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
    """Drop every sentence containing a banned phrase; keep the rest verbatim
    (original order, delimiters included). The whitespace gap a dropped
    sentence leaves behind is consumed from the next survivor. All sentences
    banned -> ""; None/empty -> "". Idempotent: the output contains no banned
    phrase, so a second run returns it unchanged (whitespace included)."""
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
        if isinstance(value, str):
            cleaned = clean_text(value)
            if cleaned != value:
                changed[field] = {"before": value, "after": cleaned}
    return changed


def plan_env_cleaning(
    env: ProjectEnv,
) -> Dict[str, Dict[str, Dict[str, str]]]:
    """Preview of every field the cleaner would change, keyed by container
    ("main" | "draft_content" | "verified_snapshot"). Only changed fields are
    listed; an empty dict means nothing to clean. Never mutates the env."""
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
    verification is triggered."""
    plan = plan_env_cleaning(env)
    for field, change in plan.get("main", {}).items():
        setattr(env, field, change["after"])
    for container in _DICT_CONTAINERS:
        mapping = getattr(env, container)
        for field, change in plan.get(container, {}).items():
            mapping[field] = change["after"]
    return sum(len(fields) for fields in plan.values())
