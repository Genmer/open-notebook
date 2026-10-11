# ADR-020: Offline-corpus seed artifacts admit exam metadata only; empty prompts and free-text domains are the designed caliber

- **Status**: Accepted
- **Date**: 2026-10

## Context

The ruankao question bank ships its seed data as a committed generated artifact (`frontend/src/lib/ruankao/question-bank-seeds.gen.ts`), produced by a dev-time extraction pipeline that runs against local-only material: SurrealDB sources and the gitignored `data/uploads/` corpus. The pipeline itself (and the keyword table it uses to assign initial `domain` values) is not committed.

An audit pass raised two caliber questions against this artifact:

1. An expectation that seed entries carry all three question prompts non-empty does not match the landed data: of 103 seeds, 50 have all three prompts, 52 are title-only, 1 carries q1 only — 53 entries have at least one empty prompt.
2. "techDomain within a normative domain list" could not be verified, because no domain-list artifact exists anywhere in the repo.

Both deviations are the design working as specified, not data defects. The v2 schema allows empty prompts deliberately (`question-bank.ts:24-29`: "v2 起允许 ''（标题-only 条目）"), the detail dialog renders an explicit empty-prompt state instead of hiding it (`QuestionBankPanel.tsx:681/698/715` → `ruankao.questionBank.detailNoPromptText`), and `domain` is documented free text (`question-bank.ts:22-23`: "技术域标签，单值自由输入"). This record settles the two questions so future audits resolve them against a decision instead of re-litigating the data.

## Decision

**Seed artifacts are generated metadata, admitted under three gates: metadata-only red line, empty-prompts-allowed, free-text domains. Verification runs against those gates — not against expectations the design never had.**

1. **Metadata-only red line.** Seeds carry title, year marker, the three question prompts *verbatim from local sources*, origin ruling, and source refs — never essay body text (ADR-017). Title-only entries are essay-library titles for which no question text exists in any local source. Fabricating prompt text to satisfy a "3 non-empty" expectation would violate the fact-data rule the module is built on (题目原文是事实数据；宁可空缺不编造) and silently rewrite a committed artifact. An empty prompt is a first-class state with its own UI guidance, not missing data.
2. **Free-text domains, closed-set drift gate for the artifact.** `domain` is free input by design — for user entries the panel validates nothing beyond type, and no normative list was ever adopted. Creating one now would either block legitimate user input or be dead weight. What is pinned instead: every *seed's* `domain` must be non-empty and within the seeds' own closed set (currently 13 values, asserted in `question-bank.test.ts`). A regenerated seed introducing a 14th value fails the gate and forces the same human diff review any seed regeneration requires. This detects pipeline drift without inventing a vocabulary the product deliberately does not have.
3. **Dev-local provenance is accepted.** The extraction pipeline and its keyword table stay dev-local (one-shot data production against `data/uploads/` + SurrealDB, hard-coded source ids, no CI use). The committed artifact plus its pinned tests are the contract; corpus-dependent checks that need the local corpus (e.g. the essay-corpus n-gram scan in `scripts/build_industry_profiles.py --validate`) read it via `--corpus-glob` — whose default includes `data/uploads/*.md` — and degrade to a warning, not a failure, when the corpus is absent.

## Alternatives considered

- **Backfilling the 53 empty prompt sets** (from exam sites or model memory): rejected — fabrication risk with no verbatim source to check against, contradicting the origin rules and the metadata-only red line. The mock-coach templates carry the same red line ("不编造官方原题").
- **Committing a normative domain list and validating seeds against it**: rejected — free text is the product decision; the closed-set gate gives drift detection at zero product cost.
- **Committing the extraction pipeline**: rejected for now — it is a one-shot producer whose output is fully pinned by tests; committing it would also pin paths and source ids that only exist on a dev machine. Revisit if seeds ever regenerate on a schedule.

## Consequences

- An audit verifying seeds against "all prompts non-empty" or "domains within a committed list" will report a deviation; this record is the ruling that deviation resolves against. The honest report is "matches the designed caliber", not "matches the expectation".
- Adding a seed domain value means updating the closed-set test in the same change — that friction is the point.
- Machines without the local corpus run `--validate` with the n-gram scan degraded to a warning; the scan is a dev-time gate and never a CI gate.
