# REV-140 Dashboard: Prototype step and Design tools for model-designed pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator reviews and changes a model-designed MVP in the dashboard. The Prototype step shows the facts to check and a "What changed" built only from measured values. The Design tools panel offers a free-text change, colors, fonts, versions with Restore, and Regenerate.

**Architecture:** One mutation hook sends the three page actions REV-139 added: `POST /edit`, `PATCH /tokens` and `POST /versions/:n/restore`. Each answer, applied or not, is kept per lead. Pure helpers in `utils/mvpPage.ts` hold every decision: seeds, contrast, the current font pairing, versions order and outcome texts, which keeps the components thin. Highlighting a fact inside the preview, which is served from another origin, uses a small message listener that `finishMvpPage` adds to the published page.

**Tech Stack:** React 18, MUI v6, React Query, react-i18next, Vitest with happy-dom (`.spec.ts` with `createElement`), and `@revamp/shared-types` / `@revamp/validation`.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md`. §7 is the dashboard; §6 lists the routes REV-139 shipped.

## Global Constraints

- The preview iframe stays `sandbox="allow-scripts allow-same-origin"` (`MvpPreviewFrame`, unchanged), and the preview version still comes from `mvpPreviewVersion`.
- **Theme tokens only:** no hard-coded hex or rgba in dashboard components (AGENTS.md §3.2.6). The one exception is a swatch that shows the stored color itself, as `MvpChangeSummary`'s `Swatch` already does.
- **i18n:**
  - Every new word is an i18n key in all five locales: en, ru, be, pl, lt. `i18n/__tests__/locales.spec.ts` requires the same keys everywhere and no empty texts.
  - A key whose only reader this ticket deletes is removed. Keys still read by code that REV-141 deletes (`mvpLayout.*`, `mvpChangeLog.*`) stay until then.
- **Tests:** dashboard tests are `.spec.ts` files using `React.createElement`, since `.spec.tsx` files are skipped. Run vitest from the repo root.
- **Design tools location:** `MvpDesignTools` remains the only place for these tools and is shared by the Prototype step and `/leads/:id/preview`.
- **"What changed" (spec §7.3):** measured facts only (standards, axe violations, LCP/CLS with the host, completeness). It shows no tuning codes and no model-written text.
- **Colors:**
  - Text needs at least `MVP_MIN_CONTRAST` (4.5) contrast on `bg` and on `surface`, computed with `contrastRatio` from `@revamp/validation`.
  - Fonts come only from `MVP_FONT_CHOICES`.
  - `null` clears a group.
- **Model-designed or not:** an MVP is model-designed exactly when it has a `theme`. One without a theme was made by the previous generator, and only Regenerate is offered for it.

## Review Focus

1. **The operator switches leads while an action runs.** The answer or error belongs to the lead it was asked for and never shows on another lead. Test in Task 2 (hook) and Task 5 (panel).
2. **504 `MVP_EDIT_TIMEOUT` on a job that was already running.** The MVP query is refetched so a late publish shows up, and the error text is the API's message. Test in Task 2.
3. **A color the operator is still typing** (`#12`, empty) **or contrast exactly at the boundary** (4.5 passes, 4.49 fails). No request is sent for an invalid or low-contrast set, and Apply says why. Test in Task 3 (helpers) and Task 4 (component).
4. **A flagged fact the preview cannot find,** including text that holds regex or quote characters or differs only in whitespace. The page script never throws and changes nothing when there is no match, and it normalizes whitespace. Test in Task 1.
5. **A previous-generator MVP that still has old data** (`colorPalette`, `layout`, a `rebuild:*` generation failure). It shows the previous-generator note and Regenerate only, with no controls. Its failure panel shows a generic text, never an i18n key. Tests in Tasks 5 and 6.

---

### Task 1: Show a fact in the published page (workers)

**Files:**
- Modify: `apps/workers/src/services/mvp-page-finish.ts`. Add `previewScript()` to the scripts at step 5.
- Test: `apps/workers/src/services/__tests__/mvp-page-finish.spec.ts`

**Interfaces:**
- Produces the message the page accepts: `{ type: 'REVAMP_SHOW_TEXT', text: string }`. The page scrolls the smallest element in `body` whose whitespace-normalized `textContent` contains the normalized `text` into view (`block: 'center'`), outlines it for 4 s (`outline: 3px solid` with the page's `var(--rv-accent)`, `outline-offset: 4px`) and sets `data-revamp-shown` on it while outlined. Any other message, text that is too short or not a string, or no match: nothing happens.
- Consumed by Task 6 (`showFactInPreview`).

- [ ] **Step 1: Write the failing tests**

  Load the finished page into happy-dom with `enableJavaScriptEvaluation: true` (memory: happy-dom runs MVP scripts), then dispatch `MessageEvent`s on `window`.
  - `'outlines the smallest element holding the flagged text'`: the page has `<p>Ponad  15 lat\ndoświadczenia</p>`. Post text `'15 lat doświadczenia'`. The `p` gets `data-revamp-shown`, and `scrollIntoView` (stubbed) is called once.
  - `'ignores text it cannot find, other messages and non-strings'`: post `'a(b[c"'`, then `{ type: 'OTHER', text: 'Ponad' }`, then `{ type: 'REVAMP_SHOW_TEXT', text: 42 }`. Nothing throws, no element has `data-revamp-shown`, and `scrollIntoView` is not called.
  - `'clears the outline after 4 s'` (fake timers): the attribute is gone after 4000 ms.

- [ ] **Step 2: Run them**, `npx vitest run apps/workers/src/services/__tests__/mvp-page-finish.spec.ts`. Expected: the 3 new tests FAIL.
- [ ] **Step 3: Implement `previewScript(): string` in `mvp-page-finish.ts`.**
  - An inline IIFE `<script>` that listens for `message`.
  - It finds the match by walking `document.body.querySelectorAll('*')` and keeping the last element whose normalized text contains the needle. Elements come in document order, so a descendant comes after its ancestor. Use plain string `includes`, never a RegExp.
  - Skip `script` and `style` elements, and do nothing for a needle under 2 characters.
- [ ] **Step 4: Run them.** Expected: PASS, and the rest of the file stays green. A determinism test may compare whole outputs: the script is constant, so it stays green.
- [ ] **Step 5: Commit** `feat(REV-140): the published page shows a flagged fact on request from the dashboard`

### Task 2: API client and the page-action hook

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/hooks/useLeads.ts`
- Test: `apps/dashboard/src/api/__tests__/client.spec.ts`, `apps/dashboard/src/hooks/__tests__/useLeads.spec.ts`

**Interfaces:**
- Produces in `client.ts`:
  - `export type IMvpPageResult = IMvpPageJobResult & { mvp: IMvpProjectDetail }`. This replaces `IMvpEditResult`, which is deleted.
  - `apiClient.editMvp(mvpId, instruction): Promise<IMvpPageResult>`
  - `apiClient.updateMvpTokens(mvpId, body: IMvpControlsUpdate): Promise<IMvpPageResult>`. Validate the body with `UpdateMvpTokensSchema.parse` before the request.
  - `apiClient.restoreMvpVersion(mvpId, n: number): Promise<IMvpPageResult>`, which calls `POST /mvp/:id/versions/:n/restore`.
  - Delete `updateMvpLayout` and `resetMvpDesign`, whose routes are gone. `generateMvp` no longer takes or sends `layout`.
- Produces in `useLeads.ts`:
  - `export type MvpPageActionVariables = { mvpId: string; leadId: string } & ({ action: 'change'; instruction: string } | { action: 'controls'; controls: IMvpControlsUpdate } | { action: 'restore'; version: number })`
  - `export const useMvpPageMutation = () => UseMutationResult<IMvpPageResult, Error, MvpPageActionVariables>`. On success it stores `result.mvp` as `['mvp', leadId]`. On an `ApiError` with status 504 it invalidates `['mvp', leadId]`.
  - Delete `useEditMvpMutation`, `useUpdateMvpTokensMutation`, `useUpdateMvpLayoutMutation`, `UPDATE_MVP_LAYOUT_MUTATION_KEY`, `UpdateMvpLayoutVariables`, `useResetMvpDesignMutation` and `mvpHasCustomDesign`. Delete `GenerateMvpVariables.layout`.
  - Keep `mvpRecordId` and `mvpPreviewVersion`.

- [ ] **Step 1: Write the failing tests**
  - client: `'restores a version by its number'` checks the URL `/mvp/mvp-1/versions/3/restore`, method POST and that `data` is returned. `'sends colors and fonts as the new tokens body'` checks the body `{ fonts: { heading: 'Lora', body: 'Lato' } }`. `'refuses low-contrast colors before any request'` checks that `fetch` is not called and the call rejects with a ZodError. `'does not send a layout on generate'`.
  - hook: `'stores the MVP the API returned'`; `'refetches the MVP after a 504, since the change may still publish'` (`invalidateQueries` spy called with `['mvp','lead-1']`); `'keeps a refusal as a result, not an error'` (an `applied:false, reason:'invalid_page'` answer resolves).
- [ ] **Step 2: Run them**, `npx vitest run apps/dashboard/src/api apps/dashboard/src/hooks`. Expected: the new tests FAIL. `npm run typecheck` fails in the components that use the deleted hooks; that is expected until Task 5.
- [ ] **Step 3: Implement** the client methods and the hook as specified. Delete the old tests of deleted client methods and hooks.
- [ ] **Step 4: Run them.** Expected: PASS for the specs above. Typecheck errors may remain in `MvpDesignTools.tsx`, `useLiveMvpLayout.ts`, `MvpGenerationFailure.tsx` and their specs; Tasks 5 and 6 fix those. Do not commit until the dashboard typechecks, so commit Tasks 2 and 5 together (Ruling: atomic compile).
- [ ] **Step 5:** commit together with Task 5.

### Task 3: Pure helpers for the page tools

**Files:**
- Create: `apps/dashboard/src/utils/mvpPage.ts`
- Test: `apps/dashboard/src/utils/__tests__/mvpPage.spec.ts`

**Interfaces (produces):**
```ts
export type MvpColorRole = 'primary' | 'accent' | 'bg' | 'surface' | 'text';
export const MVP_COLOR_ROLES: readonly MvpColorRole[];
export type MvpColors = Record<MvpColorRole, string>;
export function isModelDesigned(mvp: Pick<IMvpProjectDetail, 'theme'> | null | undefined): boolean;
/** The operator's saved colors over the page's theme, lowercase #rrggbb; null without a theme */
export function seedColors(mvp: Pick<IMvpProjectDetail, 'theme' | 'controls'> | null | undefined): MvpColors | null;
/** The audit's brand colors (primary, secondary, accent), valid #rrggbb only, lowercase, deduplicated, in that order */
export function brandColors(audit: Pick<IAuditDetail, 'colorPalette'> | null | undefined): string[];
/** Both ratios, rounded to 2 decimals for display; ok only when every color is #rrggbb and both reach MVP_MIN_CONTRAST */
export function colorContrast(colors: MvpColors): { onBg?: number; onSurface?: number; valid: boolean; ok: boolean };
/** The pairing the operator saved, or null for the page's own fonts */
export function currentFontChoice(mvp: Pick<IMvpProjectDetail, 'controls'> | null | undefined): MvpFontChoice['id'] | null;
/** Newest first; `current` is the highest n, the published page's version */
export function versionsNewestFirst(versions: IMvpProjectDetail['versions']): Array<Serialized<IMvpPageVersion> & { current: boolean }>;
export interface MvpText { key: string; values?: Record<string, string | number> }
/** What an action's answer says, as an i18n key under mvpPage.outcome */
export function pageResultText(action: 'change' | 'controls' | 'restore', result: IMvpPageJobResult): MvpText;
/** A lead's generation failure: page reasons by code; any other code (the previous generator's) a generic text */
export function generationFailureText(failure: { code: string; reason: string }): MvpText;
```

- [ ] **Step 1: Write the failing tests**
  - `seedColors`: controls `{ primary: '#AA0000' }` over theme, giving `primary '#aa0000'` with the other four from the theme. `null` for `{}` and for a legacy MVP with only `colorPalette`.
  - `brandColors`: `{ primary: '#0A5C8A', secondary: 'red', accent: '#0a5c8a' }` gives `['#0a5c8a']`.
  - `colorContrast`: `#767676` text on `#ffffff` bg and surface gives `ok: true, onBg: 4.54`. `#777777` gives `ok: false`. `#12` text gives `valid: false, ok: false` with no ratios.
  - `currentFontChoice`: `{ fontHeading: 'Lora', fontBody: 'Lato' }` gives `'editorial'`, a mismatched pair gives `null`, and no controls gives `null`.
  - `versionsNewestFirst`: `n` 1, 3, 2 gives 3, 2, 1, with only 3 `current`. `undefined` gives `[]`.
  - `pageResultText`:
    - `change` with `{applied:true, version:4}` gives `{ key: 'mvpPage.outcome.changed', values: { n: 4 } }`.
    - `controls` applied gives `mvpPage.outcome.controls`.
    - `restore` gives `mvpPage.outcome.restored` with `n`.
    - `unchanged` gives `mvpPage.outcome.unchanged`.
    - `{applied:false, reason:'invalid_page', message:'m'}` gives `{ key: 'mvpPage.outcome.refused.invalid_page', values: { message: 'm' } }`.
  - `generationFailureText`: `{ code: 'MVP_PAGE_UNAVAILABLE', reason: 'call_failed' }` gives `mvpFailure.page.call_failed`. `{ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:flat' }` gives `mvpFailure.page.previous`. An unknown page reason gives `mvpFailure.page.previous`.
  - `'every key the helpers return exists in en'`: walk the keys produced for all reasons and kinds and resolve each in `en`.
- [ ] **Step 2: Run them**, `npx vitest run apps/dashboard/src/utils/__tests__/mvpPage.spec.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** the helpers, and add the `mvpPage.outcome.*` and `mvpFailure.page.*` keys in all five locales:
  - `outcome`:
    - `changed`: "Published as version {{n}}."
    - `controls`: "Colors and fonts published."
    - `restored`: "Restored and published as version {{n}}."
    - `unchanged`: "Nothing changed."
    - `refused`:
      - `not_configured`: "No AI provider is configured, so nothing was changed."
      - `call_failed`: "The AI model did not answer: {{message}}"
      - `invalid_page`: "The AI's page did not pass the checks, so nothing was published: {{message}}"
      - `unusable_version`: "This version no longer fits the audit: {{message}}"
  - `mvpFailure.page`:
    - `not_configured`: "No AI provider is configured for page generation."
    - `call_failed`: "The AI model did not answer."
    - `invalid_page`: "The AI's page did not pass the checks twice, so nothing was published."
    - `previous`: "The previous generator could not make the page."
  - `mvpFailure.tryAgain`: "Try again"
- [ ] **Step 4: Run them**, then the locales spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-140): helpers for colors, fonts, versions and outcomes of a model-designed page`

### Task 4: The four new controls

**Files:**
- Create in `apps/dashboard/src/components/leadReview/`:
  - `MvpColorControls.tsx`
  - `MvpFontControl.tsx`
  - `MvpVersionList.tsx`
  - `MvpGroundingFlags.tsx`
- Test in `apps/dashboard/src/components/__tests__/`:
  - `MvpColorControls.spec.ts`
  - `MvpFontControl.spec.ts`
  - `MvpVersionList.spec.ts`
  - `MvpGroundingFlags.spec.ts`

**Interfaces (produces; all props plain, no data fetching):**
- `MvpColorControls { seed: MvpColors; saved: boolean; brand: string[]; disabled: boolean; onApply(colors: MvpColors): void; onReset(): void }`
  - It shows five role swatches as a toggle group (`aria-pressed`). For the selected role it shows the brand colors first as clickable swatches, then an `<input type="color">` and a hex text field.
  - Below that it shows the live contrast line `mvpPage.colors.contrast` (`{{bg}}`, `{{surface}}`), or `mvpPage.colors.contrastLow` (`{{min}}`) in `warning` when not ok.
  - **Apply** is enabled only when `colorContrast(draft).ok` holds and the draft differs from `seed`.
  - **Reset to the page's colors** shows only when `saved`, and calls `onReset`, which sends `colors: null`.
  - The draft is re-seeded when `seed` changes, keyed by its joined values.
- `MvpFontControl { value: MvpFontChoice['id'] | null; disabled: boolean; onChange(fonts: { heading: string; body: string } | null): void }`
  - A `Select` with the page's own fonts (`mvpPage.fonts.pageOwn`, null) and one item per `MVP_FONT_CHOICES` entry, labeled `mvpPage.fonts.pair` (`{{heading}} / {{body}}`).
  - Choosing an item calls `onChange` at once, and the current value does nothing.
- `MvpVersionList { versions: ReturnType<typeof versionsNewestFirst>; disabled: boolean; pending?: number; onRestore(n: number): void }`
  - Each row shows `mvpPage.versions.number` (`{{n}}`), the kind label (`mvpPage.versions.kinds.<kind>`, or `restoredFrom` with `{{n}}` when `from` is set), the date (`Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })`), and the instruction, shown in full in a `title` and cut with an ellipsis.
  - The current row shows a `mvpPage.versions.current` chip instead of Restore.
  - An empty list renders `mvpPage.versions.empty`.
- `MvpGroundingFlags { flags: IMvpGroundingFlag[]; onShow(text: string): void }`
  - Renders nothing for an empty list.
  - Otherwise it renders a `warning` Alert titled `mvpPage.flags.title` (`{{count}}`) with the intro `mvpPage.flags.intro`. Each flag is a list item with a kind chip (`mvpPage.flags.kinds.<kind>`), the text in bold, the context muted, and a `mvpPage.flags.show` button that calls `onShow(flag.text)`.

- [ ] **Step 1: Write the failing tests** (happy-dom, `createElement`, inside `ThemeProvider`):
  - colors:
    - `'applies a brand color picked for the selected role'`: choose role `primary`, click the first brand swatch, click Apply. `onApply` is called with the seed plus the new primary.
    - `'keeps Apply off while the text is too light, and says why'`: set text to `#777777` on a white `bg` and `surface`. Apply is disabled and the contrastLow text shows. At `#767676` it is enabled.
    - `'sends nothing for a half-typed hex'`: type `#12` in the hex field, and Apply is disabled.
    - `'offers reset only for saved colors'`.
  - fonts:
    - `'sends the chosen pairing and null for the page fonts'`.
    - `'lists all six pairings'`.
  - versions:
    - `'lists newest first with kind, instruction and date; the current one has no Restore'`.
    - `'restores an older version'`: `onRestore(1)` is called.
    - `'shows a restore as restored from its source'`.
    - `'disables Restore while an action runs'`.
  - flags:
    - `'renders nothing without flags'`.
    - `'lists each fact with its context and shows it in the preview'`: `onShow('15')` is called.
- [ ] **Step 2: Run them**, `npx vitest run apps/dashboard/src/components/__tests__/Mvp{ColorControls,FontControl,VersionList,GroundingFlags}.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four components, and add the keys in all five locales:
  - `mvpPage.colors`:
    - `title`: "Colors"
    - `roles`:
      - `primary`: "Primary"
      - `accent`: "Accent"
      - `bg`: "Background"
      - `surface`: "Surface"
      - `text`: "Text"
    - `brand`: "Brand colors"
    - `hex`: "Hex"
    - `apply`: "Apply colors"
    - `reset`: "Use the page's colors"
    - `contrast`: "Text contrast {{bg}}:1 on background, {{surface}}:1 on surface"
    - `contrastLow`: "Text needs at least {{min}}:1 on the background and the surface"
  - `mvpPage.fonts`:
    - `title`: "Fonts"
    - `pageOwn`: "The page's own fonts"
    - `pair`: "{{heading}} / {{body}}"
  - `mvpPage.versions`:
    - `title`: "Versions"
    - `number`: "Version {{n}}"
    - `kinds`:
      - `generate`: "Generated"
      - `change`: "Changed"
      - `restore`: "Restored"
    - `restoredFrom`: "Restored from version {{n}}"
    - `current`: "Published"
    - `restore`: "Restore"
    - `empty`: "No versions yet"
  - `mvpPage.flags`:
    - `title`: "Check these facts ({{count}})"
    - `intro`: "The original site does not say these. Keep them only if they are true."
    - `kinds`:
      - `number`: "Number"
      - `name`: "Name"
    - `show`: "Show in preview"
    - `chip`: "{{count}} to check"
- [ ] **Step 4: Run them**, plus the locales spec. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-140): color, font, version and fact-check controls`

### Task 5: Design tools panel on the new actions (commit together with Task 2)

**Files:**
- Modify:
  - `apps/dashboard/src/components/leadReview/MvpDesignTools.tsx` (rewrite)
  - `MvpEditPrompt.tsx`
  - `PrototypeStep.tsx` (panel wiring and toolbar)
  - `apps/dashboard/src/pages/MvpPreviewPage.tsx`
- Delete:
  - `hooks/useLiveMvpLayout.ts`
  - `components/MvpLayoutPicker.tsx`
  - `components/leadReview/MvpRebuildLevelToggle.tsx`
  - `components/ColorPickerToolbar.tsx`
  - `components/__tests__/PrototypeLayoutPicker.spec.ts`
  - `components/__tests__/MvpRebuildLevelToggle.spec.ts`
  - the `ColorPickerToolbar` preset test in `EmailDraftEditor.spec.ts`
  - the i18n keys only these read: `colorPicker.*`, `mvpEdit.placeholderRebuild`, `groundingRebuild`, `resetDesign`, `designReset`, `noDesign`, plus `mvpLayout.*` keys read only by the deleted files. Check each with grep before removing it.
- Test:
  - Rewrite `components/__tests__/PrototypeEditPrompt.spec.ts` as `MvpDesignTools.spec.ts`, which covers the panel through `PrototypeStep`.
  - Update `pages/__tests__/MvpPreviewPage.spec.ts`.

**Interfaces:**
- Consumes `useMvpPageMutation` (Task 2), the helpers (Task 3) and the controls (Task 4).
- Produces `useMvpDesignTools({ lead, audit, mvp }): MvpDesignToolsState` with:
  - `modelDesigned: boolean`
  - `canChange: boolean`, which is `lead.status === 'NEEDS_APPROVAL'`, as the API's `canChangeMvpLayout`
  - `run(variables: Omit<MvpPageActionVariables, 'mvpId' | 'leadId'>): void`
  - `pending: MvpPageActionVariables['action'] | null`
  - `pendingVersion?: number`
  - `outcome: { text: MvpText; tone: 'success' | 'info' } | null`
  - `error: string | null`
  - `clearOutcome()`
  - `clearError()`

  Outcome and error are kept per lead, as `useMvpEdit` does today. The hook no longer takes `iframeRef`.
- `MvpDesignTools { tools, lead, locked }`:
  - **Model-designed MVP:** `MvpEditPrompt`, then `MvpColorControls`, `MvpFontControl`, `MvpVersionList` and `RegenerateMvpButton` (`variant="button"`), with one outcome Alert and one error Alert under them.
  - **Previous-generator MVP:** the text `mvpPage.previousGenerator` ("This MVP was made with the previous generator. Regenerate it to change it here.") and `RegenerateMvpButton` only.
  - **Disabled:** every control is disabled when `locked`, when `!canChange` (tooltip `mvpEdit.locked`), or while an action runs (`mvpEdit.busy`).
- `MvpEditPrompt { edit: { submit(instruction: string, onApplied: () => void): void; isPending: boolean }, disabled, disabledReason }`. It drops `rebuilt`, the reset button and the outcome and error Alerts, which move to the panel.
- `PrototypeStep`:
  - Remove `MvpLayoutChip` and `RegenerateMvpButton` from the toolbar, since Regenerate is now in the panel.
  - Keep `MvpSourceChip`.
  - `MvpPreviewFrame` loses `onLoad`.

- [ ] **Step 1: Write the failing tests** in `MvpDesignTools.spec.ts`:
  - `'applies a change and reloads the preview'`: the `editMvp` spy resolves `{ applied: true, version: 4, mvp: { ...mvp, editedAt: later } }`. The outcome says "Published as version 4." and the iframe `src` carries the new version.
  - `'says why a change was refused'`: `invalid_page` with a message, shown in the info Alert.
  - `'publishes colors and fonts'`: `updateMvpTokens` is called with `{ colors }`, then with `{ fonts: { heading: 'Lora', body: 'Lato' } }`.
  - `'restores a version'`: `restoreMvpVersion('mvp-1', 1)` is called.
  - `'disables every control while an action runs, and outside NEEDS_APPROVAL'`.
  - `'keeps an answer with the lead it was asked for'` (Review Focus 1): rerender with another lead before the promise resolves. No outcome shows on the second lead.
  - `'shows the API message on a 504'`: `ApiError(504, 'MVP_EDIT_TIMEOUT', 'may still be published')` is shown in the error Alert.
  - `'offers only Regenerate on an MVP from the previous generator'` (Review Focus 5): an MVP with `colorPalette` and `layout` but no `theme` shows the note and the Regenerate button, and has no prompt, colors, fonts or versions.
  - MvpPreviewPage spec: the panel renders on the full-window preview with the same controls.
- [ ] **Step 2: Run them**, `npx vitest run apps/dashboard/src/components apps/dashboard/src/pages`. Expected: FAIL.
- [ ] **Step 3: Implement** the panel, prompt and wiring; delete the files listed; add `mvpPage.previousGenerator` in all five locales.
- [ ] **Step 4: Run** `npm run typecheck`, then `npx vitest run apps/dashboard`. Expected: typecheck ok and all dashboard specs PASS.
- [ ] **Step 5: Commit** Tasks 2 and 5 together: `feat(REV-140): Design tools change, color, font and restore a model-designed page`

### Task 6: Prototype step: facts to check, measured "What changed", failure panel

**Files:**
- Modify:
  - `components/leadReview/PrototypeStep.tsx`
  - `components/leadReview/LeadReview.tsx` (the tab chip)
  - `components/leadReview/MvpGenerationFailure.tsx`
  - `components/leadReview/MvpChangeSummary.tsx` (rewrite)
  - `utils/mvpChanges.ts` (rewrite)
- Create: `utils/previewFrame.ts` (`showFactInPreview`)
- Test:
  - `components/__tests__/PrototypeGenerationFailure.spec.ts`
  - `components/__tests__/MvpChangeSummary.spec.ts`
  - `utils/__tests__/mvpChanges.spec.ts` (all rewritten)
  - `components/__tests__/LeadReview.spec.ts` (chip)
  - `PrototypeStepLayout.spec.ts`: keep it green

**Interfaces:**
- `showFactInPreview(frame: HTMLIFrameElement | null, text: string): boolean` posts `{ type: 'REVAMP_SHOW_TEXT', text }` to `frame.contentWindow` with target `'*'`. It returns false without a window.
- `summarizeMvpChanges(mvp, audit): MvpChangeSummary | null` returns:
  ```ts
  {
    standards?: Pick<SeoStandardsView, 'originalScore' | 'mvpScore' | 'fixed' | 'regressed'>; // when the MVP's page was checked
    accessibility?: { originalViolations: number };                                   // from the audit; the MVP's are not measured
    performance?: { host: string; measuredAt: string; lcp?: { mvp: number; original?: number }; cls?: { mvp: number; original?: number }; error?: string };
    businessData?: { kept: number; checked: number; issues: MvpDataIssue[] };          // as today
  }
  ```
  Delete `layout`, `copySource`, `sections`, `palette` and `critiqueGuidance`. The values are in seconds for LCP and unitless for CLS. A value that was not measured is left out, never zero.
- `MvpChangeSummary` renders one card per present part:
  - **Standards:** the existing SEO card.
  - **Accessibility:** the original's count, plus `mvpChanges.a11yNotMeasured`.
  - **Performance:** LCP and CLS original → MVP with `Stat`, the note `mvpChanges.measuredOn` with the host, or `mvpChanges.perfNotMeasured` with the error.
  - **Business data:** as today.

  It no longer renders `MvpChangeLog`, which REV-141 deletes with `utils/mvpChangeLog.ts`.
- `MvpGenerationFailure`: the title, then `generationFailureText` (Task 3), then a **Try again** button: `generate.mutate({ auditId, leadId, forceRegenerate: lead.status !== 'AUDITED' })`, with no layout.
- `PrototypeStep`: `MvpGroundingFlags` sits under the preview stage, above `MvpChangeSummary`, with `onShow={(text) => showFactInPreview(iframeRef.current, text)}`.
- `LeadReview`: the prototype `Tab` label gets a `Chip color="warning" size="small"` with `mvpPage.flags.chip` when `mvp.grounding.length > 0`.

- [ ] **Step 1: Write the failing tests**
  - `mvpChanges.spec.ts`:
    - `'compares LCP and CLS with the host named'`: the audit has `lcpSeconds 3.2, cls 0.21`, and `mvp.performance` has `webVitals {lcp: 1400, cls: 0.02}, host 'demo.example'`. The result is `lcp {mvp: 1.4, original: 3.2}`.
    - `'leaves out what was not measured'`: no audit LCP gives no `original`, and a performance `error` gives `error` with no `lcp`.
    - `'reports the original's axe count'`.
    - `'lists no layout, copy, palette or critique'`: an MVP with `layout`, `colorPalette`, `generatedContent` and an audit with `quickWins` gives a summary without those keys.
    - `'keeps standards only once the MVP page was checked'`.
  - `MvpChangeSummary.spec.ts`: the performance card shows "3.2 → 1.4" and the host. Without any measurements the empty text shows.
  - `PrototypeGenerationFailure.spec.ts`:
    - `'explains a page failure and tries again without a layout'`: clicking Try again calls `generateMvp('audit-1', { forceRegenerate: true })`, with no `layout` key.
    - `'shows a generic text for a previous-generator failure'` (Review Focus 5): `rebuild:flat` shows `mvpFailure.page.previous`, and no raw key appears in the DOM.
  - `LeadReview.spec.ts`: `'shows the count of facts to check on the Prototype tab'`, with 2 flags giving "2 to check". Without flags there is no chip.
  - The flags in the step: `'Show in preview posts the fact to the frame'`, where `postMessage` on the iframe's `contentWindow` is spied and called with `{ type: 'REVAMP_SHOW_TEXT', text: '15' }, '*'`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** the changes, and add the keys in all five locales:
  - `mvpChanges`:
    - `accessibility`: "Accessibility"
    - `a11yOriginal`: "{{count}} accessibility violations on the original"
    - `a11yNotMeasured`: "Not measured on the MVP"
    - `performance`: "Loading speed"
    - `lcp`: "Largest content shown (s)"
    - `cls`: "Layout shift"
    - `measuredOn`: "MVP measured on {{host}}"
    - `perfNotMeasured`: "The MVP's speed was not measured: {{error}}"

  Delete the `mvpChanges.*` keys that only the removed cards read: layout, copy, sections, palette and critique. Check each with grep.
- [ ] **Step 4: Run** `npx vitest run apps/dashboard` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-140): facts to check, measured What changed and a simpler failure panel`

### Task 7: Gates, Chrome, PR, merge, docs, close

- [ ] Run `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` and `npm run build`.
- [ ] Chrome check on a real lead, using the chrome-devtools MCP and the dev stack:
  1. Generate a fresh MVP.
  2. Make a free-text change.
  3. Apply colors, including one refused for low contrast.
  4. Apply a font pairing.
  5. Restore a version.
  6. Check the flags: the tab chip and "Show in preview" highlighting the text.
  7. Open the full-window preview.
  8. Open a previous-generator lead.

  Expect no new console errors. Never approve a real lead.
- [ ] Open the PR with `Fixes REV-140`, attach it to the ticket and move the ticket to In Review. Merge after re-running the gates on the up-to-date branch, then run `npm test` on `main`.
- [ ] Docs:
  - AGENTS.md §3.2.6 in this PR: the Design tools sentence names the new tools, and the layout picker, level toggle and reset are gone.
  - The README if it mentions the pickers.
  - Revamp-docs: a `spec.md` dashboard note if one exists; otherwise a ticket comment that REV-142 covers the rest.
- [ ] Move the ticket to Done.

## Decisions taken in this plan (rulings for review)

1. **Colors and fonts publish only on Apply or select, with no live preview in the frame.** The theme message would need all five variables and font loading; the live part is the contrast check, as the spec says. Cost if wrong: the operator waits for a publish (about 10–40 s) to see colors.
2. **The removed pieces listed in spec §7 are deleted here**, along with the client methods and hooks whose routes REV-139 deleted: the layout picker, the level toggle, reset, `useLiveMvpLayout` and the old palette toolbar. The §8 leftovers go to REV-141: `mvpChangeLog`, `MvpChangeLog`, `MvpLayoutChip`, `renderFailure` and their keys.
3. **Regenerate moves into the Design tools panel**, per the spec's list, and leaves the Prototype toolbar.
4. **"What changed" is the same for every MVP.** It uses only measured values, which both generators store. The MVP's axe violations are not measured, so the card says so rather than comparing.
5. **The fact highlight needs the page's own script.** Pages published before this ticket get it on their next publish. Until then, "Show in preview" does nothing on them.
6. **A failure from the previous generator gets one generic text**, so this ticket's failure panel does not depend on code REV-141 deletes.
