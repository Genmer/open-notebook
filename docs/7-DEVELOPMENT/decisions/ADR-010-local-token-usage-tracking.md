# ADR-010: Token usage tracking is local-only, best-effort, and off by default-able

- **Status**: Accepted
- **Date**: 2026-09

## Context

Users had no way to see how many tokens their notebooks, chats, asks and embeddings consume — and therefore no way to anticipate provider costs. Open Notebook's product identity (VISION.md) is privacy-first and self-hosted: usage analytics in the provider dashboards exist, but they mix all traffic, are per-provider, and defeat the point of self-hosting. Any tracking feature in this project must therefore be provably local and must never be able to break an AI call.

## Decision

**Record one row per LLM/embedding call into a local `model_usage` table (migration 28), expose it as a Settings sub-page, and treat recording as strictly never-fail with a kill switch.**

- **Row granularity**: one row per call with `created`, `day` (UTC, for grouping), `model_name`, `provider`, `model_id`, `call_type` (chat / source_chat / ask / transformation / prompt / embedding), `correlation_id` (thread/source where applicable), the three token counts (nullable), `is_estimated`, `success`, `error`. No prompts, no completions, no user content — only metadata.
- **Provisioning metadata**: `provision_langchain_model` becomes a thin wrapper over `provision_langchain_model_with_info`, which returns a frozen `ProvisionedModel` (LangChain model plus model_name/provider/model_id/reason). Existing callers are unchanged.
- **Token extraction** follows the provider reality: `ai_message.usage_metadata` first, then OpenAI-style `response_metadata.token_usage`, then generic `response_metadata.usage`; nothing found → nulls, rendered as "n/a". Embedding APIs don't report tokens, so embedding usage is estimated locally (`is_estimated=true`, sum of `token_count`).
- **Never-fail**: the recorder (`open_notebook/ai/usage.py`) wraps everything in try/except-and-log. A tracking problem can never fail the AI call it observes. Sync graph nodes (chat, source_chat) use `record_llm_usage_sync`, which runs the recorder on a daemon thread so nothing blocks the node. Embedding usage is recorded in one place — `iter_embedding_batches` — covering every embedding path.
- **Privacy switch**: `usage_tracking_enabled` on ContentSettings (default on, fail-open if the read itself fails). Settings page exposes the toggle and a "clear all" action; `DELETE /api/usage/records` empties the table and reports the deleted count.
- **API**: `GET /api/usage/summary` (totals, by-model, by-day over N days, empty DB → zeros, never 404), `GET /api/usage/records` (paged, newest first, limit 1..500), `DELETE /api/usage/records`. All served from SurrealQL `math::sum(... ?? 0)` aggregations with `GROUP BY`.

## Alternatives considered

- **Track in the provider dashboards** — rejected: not self-hostable, mixes unrelated traffic, per-provider silos.
- **Estimate everything from token_count(prompt)** — rejected for LLM calls: providers report real usage and under/over-estimates compound; accepted for embeddings, where no real numbers exist.
- **Prometheus/OpenTelemetry metrics** — rejected: heavyweight infra for a single-user app; users who want it can scrape the table.
- **Sampling or aggregation-on-write** — rejected: rows are tiny and the value is in exact per-call history; keeping raw rows with a clear-all keeps the design honest and simple.

## Consequences

- The `model_usage` table grows with usage; clearing it is one click (and privacy-friendly by design). A retention policy can be added later without changing the recording path.
- Any new AI call site should provision via `*_with_info` and record on success/failure — the thin-wrapper split keeps this a two-line change.
- Aggregation relies on SurrealDB's `??` coalescing inside `math::sum`; if a future SurrealDB version changes that behavior, the service is the single place to fall back to Python-side summation.
