# Decision Records

The project's decision log: short, dated, immutable records of structural decisions. They answer *"why is it like this?"* months later, and prevent settled discussions from being reopened without knowing they were settled.

Two kinds, same format:

- **ADR** (Architecture Decision Record) — technical choices: `ADR-NNN-slug.md`
- **PDR** (Product Decision Record) — product direction and scope: `PDR-NNN-slug.md`

The **current rules** distilled from these records live in [VISION.md](../../../VISION.md) (product identity + posture) and [design-principles.md](../design-principles.md) (engineering practices). Records are the memory; those pages are the law.

## Rules

1. **Records are immutable.** Reversing a decision means writing a *new* record and marking the old one `Superseded by ADR-NNN` in its Status line — never editing history.
2. **Write it in the same PR.** A design that resolves an open structural question ships with its record. Half a page, written while the context is loaded — not a documentation session later.
3. **Keep it to half a page.** Four sections: Context, Decision, Alternatives considered, Consequences. If it needs more, link an issue or doc for the depth.
4. **Number sequentially** within each prefix (ADR-005 comes after ADR-004, independent of PDRs). The maintainer assigns the number at merge: in a PR, name the file `ADR-0XX-<slug>.md`, and the next free number and the index row below are added when it lands. This avoids several open PRs claiming the same number. ADR-010 is currently unassigned: it was once set aside for the unmerged PR #1332, so the index jumps from 009 to 011.

## Template

```markdown
# ADR-NNN: <Title>

- **Status**: Accepted | Superseded by ADR-NNN
- **Date**: YYYY-MM
- **Related**: #issue, other records

## Context
What was the situation and the forces at play? (2-5 sentences)

## Decision
What we decided, stated as a rule someone can follow.

## Alternatives considered
What else was on the table and why it lost. (bullets)

## Consequences
What this makes easier, what it makes harder, what to watch. (bullets)
```

## Index

| Record | Title | Status |
|---|---|---|
| [ADR-001](ADR-001-surrealdb.md) | SurrealDB as the database | Accepted |
| [ADR-002](ADR-002-external-libraries.md) | Delegate platform/media support to focused external libraries | Accepted |
| [ADR-003](ADR-003-streamlit-to-nextjs.md) | Migrate the UI from Streamlit to Next.js | Accepted |
| [ADR-004](ADR-004-background-workers.md) | Long-running work runs on background workers | Accepted |
| [ADR-005](ADR-005-release-confidence-process.md) | Releases pass a risk-based confidence process, gated on the real image | Accepted |
| [ADR-006](ADR-006-migration-granularity.md) | Migration granularity follows merge granularity, not release granularity | Accepted |
| [ADR-007](ADR-007-optin-runtimes.md) | Heavy extraction runtimes (Docling, Crawl4AI local) are opt-in, installed at startup | Accepted |
| [ADR-008](ADR-008-notebook-scoped-search.md) | Notebook scope is an optional filter on the existing search functions | Accepted |
| [ADR-009](ADR-009-pbkdf2-credential-encryption.md) | PBKDF2 credential key derivation with versioned ciphertext | Accepted |
| [ADR-011](ADR-011-design-token-system.md) | Visual identity is a token contract in globals.css, reviewed through /dev/design | Accepted |
| [ADR-012](ADR-012-provider-endpoint-overrides.md) | Provider endpoint overrides are declared in the registry | Accepted |
| [ADR-013](ADR-013-objectmodel-get-error-contract.md) | ObjectModel.get raises NotFoundError only for a missing record | Accepted |
| [PDR-001](PDR-001-single-user-first.md) | Single-user first; don't preclude multi-user | Accepted |
| [PDR-002](PDR-002-provider-agnostic-core.md) | Provider-agnostic core by default | Accepted |
| [ADR-009](ADR-009-embedding-progress-denormalization.md) | Source embedding progress is denormalized onto the source row | Accepted |
| [ADR-010](ADR-010-local-token-usage-tracking.md) | Token usage tracking is local-only, best-effort, and off by default-able | Accepted |
| [ADR-011](ADR-011-data-transfer-export-import.md) | Data export/import — single zip package, id-skip idempotency, direct SQL writes | Accepted |
| [ADR-012](ADR-012-chat-context-preferences.md) | Chat context preferences: schemaless (notebook, folder, source) table, no DELETE | Accepted |
| [ADR-013](ADR-013-task-failure-explain-ai.md) | Task-failure explanations are assembled server-side and answered by an optional qa model slot | Accepted |
| [ADR-014](ADR-014-model-config-export-import.md) | Model configuration export/import — package format v2, plain-text API keys by user decision, conflict-confirm import | Accepted |
| [ADR-016](ADR-016-ruankao-module-tab-registry.md) | Ruankao module is one registry-driven page with hidden null-slot tabs | Accepted |
| [ADR-017](ADR-017-model-essay-mark-red-line-isolation.md) | Model-essay red-line isolation: one mark table, one fail-closed filter, three shared read points, two exception channels | Accepted |
| [PDR-003](PDR-003-source-annotation-system.md) | 来源标注系统规划定稿——18 项开放问题全部裁决（页级路由/条件互斥/标称对账等；规划与 MVP 任务清单见 `../plans/`） | Accepted |
| [PDR-004](PDR-004-agents-and-parallel-chat.md) | 智能体配置与多路并发对话——智能体表+配置页+分组选择器；并发走后端单 SSE 端点（执行与持久化解耦）；工作流缓做，锁定"预设链"演进形态 | Accepted |
