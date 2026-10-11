# REV-162 Design Changes Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Prototype tab's "What changed" card lists the page model's own `{ change, reason }` entries, in the operator's dashboard language, under the measured blocks.

**Architecture:** When an operator locale is known, the page model is asked to write a `===CHANGES===` JSON block after `</html>`. Code splits it off before `checkMvpPage`, keeps only entries that pass `MvpDesignChangeSchema`, and stores the list on the version entry (`IMvpPageVersion.changes`). The current page is always the last version, so the dashboard reads the last version's list. The locale comes from the dashboard on Add lead, discovery import, Regenerate and Edit, and is stored on the lead for the auto-chained first generation.

**Tech Stack:** TypeScript, Zod (`@revamp/validation`), Mongoose (`@revamp/db`), BullMQ workers, Express, React 18 + MUI v6, i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-rev-162-design-changes-summary-design.md`

## Global Constraints

- Locales: `OPERATOR_LOCALES = ['en', 'ru', 'be', 'pl', 'lt']`; prompt names: English, Russian, Belarusian, Polish, Lithuanian.
- Limits: `MVP_DESIGN_CHANGE_LIMITS = { change: 140, reason: 240, maxEntries: 8 }`.
- An entry is refused when either field, trimmed, is empty or over its limit, or contains any decimal digit (`\p{Nd}`), `{{` or `}}`, `<` or `>`, an email address, `http://`, `https://` or `www.`.
- Marker line: exactly `===CHANGES===`.
- No locale (job and lead both without one): no block is asked for and none is read.
- A bad, missing or empty block never rejects or retries a page; it only means no `changes`.
- No fallback or templated summary text anywhere (AGENTS.md §3.2.2); the list is shown as stored.
- Schemas only in `packages/db`; validation only in `@revamp/validation`; queue and error codes from shared-types.
- Dashboard: theme tokens only; every new label in en, ru, be, pl, lt.
- Tests: Vitest `.spec.ts` only, run from the repo root (`npx vitest run <path>`); no test calls a live model.
- Work in `../Revamp-dev-rev162`; never stop the main checkout's dev stack.
- Commits: `feat(REV-162): …` / `test(REV-162): …` / `docs(REV-162): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Non-ASCII digits** (`٣`, `３`) in a reason must be refused like `3`: `\d` without the `u` flag misses them. Test in Task 1.
2. **Extra keys or non-object items** in the array (`"why"`, `null`, a string) are dropped per item, and the stored entries have only `change` and `reason`. Test in Task 3.
3. **A marker before `</html>`** (the model put the block inside the body) gives no block, and the page goes to the checks untouched. Test in Task 3.
4. **Restoring a version made before REV-162** stores a `restore` entry with no `changes` key (not `null`, not `[]`). Test in Task 6.
5. **The operator switches language after Add lead:** the auto-chained generation uses the lead's stored locale, while Regenerate uses the request's. Test in Task 6.

---

### Task 1: Shared types and validation schemas

**Files:**
- Modify: `packages/shared-types/src/index.ts` (near `ILead` ~100, `IAiGenerationJobData` ~948, `IMvpPageJobData` ~989, `IMvpPageVersion` ~1242, `IMvpPageJob` ~1260)
- Modify: `packages/validation/src/index.ts` (`CreateLeadSchema` ~85, `ImportDiscoverySchema` ~211, `GenerateMvpSchema` ~315, `EditMvpSchema` ~507)
- Modify: `apps/dashboard/src/i18n/languages.ts` (`SUPPORTED_LANGUAGES` becomes `export { OPERATOR_LOCALES as SUPPORTED_LANGUAGES }` semantics; `AppLanguage = OperatorLocale`)
- Test: `packages/validation/__tests__/mvp-page.spec.ts`, `packages/validation/__tests__/validation.spec.ts`

**Interfaces:**
- Produces (shared-types): `OPERATOR_LOCALES`, `type OperatorLocale`, `OPERATOR_LOCALE_NAMES: Record<OperatorLocale, string>`, `interface IMvpDesignChange { change: string; reason: string }`; optional fields `ILead.operatorLocale?: OperatorLocale`, `IAiGenerationJobData.operatorLocale?`, `IMvpPageJobData.operatorLocale?`, `IMvpPageVersion.changes?: IMvpDesignChange[]`, `IMvpPageJob.changes?: IMvpDesignChange[]`.
- Produces (validation): `OperatorLocaleSchema`, `MVP_DESIGN_CHANGE_LIMITS`, `MvpDesignChangeSchema`; `operatorLocale: OperatorLocaleSchema.optional()` on `CreateLeadSchema`, `ImportDiscoverySchema`, `GenerateMvpSchema`, `EditMvpSchema`.

- [ ] **Step 1: Write the failing tests**

In `mvp-page.spec.ts`, `describe('MvpDesignChangeSchema (REV-162)')`:
- `accepts a plain entry and trims it`: `{ change: '  Moved services up ', reason: 'Visitors see the offer first.' }` parses to the trimmed values.
- `accepts each field at its limit`: `'a'.repeat(140)` / `'a'.repeat(240)` pass; `141` / `241` fail.
- `refuses empty or whitespace-only fields`.
- `refuses digits, including non-ASCII ones`: `'3 columns'`, `'٣ columns'`, `'３ columns'` each fail.
- `refuses contacts, placeholders, links and markup`: `'mail us at a@b.pl'`, `'{{phone}}'`, `'see https://x.pl'`, `'www.x.pl'`, `'<b>bold</b>'` each fail.
- `strips unknown keys`: `{ change, reason, why: 'x' }` parses to an object without `why`.
- `MVP_DESIGN_CHANGE_LIMITS` equals `{ change: 140, reason: 240, maxEntries: 8 }`.

In `validation.spec.ts`, `describe('operatorLocale (REV-162)')`:
- `OperatorLocaleSchema` accepts each of `en ru be pl lt` and refuses `'de'`, `'PL'`, `''`.
- `CreateLeadSchema`, `ImportDiscoverySchema`, `GenerateMvpSchema`, `EditMvpSchema` each accept a payload with `operatorLocale: 'pl'`, without it, and refuse `operatorLocale: 'de'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/validation/__tests__/mvp-page.spec.ts packages/validation/__tests__/validation.spec.ts`
Expected: FAIL, `MvpDesignChangeSchema` / `OperatorLocaleSchema` not exported.

- [ ] **Step 3: Implement the types and schemas**

Field checks in `MvpDesignChangeSchema` are one `superRefine` per field over the trimmed string, using `/\p{Nd}/u`, `/\{\{|\}\}/`, `/[<>]/`, `/[\w.+-]+@[\w-]+\.[\w.-]+/`, `/https?:\/\/|www\./i`. In the dashboard, `languages.ts` re-exports the shared list (`SUPPORTED_LANGUAGES = OPERATOR_LOCALES`, `AppLanguage = OperatorLocale`); `LANGUAGE_NAMES` stays (native names, for the switcher).

- [ ] **Step 4: Build the packages and run the tests**

Run: `npm run build:packages && npx vitest run packages/validation apps/dashboard/src/i18n`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): operator locale and design-change schemas"`

---

### Task 2: Lead.operatorLocale in the db schema

**Files:**
- Modify: `packages/db/src/models/Lead.model.ts` (next to `source` ~68)
- Test: `packages/db/__tests__/models.spec.ts`

**Interfaces:**
- Consumes: `OPERATOR_LOCALES` (Task 1).
- Produces: `Lead.operatorLocale` persisted; `MvpProject.versions[].changes` persisted (already `Mixed`, pinned by a test).

- [ ] **Step 1: Write the failing tests**

- `Lead keeps operatorLocale (REV-162)`: a lead created with `operatorLocale: 'pl'` reads back `'pl'`; one with `'de'` fails validation.
- `MvpProject keeps the design changes on a version (REV-162)`: a project saved with `versions: [{ n: 1, kind: 'generate', storagePath: 'v/x/versions/1.html', createdAt: new Date(), changes: [{ change: 'A', reason: 'B' }] }]` reads back the same `changes`.

- [ ] **Step 2: Run to verify the Lead test fails**

Run: `npx vitest run packages/db/__tests__/models.spec.ts`
Expected: the Lead test FAILS (strict mode drops the field); the MvpProject test passes already (it pins the behaviour).

- [ ] **Step 3: Add `operatorLocale: { type: String, enum: OPERATOR_LOCALES }` to `LeadSchema`**

- [ ] **Step 4: Run the tests**

Run: `npm run build:packages && npx vitest run packages/db`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): store the operator locale on the lead"`

---

### Task 3: Splitting and reading the changes block

**Files:**
- Create: `apps/workers/src/services/mvp-page-changes.ts`
- Test: `apps/workers/src/services/__tests__/mvp-page-changes.spec.ts`

**Interfaces:**
- Consumes: `MvpDesignChangeSchema`, `MVP_DESIGN_CHANGE_LIMITS` (Task 1); `stripCodeFence` (`mvp-page-generator.ts`; move it into this file and re-export it from the generator so existing imports keep working).
- Produces:
  - `MVP_CHANGES_MARKER = '===CHANGES==='`
  - `splitChangesBlock(answer: string): { page: string; block?: string }`
  - `readDesignChanges(block: string | undefined): { changes?: IMvpDesignChange[]; dropped: number }`
  - `changesInstruction(locale: OperatorLocale): string` (the block instruction for the user prompt, Task 4 wording)

- [ ] **Step 1: Write the failing tests**

`splitChangesBlock`:
- `returns the whole answer as the page without a marker`: `{ page: VALID }`, no `block`.
- `splits on a marker line after </html>`: `VALID + '\n===CHANGES===\n[{"change":"a","reason":"b"}]'` gives `page === VALID` and `block === '[{"change":"a","reason":"b"}]'`.
- `strips a fence around the page and one around the block`: page part in ` ```html `, block in ` ```json `.
- `strips a fence around the whole answer before splitting`.
- `splits on the last marker`: two marker lines after `</html>`; the block is the text after the second.
- `ignores a marker before </html>` (Review Focus 3): marker inside `<body>`; result `{ page: <answer unchanged> }`, no block.

`readDesignChanges`:
- `undefined` → `{ dropped: 0 }`, no `changes`.
- `broken JSON` (`'[{"change":'`) → no `changes`, `dropped: 0`.
- `not an array` (`'{"change":"a","reason":"b"}'`) → no `changes`.
- `keeps valid entries and drops the rest` (Review Focus 2): `[valid, {change:'3 cols',reason:'x'}, null, 'text', {change:'a',reason:'b',why:'c'}]` → `changes` is `[valid, {change:'a',reason:'b'}]`, `dropped: 3`.
- `keeps the first 8`: 9 valid entries → 8 kept, the ninth dropped, `dropped: 1`.
- `all invalid` → no `changes`.
- `reads a fenced block`.

`changesInstruction`:
- `names the language and the marker`: `changesInstruction('pl')` contains `'Polish'`, `'===CHANGES==='`, `'</html>'`, `'8'`; does not contain `'Russian'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/mvp-page-changes.spec.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`splitChangesBlock`: strip a whole-answer fence; find the last line equal (trimmed) to the marker; split only when that line starts after the last `</html>` (case-insensitive); strip a fence from each part, trim. `readDesignChanges` parses each item with `MvpDesignChangeSchema.safeParse` and keeps passing items up to `maxEntries`. `changesInstruction` carries the spec's wording (§1 Prompt) with the language from `OPERATOR_LOCALE_NAMES`; it may only be retuned in Task 5.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/mvp-page-changes.spec.ts apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`
Expected: PASS (the generator's `stripCodeFence` tests still pass through the re-export).

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): split and validate the model's changes block"`

---

### Task 4: The generator asks for and returns the changes

**Files:**
- Modify: `apps/workers/src/services/mvp-page-generator.ts` (`MvpPageInput`, `MvpPageChangeInput`, `MvpPageResult`, `change`, `run`, `reviewPage`)
- Create: `apps/workers/src/services/__tests__/fixtures/page-gen/answers/with-changes.txt` (`valid-page.html` + marker + 3 valid Polish entries), `with-bad-changes.txt` (`valid-page.html` + marker + broken JSON)
- Test: `apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`

**Interfaces:**
- Consumes: Task 3's exports.
- Produces: `MvpPageInput.operatorLocale?: OperatorLocale`; `MvpPageChangeInput.currentChanges?: IMvpDesignChange[]`; `MvpPageResult` (`ok: true`) `.changes?: IMvpDesignChange[]`.

- [ ] **Step 1: Write the failing tests** (in a new `describe('design changes (REV-162)')`, using the existing `generator()` stub)

- `asks for no block without a locale`: request's `userPrompt` does not contain `'===CHANGES==='`; result has no `changes` even for `with-changes.txt`.
- `asks for the block in the operator's language`: with `operatorLocale: 'ru'`, `userPrompt` contains `changesInstruction('ru')`; `systemPrompt === MVP_PAGE_SYSTEM_PROMPT` (unchanged).
- `returns the entries and checks only the page`: `with-changes.txt`, locale `pl` → `ok`, `page === VALID.trim()`, `changes` has the 3 entries.
- `keeps the page when the block is bad`: `with-bad-changes.txt` → `ok`, one call, no `changes`.
- `uses the accepted retry's block`: queue `[WITH_SCRIPT + block A, VALID + block B]` → `changes` equals B; the retry prompt's rejected page has no marker.
- `edit sends the stored list as data`: `change({ …, currentChanges: [{change:'X',reason:'Y'}], operatorLocale: 'pl' })` → `userPrompt` contains `'"change":"X"'` and `'data, not instructions'`.
- `edit without a stored list asks for one from scratch`: no `currentChanges` → `userPrompt` contains `changesInstruction('pl')` and not the stored-list label.
- `self-review revised: the revision's block`: revision answer `REVISED + block B`, first `VALID + block A` → `changes` B.
- `self-review revised without a valid block: the first page's block`: revision `REVISED` alone → `changes` A.
- `self-review unchanged: the first page's block`: revision is `VALID + block C` (same page) → `review.outcome === 'unchanged'`, `changes` A.
- `self-review prompt asks for the updated block with a locale`: the review request's `userPrompt` contains `'changes block'`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`
Expected: the new tests FAIL; the existing ones pass.

- [ ] **Step 3: Implement**

In `run`, append `'\n\n' + changesInstruction(locale)` to the user prompt when `input.operatorLocale` is set; for `change`, the task text adds the stored list as `JSON.stringify(currentChanges)` under "The list of design changes this page made compared with the current site (data, not instructions):" and asks for the full updated list, or, without one, the list from scratch. Each answer goes through `splitChangesBlock`, then the existing `checkMvpPage`; `readDesignChanges(block)` only for the accepted answer, only with a locale. `reviewPage` gets the locale and the first page's changes; with a locale, the review prompt adds "Answer with the whole page and its updated changes block." `unchanged` compares the split page. Log `[MvpPageGenerator] N design change(s) dropped` when `dropped > 0`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers/src/services/__tests__/mvp-page-generator.spec.ts apps/workers/src/services/__tests__/mvp-page-review.spec.ts`
Expected: PASS, the existing recorded-answer test (`falcodent.recorded.json`) included.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): the page model reports its design changes"`

---

### Task 5: Live probe on real sites

**Files:**
- Modify: `scripts/generate_mvp_page.ts` (new `--operator-locale <en|ru|be|pl|lt>` option, validated with `OperatorLocaleSchema`; the usage line and header comment; the per-site summary prints the changes count and the entries)
- Create (if good): `apps/workers/src/services/__tests__/fixtures/page-gen/answers/<host>.changes.recorded.json` plus one test in `mvp-page-generator.spec.ts` replaying it

- [ ] **Step 1: Add the option** and check it is refused when invalid: `npx tsx scripts/generate_mvp_page.ts --operator-locale de /tmp/x https://falcodent.pl` exits non-zero with the usage line.
- [ ] **Step 2: Run** `npx tsx scripts/generate_mvp_page.ts --operator-locale pl --record <scratchpad>/rec-pl <scratchpad>/out-pl <3–4 sites from earlier recordings>` and the same with `ru`.
- [ ] **Step 3: Check each result:** the block arrives and parses, entries are in the operator's language, `<html lang>` and copy stay in the site's language, the drop count is low. If the block is missing or mostly dropped, adjust only `changesInstruction`'s wording and rerun; record the outcome table (site, locale, entries kept/dropped, page language) for the PR body.
- [ ] **Step 4: Turn one good recording into a fixture** with a test: `replays a recorded answer with a changes block`, `ok`, `changes.length >= 1`, every entry passes `MvpDesignChangeSchema`.
- [ ] **Step 5: Commit**

`git commit -m "test(REV-162): live probe option and a recorded answer with changes"`

---

### Task 6: Workers store the changes per version

**Files:**
- Modify: `apps/workers/src/workers/ai.worker.ts` (~66 `generate`, ~84 `addDeployJob`)
- Modify: `apps/workers/src/workers/deploy.worker.ts` (version entry ~80)
- Modify: `apps/workers/src/workers/mvp-page.worker.ts` (`change` ~100, `restore` ~130, `NextPage.version`)
- Test: `apps/workers/src/workers/__tests__/ai.worker.spec.ts`, `deploy-page.spec.ts`, `mvp-page.worker.spec.ts`

**Interfaces:**
- Consumes: Task 1 job fields; Task 4 `operatorLocale`, `currentChanges`, `result.changes`.
- Produces: `IMvpPageJob.changes` set by the ai worker; `versions[].changes` written by deploy and the mvp-page worker.

- [ ] **Step 1: Write the failing tests**

ai worker:
- `uses the job's locale` (Review Focus 5): job `operatorLocale: 'ru'`, lead `operatorLocale: 'pl'` → `generate` called with `operatorLocale: 'ru'`.
- `falls back to the lead's locale`: job without, lead `'pl'` → `'pl'`.
- `asks for no changes without a locale`: neither → `generate` input has no `operatorLocale`.
- `carries the changes to the deploy job`: generator result with `changes` → `addDeployJob` page has the same `changes`; without → no `changes` key.

deploy worker:
- `writes the page's changes on the new version`; `a page without changes makes a version without the key`.

mvp-page worker:
- `change passes the current version's list and stores the result's`: last version has `changes: L1`, job `operatorLocale: 'lt'` → `generator.change` called with `currentChanges: L1, operatorLocale: 'lt'`; result `changes: L2` → pushed entry has `changes: L2`.
- `change falls back to the lead's locale`.
- `controls leaves the versions alone`: no `$push`.
- `restore copies the restored version's list`: restoring `n` with `changes: L1` → new entry `changes: L1`, no generator call.
- `restore of a version made before REV-162 stores no changes key` (Review Focus 4): `'changes' in entry === false`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/workers/src/workers/__tests__`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

The locale is `data.operatorLocale ?? lead.operatorLocale`; `NextPage.version` gets `changes?`; spread `changes` only when present, everywhere.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/workers`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): keep the design changes on each version"`

---

### Task 7: API passes the locale through

**Files:**
- Modify: `apps/api/src/services/lead.service.ts` (`createLead`, `Lead.create` ~65)
- Modify: `apps/api/src/services/discovery.service.ts` (`importCandidates` ~115, the `createLead` call ~151)
- Modify: `apps/api/src/routes/mvp.routes.ts` (generate ~82, edit ~220)
- Test: `apps/api/src/routes/__tests__/api.routes.spec.ts`, `discovery.routes.spec.ts`

**Interfaces:**
- Consumes: Task 1 schemas and job fields.
- Produces: `Lead.operatorLocale` from `POST /leads` and the import; `operatorLocale` in ai-gen and mvp-page job data.

- [ ] **Step 1: Write the failing tests**

- `POST /leads stores operatorLocale`: `Lead.create` called with `operatorLocale: 'pl'`; without it, no key.
- `POST /leads rejects an unknown locale with 400 VALIDATION_ERROR`.
- `POST /discovery/:jobId/import gives each lead the locale`: two ids, `operatorLocale: 'ru'` → both `createLead` dtos carry `'ru'`.
- `POST /mvp/generate passes operatorLocale to the job`; `rejects 'de' with 400`.
- `POST /mvp/:id/edit passes operatorLocale to the page job`; `rejects 'de' with 400`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/src/routes/__tests__/api.routes.spec.ts apps/api/src/routes/__tests__/discovery.routes.spec.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement** (spread `operatorLocale` only when present)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): pass the operator locale from the requests to the jobs"`

---

### Task 8: Dashboard requests send the locale

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`createLead` ~184, `editMvp` ~300, `generateMvp` ~330, `importDiscoveryCandidates` ~400)
- Test: `apps/dashboard/src/api/__tests__/client.spec.ts`

**Interfaces:**
- Consumes: `useLanguageStore.getState().language` (`store/useLanguageStore.ts`), Task 1 schemas.
- Produces: the four request bodies carry `operatorLocale`; callers and hooks are unchanged.

- [ ] **Step 1: Write the failing tests**

For each of the four calls: with `useLanguageStore.setState({ language: 'pl' })`, the fetched body's `operatorLocale === 'pl'`; after `setState({ language: 'lt' })`, `'lt'` (read at call time, not import time).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/dashboard/src/api/__tests__/client.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** (read the store inside each call; `generateMvp` passes it through `GenerateMvpSchema.parse`)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/dashboard/src/api`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): the dashboard sends its language with lead and MVP requests"`

---

### Task 9: "Design changes" in the What changed card

**Files:**
- Modify: `apps/dashboard/src/utils/mvpChanges.ts` (`MvpChangeSummary`, `summarizeMvpChanges`, `isMvpChangeSummaryEmpty`)
- Modify: `apps/dashboard/src/components/leadReview/MvpChangeSummary.tsx`
- Modify: `apps/dashboard/src/i18n/locales/{en,ru,be,pl,lt}.ts` (`mvpChanges` ~661 in en)
- Test: `apps/dashboard/src/utils/__tests__/mvpChanges.spec.ts`, `apps/dashboard/src/components/__tests__/MvpChangeSummary.spec.ts`, `MvpChangeSummaryKeys.spec.ts`

**Interfaces:**
- Consumes: `IMvpProjectDetail.versions[].changes`, `IMvpProjectDetail.controls`.
- Produces: `MvpChangeSummary.design?: { changes: IMvpDesignChange[]; controlsApplied: boolean }`; locale keys `mvpChanges.design.title`, `mvpChanges.design.caption`, `mvpChanges.design.controlsApplied`.

- [ ] **Step 1: Write the failing tests**

`summarizeMvpChanges`:
- `reads the last version's changes`: versions `[v1 changes A, v2 changes B]` → `design.changes === B`.
- `no design block when the last version has none`: v1 has A, v2 has none → no `design` (never the older list).
- `no design block without versions` (MVP from before REV-139/162).
- `controlsApplied` is `true` with `controls: { primary: '#000000' }` and `false` with `{}` or none.
- `isMvpChangeSummaryEmpty` is `false` when only `design` is present.

Component:
- `lists each change with its reason under the measured blocks`: the design block's list items show change and reason text, and the block comes after the measured cards in DOM order.
- `shows the palette label only when controls are applied`.
- `renders no design block and no placeholder text without changes`.

Keys spec: the three new keys exist and are non-empty in all five locales.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/dashboard/src/utils/__tests__/mvpChanges.spec.ts apps/dashboard/src/components/__tests__/MvpChangeSummary.spec.ts apps/dashboard/src/components/__tests__/MvpChangeSummaryKeys.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

A full-width `ChangeCard` (`wide`) with an icon from `@mui/icons-material` (e.g. `AutoAwesome`), the title, the caption in `text.secondary`, the optional palette label, and a `ul` of entries (change in `fontWeight: 600`, reason in `text.secondary`). Theme tokens only. English copy: title "Design changes", caption "Written by the page model", label "Your colors and fonts replace the model's choices."

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/dashboard`
Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(REV-162): show the model's design changes in What changed"`

---

### Task 10: Gates, end-to-end check and in-repo docs

**Files:**
- Modify: `README.md` (MVP section, the script's `--operator-locale`), `AGENTS.md` §3.2.2 (the changes block: marker, schema, no fallback) and §3.2.6 ("What changed" shows the last version's list and the palette label)

- [ ] **Step 1: Run the gates in the worktree**

`npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`
Expected: 0 errors, no new lint warnings, 0 test failures.

- [ ] **Step 2: Chrome, end to end** (isolated workers on Redis DB 1, per the email-e2e-isolated-stack memory; main checkout's stack untouched)

Dashboard in Polish → Add lead (fresh URL) → wait for NEEDS_APPROVAL → Prototype tab shows "Design changes" in Polish, page in the site's language. Switch to Russian → Regenerate → list in Russian. Edit ("make the header darker") → list updated. Change a palette color → label appears, list kept. Restore version 1 → the Polish list again. Console: no new errors. Never approve the lead.

- [ ] **Step 3: Update README and AGENTS.md, commit**

`git commit -m "docs(REV-162): design changes summary in README and AGENTS.md"`

After the merge (outside this plan's code): `../Revamp-docs` spec.md (request fields, `MvpDesignChangeSchema`), blueprint.md (`versions.changes`, `Lead.operatorLocale`), AGENTS.md (the changes instruction and schema), committed as `docs(REV-162): …`; ticket comment noting the full-window preview was left out on purpose.
