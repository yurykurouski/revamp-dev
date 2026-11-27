# REV-229 Contact-Right Chip Shows the Full Date in the Table Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch the new tests fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** In the All leads table the contact-right chip shows its full date (day, month, year) at 1280 px and wider. It uses a short label there ("Until 29 Nov 2026", since the column header already says "Contact right"), with the full text as a tooltip. The review header chip is unchanged.

**Architecture:**
* `ContactRightChip` gains `variant?: 'full' | 'compact'` (default `'full'`).
* `compact` uses the new key `contactRight.untilShort` for active and expiring rights, keeps the same colors, and wraps the chip in a MUI `Tooltip` whose title is the full `contactRight.until` text.
* Ended and opted-out states keep their existing (already short) labels in both variants.
* `LeadsDataGrid` renders `variant="compact"` and sets the column `width: 170` with `minWidth: 160`.

**Tech Stack:** React 18, MUI v6 (`Chip`, `Tooltip`), MUI X DataGrid, i18next, Vitest + happy-dom.

**Spec:** Linear REV-229 (follow-up of REV-228). Read `apps/dashboard/AGENTS.md` first.

## Rulings

1. **Short labels**, in each language and not copied from English:

   | Locale | `contactRight.untilShort` |
   |---|---|
   | en | "Until {{date}}" |
   | ru | "До {{date}}" |
   | be | "Да {{date}}" |
   | pl | "Do {{date}}" |
   | lt | "Iki {{date}}" |

2. **Date format** stays `DATE_FORMAT` (`day: 'numeric', month: 'short', year: 'numeric'`), so the date matches everywhere.
3. **Column width:** `170` was measured to hold "Until 29 Nov 2026" in a small chip with the dashboard font. Check it in Chrome. If the Russian or Belarusian label ("До 29 нояб. 2026 г.") is cut at 170, widen to the smallest width that fits all five locales and report the number.
4. **Theme tokens only:** no new colors.

## Review Focus

1. **The longest locale** (`ru`/`be` month abbreviations with "г.") must fit the column. Check in Chrome by switching the language (Settings → Interface language).
2. **Tooltip text** equals the full review-header label.
3. **The review header still renders `full`** (the default), so no other caller changes.

---

### Task 1: Compact chip in the table

**Files:**
- Modify: `apps/dashboard/src/components/ContactRightChip.tsx`, `apps/dashboard/src/components/LeadsDataGrid.tsx`, `apps/dashboard/src/i18n/locales/{en,ru,be,pl,lt}.ts`
- Test: `apps/dashboard/src/components/__tests__/ContactRightChip.spec.ts` (extend), the LeadsDataGrid spec (extend), the locale parity test

- [ ] **Step 1: Failing tests:**
  - `compact` shows "Until <date>" for active and expiring rights, with the same colors as `full`. Its tooltip / accessible name contains "Contact right until <date>".
  - `compact` ended and opted-out labels are unchanged.
  - The default variant is unchanged (the existing tests stay green).
  - The grid cell renders the compact label.
  - The parity test fails until all five locales have `untilShort`.
- [ ] **Step 2:** Run `npx vitest run apps/dashboard/src/components apps/dashboard/src/i18n` from the worktree root. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun (PASS), then run the five gates: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`.
- [ ] **Step 5: Chrome check on an isolated stack** (memory `email-e2e-isolated-stack`: in-memory replset :27118, a spare Redis DB with DBSIZE 0, API :4100 with `CORS_ORIGIN=http://localhost:5174`, Vite :5174, no workers; data inserted directly as in REV-228's check: leads with rights expiring in 10 days and in 1 day, and one expired).
  1. Resize the page to 1280×800 (`resize_page`). All leads → Table: both active chips show "Until <d> <Mon> <yyyy>" in full, hovering one shows the full text, and the expired one shows "Right expired".
  2. Switch the interface language to Русский and to Беларуская: the chips are still not cut off.
  3. The review header chip still reads "Contact right until …".
  4. No new console errors.

  Tear down by port/PID only and flush the spare Redis DB.
- [ ] **Step 6:** Commit `fix(REV-229): the table's contact-right chip shows the full date`.

Docs: `../Revamp-docs` needs nothing (a UI wording change); `apps/dashboard/AGENTS.md` gets one line on the compact variant in the REV-228 section.
