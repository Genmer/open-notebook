"""Failure-explanation assembly for the Task Center explain endpoint.

Fetches the failed command row, builds an evidence pack (a per-command
recipe registry), renders the qa prompt and calls the qa model. Model-side
failures never propagate: they degrade to a rule-based classification so the
endpoint can always answer with something useful.
"""

import asyncio
import hashlib
import json
import time
import weakref
from collections import OrderedDict
from importlib.metadata import PackageNotFoundError
from typing import Any, Dict, List, Optional

from ai_prompter import Prompter
from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from api.task_service import TASK_TYPE_BY_COMMAND
from open_notebook.ai.models import DefaultModels
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.exceptions import NotFoundError
from open_notebook.utils import clean_thinking_content, token_count
from open_notebook.utils.embedding_config import get_embedding_params
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.redact import redact_text
from open_notebook.utils.text_utils import extract_text_content
from open_notebook.utils.version_utils import get_installed_version

RETRYABLE_COMMANDS: frozenset[str] = frozenset(
    {
        # Section analysis is read-only + generative (no persisted side
        # effects beyond its own state record), so replaying it is safe.
        "analyze_source_section",
        "classify_sources",
        # Compression writes only after every validation passes, so a failed
        # attempt left the history untouched; a retry after the (rare)
        # post-write crash fails permanently on the now-missing ids — a safe
        # no-op instead of a double compression.
        "compress_chat_history",
        "create_insight",
        "embed_insight",
        "embed_note",
        "embed_source",
        "export_data",
        "generate_artifact",
        "generate_project_env_materials",
        "process_source",
        "rebuild_embeddings",
        "run_transformation",
        "verify_project_env",
    }
)
# The import worker deletes the uploaded package on permanent failure, so a
# task-center retry would just FileNotFoundError through all retry attempts.
NO_RETRY_COMMANDS: frozenset[str] = frozenset({"generate_podcast", "import_data"})

EMBEDDING_COMMANDS = frozenset(
    {"embed_source", "rebuild_embeddings", "embed_note", "embed_insight"}
)

ALLOWED_ACTIONS = frozenset(
    {
        "retry",
        "open_models_settings",
        "open_credentials",
        "copy_diagnostics",
        "report_issue",
    }
)

ACTION_LABEL_KEYS = {
    "retry": "tasks.explain.actionRetry",
    "open_models_settings": "tasks.explain.actionOpenModelsSettings",
    "open_credentials": "tasks.explain.actionOpenCredentials",
    "copy_diagnostics": "tasks.explain.actionCopyDiagnostics",
    "report_issue": "tasks.explain.actionReportIssue",
}

# classify_error exception name -> response classification for the degraded path
DEGRADED_CLASSIFICATION = {
    "AuthenticationError": "user_fixable",
    "ConfigurationError": "user_fixable",
    "RateLimitError": "transient",
    "NetworkError": "transient",
    "ExternalServiceError": "transient",
}

DEGRADED_ACTIONS = {
    "user_fixable": ["open_credentials", "open_models_settings"],
    "transient": ["retry", "copy_diagnostics"],
    "unknown": ["copy_diagnostics", "report_issue"],
}

LANGUAGE_BY_LOCALE = {
    "bn-IN": "Bengali",
    "ca-ES": "Catalan",
    "de-DE": "German",
    "en-US": "English",
    "en-GB": "English",
    "es-ES": "Spanish",
    "fr-FR": "French",
    "it-IT": "Italian",
    "ja-JP": "Japanese",
    "pl-PL": "Polish",
    "pt-BR": "Portuguese",
    "ru-RU": "Russian",
    "tr-TR": "Turkish",
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
}

MAX_PROMPT_TOKENS = 12000
MAX_QUESTION_CHARS = 1000
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 8000
MAX_ENTITY_STATE_CHARS = 600
MAX_ARGS_DIGEST_CHARS = 500
ERROR_KEEP_HEAD = 1600
ERROR_KEEP_TAIL = 400
MODEL_TIMEOUT_SECONDS = 90
MODEL_MAX_TOKENS = 1024
MODEL_TEMPERATURE = 0.2

VALID_CATEGORIES = frozenset(
    {"user_fixable", "transient", "known_issue", "likely_bug", "unknown"}
)

# keys copied into the materials as the command args digest
ENTITY_ARG_KEYS = (
    "source_id",
    "note_id",
    "insight_id",
    "transformation_id",
    "notebook_ids",
    "mode",
    "embed",
    "insight_type",
)

# Commands whose entity has no observable state field: recovery is judged by
# a completed run of the same command on the same entity (args keys compared).
SAME_ENTITY_RECOVERY_KEYS: Dict[str, tuple] = {
    "embed_note": ("note_id",),
    "embed_insight": ("insight_id",),
    "generate_artifact": ("notebook_id", "artifact_type"),
    "create_insight": ("source_id", "insight_type"),
    "run_transformation": ("source_id", "transformation_id"),
}


class _ResultCache:
    """Tiny in-process LRU with TTL — one API process means one cache."""

    def __init__(self, maxsize: int, ttl_seconds: float) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._entries: "OrderedDict[str, tuple[float, Dict[str, Any]]]" = OrderedDict()

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        entry = self._entries.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if time.monotonic() - stored_at > self._ttl:
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return value

    def put(self, key: str, value: Dict[str, Any]) -> None:
        self._entries[key] = (time.monotonic(), value)
        self._entries.move_to_end(key)
        while len(self._entries) > self._maxsize:
            self._entries.popitem(last=False)

    def clear(self) -> None:
        self._entries.clear()


_explain_cache = _ResultCache(maxsize=50, ttl_seconds=600.0)

# A module-level asyncio.Semaphore binds to its first event loop and raises on
# any other loop (pytest-asyncio uses a fresh loop per test), so gates are
# kept per-loop and dropped with the loop itself.
_MODEL_GATES: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = weakref.WeakKeyDictionary()


def _model_gate() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    gate = _MODEL_GATES.get(loop)
    if gate is None:
        gate = asyncio.Semaphore(3)
        _MODEL_GATES[loop] = gate
    return gate


def _app_version() -> str:
    try:
        return get_installed_version("open-notebook")
    except PackageNotFoundError:
        return "unknown"


def _language_for_locale(locale: Optional[str]) -> str:
    if not locale:
        return "English"
    return LANGUAGE_BY_LOCALE.get(locale, locale)


def _args_digest(args: Dict[str, Any]) -> str:
    parts = []
    for key in ENTITY_ARG_KEYS:
        if args.get(key) is not None:
            parts.append(f"{key}={str(args[key])[:80]}")
    return ", ".join(parts)[:MAX_ARGS_DIGEST_CHARS]


def _rule_hint(error_message: str) -> str:
    if not error_message:
        return ""
    exc_class, user_message = classify_error(Exception(error_message))
    return f"rule-based hint: {user_message} [{exc_class.__name__}]"


def _format_history(history: List[Dict[str, Any]]) -> str:
    if not history:
        return ""
    lines = [
        f"{str(item.get('role') or 'user')}: {redact_text(str(item.get('content') or ''))}"
        for item in history[-MAX_HISTORY_TURNS:]
    ]
    return redact_text("\n".join(lines))[-MAX_HISTORY_CHARS:]


def _known_issues_material(name: str, error_message: str) -> str:
    lowered = (error_message or "").lower()
    if (
        name in ("embed_source", "rebuild_embeddings")
        and "read or write conflict" in lowered
    ):
        return Prompter(
            prompt_template="qa/known_issues/embedding_txn_conflict"
        ).render(data={})
    return ""


async def _transformation_names(tids: List[str]) -> List[str]:
    rids = []
    for tid in tids:
        try:
            rids.append(ensure_record_id(tid))
        except Exception:
            continue
    if not rids:
        return []
    rows = await repo_query(
        "SELECT name FROM transformation WHERE id IN $ids", {"ids": rids}
    )
    return [str(row["name"]) for row in rows or [] if row.get("name")]


async def _embedding_state(args: Dict[str, Any]) -> str:
    lines = []
    sid = args.get("source_id")
    if sid:
        rows = await repo_query(
            "SELECT embedding_status, embedded_chunks, total_chunks FROM $sid",
            {"sid": ensure_record_id(str(sid))},
        )
        if rows:
            src = rows[0]
            embedded = int(src.get("embedded_chunks") or 0)
            total = int(src.get("total_chunks") or 0)
            lines.append(
                f"- source embedding: status={src.get('embedding_status')}, "
                f"chunks={embedded}/{total}"
            )
    params = get_embedding_params()
    lines.append(
        f"- embedding runtime: batch_size={params.embedding_batch_size}, "
        f"chunk_size={params.chunk_size}, chunk_overlap={params.chunk_overlap}"
    )
    return "\n".join(lines)


async def _process_source_state(args: Dict[str, Any]) -> str:
    lines = []
    sid = args.get("source_id")
    if sid:
        rows = await repo_query(
            "SELECT embedding_status, embedded_chunks, total_chunks FROM $sid",
            {"sid": ensure_record_id(str(sid))},
        )
        if rows:
            src = rows[0]
            embedded = int(src.get("embedded_chunks") or 0)
            total = int(src.get("total_chunks") or 0)
            lines.append(
                f"- source embedding: status={src.get('embedding_status')}, "
                f"chunks={embedded}/{total}"
            )
    tids = [str(t) for t in (args.get("transformations") or [])]
    if tids:
        names = await _transformation_names(tids)
        if names:
            lines.append(f"- transformations: {', '.join(names)}")
    return "\n".join(lines)


async def _run_transformation_state(args: Dict[str, Any]) -> str:
    tid = args.get("transformation_id")
    if not tid:
        return ""
    names = await _transformation_names([str(tid)])
    return f"- transformation: {names[0]}" if names else ""


def _create_insight_state(args: Dict[str, Any]) -> str:
    parts = []
    if args.get("source_id"):
        parts.append(f"source_id={args['source_id']}")
    if args.get("insight_type"):
        parts.append(f"insight_type={args['insight_type']}")
    return f"- insight target: {', '.join(parts)}" if parts else ""


async def _transfer_state(name: str) -> str:
    kind = "import" if name == "import_data" else "export"
    rows = await repo_query(
        "SELECT progress FROM $rid",
        {"rid": ensure_record_id(f"data_transfer_state:{kind}")},
    )
    if not rows:
        return ""
    progress = rows[0].get("progress") or {}
    return (
        f"- transfer: stage={progress.get('stage')}, "
        f"percent={progress.get('percent')}, message={progress.get('message')}"
    )


async def _source_recovery(source_id: str) -> Optional[Dict[str, Any]]:
    rows = await repo_query(
        "SELECT embedding_status, embedded_chunks, total_chunks FROM $sid",
        {"sid": ensure_record_id(source_id)},
    )
    if not rows:
        return None
    src = rows[0]
    status = str(src.get("embedding_status") or "")
    embedded = int(src.get("embedded_chunks") or 0)
    total = int(src.get("total_chunks") or 0)
    chunks_ok = total <= 0 or embedded >= total
    return {
        "recovered": status == "completed" and chunks_ok,
        "detail": f"source now {status or 'unknown'}, {embedded}/{total} chunks",
    }


async def _source_view_recovery(view_id: str) -> Optional[Dict[str, Any]]:
    rows = await repo_query(
        "SELECT last_classified_at FROM $rid",
        {"rid": ensure_record_id(view_id)},
    )
    if not rows:
        return None
    classified_at = rows[0].get("last_classified_at")
    if classified_at:
        return {
            "recovered": True,
            "detail": f"source view last classified at {classified_at}",
        }
    return {"recovered": False, "detail": "source view has no last_classified_at"}


async def _transfer_recovery(name: str) -> Optional[Dict[str, Any]]:
    kind = "import" if name == "import_data" else "export"
    rows = await repo_query(
        "SELECT progress FROM $rid",
        {"rid": ensure_record_id(f"data_transfer_state:{kind}")},
    )
    if not rows:
        return None
    progress = rows[0].get("progress") or {}
    stage = progress.get("stage")
    return {
        "recovered": stage == "done",
        "detail": f"transfer stage={stage}, percent={progress.get('percent')}",
    }


async def _completed_run_recovery(
    name: str, args: Dict[str, Any], keys: tuple
) -> Optional[Dict[str, Any]]:
    rows = await repo_query(
        "SELECT id, args, result FROM command "
        "WHERE name = $name AND status = 'completed'",
        {"name": name},
    )
    match = None
    for row in rows or []:
        row_args = row.get("args")
        if not isinstance(row_args, dict):
            continue
        if all(str(row_args.get(k)) == str(args.get(k)) for k in keys):
            match = row
            break
    if match is None:
        return {
            "recovered": False,
            "detail": f"no completed '{name}' run found for this entity",
        }
    result = match.get("result")
    started_at = None
    if isinstance(result, dict):
        metadata = result.get("execution_metadata") or {}
        if isinstance(metadata, dict):
            started_at = metadata.get("started_at")
    detail = f"a completed '{name}' run exists for this entity"
    if started_at:
        detail += f" (started at {started_at})"
    return {"recovered": True, "detail": detail}


async def _recovery_status(name: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Is the entity this failure targeted healthy again?

    Command rows carry no reliable timestamps, so recovery is judged from the
    entity's current state (or a completed same-entity run where the entity
    has no state field). Never raises: None means "cannot tell" and the
    explanation must survive recovery-lookup failures.
    """
    try:
        if name == "embed_source":
            sid = args.get("source_id")
            if not sid:
                return None
            return await _source_recovery(str(sid))
        if name == "process_source":
            # embedding_status is written by the separate fire-and-forget
            # embed_source job, so a stale 'completed' must not mask a
            # processing failure: only the embed=True combo counts as evidence
            if not args.get("embed") or not args.get("source_id"):
                return None
            return await _source_recovery(str(args["source_id"]))
        if name == "classify_sources":
            # stored arg key is view_id; accept source_view as a defensive alias
            view_id = args.get("view_id") or args.get("source_view")
            if not view_id:
                return None
            return await _source_view_recovery(str(view_id))
        if name in ("import_data", "export_data"):
            return await _transfer_recovery(name)
        # fall-through: rebuild_embeddings has no per-entity args → None
        keys = SAME_ENTITY_RECOVERY_KEYS.get(name)
        if not keys:
            return None
        present = [k for k in keys if args.get(k) is not None]
        if not present:
            return None
        return await _completed_run_recovery(name, args, tuple(present))
    except Exception as e:
        logger.warning(f"Explain: recovery check failed for {name}: {e}")
        return None


async def _entity_state_material(
    name: str, args: Dict[str, Any], error_message: str
) -> str:
    # Entity lookups must never sink the whole explanation.
    try:
        if name in EMBEDDING_COMMANDS:
            recipe = await _embedding_state(args)
        elif name == "process_source":
            recipe = await _process_source_state(args)
        elif name == "run_transformation":
            recipe = await _run_transformation_state(args)
        elif name == "create_insight":
            recipe = _create_insight_state(args)
        elif name in ("import_data", "export_data"):
            recipe = await _transfer_state(name)
        else:
            recipe = ""
    except Exception as e:
        logger.warning(f"Explain: entity state lookup failed for {name}: {e}")
        recipe = ""
    if len(recipe) > MAX_ENTITY_STATE_CHARS:
        recipe = recipe[:MAX_ENTITY_STATE_CHARS]
    parts = []
    digest = redact_text(_args_digest(args))
    if digest:
        parts.append(f"- args: {digest}")
    hint = redact_text(_rule_hint(error_message))
    if hint:
        parts.append(f"- {hint}")
    if recipe:
        parts.append(recipe)
    return "\n".join(parts)


async def _model_slots_snapshot() -> str:
    # Slot names + model name/provider only — never credential fields.
    slot_fields = (
        ("chat", "default_chat_model"),
        ("transformation", "default_transformation_model"),
        ("tools", "default_tools_model"),
        ("qa", "default_qa_model"),
        ("embedding", "default_embedding_model"),
        ("large_context", "large_context_model"),
        ("text_to_speech", "default_text_to_speech_model"),
        ("speech_to_text", "default_speech_to_text_model"),
    )
    try:
        defaults = await DefaultModels.get_instance()
    except Exception as e:
        logger.warning(f"Explain: could not load default models: {e}")
        return ""
    model_ids = set()
    for _, field_name in slot_fields:
        value = getattr(defaults, field_name, None)
        if value:
            model_ids.add(str(value))
    names: Dict[str, str] = {}
    rids = []
    for mid in model_ids:
        try:
            rids.append(ensure_record_id(mid))
        except Exception:
            continue
    if rids:
        try:
            rows = await repo_query(
                "SELECT id, name, provider FROM model WHERE id IN $ids",
                {"ids": rids},
            )
            for row in rows or []:
                names[str(row["id"])] = f"{row.get('name')} ({row.get('provider')})"
        except Exception as e:
            logger.warning(f"Explain: could not resolve model names: {e}")
    lines = []
    for slot, field_name in slot_fields:
        value = getattr(defaults, field_name, None)
        if value:
            lines.append(f"- {slot}: {names.get(str(value), str(value))}")
    return "\n".join(lines)


def _render_prompt(data: Dict[str, Any]) -> str:
    return Prompter(prompt_template="qa/system").render(data=data)  # type: ignore[arg-type]


def _cache_key(
    resource_id: str,
    question: Optional[str],
    error_message: str,
    history: List[Dict[str, Any]],
    locale: str,
    recovered: bool,
) -> str:
    digest = hashlib.sha1()
    digest.update(resource_id.encode())
    digest.update((question or "").encode())
    digest.update(error_message.encode())
    digest.update(locale.encode())
    # recovery flips over the TTL window; without it a stale "still broken"
    # answer would survive up to 10 minutes after the user fixed the item
    digest.update(str(recovered).encode())
    digest.update(
        json.dumps(history[-MAX_HISTORY_TURNS:], sort_keys=True, default=str).encode()
    )
    return digest.hexdigest()


def _filter_suggestions(
    raw: Any, command_name: str, recovered: bool = False
) -> List[Dict[str, str]]:
    suggestions: List[Dict[str, str]] = []
    seen = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        action = str(item.get("action") or "")
        if action not in ALLOWED_ACTIONS or action in seen:
            continue
        if action == "retry" and (recovered or command_name not in RETRYABLE_COMMANDS):
            continue
        seen.add(action)
        suggestions.append({"action": action, "label_key": ACTION_LABEL_KEYS[action]})
    # The model decides suggestions freely, so a retryable command can come
    # back without the one action the user actually needs — guarantee it.
    if not recovered and command_name in RETRYABLE_COMMANDS and "retry" not in seen:
        suggestions.insert(
            0, {"action": "retry", "label_key": ACTION_LABEL_KEYS["retry"]}
        )
    return suggestions


def _parse_output(
    content: str, command_name: str, recovered: bool = False
) -> tuple[str, List[Dict[str, str]]]:
    """Pull the trailing JSON line out of the model output; any parse miss degrades to unknown."""
    category = "unknown"
    raw_suggestions: Any = None
    for line in reversed(content.strip().splitlines()):
        line = line.strip()
        if not (line.startswith("{") and line.endswith("}")):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        parsed_category = str(data.get("category") or "unknown")
        category = parsed_category if parsed_category in VALID_CATEGORIES else "unknown"
        raw_suggestions = data.get("suggestions")
        break
    return category, _filter_suggestions(raw_suggestions, command_name, recovered)


def _facts(
    name: str, task_type: str, status: str, error_redacted: str
) -> List[Dict[str, str]]:
    return [
        {"label_key": "tasks.explain.factCommand", "value": name},
        {"label_key": "tasks.explain.factType", "value": task_type},
        {"label_key": "tasks.explain.factStatus", "value": status},
        {"label_key": "tasks.explain.factError", "value": error_redacted[:300]},
    ]


def _degraded_response(
    name: str,
    task_type: str,
    status: str,
    error_redacted: str,
    error: BaseException,
    mode: str,
    recovery: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    exc_class, user_message = classify_error(error)
    classification = DEGRADED_CLASSIFICATION.get(exc_class.__name__, "unknown")
    user_message = redact_text(user_message)
    actions = DEGRADED_ACTIONS.get(classification, DEGRADED_ACTIONS["unknown"])
    markdown = (
        "AI-powered explanation is unavailable right now; "
        "the rule-based classification below stands in.\n\n"
        f"**What happened** — Task `{name}` finished with status `{status}`.\n"
        f"**Likely root cause** — {user_message} "
        f"(classification: {classification}, confidence: low).\n"
        "**How to fix** — 1. Follow the suggested action below. "
        "2. If the failure persists, copy the diagnostics and report an issue.\n"
        "**Next actions** — Start with the first suggested action; "
        "retry the AI explanation later for a deeper analysis."
    )
    return {
        "mode": mode,
        "classification": classification,
        "explanation_markdown": markdown,
        "suggestions": _filter_suggestions(
            [{"action": action} for action in actions],
            name,
            recovered=bool(recovery and recovery.get("recovered")),
        ),
        "facts": _facts(name, task_type, status, error_redacted),
        "recovery": recovery,
        "degraded": True,
        "from_cache": False,
    }


def _trim_to_budget(data: Dict[str, Any]) -> str:
    """Drop the least valuable materials until the prompt fits the token budget."""
    prompt = _render_prompt(data)
    if token_count(prompt) <= MAX_PROMPT_TOKENS:
        return prompt
    for key in ("known_issues", "entity_state", "model_slots"):
        if data.get(key):
            data[key] = ""
            prompt = _render_prompt(data)
            if token_count(prompt) <= MAX_PROMPT_TOKENS:
                return prompt
    error = str(data.get("error_message") or "")
    if len(error) > ERROR_KEEP_HEAD + ERROR_KEEP_TAIL:
        data["error_message"] = (
            error[:ERROR_KEEP_HEAD] + "\n[...truncated...]\n" + error[-ERROR_KEEP_TAIL:]
        )
    return _render_prompt(data)


async def _fetch_command(command_id: str) -> Dict[str, Any]:
    rows = await repo_query(
        "SELECT id, name, args, status, error_message FROM command WHERE id = $id",
        {"id": ensure_record_id(command_id)},
    )
    if not rows:
        raise NotFoundError(f"Command {command_id} not found")
    return rows[0]


async def explain_failed_command(
    command_id: str,
    question: Optional[str],
    history: List[Dict[str, Any]],
    locale: str,
    refresh: bool,
) -> Dict[str, Any]:
    """Explain one failed (or otherwise ended) command row; model failures degrade, never raise."""
    row = await _fetch_command(command_id)
    name = str(row.get("name") or "")
    status = str(row.get("status") or "unknown")
    args = row.get("args") or {}
    if not isinstance(args, dict):
        args = {}
    raw_error = str(row.get("error_message") or "")
    task_type = TASK_TYPE_BY_COMMAND.get(name, "other")
    mode = "followup" if question and question.strip() else "explain"

    # before the cache lookup: the key must reflect the current recovery state
    recovery = await _recovery_status(name, args)
    recovered = bool(recovery and recovery.get("recovered"))

    key = _cache_key(command_id, question, raw_error, history, locale, recovered)
    if not refresh:
        cached = _explain_cache.get(key)
        if cached is not None:
            return {**cached, "mode": mode, "from_cache": True}

    error_redacted = redact_text(raw_error)
    question_redacted = redact_text((question or "")[:MAX_QUESTION_CHARS]).strip()

    entity_state = await _entity_state_material(name, args, raw_error)
    model_slots = redact_text(await _model_slots_snapshot())
    known_issues = _known_issues_material(name, raw_error)
    history_text = _format_history(history)

    data: Dict[str, Any] = {
        "command_name": name,
        "task_type": task_type,
        "status": status,
        "app_version": _app_version(),
        "model_slots": model_slots,
        "error_message": error_redacted,
        "entity_state": entity_state,
        "known_issues": known_issues,
        "history": history_text,
        "question": question_redacted or None,
        "language": _language_for_locale(locale),
        "recovery": redact_text(str(recovery.get("detail"))) if recovery else None,
    }
    prompt = _trim_to_budget(data)

    provisioned = None
    ai_message = None
    try:
        async with _model_gate():
            provisioned = await provision_langchain_model_with_info(
                prompt,
                None,
                "qa",
                max_tokens=MODEL_MAX_TOKENS,
                temperature=MODEL_TEMPERATURE,
            )
            # DashScope/GLM-style providers reject a messages array without a
            # user turn ("messages 参数非法", code 1214) — mirror chat.py's shape.
            payload = [
                SystemMessage(content=prompt),
                HumanMessage(
                    content="Explain this task failure now, following the OUTPUT FORMAT exactly."
                ),
            ]
            ai_message = await asyncio.wait_for(
                asyncio.to_thread(provisioned.langchain_model.invoke, payload),
                timeout=MODEL_TIMEOUT_SECONDS,
            )
    except Exception as e:
        logger.warning(f"Explain: model call failed for {command_id}, degrading: {e}")
        await record_llm_usage(
            model=provisioned,
            ai_message=None,
            call_type="qa_explain",
            correlation_id=command_id,
            success=False,
            error=str(e),
        )
        return _degraded_response(
            name, task_type, status, error_redacted, e, mode, recovery
        )

    content = redact_text(
        clean_thinking_content(extract_text_content(ai_message.content))
    )
    category, suggestions = _parse_output(content, name, recovered)
    await record_llm_usage(
        model=provisioned,
        ai_message=ai_message,
        call_type="qa_explain",
        correlation_id=command_id,
    )

    response = {
        "mode": mode,
        "classification": category,
        "explanation_markdown": content,
        "suggestions": suggestions,
        "facts": _facts(name, task_type, status, error_redacted),
        "recovery": recovery,
        "degraded": False,
        "from_cache": False,
    }
    _explain_cache.put(key, response)
    return response
