# ADR-013: Task-failure explanations are assembled server-side and answered by an optional qa model slot

- **Status**: Accepted
- **Date**: 2026-09

## Context

When a background task fails, the Task Center shows the raw (English) provider error string. For a self-hosted user this is the dead end: no hint whether the failure is their credentials, a transient retry, or a bug worth reporting. All the evidence needed for a useful answer (command row, affected item state, active model config, app version) already lives server-side, and the project already has a chat-model pipeline with usage tracking — but no single place that turns a failed command row into an explanation.

## Decision

**One `POST /api/explain` endpoint backed by an assembly service (`api/explain_service.py`) that builds an evidence pack per command family and answers it with the LLM; model failures degrade to rule-based classification, never to an error response.**

- **Context recipe registry**: a common base (command name/status/args digest, redacted error, `classify_error` rule hint, DefaultModels slot snapshot without credential fields, app version) plus per-family entity state (embedding counters + runtime params, source/transformation state, transfer progress). Entity lookups fail open (empty material, never a broken explanation).
- **`qa` is an optional model slot** falling back to `default_chat_model` (like `tools`); it is not in REQUIRED_DEFAULTS, so PUT field-presence semantics cover it with no migration.
- **Prompt contract**: `prompts/qa/system.jinja` with four English section headers as parsed anchors plus one trailing JSON line (category + suggestions). Suggested actions are whitelisted, and `retry` is only kept for commands in `RETRYABLE_COMMANDS` — every registered command except `generate_podcast`, whose generic replay would create a duplicate episode (failed episodes retry through the dedicated endpoint that deletes the record first). A guard test fails when a new command is left unclassified.
- **Guardrails**: in-process LRU cache (50 entries / 10 min), a 3-slot gate, a 90 s server-side timeout (ahead of the client's 600 s), all materials and model output pass `redact_text`, usage recorded as `call_type="qa_explain"`.
- **Phase 1 is non-streaming** (one POST, ≤1024 output tokens); `question`/`history` already switch the prompt into follow-up mode so the frontend can wire conversations in phase 2 without backend changes.
- **Retry is replay**: `POST /api/commands/jobs/{job_id}/retry` re-submits the original name/args as a new job and leaves the failed row as history.
- **Recovery detection** (added 2026-09): `api/explain_service.py:_recovery_status` judges whether the entity a failure targeted is healthy *now*. Command rows carry no usable timestamps (created/updated are null), so the entity's current state is primary — source `embedding_status`/chunk counters (embed), `source_view.last_classified_at` (classify), `data_transfer_state.progress.stage == 'done'` (import/export) — and for entities without state fields (notes, insights, artifacts, transformations) a completed run of the same command on the same entity args stands in, its `result.execution_metadata.started_at` cited as supporting evidence. Exception: `process_source` only uses the embedding criteria when `args.embed` is true — `embedding_status` is written by the separate fire-and-forget `embed_source` job, so a stale `completed` must not mask a processing failure (embed absent/false → None, retry stays available). The check never raises (None = cannot tell), feeds a `recovery` block into materials/response, filters `retry` out of suggestions when recovered, and joins the cache key so a recovery flip invalidates a cached "still broken" answer.
- **AI retry precheck**: the retry endpoint accepts `?check_recovery=true` — if `_recovery_status` says recovered, the replay is skipped (`status="skipped_recovered"`, `job_id=null`); an undeterminable check (None) still replays, trading a redundant retry for never skipping a real fix.

## Alternatives considered

- **Explain client-side from the error string** — rejected: no access to entity state, config or version, and it would ship prompt logic to the browser.
- **SSE/streaming answers** — rejected for phase 1: the payload is short and bounded; streaming adds plumbing the card UI does not need yet.
- **Retry by mutating the failed row** — rejected: replay-as-new-job keeps the failure as auditable history and reuses the existing submit path untouched.

## Consequences

- Every new registered command must be classified (the registry guard test fails otherwise) and ideally gets a recipe entry; commands without one still explain from the base materials.
- The first KNOWN ISSUES entry (`prompts/qa/known_issues/embedding_txn_conflict.jinja`) documents a real existing bug — the retriable SurrealDB transaction conflict that `commands/embedding_commands.py` marks permanent — and tells the user that retrying restores the source.
- The explain answer is only as good as the assembled evidence; if failure modes need more context (worker logs), the recipe registry is the single place to extend.
- Degraded responses still return 200 with `degraded: true`, so the frontend renders one card shape in both modes.
