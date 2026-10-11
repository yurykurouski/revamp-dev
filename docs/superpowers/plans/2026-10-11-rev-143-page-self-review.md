# REV-143 Visual self-review of the MVP page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a generated page passes `checkMvpPage`, optionally render it (finished) at 1440 px and 390 px, send both captures and the page to the model for one revision, and keep the revision only if it passes the same checks. The feature sits behind `MVP_PAGE_SELF_REVIEW` (off by default). Then measure it on real sites and decide the default.

**Architecture:** `MvpPageGenerator.generate` takes an optional `review: RenderPage` per call. The generator stays free of Playwright and finishing. With no `review`, behavior is exactly as today. A new `mvp-page-review.ts` builds the renderer from the finish context: it runs `finishMvpPage` without the tracker and calls `browserService.captureHtmlScreenshot` (new `fullPage` option) at two widths. `ai.worker` passes the renderer only when the flag is on. `scripts/generate_mvp_page.ts --self-review` measures the first page and the revision from the same run.

**Tech Stack:** TypeScript, Vitest, Playwright (Chromium), sharp (`ImageService.tilesForVision`), Zod env schema.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` (§2 "Generation strategy", approach C; §3.2; §11 item 8) and Linear REV-143.

## Global Constraints

- Flag `MVP_PAGE_SELF_REVIEW`, default **off**, documented in `.env.example`. It is parsed like `MVP_COMPLETENESS_LLM`: `false`/`0`/`no`/`off`/empty mean off. `z.coerce.boolean` must not be used.
- Capture widths: desktop **1440**, mobile **390** (ticket). Script measurement width for horizontal scroll: **360** (spec §3.2 prompt rule).
- One revision call at most, and no retry of the revision. A revision that fails `checkMvpPage` or a failed render or call keeps the first page. Self-review never turns a successful generation into a failure.
- The revision goes through the same `checkMvpPage(page, brief)`. Grounding and theme are recomputed from the page that is kept.
- No test calls a live model or a real site. Tests replay recorded answers through the `PageLlm` stub.
- The render must not load the tracker. `finish` is used without `publicApiUrl` or `trackingToken`.
- HITL unchanged. Contacts never reach the prompt: the render screenshots show filled contacts as pixels only. (Ruling R2 below covers this.)

## Rulings (for approval)

- **R1. Generate only, not `change`.** An operator waits on `/edit` against a deadline, and the review would double that wait. Regenerate goes through `generate`, so it gets the review. *Cost if wrong:* a later small change wires `review` into `change` with a deadline check.
- **R2. The captures are of the finished page**, so the model sees real contact lengths and the booking form. The prompt never contains contact text, but the pixels do. The model already sees the original site's screenshot with the same contacts, so nothing new leaks. *Alternative:* render the raw page, which would show `{{phone}}` text and no booking form.
- **R3. The outcome is not persisted.** It is logged by `ai.worker`, returned in the job result, and printed by the script. No schema or dashboard change. *Cost if wrong:* a follow-up adds a field on `MvpProject`.
- **R4. The original site's screenshot is not resent on the revision call**, only the page's own captures (desktop ≤ 2 tiles, mobile ≤ 3 tiles). This keeps tokens down.
- **R5. Default after measurement:** the default turns on only if, on ≥ 5 sites, the revision never lowers the standards score, never adds axe violations, and removes at least one horizontal-scroll or contrast problem, at an acceptable time and token cost. Otherwise it stays off. The numbers and the decision go on the ticket.

## Review Focus

1. **A render that hangs or throws** (Chromium crash, a remote image that never loads): expect a `failed` outcome, the first page kept, and the job not failed. Test in Task 2.
2. **A revision that is the first page unchanged** (the model found nothing): expect `unchanged`, no second grounding pass, the first page kept. Test in Task 2.
3. **A revision answer wrapped in a code fence or followed by prose:** it goes through `stripCodeFence` and the checks like any answer. Fenced passes; prose gives `rejected`. Test in Task 2.
4. **The first generation fails or needs its retry:** the review runs only after an accepted page, also after an accepted retry, and never on a failure. Test in Task 2.
5. **Flag on but the lead has no verified contacts:** finishing still works. The renderer passes the same `finish` that publish uses. Test in Task 3 with an empty `contacts`.

---

### Task 1: Env flag and full-page HTML capture

**Files:**
- Modify: `apps/workers/src/config/env.ts` (add the flag next to `MVP_COMPLETENESS_LLM`, and share its preprocess as a local `envFlag(defaultValue)` helper used by both)
- Modify: `apps/workers/src/services/browser.service.ts:590-620` (`captureHtmlScreenshot` options gain `fullPage?: boolean`, default `false`)
- Modify: `.env.example` (after `MVP_COMPLETENESS_LLM_TIMEOUT_MS`)
- Test: `apps/workers/src/config/__tests__/env.spec.ts`, `apps/workers/src/services/__tests__/browser.service.spec.ts`

**Interfaces:**
- Produces: `env.MVP_PAGE_SELF_REVIEW: boolean`. Produces `browserService.captureHtmlScreenshot(html, { width?, height?, deviceScaleFactor?, fullPage? }): Promise<Buffer>`.

- [ ] **Step 1: Failing tests**
  - `env.spec.ts` › `'MVP_PAGE_SELF_REVIEW is off by default and reads "false" as off (REV-143)'`: the schema parse of `{}` → `false`; `'true'` → `true`; `'false'`, `'0'`, `'off'`, `''` → `false`. Use the same parse helper the file already uses.
  - `browser.service.spec.ts` › `'captureHtmlScreenshot takes a full-page capture when asked (REV-143)'`: call with `{ width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true }`. Assert `newContext` was called with `viewport { width: 1440, height: 900 }`, `isMobile: false`. Assert `page.screenshot` was called with `{ fullPage: true }`. A second call without the option → `{ fullPage: false }`.
- [ ] **Step 2: Run** `npx vitest run apps/workers/src/config/__tests__/env.spec.ts apps/workers/src/services/__tests__/browser.service.spec.ts` (from the repo root). Expected: the two new tests FAIL.
- [ ] **Step 3: Implement** the flag (`MVP_PAGE_SELF_REVIEW: envFlag(false)`), the `fullPage` passthrough, and the `.env.example` lines:
  ```
  # Visual self-review of the MVP page (REV-143): render the accepted page at 1440 and 390 px and let the model
  # revise it once from the captures; a revision that fails the checks is dropped. Costs one more vision call.
  MVP_PAGE_SELF_REVIEW=false
  ```
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-143): MVP_PAGE_SELF_REVIEW flag and full-page HTML capture`

### Task 2: The revision pass in `MvpPageGenerator.generate`

**Files:**
- Modify: `apps/workers/src/services/mvp-page-generator.ts`
- Create: `apps/workers/src/services/__tests__/fixtures/page-gen/answers/revised.html` (`valid-page.html` plus one mobile fix: a trailing `@media (max-width: 480px) { … }` rule inside its `<style>`; it must still pass `checkMvpPage(…, BRIEF)`)
- Test: `apps/workers/src/services/__tests__/mvp-page-generator.spec.ts` (new `describe('MvpPageGenerator self-review (REV-143)')`)

**Interfaces:**
- Produces, exported from `mvp-page-generator.ts`:
  ```ts
  export interface PageShots { desktop: Buffer; mobile: Buffer }   // full-page PNGs at 1440 and 390 px
  export type RenderPage = (page: string, theme: IMvpTheme) => Promise<PageShots>;
  export interface MvpPageGenerateInput extends MvpPageInput { review?: RenderPage }
  export type MvpPageReview =
    | { outcome: 'revised'; firstPage: string }
    | { outcome: 'unchanged' }
    | { outcome: 'rejected'; problems: IMvpPageProblem[] }
    | { outcome: 'failed'; message: string };
  export const MVP_PAGE_REVIEW_PROMPT: string;   // the revision task appended to the user prompt
  ```
  `generate(input: MvpPageGenerateInput)`. The `ok: true` result gains `review?: MvpPageReview`, present only when `review` was passed. `change` is unchanged (R1).
- Behavior: once a page is accepted (first call or retry) and `input.review` is set, the generator calls `review(page, theme)` and cuts each capture into tiles with `ImageService.tilesForVision(png, { maxTiles })`, using `REVIEW_TILES = { desktop: 2, mobile: 3 }`. It then makes one call: system `MVP_PAGE_SYSTEM_PROMPT`; user = the same base user prompt *without* the original-site screenshot line + `MVP_PAGE_REVIEW_PROMPT` + `\n\nYour page:\n<page>`; images = the desktop tiles then the mobile tiles; temperature `0.3`; the same `maxTokens`; timeout `min(TIMEOUT_MS, deadline left)`. The answer goes through `stripCodeFence(...).trim()` and `checkMvpPage(…, brief)`:
  - it passes and differs from the first page → returned `page`, `theme` and `grounding` (recomputed) come from the revision, with `review: { outcome: 'revised', firstPage }`;
  - it passes and is identical → the first page, `review: { outcome: 'unchanged' }`;
  - it fails the checks → the first page, `review: { outcome: 'rejected', problems }`;
  - the render, the tiling or the call throws → the first page, `review: { outcome: 'failed', message }` (cut to `MESSAGE_CHARS`), with a `console.warn`.
  
  `attempts` still counts generation calls only. `answers` gets the revision answer appended. `usage` adds the revision call.
- `MVP_PAGE_REVIEW_PROMPT` must contain these phrases (tested): `1440 px`, `390 px`, `horizontal scroll`, `contrast`, `Keep the design`, `answer with the page unchanged`. Suggested text: "The images are your page as rendered: first at 1440 px wide (desktop), then at 390 px wide (mobile), each top to bottom. Review it as a designer and fix only what is visibly wrong: horizontal scroll or content cut off on mobile, overlapping or clipped text, text with too little contrast, stretched or broken images, empty or collapsed sections. Keep the design, the copy, the images and the placeholders; every rule above still applies. If nothing needs fixing, answer with the page unchanged. Answer with the whole page."

- [ ] **Step 1: Failing tests** (stub as in the file; `render = vi.fn(async () => ({ desktop: png1440, mobile: png390 }))`, where the PNGs come from sharp `create`, 1440×4000 and 390×6000, white):
  - `'flag off: no review, one call, no render'`: `generate({ brief: BRIEF })` with queue `[VALID]` → `requests` length 1, `result.review` undefined.
  - `'revision accepted'`: queue `[VALID, REVISED]` → `ok`, `page === REVISED.trim()`, `review` = `{ outcome: 'revised', firstPage: VALID.trim() }`, `attempts: 1`, `answers` `[VALID, REVISED]`, `usage.totalTokens` 60. `render` was called once with `(VALID.trim(), theme)` where `theme.primary === '#0a5c8a'`. Request 2: `temperature` 0.3, `images` length 2 + 3 = 5, `userPrompt` contains `MVP_PAGE_REVIEW_PROMPT` and `'Your page:'` and `VALID.trim().slice(0, 200)`, and does not contain `'screenshots of the current home page follow'`.
  - `'revision rejected: first page kept'`: queue `[VALID, WITH_SCRIPT]` → `page === VALID.trim()`, `review.outcome 'rejected'`, `review.problems[0].code === 'page:script'`.
  - `'revision unchanged'`: queue `[VALID, VALID]` → `review` `{ outcome: 'unchanged' }`, `page === VALID.trim()`.
  - `'revision in a code fence is accepted'`: queue `[VALID, '```html\n' + REVISED + '\n```']` → `outcome 'revised'`.
  - `'render fails: first page kept, no revision call'`: `render` rejects with `Error('Chromium crashed')` → `requests` length 1, `review` `{ outcome: 'failed', message: expect.stringContaining('Chromium crashed') }`, `ok: true`.
  - `'revision call fails: first page kept'`: queue `[VALID, new Error('timed out')]` → `ok: true`, `outcome 'failed'`.
  - `'review runs after an accepted retry, never after a failure'`: queue `[WITH_SCRIPT, VALID, REVISED]` → `attempts 2`, `outcome 'revised'`, 3 requests. Queue `[WITH_SCRIPT, WITH_SCRIPT]` → `ok: false`, `render` not called.
  - `MVP_PAGE_REVIEW_PROMPT` phrase test (the list above).
- [ ] **Step 2: Run** `npx vitest run apps/workers/src/services/__tests__/mvp-page-generator.spec.ts`. Expected: the new tests FAIL. The REV-137 tests still pass.
- [ ] **Step 3: Implement.** Split `run` so that the accepted-page branch returns through a private `reviewPage(accepted, ctx)` when `review` is set. Build the base user prompt once; the original-screenshot sentence is appended separately, so the review call can leave it out.
- [ ] **Step 4: Run** the same command. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(REV-143): one visual self-review call after an accepted page`

### Task 3: The renderer and the worker wiring

**Files:**
- Create: `apps/workers/src/services/mvp-page-review.ts`
- Modify: `apps/workers/src/workers/ai.worker.ts` (use `pageContext(leadData, auditData)` for `brief` and `finish`; pass `review` only when `env.MVP_PAGE_SELF_REVIEW`; log the outcome; add `review: result.review?.outcome` to the job's return value)
- Test: `apps/workers/src/services/__tests__/mvp-page-review.spec.ts`, `apps/workers/src/workers/__tests__/ai.worker.spec.ts`

**Interfaces:**
- Consumes: `RenderPage`, `PageShots` (Task 2); `captureHtmlScreenshot(..., { fullPage })` (Task 1); `pageContext` / `MvpFinishContext` (existing).
- Produces:
  ```ts
  export const REVIEW_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
  export function pageReviewRenderer(
    finish: Omit<MvpFinishContext, 'theme' | 'controls'>,
    browser: Pick<BrowserService, 'captureHtmlScreenshot'> = browserService,
  ): RenderPage;
  ```
  The renderer calls `finishMvpPage(page, { ...finish, theme, publicApiUrl: undefined, trackingToken: undefined })` (written so that neither key is present) and then makes two `captureHtmlScreenshot` calls, desktop then mobile, each with `deviceScaleFactor: 1, fullPage: true`.

- [ ] **Step 1: Failing tests**
  - `mvp-page-review.spec.ts` › `'renders the finished page at 1440 and 390 px, full page'`: a fake browser records `(html, options)`. `finish` has `contacts: { phone: '+48 600 100 200' }`, `publicApiUrl: 'https://api.revamp.test/api/v1'`, and the `theme` from the fixture. Assert two calls with options `{ width: 1440, height: 900, deviceScaleFactor: 1, fullPage: true }` and `{ width: 390, height: 844, deviceScaleFactor: 1, fullPage: true }`. Assert the html contains `+48 600 100 200`, contains no `{{phone}}`, and does not contain `api.revamp.test` (no tracker). Assert the result is `{ desktop, mobile }` in that order.
  - `'renders a lead with no verified contacts'`: `contacts: {}` and a page using only `{{booking}}` → resolves, with the booking form present (`id="booking"`).
  - `ai.worker.spec.ts` › `'passes a review renderer only when MVP_PAGE_SELF_REVIEW is on (REV-143)'`: set `env.MVP_PAGE_SELF_REVIEW = false` → the `generate` argument has no `review`. Set it to `true` → `typeof arg.review === 'function'`. Restore the flag in `afterEach`. Also `'returns the review outcome'`: the mocked `generate` resolves `{ …ok result, review: { outcome: 'rejected', problems: [] } }` → the job result has `review: 'rejected'`, and the deploy job carries the first page (the result's `page`).
- [ ] **Step 2: Run** `npx vitest run apps/workers/src/services/__tests__/mvp-page-review.spec.ts apps/workers/src/workers/__tests__/ai.worker.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pageReviewRenderer` and the worker wiring.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-143): render the finished page for the review and wire it behind the flag`

### Task 4: `--self-review` in the dev script, and measurement on real sites

**Files:**
- Modify: `scripts/generate_mvp_page.ts`

**Interfaces:**
- Consumes: `pageReviewRenderer`, `MvpPageReview`, `checkMvpStandards`, `axeService.scanPage`, `browserService.getBrowser`.
- The script adds a `--self-review` option and passes `review: pageReviewRenderer(finish)`, using the `finish` it already builds (refactored to build `finish` before `generate`). For each URL it measures the kept page and, on `revised`, the first page too, each one finished. It writes `<host>.first.html` on `revised`. Per page, a local `measure(html)` reports:
  - standards (`checkMvpStandards`);
  - axe violation count (`axeService.scanPage` after `setContent` at 1440 px);
  - horizontal scroll at 360 px: `document.documentElement.scrollWidth > window.innerWidth` after `setContent` with viewport 360×800.

  Its output line is `host: review <outcome> | first: standards S, axe A, hscroll360 yes/no | kept: … | Ns, P+C tokens`. Without `--self-review` the output is unchanged apart from these measurements for the one page. `--record` still saves every answer, the revision included. Update the usage line and the header comment.

- [ ] **Step 1:** Implement, then run `npm run typecheck` and `npm run lint`. Expected: clean.
- [ ] **Step 2: Measure** (live model, read-only) on at least 5 real sites from the dev data or known test sites:
  `npx tsx scripts/generate_mvp_page.ts --self-review --record <scratch>/rec <scratch>/out <url1> … <url5>`.
  Record per site: outcome, standards first→kept, axe first→kept, hscroll360 first→kept, seconds, and the tokens of the revision. Save the recordings of one `revised` site and one `rejected` site, if any occur, as the source for a later fixture refresh (optional; the Task 2 fixtures already cover the paths).
- [ ] **Step 3:** Post the table and the R5 decision as a comment on REV-143. If the decision is "on", change the default to `envFlag(true)` and `.env.example` to `true`, and update the env test.
- [ ] **Step 4: Commit** `feat(REV-143): --self-review in generate_mvp_page with first/kept measurements`

### Task 5: Docs and gates

**Files:**
- Modify: `AGENTS.md` §3.2 (the MVP page bullet): one sentence on the self-review. "With `MVP_PAGE_SELF_REVIEW` on, `generate` renders the accepted page finished (`pageReviewRenderer`, 1440 and 390 px) and makes one revision call with the captures; the revision passes `checkMvpPage` or the first page is kept (`MvpPageReview` outcome); `change` is not reviewed." Also add `--self-review` to the script usage there.
- Modify: `README.md` (env var table or list, and the script usage line).
- After merge: `../Revamp-docs` `spec.md` and `blueprint.md` (the generation step and env), `AGENTS.md` (the revision prompt), `milestones.md` (tick). Commit as `docs(REV-143): …`.

- [ ] **Step 1:** Edit the docs.
- [ ] **Step 2: Gates** (repo root): `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures), `npm run build`. All must pass.
- [ ] **Step 3: End to end:** run the stack with `MVP_PAGE_SELF_REVIEW=true`, Add lead on a fresh URL, check the workers log for the review outcome, then open the lead's Prototype step in Chrome (chrome-devtools MCP). The page must be published with no new console errors. Restore the flag afterwards.
- [ ] **Step 4: Commit** `docs(REV-143): self-review flag in AGENTS.md and README`
