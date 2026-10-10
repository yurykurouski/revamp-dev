# REV-137 MvpPageGenerator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The model call that designs the MVP page: `MvpPageGenerator.generate(brief, screenshot)` and `.change(brief, screenshot, currentPage, instruction)` return a page that passed `checkMvpPage`, with its theme and grounding flags, or a coded failure. Plus a read-only dev script that runs it on real sites and records answers for tests.

**Architecture:** One service file next to `SiteGroupingService` and in the same shape: provider resolved like the vision grouping (`VISION_LLM_PROVIDER`, else the copywriting default, else the local CLI), the operator's provider/model passed in by the caller, one call, the REV-136 checks as the gate, one retry told the rejection reasons, a failure reason from `MVP_PAGE_FAILURES`. Nothing is wired into workers (REV-138).

**Tech Stack:** TypeScript, `LlmClient`, `ImageService.tilesForVision` (sharp), Vitest, Playwright (script only).

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` §3.2. Ticket [REV-137](https://linear.app/revamp-proect/issue/REV-137), Epic REV-135. Builds on REV-136 (`buildMvpSourceBrief`, `checkMvpPage`, `checkMvpGrounding`, `finishMvpPage`).

## Global Constraints

- Branch `ymorpheus/rev-137-page-generation-mvppagegenerator-generate-change-with-prompt` (exists). Commits `feat(REV-137): …` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests from the repo root: `npx vitest run <path>`; only `*.spec.ts` run. `npm run build:packages` after changing a package.
- No test calls a live model. Mocks only in test files.
- Failure reasons, exactly: `not_configured`, `call_failed`, `invalid_page`.
- One call, then at most one retry (two attempts total).
- The model writes no contact value; the prompt names only the brief's placeholders.

## Decisions this plan makes

1. **A surrounding code fence is stripped before the check** (spec §3.2: "the client strips a surrounding code fence"): exactly one fence around the whole answer, optional language tag. Prose before or after still fails `page:parse`.
2. **Screenshot:** the caller passes the audit's full-page desktop PNG (or nothing); the generator cuts it with `ImageService.tilesForVision(png, { maxTiles: 3 })`. No screenshot → a text-only call and the prompt says so. Fetching it from storage is REV-138.
3. **Temperatures** `[0.7, 0.3]`: a design benefits from variety on the first call, a retry should fix, not reinvent. (`LlmClient` already drops temperature where a model rejects it.)
4. **Budgets:** `maxTokens` 32 000, `timeoutMs` 300 000 for HTTP providers. The CLI keeps its own `CLAUDE_CLI_TIMEOUT_MS`; if real runs time out, REV-138 raises it for this job.
5. **Failure precedence** as the grouping: a rejected answer makes the run `invalid_page` even if the other attempt's call failed; only calls that all failed give `call_failed`.
6. **Testability:** the generator takes `client?: PageLlm` where `PageLlm = Pick<LlmClient, 'completeWithUsage' | 'unavailableReason' | 'modelName' | 'provider'>`, so tests pass a stub replaying recorded answers.

## Review Focus

1. A model that answers with a short apology or a refusal text instead of HTML must end as `invalid_page` with the reason, not crash. (Task 2)
2. A retry prompt must carry every rejection code and message, or the second answer repeats the mistake. (Task 2)
3. `change` must never lose the page: when both attempts are rejected, the result is a failure and the caller keeps the current page; the generator must not return the current page as if it were new. (Task 2)
4. A screenshot that sharp cannot read must not fail the generation; it degrades to a text-only call. (Task 2)
5. The brief in the prompt must be exactly the validated brief: a caller passing a wider object (with contacts) gets an error before any call, never a prompt carrying them. (Task 2)

---

### Task 1: Failure codes

**Files:** Modify `packages/shared-types/src/index.ts` (REV-136 block); Test `packages/validation/__tests__/mvp-page.spec.ts`

**Interfaces — Produces:** `export const MVP_PAGE_FAILURES = ['not_configured', 'call_failed', 'invalid_page'] as const; export type MvpPageFailure = (typeof MVP_PAGE_FAILURES)[number];` and `MvpPageFailureSchema = z.enum(MVP_PAGE_FAILURES)` in validation.

- [ ] **Step 1:** Move REV-137 to **In Progress**. Write failing test: `MvpPageFailureSchema` accepts the three codes, rejects `'timeout'`.
- [ ] **Step 2:** `npx vitest run packages/validation/__tests__/mvp-page.spec.ts` → FAIL.
- [ ] **Step 3:** Add the constant, type and schema; `npm run build:packages`.
- [ ] **Step 4:** Same test → PASS. **Commit** `feat(REV-137): page generation failure codes`.

### Task 2: `MvpPageGenerator`

**Files:**
- Create `apps/workers/src/services/mvp-page-generator.ts`
- Test `apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`
- Fixtures `apps/workers/src/services/__tests__/fixtures/page-gen/answers/`: `fenced.txt` (VALID inside ```` ```html ```` fence), `with-script.html` (VALID plus `<script>`), `apology.txt` ("I'm sorry, I can't…")

**Interfaces:**
- Consumes: `IMvpSourceBrief`, `MvpSourceBriefSchema`, `IMvpTheme`, `IMvpGroundingFlag`, `IMvpPageProblem`, `MvpPageFailure`; `checkMvpPage`, `checkMvpGrounding` (REV-136); `LlmClient`, `resolveDefaultProvider`, `LlmUsage`, `LlmProvider`; `findExecutable`; `ImageService.tilesForVision`; `env`.
- Produces:
  ```ts
  export const MVP_PAGE_SYSTEM_PROMPT: string;
  export type PageLlm = Pick<LlmClient, 'completeWithUsage' | 'unavailableReason' | 'modelName' | 'provider'>;
  export function pageProvider(): LlmProvider | undefined; // VISION_LLM_PROVIDER ?? resolveDefaultProvider() ?? CLI if found
  export function stripCodeFence(text: string): string;
  export interface MvpPageInput { brief: IMvpSourceBrief; screenshot?: Buffer }
  export interface MvpPageChangeInput extends MvpPageInput { currentPage: string; instruction: string }
  export type MvpPageResult =
    | { ok: true; page: string; theme: IMvpTheme; grounding: IMvpGroundingFlag[]; attempts: number; modelUsed: string; provider?: LlmProvider; usage?: LlmUsage }
    | { ok: false; reason: MvpPageFailure; message: string; problems?: IMvpPageProblem[]; modelUsed: string; provider?: LlmProvider; usage?: LlmUsage };
  export class MvpPageGenerator {
    constructor(options?: { provider?: LlmProvider; model?: string; client?: PageLlm });
    unavailableReason(): string | undefined;
    generate(input: MvpPageInput): Promise<MvpPageResult>;
    change(input: MvpPageChangeInput): Promise<MvpPageResult>;
  }
  export const mvpPageGenerator: MvpPageGenerator;
  ```

**`MVP_PAGE_SYSTEM_PROMPT` must say** (the test asserts each marked ✓ phrase is present):
- Role: you redesign a small business's home page as one modern, responsive page; you decide layout, sections and visual style freely.
- Output: exactly one complete HTML document from `<!DOCTYPE html>` to `</html>`, no prose, no markdown ✓`<!DOCTYPE html>`.
- Copy: only from the brief's `copy`, `services` and `business`; reword lightly or use synonyms; never add facts: no numbers, years, prices, ratings, awards, certifications, names or testimonials that are not in the brief ✓`never add facts`.
- Contacts: never write a phone, email or address; use the placeholders listed in the brief, in text or as the whole `href` ✓`{{phone}}`; the booking call to action is `href="{{booking}}"`; never use `id="booking"`, a form is added for you.
- Theme: declare in `:root` and use for every color and font ✓ each of the seven `MVP_THEME_VARS` names; start from the brand colors.
- Allowed: plain HTML content elements, inline `<style>`, inline SVG icons, Google Fonts `<link>`s; images only from the brief's `images` and `brand.logoUrl` ✓`only these images`.
- Forbidden: scripts, event attributes, forms and inputs, iframes, video/audio, `<template>`, `<noscript>`, other external resources, `data:` URLs.
- One `<h1>`; `<html lang>` = the brief's language (English when none) ✓`lang`.
- Responsive (no horizontal scroll at 360 px), WCAG AA contrast, semantic landmarks (`header`, `main`, `footer`).
- The screenshot shows the current site: keep the brand recognizable, fix what looks dated or hard to use.

**User prompt:** `Brief (JSON):\n${JSON.stringify(MvpSourceBriefSchema.parse(brief))}` + a line naming the placeholders + a line stating whether screenshots follow. `change` adds `\n\nCurrent page:\n${currentPage}\n\nOperator's change: ${instruction}\nReturn the whole page with the change applied; keep everything else.` A retry appends `\n\nYour previous answer was rejected:\n- <code>: <message>` per problem, `\nAnswer again with the whole page, fixing all of these.`

- [ ] **Step 1: Write fixtures and failing tests**, with a stub `PageLlm` that returns queued answers (or throws) and records each request:
  - `generate` with VALID → `{ ok: true, attempts: 1, theme: …seven values }`, `page === VALID.trim()`, `grounding` an array; one request: system prompt is `MVP_PAGE_SYSTEM_PROMPT`, user prompt contains the brief JSON and `{{phone}}`, temperature 0.7.
  - `MVP_PAGE_SYSTEM_PROMPT` contains every ✓ phrase above and all seven theme variable names.
  - `fenced.txt` → accepted; `stripCodeFence` unit cases: fence with and without `html` tag stripped; text before a fence left as is.
  - `with-script.html` then VALID → `ok: true, attempts: 2`; second request's user prompt contains `page:script` and its message; temperature 0.3.
  - `with-script.html` twice → `{ ok: false, reason: 'invalid_page' }`, `problems[0].code === 'page:script'`, two requests.
  - `apology.txt` twice → `invalid_page` with `page:parse`.
  - stub whose `unavailableReason()` returns text → `not_configured`, zero requests.
  - throws twice → `call_failed`, message has the error; throws then `with-script.html` → `invalid_page`.
  - `change`: request contains the current page and the instruction; both rejected → `ok: false` (no `page` property).
  - with a real 1440×4000 PNG made by sharp in the test → `images.length === 3`, `mediaType 'image/webp'`; with `Buffer.from('not a png')` → zero images, still `ok: true`, prompt says no screenshot.
  - a brief carrying an extra `contacts` key is a caller's bug, not a model failure: `generate` throws the Zod error before any call (`rejects.toThrow()`, zero requests).
- [ ] **Step 2:** `npx vitest run apps/workers/src/services/__tests__/mvp-page-generator.spec.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement per the interfaces and decisions.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5: Commit** `feat(REV-137): the model designs the page, gated by the page checks`

### Task 3: Dev script and real-site check

**Files:** Create `scripts/generate_mvp_page.ts`

Usage: `npx tsx scripts/generate_mvp_page.ts [--record <dir>] [--provider <id>] [--model <id>] <out-dir> <url...>`. Per URL: `browserService.captureFullAudit(url)` → `BrandExtractorService.processBrandData(raw, host)` → `buildMvpSourceBrief` (lead: host as name, niche `OTHER`, URL) → `generate({ brief, screenshot: desktopFullBuffer })`. On success write `<out>/<host>.raw.html` and `<out>/<host>.html` (`finishMvpPage` with `verifiedContacts`, `buildMvpSeo` from the audit data, the theme) and print attempts, model, tokens, grounding flags, `checkMvpStandards(finished).score`. On failure print the reason and problems. `--record <dir>` writes `<dir>/<host>.json` `{ url, brief, answers: [raw texts], result }`. No database, storage or queue. Usage errors exit 1.

- [ ] **Step 1:** Write the script; `npx tsc --noEmit -p tsconfig.json` (or the repo's script typecheck via `npm run typecheck`) passes.
- [ ] **Step 2:** Run it on 3 real sites (one Polish, one English, one dated) with the configured vision provider; save outputs in the scratchpad. Open each finished page in a browser at 1440 and 390 widths. Note per site on REV-137: attempts, rejection codes, flags, standards score, a one-line look verdict.
- [ ] **Step 3:** If a rejection code repeats across sites, adjust `MVP_PAGE_SYSTEM_PROMPT` (never the checks), re-run, and add the case as a fixture test.
- [ ] **Step 4: Commit** `feat(REV-137): dev script to generate a page for real sites`

### Task 4: Gates, PR, ticket

- [ ] All gates: `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test`, `npm run build`. No dashboard flow changes (nothing wired), say so in the PR.
- [ ] Push; `gh pr create` titled `feat(REV-137): MvpPageGenerator with prompt, retry and recorded-answer tests`, body `Fixes [REV-137](…)`, Problem / Changes / Verification (commands, results, the real-site table), Claude Code attribution.
- [ ] Link the PR on REV-137, move to **In Review**; comment that docs land in REV-142.
- [ ] Merge per AGENTS.md §4.3 step 5, `npm test` on `main`, REV-137 → **Done**.
