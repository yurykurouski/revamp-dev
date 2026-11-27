# REV-228 (E2.5) Dashboard Shows the Contact Right Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch each new test fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:**
* The operator sees each lead's contact right: until when, a warning when it is about to end, and "Right expired" once it has.
* Approve is disabled once the right has ended.
* Every rights refusal from Add lead, import and approve is explained in plain words with its date.
* A lead that came back to review shows why.
* Discovery candidates another studio holds can't be selected.

**Architecture:**
* **API:** `GET /leads` and `GET /leads/:id` gain a `contactRight` view per lead: the studio's newest right on the lead's business, read through `scope.rights`.
* **Dashboard:**
  * one pure helper module turns rights and error codes into states and words (`utils/contactRight.ts`);
  * a `ContactRightChip` sits in the lead review header and in the All leads grid;
  * `ReviewActionBar` gates Approve on the right and shows `outreachError`;
  * `AddLeadModal` and discovery map the refusal codes;
  * discovery treats `unavailable` candidates as not importable.

**Tech Stack:** Express, React 18, MUI v6, React Query, i18next (five locales), Vitest + happy-dom.

**Spec:** Linear REV-228 and epic REV-170. The API from REV-225 to REV-227: codes `CONTACT_RIGHT_HELD` (`details.expiresAt`), `BUSINESS_IN_COOLDOWN` (`details.availableAt`), `BUSINESS_OPTED_OUT`, `CONTACT_RIGHT_REQUIRED` (`details.expiredAt`); `Lead.outreachError.code` is `CONTACT_RIGHT_EXPIRED` or `CONTACT_OPTED_OUT`; a candidate's `unavailable: { reason: held|cooldown|opted_out, until? }`; import outcomes `right_held`, `cooldown`, `opted_out` with `until`. Read root `AGENTS.md`, `apps/dashboard/AGENTS.md` and `apps/api/AGENTS.md` first.

## Rulings

1. **API lead view** `contactRight: { expiresAt: string; active: boolean; endedAt?: string; endReason?: 'opted_out' } | null`. It is the studio's newest right (`grantedAt` desc) for `lead.businessId`, or `null` when there is none or no `businessId`. `active` uses the same rule as `findActiveContactRight` (granted, not expired, not ended, at request time).
   * The list reads it in **one** query: `scope.rights.find({ businessId: { $in } })` sorted, keeping the first per business. It is added next to the existing MVP enrichment.
   * `getLeadById` adds it to `data.lead`.
   * The view is defined once as `IContactRightView` in shared-types. It replaces REV-224's unused `IContactRightView { expiresAt; active }`: extend that type, don't add a second.
2. **States** (`contactRightState(view, now)`):
   * `'none'` when the view is null;
   * `'ended'` when `active` is false;
   * `'expiring'` when it is active and `expiresAt - now < 3 days` (`CONTACT_RIGHT_WARNING_DAYS = 3`, a dashboard constant);
   * `'active'` otherwise.
3. **Chip** (`ContactRightChip`):

   | State | Label | Color |
   |---|---|---|
   | active | `contactRight.until` "Contact right until {{date}}" | `success` |
   | expiring | the same text | `warning` |
   | ended, `endReason: opted_out` | `contactRight.optedOut` "Business opted out" | `default` |
   | ended, otherwise | `contactRight.expired` "Right expired" | `default` |
   | none | nothing rendered | — |

   Dates go through `formatDate` (`i18n/languages.ts`) with the UI language. Theme colors only.
4. **Placement:** the `LeadReview` header (next to the business name / score chip) and a new `contactRight` column in `LeadsDataGrid` (sortable by `expiresAt`, empty cell for none). The review queue list stays as it is (space). The review header shows the state when a lead is selected.
5. **Approve gating** (`ReviewActionBar`): only when the lead can be approved (`canApproveOutreach`) and the state is `ended` or `none`. Approve is disabled, and a warning `Alert` shows `contactRight.approveBlocked` ("Your studio's right to contact this business has ended, so outreach can't be approved."). For an opted-out right, `contactRight.approveBlockedOptedOut` instead. This follows the same pattern as the REV-221 sender gate.
6. **Refusal texts:** `refusalMessage(t, error: ApiError)` returns a localized string or `undefined`:

   | Code | Key |
   |---|---|
   | `CONTACT_RIGHT_HELD` | `refusals.held` "Another studio holds this business until {{date}}." |
   | `BUSINESS_IN_COOLDOWN` | `refusals.cooldown` "This business can be added again from {{date}}." |
   | `BUSINESS_OPTED_OUT` | `refusals.optedOut` "This business or its contact address asked not to be contacted." |
   | `CONTACT_RIGHT_REQUIRED` | `refusals.rightRequired` "Your studio's right to contact this business ended on {{date}}." (`refusals.rightRequiredNoDate` without a date) |

   Used by `AddLeadModal`'s catch and by `ReviewActionBar.runAction`. Any other error keeps today's text.
7. **`outreachError` on a lead in `NEEDS_APPROVAL`:** an error `Alert` with `outreachError.CONTACT_RIGHT_EXPIRED` ("The right to contact this business ended before the email was sent. Nothing was sent.") or `outreachError.CONTACT_OPTED_OUT` ("The contact address asked not to be contacted. Nothing was sent."), plus the date. It is shown on the email step.
8. **Discovery:**
   * `importableIds` excludes candidates with `unavailable`, so `pruneSelection` drops them too.
   * An unavailable row is dimmed and its checkbox disabled. It shows a chip with `discovery.unavailable.held|cooldown|opted_out` (with `{{date}}` for held and cooldown).
   * `summarizeImport` gains `unavailable` (the count of `right_held`, `cooldown` and `opted_out` outcomes), and the import summary mentions it with `discovery.importUnavailable` ("{{count}} not imported: another studio holds them, or they opted out").
9. **Locales:** every new key in `en`, `ru`, `be`, `pl` and `lt` (the parity test enforces it). Wording in each language, not English copies.

## Global Constraints

- Theme tokens only, no hex. Tests are `.spec.ts` with createElement and happy-dom (memories: vitest-spec-ts-only, happy-dom-iframe-tests).
- The API change goes through `scope.rights` (tenant guard). No other studio's data is ever returned: the view is the caller's own right only.
- Approve still has its single entry point in `ReviewActionBar` (`apps/dashboard/AGENTS.md`).

## Review Focus

1. **The right ends while the review is open.** The chip and the Approve gate must follow the clock, not only data refetches. `contactRightState` takes `now`, and `ReviewActionBar` uses a `now` that re-evaluates at least every minute (`useNow(60_000)`), so Approve disables without a reload. Test: `ReviewActionBar.spec.ts › disables Approve when the right expires during the review` (fake timers).
2. **A lead from another studio's conflict** (no right of its own): state `none`, so Approve is disabled with the reason, and the chip renders nothing. Test (Task 3).
3. **An API refusal racing the UI state** (the chip says active, the API says `CONTACT_RIGHT_REQUIRED`): the error shows the localized text, and the lead query is invalidated so the chip updates. Test (Task 3).
4. **Discovery "select all"** must not pick unavailable candidates, and a selection made before a poll marked a candidate unavailable is pruned. Test (Task 4).
5. **Dates in other locales** (`ru`, `pl`) format through `formatDate`. Test: one refusal under `pl` contains the `formatDate` output (Task 2).

---

### Task 1: API adds the contact right view to leads

**Files:**
- Modify: `packages/shared-types/src/index.ts` (`IContactRightView`, `ILead.contactRight?`), `apps/api/src/data/contact-rights.ts` (`contactRightViews(scope, businessIds, now)` → `Map<string, IContactRightView>`; `toContactRightView(doc, now)`), `apps/api/src/services/lead.service.ts` (list and detail), `apps/api/AGENTS.md` (one line)
- Test: the lead service spec and `api.routes.spec.ts`; `tenant-isolation.spec.ts` (a real-MongoDB check that studio B's lead list never carries studio A's right)

- [ ] **Step 1: Failing tests:**
  - The list item has `contactRight` `{ expiresAt, active: true }` for an active right, `active: false` plus `endedAt`/`endReason` for an ended one, and `null` without a right or `businessId`.
  - Exactly one `scope.rights.find` call for a page.
  - Detail `data.lead.contactRight` is the same.
  - Cross-studio: B's conflicting lead shows `null` while A holds the business.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-228): leads carry the studio's contact right`.

### Task 2: Helpers, chip and locales

**Files:**
- Create: `apps/dashboard/src/utils/contactRight.ts`, `apps/dashboard/src/components/ContactRightChip.tsx`, `apps/dashboard/src/hooks/useNow.ts`
- Modify: `apps/dashboard/src/api/client.ts` (`ILeadItem.contactRight?: IContactRightView | null; outreachError?: Serialized<ILeadOutreachError>`), locales ×5
- Test: `apps/dashboard/src/utils/__tests__/contactRight.spec.ts`, `apps/dashboard/src/components/__tests__/ContactRightChip.spec.ts`, the locale parity test

**Interfaces:**
```ts
export const CONTACT_RIGHT_WARNING_DAYS = 3;
export type ContactRightState = 'none' | 'active' | 'expiring' | 'ended';
export function contactRightState(view: IContactRightView | null | undefined, now: Date): ContactRightState
export function refusalMessage(t: TFunction, error: unknown, language: AppLanguage): string | undefined
export function useNow(intervalMs: number): Date
export const ContactRightChip: React.FC<{ right: IContactRightView | null | undefined; size?: 'small' | 'medium' }>
```
- [ ] **Step 1: Failing tests:**
  - States at the exact 3-day boundary: `expiresAt - now === 3d` is `active`, and 1 ms less is `expiring`.
  - `ended` for `active: false`, and `none` for null.
  - `refusalMessage` for each of the four codes, with and without a date. It returns `undefined` for other codes and non-`ApiError` values. Under `pl`, the text contains `formatDate(date, 'pl')`.
  - The chip: its label and color per state, the opted-out label, and nothing rendered for `none`.
- [ ] **Step 2:** Run `npx vitest run apps/dashboard/src/utils apps/dashboard/src/components/__tests__/ContactRightChip.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement; add the keys to all five locales.
- [ ] **Step 4:** Rerun, plus the parity test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-228): contact right states, chip and refusal texts`.

### Task 3: Review, list, approve gate, outreach error, Add lead

**Files:**
- Modify: `apps/dashboard/src/components/leadReview/LeadReview.tsx` (the header chip), `apps/dashboard/src/components/leadReview/ReviewActionBar.tsx` (Rulings 5–7, `useNow(60_000)`, `refusalMessage` in `runAction`, invalidate the lead queries on `CONTACT_RIGHT_REQUIRED` / `BUSINESS_OPTED_OUT`), `apps/dashboard/src/components/LeadsDataGrid.tsx` (the column), `apps/dashboard/src/components/AddLeadModal.tsx` (`refusalMessage` in the catch), `apps/dashboard/AGENTS.md` (the chip, the approve gate order: sender then right; refusal texts come only from `refusalMessage`)
- Test: `ReviewActionBar*.spec.ts` (extend an existing one or add `ReviewActionBarRight.spec.ts`), `LeadsDataGrid` spec, `AddLeadModal` spec, `LeadReview` spec

- [ ] **Step 1: Failing tests:**
  - Approve is disabled with the warning for `ended`, `none` and opted-out.
  - It is enabled for `active` and `expiring`.
  - `disables Approve when the right expires during the review` (fake timers advanced past `expiresAt` plus one minute).
  - An approve rejected with `CONTACT_RIGHT_REQUIRED` shows the localized text and invalidates `['leads']`.
  - The `outreachError` alert shows for each code on a `NEEDS_APPROVAL` lead, and not on other statuses.
  - The grid shows the column with the chip.
  - The review header shows the chip.
  - Add lead rejected with `CONTACT_RIGHT_HELD` shows "Another studio holds this business until …".
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-228): the review and list show the contact right; approve and Add lead explain refusals`.

### Task 4: Discovery unavailable candidates

**Files:**
- Modify: `apps/dashboard/src/hooks/useDiscovery.ts` (`importableIds`, `summarizeImport`), `apps/dashboard/src/components/DiscoveryReview.tsx` (the dimmed row, disabled checkbox, chip), `apps/dashboard/src/components/DiscoveryDrawer.tsx` (the summary line), locales ×5
- Test: `apps/dashboard/src/hooks/__tests__/useDiscovery.spec.ts`, the `DiscoveryReview` spec

- [ ] **Step 1: Failing tests:**
  - `importableIds` skips `unavailable`, and `pruneSelection` drops one.
  - `summarizeImport` counts the three outcomes as `unavailable`.
  - Select-all selects only available rows.
  - An unavailable row has a disabled checkbox and its reason chip with the date.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, then run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green, lint 0 errors and no new warnings.
- [ ] **Step 5: Chrome check on an isolated stack** (memory `email-e2e-isolated-stack`: in-memory replset :27118, a spare Redis DB with DBSIZE 0, API :4100 with `CORS_ORIGIN=http://localhost:5174`, Vite :5174 with `VITE_API_URL`; **no workers** unless step 6). Use the chrome-devtools MCP tools, and save no screenshots outside your allowed roots (viewing inline is fine). Insert directly into the isolated DB: studio S (sender set) with three `NEEDS_APPROVAL` leads, each with a business:
  * L1: an active right that expires in 10 days;
  * L2: an active right that expires in 1 day;
  * L3: an expired right.

  Also add one more business, X, held by another studio T (a hold and a right with T's tenant), to test Add lead. Then:
  1. All leads grid: L1 shows a green "until …", L2 a warning chip, L3 "Right expired".
  2. Open L3: the chip shows, Approve is disabled, and the warning is shown.
  3. Open L1: Approve is enabled.
  4. Set L1's right `expiresAt` to 1 minute from now in the DB and wait just over 1 minute with the review open: Approve disables without a reload.
  5. Add lead for X's URL: the localized "Another studio holds this business until …" message.
  6. Set `outreachError: { code: 'CONTACT_RIGHT_EXPIRED', … }` on L3: the email step shows that alert.
  7. Optional discovery check: run only the discovery worker (memory `discovery-only-worker`) against the isolated stack. Search a small city, then insert a hold for one candidate's domain under studio T and reload. That candidate is dimmed with "held until …" and can't be selected. **Never import candidates.**
  8. No new console errors.

  Tear down by port/PID only and flush the spare Redis DB.
- [ ] **Step 6:** Commit `feat(REV-228): discovery shows unavailable candidates and does not let them be selected`.

**Docs to update in `../Revamp-docs`** (orchestrator, after merge):
- `blueprint.md`: the `GET /leads` and `/leads/:id` rows (`contactRight` view).
- `spec.md`: a dashboard requirement for US3/US4.
- OpenAPI: the `Lead.contactRight` schema, CHANGELOG 2.4.0.
- `npm run docs:index`.
