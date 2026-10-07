# ADR-015: Paragraph-level project-env verification and export format v3

- **Status**: Accepted
- **Date**: 2026-10

## Context

The project-env verifier (introduced after ADR-014) extracted one claim per sentence. Real 软考 essays state several technology+version facts inside one sentence flow, so sentence-level points fragmented the narrative: lane B judged isolated version mentions, the correction loop rewrote fragments out of context, and the two-stage extraction plus dedup keyed on the first 120 characters collapsed distinct long claims. Separately, data-transfer packages (format v2, ADR-014) still excluded the `project_env` tables — an instance move silently dropped the user's most content-heavy records, a gap only noted in a code comment.

## Decision

**The verification unit is one natural paragraph, every stage of the pipeline operates on that unit, and full-scope transfer packages become format v3 by including `project_env` and `project_env_verification`.**

- **Paragraph granularity**: newline-delimited paragraphs are the claim unit; paragraphs over 800 chars are greedily repacked by sentence (an oversized sentence without boundaries stays whole). Extraction yields at most one claim per paragraph (version > metric > param priority), all verify prompts enumerate every technology+version pair inside it (any single violation fails the whole point), the GA pre-screen aggregates the same way, and the correction/rewrite loop replaces whole paragraphs. Dedup keys on the whitespace-stripped full quote.
- **Byte-exact replacements**: LLM/hallucinated quotes are located in the source text whitespace-tolerantly and snapped to the exact original substring before storage, so every downstream `replace` writes precisely once.
- **Paragraph-level user actions**: rewrite submissions (cap 4000 chars) pass through the same pre-screen before the lanes run; dismiss removes the whole supporting paragraph (409 when it is the field's only content — the user should rewrite, not empty the field). A stateless suggest endpoint turns failed-lane opinions into a whole-paragraph proposal that only ever fills the rewrite box.
- **Export v3**: `project_env` and `project_env_verification` join full-scope packages only (topic/model scopes stay untouched). Per env only the latest run exports; fencing tokens (`verification_token`, run `token`, `active_job_id`) are whitelisted out on both sides, so imported needs_review envs are immediately actionable while a local reverify rotates the token and invalidates stale runs. Import is id-skip; in-flight statuses (`pending`, `material_pending`) map to `failed` with a re-verify progress note — an interrupted verification can never finish after the move; name collisions and orphaned run rows warn without blocking.

## Alternatives considered

- **Keeping sentence granularity with multi-fact lanes** — rejected: lanes would need to re-derive paragraph context per sentence, multiplying calls without fixing the fragmented rewrites.
- **Sliding-window claims** — rejected: arbitrary windows break verbatim quotes and make dismiss/replace ambiguous about what gets removed.
- **Always importing the newest N runs per env** — rejected: run history is debugging data; only the actionable latest run justifies the package size.
- **Failing the import on status/state mismatch** — rejected: moving a mid-verification env is a normal occurrence; degrading to failed + re-verify keeps the target actionable with no silent data invention.

## Consequences

- Format v3 packages are not importable by pre-v3 builds; v1/v2 packages remain importable (project-env members inside v2 are rejected as a packaging bug).
- Verification cost scales with paragraph count, not sentence count — fewer, larger LLM calls with a higher per-call token ceiling (correction/suggest/rewrite prompts run at 4096 max tokens).
- The `generic_paragraph` field rides export v3 as user content; it is live-injected (not snapshot-frozen), so imported envs inject their paragraph immediately once verified.
