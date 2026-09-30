# ADR-014: Model configuration export/import — package format v2, plain-text API keys by user decision, conflict-confirm import

- **Status**: Accepted
- **Date**: 2026-09

## Context

ADR-011 deliberately excluded credential/model tables from data-transfer packages: credentials are encrypted with a machine-specific `OPEN_NOTEBOOK_ENCRYPTION_KEY`, so a raw credential row is useless (and confusing) on another machine. The operational reality is that moving an instance's model setup — credentials, model records and default-model assignments — is the most common manual migration step after moving notebooks, and users currently rebuild it by hand. The product decision (user-ratified) is that this convenience justifies shipping API keys in plain text inside an export package, provided the user is warned and the import side re-encrypts.

## Decision

**Package format v2 adds a model-configuration scope: `credential`, `model` and `default_models` members, plus `package_type` in the manifest; exports choose `full` (with or without model config) or `models`-only, and imports of conflicting model records are decided up-front by the user.**

- **Format v2**: `FORMAT_VERSION` 2 with `SUPPORTED_FORMAT_VERSIONS = (1, 2)` — v1 packages stay importable untouched. `package_type` (`full` | `models`) is validated: a `models` package carrying any data table rejects the whole import, and model members inside a v1 package are a packaging bug. `default_models` joins `content_settings`/`default_prompts` as a singleton (fixed id `open_notebook:default_models`, `LIMIT 1` read, unconditional MERGE on import).
- **Plain-text API keys in the package (accepted risk)**: export decrypts every credential's `api_key` before writing (`credential.ndjson` carries plaintext) and re-encrypts on import with the local key. Two fast-fail guards bracket the risk: export aborts entirely if any credential cannot be decrypted (no half-written package), and import refuses packages containing plaintext keys when `OPEN_NOTEBOOK_ENCRYPTION_KEY` is unset — checked both in the scan endpoint (HTTP 400) and again in the worker before the first write. The export UI shows a red plain-text warning whenever the package will contain keys.
- **Import conflicts are user-decided, not silent**: a pre-import scan endpoint diffs the package's model configuration against the local DB using business fingerprints (whitelisted fields minus `created`/`updated`; credential keys compared as decrypted plaintext). Same fingerprint → silent skip; same id with different content → the UI lists both sides side-by-side (masked key previews) and the user picks skip/overwrite per record, defaulting to skip. Decisions travel into the worker as `model_decisions` and are re-validated there (unknown ids, duplicates → permanent failure before any write).
- **Overwrite boundaries**: overwriting a credential replaces only `api_key`, `config`, `modalities` (local `name`/`provider` survive); overwriting a model replaces all business fields. `default_models` is applied unconditionally by MERGE after its eight pointers are validated against locally-known or just-imported model ids; dangling pointers are cleared to None with a `defaultModelTargetMissing` warning instead of blocking.
- **Two-phase import API**: `POST /data-transfer/import` now uploads to a fixed `pending_scan.zip` and returns the scan result with a `scan_id` (parked in a sidecar JSON); `POST /data-transfer/import/execute` submits the worker job with the decisions and consumes the sidecar (single-use ticket; scan-id mismatch → 400). The old upload-then-start flow is gone.
- **Record ids are the package identity**: skip and overwrite both target the source record id directly, so no pointer redirection is ever needed.

## Alternatives considered

- **Encrypted packages** — rejected for now: key exchange between machines is the same problem as sharing the key manually; the zip is on the user's own machines. Revisit if packages ever transit third-party storage.
- **Skip-only import (ADR-011 semantics) for model config** — rejected: model rows are small but semantically load-bearing; silently keeping a stale local credential while the user expects the package state is worse than one confirmation screen.
- **Encrypting only the credential member** — rejected: partial encryption adds a false sense of security while the failure modes (no key on target) are identical.
- **Per-field merge of credential overwrites** — rejected: keeping local `name`/`provider` is enough continuity; field-level merging of secrets invites ambiguous states.

## Consequences

- `format_version` 2 packages are not importable by pre-v2 builds; v1 packages remain importable everywhere (no model members by definition).
- The plain-text key risk is documented UI-visible, but the zip itself is unprotected — the ADR-011 "package encryption" alternative stays open for a future format bump.
- The worker and API must be restarted together: a pre-v2 worker cannot parse `model_decisions` and would fail the import fast (permanent ValueError), not corrupt data.
- The unused-i18n-key scanner forces every new key to be referenced; `conflict.fields.*` labels are mapped through a literal key map (same pattern as `WARNING_KEYS`).
