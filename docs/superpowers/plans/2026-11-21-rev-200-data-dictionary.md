# REV-200 Data Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `Schema.Types.Mixed` field is either checked by a Zod schema before it's written or documented as free-form with a reason. The data dictionary in `../Revamp-docs/database-expertise.md` covers every model field, the integrity rules and the data-quality rules, and a script reports any model field the dictionary doesn't mention.

**Architecture:**
- **Code (revamp-dev).** Producers that build a Mixed value parse it with its schema from `@revamp/validation` right where it's built, as `site-era.service.ts`, `mvp-standards.ts` and `mvp-completeness.service.ts` already do. Contacts and site content get new schemas. A pure function lists every schema path of the five `@revamp/db` models and finds those missing from a Markdown file. A root script runs it against the docs file.
- **Docs (revamp-docs).** The user's own `database-expertise.md` (Russian, uncommitted) is extended in place and committed with REV-200, as the user chose.

**Tech Stack:** Zod, Mongoose (`schema.eachPath`), Vitest, tsx.

**Spec:** Linear REV-200 acceptance criteria, plus AGENTS.md §3.2.2 (REV-45, REV-100), §3.2.4 (Zod before persisting), §3.2.7 and §3.2.8.

## Global Constraints

- A new parse never turns a working audit or generation into a failure for a cosmetic reason. Schemas mirror the existing TypeScript types (`ISiteComplexity`, `IExtractedContacts`, `ISiteContent`), with no new length caps beyond what the producers already enforce.
- The generation-failure handler must never throw. An invalid `generationFailure` is logged and left out, while `status` and `generationError` are still written.
- No schema changes in `packages/db` (no change to stored shapes); validation happens in the producers.
- The docs stay in Russian, in the existing structure of `database-expertise.md`. Only REV-200 sections are added or corrected; the author's text stays unless it's out of date.

## Mixed field map (the decisions)

| Field | Validated before write by | Change in this ticket |
|---|---|---|
| `Audit.siteEra` | `SiteEraSchema` (`site-era.service.ts`) | none |
| `Audit.siteComplexity` | `SiteComplexitySchema` | parse in `classifySiteComplexity` |
| `Audit.extractedContacts` | new `ExtractedContactsSchema` | add schema, parse in brand extractor |
| `Audit.extractedContent` | new `SiteContentSchema` | add schema, parse in brand extractor |
| `Audit.axeViolations` | free-form: raw axe-core output, third-party shape, read only for display | document the reason |
| `MvpProject.completenessReport` | `MvpCompletenessReportSchema` | none |
| `MvpProject.standards` | `MvpStandardsSchema` | none |
| `MvpProject.performance` | `MvpPerformanceSchema` | none |
| `MvpProject.theme` | `MvpThemeSchema` | parse in `checkMvpPage` when the page is accepted |
| `MvpProject.controls` | `UpdateMvpTokensSchema` at the API | none |
| `MvpProject.grounding` | `MvpGroundingFlagSchema` | parse the result of `checkMvpGrounding` |
| `MvpProject.versions` | `MvpPageVersionSchema` | parse each new entry (deploy and page workers) |
| `Lead.generationFailure` | `MvpRenderFailureSchema` | `safeParse` in `generation-failure.ts`; invalid → logged, left out |
| `AnalyticsEvent.metadata` | free-form: small per-event context (referer, CTA label), never read back as structure | document the reason |

## Review Focus

1. A real audit of a site with unusual contacts or content (empty arrays, missing `language`, odd social links) must still complete. The new schemas must accept every value the extractor already produces.
2. A generation whose error carries a malformed `failure` still resets the lead to its previous status.
3. A retried page job reuses its version entry (`jobId`), so the parse must not reject an entry with `jobId`, `instruction`, `from` or `changes`.
4. The dictionary checker must treat nested paths (`scores.total`, `metrics.openCount`, `standardsChecks.https`) and subdocument array fields (`a11ySummary.criticalViolations`) consistently, without false misses for `_id`, `__v` or timestamps.
5. Older documents with removed fields aren't a checker concern: it reads model paths, not data.

---

### Task 1: Validate the Mixed fields that have a schema

**Files:** `apps/workers/src/services/site-complexity.service.ts`, `mvp-page-check.ts`, `mvp-grounding.ts`, `apps/workers/src/workers/deploy.worker.ts`, `mvp-page.worker.ts`, `generation-failure.ts`, and their specs.

- [ ] **Failing tests:**
  - `classifySiteComplexity` returns a value `SiteComplexitySchema` accepts. It throws on a class outside the enum, simulated by mocking the classifier's internal table only if one exists; otherwise assert that it parses.
  - `checkMvpPage` on an accepted fixture returns a theme that passes `MvpThemeSchema`; a page declaring an empty theme value is rejected.
  - `checkMvpGrounding` output passes `z.array(MvpGroundingFlagSchema)`.
  - The deploy and page workers build version entries that pass `MvpPageVersionSchema`. An extracted helper `pageVersionEntry(input): IMvpPageVersion` parses, and both workers use it.
  - `handleGenerationFailure` with `failure: { code: 'X' }` still sets the status and `generationError`, and does not set `generationFailure`.
- [ ] **Implement:** parse at each producer.
- [ ] **Run** the workers specs; then commit `feat(REV-200): validate siteComplexity, theme, grounding, versions and generationFailure before writing`.

### Task 2: Schemas for contacts and site content

**Files:** `packages/validation/src/index.ts` (`ExtractedContactsSchema`, `SiteContentSchema` mirroring `IExtractedContacts` / `ISiteContent`), `apps/workers/src/services/brand-extractor.service.ts`, and specs.

- [ ] **Failing tests:**
  - Validation spec: valid, minimal and invalid cases (a wrong `languageSource`, a non-array `socialLinks`).
  - Brand extractor spec: its result's `contacts` and `siteContent` pass the schemas on the existing fixtures.
- [ ] **Implement:** parse in the extractor where it builds `contacts` and `siteContent`.
- [ ] **Commit** `feat(REV-200): Zod schemas for extracted contacts and site content`.

### Task 3: Dictionary drift checker

**Files:** `packages/db/src/data-dictionary.ts`, which exports:
- `modelFieldPaths(): Record<string, string[]>`, from the five models' `schema.eachPath` plus subdocument schemas, without `_id`, `__v`, `createdAt` and `updatedAt`;
- `undocumentedFields(markdown: string, paths = modelFieldPaths()): string[]`. A path counts as documented when it appears in backticks, either in full or as its last segment inside the section of its collection (heading containing `` `leads` `` etc.).

Plus `scripts/check-data-dictionary.ts` (`npm run docs:check-dictionary [-- <file>]`, default `../Revamp-docs/database-expertise.md`, exit 1 listing the missing paths) and tests in `packages/db/src/__tests__/data-dictionary.spec.ts`.

- [ ] **Failing tests:**
  - The paths include `scores.total`, `metrics.openCount`, `standardsChecks.https`, `a11ySummary.criticalViolations` and `versions`, and leave out `_id` and `__v`.
  - A Markdown file missing `trackingToken` from the `emailcampaigns` section reports `EmailCampaign.trackingToken`.
  - A field documented only under another collection's heading still counts as missing.
- [ ] **Implement, then commit** `feat(REV-200): npm run docs:check-dictionary reports model fields missing from the data dictionary`.

### Task 4: The dictionary (revamp-docs `database-expertise.md`)

- §4: every field the checker reports, with type, required, default, allowed values and nesting.
- New §4.6: the Mixed field table above, in Russian, with the schema or the free-form reason.
- §3: embedded vs referenced, with the reason per relationship (already mostly there; add document size and query pattern where missing).
- §7: integrity. Mongoose validation, Zod at the API and LLM boundaries, `LEAD_TRANSITIONS` with atomic `findOneAndUpdate`, unique keys, stalled jobs (`handleAuditJobFailed`, REV-145), and Add lead as a transaction (REV-202). Correct the line saying code opens no transactions. Known gaps: no cascade delete, and the multi-document writes that are still not transactional (generation publish, approval) with their order.
- New data-quality rules per collection: lowercase, trimming, 0–100 scores, `.test`/no made-up contacts (REV-45), no stand-in values for failed measurements (REV-100, `measurementErrors`), grounding flags.
- §2: MongoDB, Redis and MinIO, each with its role, linked to ADR 2.
- §10: `npm run db:seed`, `db:dump` and `db:restore` (REV-199).
- Run `npm run docs:check-dictionary`. Expected: exit 0.

### Task 5: Gates, review, PR, merge, docs commit

- Gates (`build:packages`, `typecheck`, `lint`, `test`, `build`). No dashboard change, so the Chrome check is one audit plus one MVP generation on the dev stack to confirm the new parses don't reject real data.
- One Opus review, then PR, merge, commit `database-expertise.md` in revamp-docs with `docs(REV-200)`, README and AGENTS.md lines for the checker, and close the ticket.
