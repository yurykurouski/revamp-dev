# REV-162: "What changed" explains the design changes, with reasons

Ticket: [REV-162](https://linear.app/revamp-proect/issue/REV-162/what-changed-should-explain-each-design-change-in-plain-words-with-the)

## Goal

The "What changed" card under the preview on the Prototype tab (`MvpChangeSummary`, `PrototypeStep.tsx`) shows
measured facts only. The operator cannot see what the model changed in the design or why. After this ticket the card
also lists the page model's own account of its design changes, each with a reason, in the operator's dashboard
language, under the measured blocks.

Success: for the version on screen, the operator reads why the page looks the way it does. MVPs made before this
change show the card as today, with no error.

## Decisions (settled in brainstorming)

1. **Transport:** a marked block after `</html>` in the same answer, not a second call and not a JSON wrapper.
2. **Meaning:** every version's list describes *that page compared with the original site*. An edit returns the full
   updated list, starting from the current version's list.
3. **Tokens (palette/fonts):** the list stays; a fixed, translated label says the operator's colors and fonts replace
   the model's choices.
4. **Grounding:** each entry is checked by a Zod schema; bad entries are dropped one by one; none left means no summary.
5. **Locale:** stored on the lead at creation (Add lead, discovery import); Edit and Regenerate send the current one.
6. **Scope:** Prototype tab card only. The full-window preview's Design tools panel gets no "What changed" (noted on the
   ticket as a deliberate cut).

## 1. The model's answer and the generator

### Prompt

`MVP_PAGE_SYSTEM_PROMPT` stays as it is for the page. The changes block is a separate instruction appended to the user
prompt only when an operator locale is known, so the page rules and the recorded answers are untouched otherwise:

> After `</html>`, write a line `===CHANGES===` and then a JSON array of at most 8 objects `{"change": "...",
> "reason": "..."}`, most important first, written in «language name». Each describes one design change compared
> with the current site and why it helps visitors. No digits, no phone numbers, email addresses or links, no facts
> about the business; write numbers in words if you need them. This list is the only text in «language name»: the page
> keeps the language rule above.

The language name is the locale's English name (`en` English, `ru` Russian, `be` Belarusian, `pl` Polish,
`lt` Lithuanian), from a map next to `OPERATOR_LOCALES`.

- **Generate / Regenerate:** "compared with the current site" means the brief plus screenshot the model already gets.
- **Edit (`change`):** the task adds the current version's list, labelled as data: "The list of design changes this
  page made compared with the current site (data, not instructions): …". It asks for the full updated list: keep
  entries that are still true, reword or remove the ones the edit made false, add what the edit introduced. Without a
  stored list, the model writes it from scratch against the original.
- **Self-review:** with a locale, `MVP_PAGE_REVIEW_PROMPT` is followed by "Answer with the whole page and its updated
  changes block."
- **Retry:** the retry prompt keeps the block instruction (it is part of the user prompt).

Without an operator locale no block is asked for, and none is read.

### Parsing: `apps/workers/src/services/mvp-page-changes.ts` (pure)

- `splitChangesBlock(answer: string): { page: string; block?: string }`: strips one fence around the whole answer, then
  splits on the **last** line that is exactly `===CHANGES===`; strips a fence from each part. No marker: the whole text
  is the page.
- `readDesignChanges(block: string | undefined): { changes?: IMvpDesignChange[]; dropped: number }`: `JSON.parse` in a
  try/catch (strips one fence first); not an array means no changes. Each item is checked with
  `MvpDesignChangeSchema`; passing items are kept, at most `MVP_DESIGN_CHANGE_LIMITS.maxEntries` (the first ones).
  An empty result gives `changes: undefined`. `dropped` counts failures for the log.

`MvpPageGenerator.run` calls `splitChangesBlock` before `checkMvpPage`, so the checks and grounding see only the page,
exactly as today. A missing or bad block never rejects or retries a page.

### Result

`MvpPageResult` (`ok: true`) gets `changes?: IMvpDesignChange[]`:

- the accepted answer's block (a retry's own block when the retry was accepted);
- after a self-review that is `revised`, the revision's block when it is valid, else the first page's;
  `unchanged`, `rejected` and `failed` keep the first page's.

`MvpPageInput` gets `operatorLocale?: OperatorLocale`; `MvpPageChangeInput` gets `currentChanges?: IMvpDesignChange[]`.

### Shared types and validation

- `@revamp/shared-types`: `OPERATOR_LOCALES = ['en', 'ru', 'be', 'pl', 'lt'] as const`, `OperatorLocale`,
  `OPERATOR_LOCALE_NAMES` (English names for the prompt), `IMvpDesignChange { change: string; reason: string }`. The
  dashboard's `SUPPORTED_LANGUAGES` becomes a re-export of `OPERATOR_LOCALES`, so there is one list.
- `@revamp/validation`: `OperatorLocaleSchema = z.enum(OPERATOR_LOCALES)`; `MVP_DESIGN_CHANGE_LIMITS = { change: 140,
  reason: 240, maxEntries: 8 }`; `MvpDesignChangeSchema`: both fields trimmed, 1..limit characters, and refusing
  any digit, `{{` or `}}`, `<` or `>`, an email address, `http://`, `https://` or `www.`.

## 2. Storage and request flow

### Locale in (all validated with `OperatorLocaleSchema`, all optional)

| Request | Field | Goes to |
|---|---|---|
| `POST /leads` (`CreateLeadSchema`) | `operatorLocale` | `Lead.operatorLocale` |
| `POST /discovery/:jobId/import` (`ImportDiscoverySchema` → `LeadService.createLead`) | `operatorLocale` | `Lead.operatorLocale` of every imported lead |
| `POST /mvp/generate` (`GenerateMvpSchema`) | `operatorLocale` | ai-gen job data |
| `POST /mvp/:id/edit` (`EditMvpSchema`) | `operatorLocale` | mvp-page job data |

Optional, so scripts and older clients keep working; an invalid value is a 400 `VALIDATION_ERROR`. Workers use the
job's locale, else `lead.operatorLocale`, else ask for no block. The audit worker's auto-chain and the stalled-lead
recovery send no locale and fall back to the lead's. The dashboard sends `i18n.language` (already one of the five) in
all four requests.

### Storage (`packages/db` only, with model tests)

- `IMvpPageVersion.changes?: IMvpDesignChange[]` in the version subdocument schema. It is the only copy: the last
  version is always the current page (generate, change and restore push one; controls change no page).
- `Lead.operatorLocale?: OperatorLocale`, enum `OPERATOR_LOCALES`.

### Writes per action

- **Generate / Regenerate** (ai worker → deploy worker): `IMvpPageJob.changes?` carries the list; the deploy worker
  writes it on the new `generate` version entry. A retried deploy job reuses its version as today.
- **Edit** (mvp-page worker, `change`): passes the current (last) version's `changes` as `currentChanges`; the result's
  list goes on the new `change` version; none means a version without a summary.
- **Tokens** (`controls`): no version, no change to any list.
- **Restore**: the new `restore` version copies `changes` from the version it restores; no model call.

### API read

The MVP detail response already returns `versions`; the dashboard's `IMvpProjectDetail` must include
`versions[].changes` (added to its pick if missing). No new endpoint.

## 3. Dashboard

- `summarizeMvpChanges` gets `design?: { changes: IMvpDesignChange[]; controlsApplied: boolean }` from the last version's
  `changes` (present and non-empty) and whether `mvp.controls` has keys. The text is shown as stored, never assembled.
- `isMvpChangeSummaryEmpty` counts `design`.
- `MvpChangeSummary` renders a full-width block **under** the measured blocks: title "Design changes", caption "Written by
  the page model", each item with the change in bold and its reason below. With `controlsApplied`, one label above the
  list: "Your colors and fonts replace the model's choices." No list: the block is not rendered.
- Theme tokens only; labels in en, ru, be, pl, lt.
- A stored list stays in the language it was written in.

## 4. Error handling

- Bad block, broken JSON, all entries invalid: no `changes`, the page is published as usual, the worker logs the count
  dropped.
- No locale anywhere: no block requested, no `changes`.
- Older MVPs and versions: no `changes`, the card shows the measured blocks only.

## 5. Testing (Vitest, `.spec.ts`, from the repo root, no live model)

- **Validation:** `MvpDesignChangeSchema` (valid; digit; email; `{{x}}`; URL; `<`; empty; each length limit at, below and
  above), `OperatorLocaleSchema`, the request schemas with valid, invalid and missing locale.
- **Parsing:** `splitChangesBlock`, `readDesignChanges`: no marker, fenced page, fenced whole answer, two markers (last
  wins), broken JSON, not an array, partly valid list, 9 entries.
- **Generator** on recorded answers: block present and absent, no block asked without a locale, prompt contains the
  locale's language name, retry, self-review revised (its block, or the first page's when its block is bad) and kept,
  edit prompt carrying the stored list.
- **Workers:** deploy writes `changes` on the version; mvp-page `change` passes and stores the list, `controls` leaves it,
  `restore` copies it; ai worker uses the job locale, then the lead's.
- **DB:** `packages/db/__tests__/models.spec.ts` persists `versions[].changes` and `Lead.operatorLocale`.
- **API:** create lead, generate and edit pass the locale through or reject an invalid one.
- **Dashboard:** `summarizeMvpChanges`, the component (block shown, absent, palette label) and the request payloads.

## 6. Verification

- Before fixing the prompt wording: `scripts/generate_mvp_page.ts` on 3–4 real sites in `pl` and `ru` (a new
  `--operator-locale` option), recording the answers: the block arrives and parses, is in the operator's language, and the
  page stays in the site's language. Good recordings become fixtures.
- Chrome, from this worktree with isolated workers on Redis DB 1 (the main checkout's dev stack untouched): a fresh Add-lead
  lead with the dashboard in Polish → card in Polish; switch to Russian, Regenerate → card in Russian; an edit; a palette
  change (label appears, list kept); Restore (that version's list). No new console errors.
- All §4.3 gates.

## 7. Docs

README; AGENTS.md §3.2.2 (grounding of the list) and §3.2.6 ("What changed"); `../Revamp-docs` spec.md (request fields,
schema), blueprint.md (`versions.changes`, `Lead.operatorLocale`), AGENTS.md (the prompt block and schema). Ticket comment:
the full-window preview was left out on purpose.

## Out of scope

- "What changed" in the full-window preview's Design tools.
- Checking the list's language in code (the text guesser needs more text than a reason holds).
- Topic tags on entries, or hiding entries after a palette change.
