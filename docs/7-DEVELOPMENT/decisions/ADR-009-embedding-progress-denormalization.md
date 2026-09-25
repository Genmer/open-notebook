# ADR-009: Source embedding progress is denormalized onto the source row

- **Status**: Accepted
- **Date**: 2026-09
- **Related**: ADR-004 (background workers), ADR-006 (migration granularity)

## Context

Source embedding ran as one opaque `embed_source` job: the worker chunked the text, generated all embeddings, bulk-inserted `source_embedding` rows, and only then did the source become "embedded". For large documents this meant minutes of no feedback — the UI showed a generic processing spinner and could not answer "how far along is the embedding?". Status polling endpoints existed for the processing *command*, but embedding progress lived nowhere queryable.

## Decision

**The embed_source command writes embedding progress into denormalized fields on the `source` row after every inserted batch, and the API serves those fields directly.**

- Migration 27 adds `embedding_status` (`not_embedded`/`queued`/`running`/`completed`/`partial`/`failed`), `embedding_command`, `embedding_error`, `total_chunks`, `embedded_chunks` to `source`, and backfills existing sources that already have chunk embeddings as `completed`.
- The command updates progress **per batch**, so the counter reflects real persisted rows, not intent. A terminal `partial` state (some batches persisted, then a permanent failure) is distinct from `failed` (nothing persisted). Transient failures still re-run the whole command; each run resets the counter to 0 first.
- Writes go through a targeted `UPDATE ... MERGE` (`Source.set_embedding_state`), never `save()`, so the worker and the API can't overwrite each other's whole-object changes. Progress writes are best-effort: a failed progress update must not fail the embedding itself.
- `Source.vectorize()` marks the source `queued` with the command id, covering both the manual embed endpoint and the processing pipeline. Rebuild embeddings does not mark each source `queued` (hundreds of UPDATEs for no UI benefit).
- The API composes responses from these fields — no `count()` query on the polling path. Legacy rows without the fields derive `completed` from an existing chunk count / the `embedded` flag.
- `open_notebook/utils/embedding.py` exposes `iter_embedding_batches()`, an async iterator that yields one provider batch at a time; the command inserts each batch and then advances the counter. `generate_embeddings()` is a thin consumer with unchanged behavior.

## Alternatives considered

- **Query the command status / job result** — rejected: command status is coarse (queued/running/completed) and lives in the surreal-commands tables; deriving chunk counts from it means coupling to worker internals.
- **`count(source_embedding)` on every poll** — rejected: per-poll aggregates on a growing table for a spinner is wasted work; the denormalized counter is written once per batch anyway.
- **Stream progress over SSE/WebSocket** — rejected: significant new plumbing for data the client can poll in a 2s loop it already runs.
- **A separate progress table** — rejected: one-to-one with `source`; a column block is simpler and transactional with the row.

## Consequences

- The source list/detail/status endpoints answer "how far along is embedding?" without touching `source_embedding`.
- Any future writer of chunk embeddings must keep the counter honest (insert per batch, update the counter), or the progress UI lies.
- Migration 28 in the same change adds the `model_usage` table for local token tracking (see ADR-010); the down migrations revert both cleanly.
