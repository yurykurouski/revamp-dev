# REV-227 (E2.4) An Opt-Out Blocks Every Studio Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch each new test fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** One unsubscribe makes all of these happen in one transaction:
* the shared business is opted out;
* the recipient address's hash is added to the suppression list;
* the business's active right ends;
* every studio's lead for that business moves to `UNSUBSCRIBED`;
* their not-yet-sent campaigns are closed.

The address is also blocked everywhere: approval and the email worker refuse a recipient whose hash is suppressed, under any business. The public unsubscribe pages answer exactly as today.

**Architecture:**
* A new `recordBusinessOptOut` in `@revamp/db` does the cross-studio write in one MongoDB transaction. It is the one place allowed to touch other studios' leads for an opt-out.
* `@revamp/db` does not depend on `@revamp/validation`, so the API passes it the list of statuses that may move into `UNSUBSCRIBED` (`leadStatusesInto('UNSUBSCRIBED')`).
* `TrackingService.recordUnsubscribe` keeps its own campaign, lead and event writes, and calls the new function in both its first-time and repeat branches. The function is idempotent, so a half-done first call is completed by a repeat.
* `isAddressSuppressed(email)` (`@revamp/db`) is the one suppression read, used by approval and by the worker.

**Tech Stack:** Mongoose transactions, Express, BullMQ, Vitest.

**Spec:** Linear REV-227 and epic REV-170 (opt-out = business + address hash). Read root `AGENTS.md`, `apps/api/AGENTS.md`, `apps/workers/AGENTS.md` and `packages/db/AGENTS.md` first.

## Rulings

1. **What one opt-out writes** (`recordBusinessOptOut({ businessId, recipientEmail, unsubscribableStatuses, now })`, one transaction):
   * `Business.optedOutAt = now` only if it is not set yet (the first opt-out's time stays).
   * `SuppressedAddress` upsert of `hashAddress(recipientEmail)` (only when an email is given).
   * If `Business.contactHold` names a right that is still active, call `endContactRight(rightId, { at: now, reason: 'opted_out' }, session)`.
   * `Lead.updateMany({ businessId, status: { $in: unsubscribableStatuses } }, { $set: { status: 'UNSUBSCRIBED' }, $addToSet: { tags: 'unsubscribed' } })`. Every studio, through the state machine's own list.
   * `EmailCampaign.updateMany({ leadId: { $in: <those businesses' lead ids> }, status: { $in: ['DRAFT', 'NEEDS_APPROVAL', 'APPROVED', 'SCHEDULED'] } }, { $set: { status: 'UNSUBSCRIBED', unsubscribedAt: now } })`. Campaigns that are `SENDING`, `DELIVERED` or `BOUNCED` are history and stay as they are.
   * It returns counts `{ leadsUnsubscribed, campaignsClosed, rightEnded: boolean, newlyOptedOut: boolean }` for the log. A second call returns zeros and `newlyOptedOut: false`.
2. **Queued BullMQ jobs** are not removed from Redis. When they run, the worker's existing HITL gate aborts, because an `UNSUBSCRIBED` lead cannot move to `SENT`, so nothing is sent or recorded. Removing jobs would need job ids the API doesn't store. The gate is already the rule and is tested.
3. **The public route is unchanged:** same status codes, same pages, same JSON. The token's campaign still decides `found` / `alreadyUnsubscribed`. Logs name lead ids only, never addresses. No other studio's data reaches the response.
4. **A legacy lead without `businessId`:** the opt-out falls back to today's single-lead behavior plus the address hash (no business flag).
5. **Approval** (`POST /outreach/:id/approve`), after the sender check and before the right check (REV-226): if the lead's business has `optedOutAt`, or `isAddressSuppressed(existing.contactEmail)`, answer `409 BUSINESS_OPTED_OUT` (the code exists since REV-225) with the message "This business or its contact address asked not to be contacted." Nothing is written. This is checked before the right, because an opt-out also ends the right and its reason is the clearer one. The test send stays allowed (it goes to the operator).
6. **Worker,** after the right check (REV-226) and before MX: if `isAddressSuppressed(recipientEmail)`, call `revertOutreachApproval(leadId, { outreachError: { code: 'CONTACT_OPTED_OUT', message: 'The contact address asked not to be contacted. Nothing was sent.', at } })` and abort. Add `'CONTACT_OPTED_OUT'` to `LEAD_OUTREACH_ERROR_CODES` and the `Lead.outreachError.code` enum. An opted-out **business** needs no extra worker branch: its leads are already `UNSUBSCRIBED`, so the HITL gate aborts.
7. **The API reads** `Business` and `SuppressedAddress` (shared, not tenant-owned) only for these checks. The cross-studio write happens inside `@revamp/db`, called from the tracking service. The tenant guard is unchanged.

## Global Constraints

- The state machine stays the source: the API passes `leadStatusesInto('UNSUBSCRIBED')`. No local status list for leads.
- Only hashes in `suppressedaddresses` (test: no document field equals or contains the plain address).
- HITL unchanged. The public route's responses are unchanged (route tests assert the same bodies as before).
- Real-MongoDB tests only in `real-mongo.spec.ts` (db) and `tenant-isolation.spec.ts` (API).

## Review Focus

1. **Studio A's recipient unsubscribes while studio C's lead of the same business is `SCHEDULED`,** with its job delayed. C's lead becomes `UNSUBSCRIBED`, and when C's job runs, nothing is sent. Tests: real-MongoDB `› an opt-out closes every studio's lead and open campaign of the business` (Task 1), and the worker's existing HITL test (an `UNSUBSCRIBED` lead aborts), which stays green.
2. **A repeat unsubscribe after a first call that wrote the campaign but crashed before the business write** is completed by the repeat. Test: `tenant-isolation.spec.ts › a repeated unsubscribe completes an interrupted opt-out and answers the same` (Task 2).
3. **The same address as the contact of an unrelated business in another studio:** approval is refused with `BUSINESS_OPTED_OUT` and the worker reverts with `CONTACT_OPTED_OUT`. Tests (Tasks 2 and 3).
4. **Address normalization:** `Owner@Example.com ` unsubscribes, and the other business's contact is `owner@example.com`. It must still be refused (`hashAddress` normalizes). Test (Task 2).
5. **An opt-out of a business whose right is held by studio A ends that right,** so its cooldown starts at the opt-out. `Business.optedOutAt` then blocks any new grant even after the cooldown (REV-224 grant rule). Test (Task 1).

---

### Task 1: `recordBusinessOptOut` and `isAddressSuppressed` in `@revamp/db`

**Files:**
- Create: `packages/db/src/opt-out.ts` (exported from `index.ts`)
- Modify: `packages/shared-types/src/index.ts` (`LEAD_OUTREACH_ERROR_CODES` += `'CONTACT_OPTED_OUT'`), `packages/db/src/models/Lead.model.ts` (enum follows the constant), `packages/db/AGENTS.md` (a short "Opt-out (REV-227)" bullet: one function, one transaction, every studio, hashes only, statuses passed in)
- Test: `packages/db/src/__tests__/real-mongo.spec.ts`, a new nested `describe('recordBusinessOptOut (REV-227)')`; `packages/db/__tests__/models.spec.ts` (the enum)

**Interfaces:**
```ts
export interface BusinessOptOutInput { businessId?: Types.ObjectId | string; recipientEmail?: string; unsubscribableStatuses: readonly LeadStatus[]; now?: Date }
export interface BusinessOptOutResult { newlyOptedOut: boolean; rightEnded: boolean; leadsUnsubscribed: number; campaignsClosed: number; addressSuppressed: boolean }
export async function recordBusinessOptOut(input: BusinessOptOutInput): Promise<BusinessOptOutResult>
export async function isAddressSuppressed(email: string | undefined, session?: ClientSession): Promise<boolean>   // false for undefined or empty
export async function isBusinessOptedOut(businessId: Types.ObjectId | string | undefined): Promise<boolean>
```
- [ ] **Step 1: Failing tests:**
  - `an opt-out closes every studio's lead and open campaign of the business`: business X with studio A's lead (`SENT`, campaign `DELIVERED`), studio C's lead (`SCHEDULED`, campaign `SCHEDULED`) and studio D's lead (`AUDITED`, no campaign). Afterwards: X has `optedOutAt`; A, C and D are `UNSUBSCRIBED` with the tag; C's campaign is `UNSUBSCRIBED` with `unsubscribedAt`; A's `DELIVERED` campaign is unchanged; `leadsUnsubscribed === 3` and `campaignsClosed === 1`.
  - `ends the active right and starts its cooldown at the opt-out`.
  - `stores only the hash`: `SuppressedAddress` has `hashAddress(email)`, and no document field equals or contains the plain address.
  - `a second call changes nothing`: all zeros, `newlyOptedOut: false`, and `optedOutAt` unchanged.
  - `isAddressSuppressed` is true for `' Owner@Example.COM '` after suppressing `owner@example.com`, and false for `undefined`.
  - Without `businessId`, only the address is suppressed.
  - A lead in another business is untouched.
- [ ] **Step 2:** Run `npx vitest run packages/db -t "REV-227"`. Expected: FAIL.
- [ ] **Step 3:** Implement per Ruling 1. Use one `mongoose.connection.transaction`.
- [ ] **Step 4:** `npm run build:packages && npx vitest run packages`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-227): recordBusinessOptOut closes every studio's leads for an opted-out business`.

### Task 2: API: unsubscribe applies to all studios; approval refuses opted-out contacts

**Files:**
- Modify: `apps/api/src/services/tracking.service.ts` (`recordUnsubscribe`: resolve the lead's `businessId` through `scope.leads.findById` and call `recordBusinessOptOut({ businessId, recipientEmail: campaign.recipientEmail, unsubscribableStatuses: leadStatusesInto('UNSUBSCRIBED') })` in **both** branches; log the counts with lead and business ids only), `apps/api/src/routes/outreach.routes.ts` (Ruling 5), `apps/api/AGENTS.md` (unsubscribe is cross-studio through `recordBusinessOptOut`; the approval order: sender, opt-out, right)
- Test: `apps/api/src/services/__tests__/tracking.service.spec.ts` (or wherever `recordUnsubscribe` is tested), `apps/api/src/routes/__tests__/api.routes.spec.ts`, `apps/api/src/routes/__tests__/tenant-isolation.spec.ts`

- [ ] **Step 1: Failing tests:**
  - Service: `recordUnsubscribe` calls `recordBusinessOptOut` with the lead's `businessId`, the campaign's `recipientEmail` and exactly `leadStatusesInto('UNSUBSCRIBED')`, also on the repeat branch. The returned `{ found, alreadyUnsubscribed, leadId }` is unchanged.
  - `tenant-isolation.spec.ts`, real MongoDB:
    - `an unsubscribe from studio A's email closes studio C's lead of the same business`: C's lead is `UNSUBSCRIBED`, and the response body is the same as before this change (compare with the existing assertions).
    - `a repeated unsubscribe completes an interrupted opt-out and answers the same`: set up the campaign as already `UNSUBSCRIBED`, with the business not yet opted out.
    - `the opted-out address under another studio's business is refused at approval`: `409 BUSINESS_OPTED_OUT`, including the address-case variant.
  - Route spec: approve on an opted-out business gives `409 BUSINESS_OPTED_OUT` with nothing written, ahead of `CONTACT_RIGHT_REQUIRED`. The test send is still allowed.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-227): an unsubscribe opts the business out for every studio; approval refuses opted-out contacts`.

### Task 3: Worker refuses a suppressed recipient

**Files:**
- Modify: `apps/workers/src/workers/email.worker.ts` (Ruling 6; the outreach error is built and parsed with `LeadOutreachErrorSchema`, like REV-226), `apps/workers/src/models/` (re-export `isAddressSuppressed`), `apps/workers/AGENTS.md` (the order: …, sender, right, **suppressed recipient**, MX, claim, outbox)
- Test: `apps/workers/src/workers/__tests__/email.worker.spec.ts`

- [ ] **Step 1: Failing tests:**
  - `returns the lead to review when the recipient opted out under any business`: `isAddressSuppressed` resolves true. `revertOutreachApproval` is called with `CONTACT_OPTED_OUT`, and the value passes `LeadOutreachErrorSchema`. No claim, outbox, `SENT` or MX call.
  - `an UNSUBSCRIBED lead (business opted out) still aborts at the HITL gate`: the existing test, renamed or added, confirming nothing is sent.
  - `a non-suppressed recipient sends as today`.
- [ ] **Step 2:** Run `npx vitest run apps/workers/src/workers`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, then run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green, lint 0 errors and no new warnings.
- [ ] **Step 5:** Check end to end on an isolated stack (memory `email-e2e-isolated-stack`: in-memory replset :27118, a spare Redis DB with DBSIZE 0, API :4100, workers on the same DB). Insert directly:
  * studios A and C with senders;
  * business X with A's lead (`SENT`, campaign `DELIVERED` with a `trackingToken`) and C's lead (`NEEDS_APPROVAL`, with an active right for C, an `@gmail.com` contact);
  * business Y in studio C whose contact is A's recipient address.

  Then:
  1. Approve C's X lead → 200, so its job is delayed 15–45 s.
  2. Immediately `POST /track/unsubscribe/<A's token>` → the same answer as before the change.
  3. In the DB: X has `optedOutAt`; A's and C's X leads are `UNSUBSCRIBED`; C's campaign is `UNSUBSCRIBED`; the suppression list holds the hash only.
  4. After C's job runs: no outbox, the lead is still `UNSUBSCRIBED`, and the worker log shows the HITL abort.
  5. Approve C's Y lead → `409 BUSINESS_OPTED_OUT`.
  6. Repeat the unsubscribe → the same answer, and nothing changes.

  Paste the responses and DB reads. Tear down by port/PID only and flush the spare Redis DB.
- [ ] **Step 6:** Commit `feat(REV-227): the email worker refuses a recipient who opted out`.

No dashboard change (`dashboardTouched: false`). Showing the opt-out and `CONTACT_OPTED_OUT` is REV-228.

**Docs to update in `../Revamp-docs`** (orchestrator, after merge):
- `blueprint.md`: the unsubscribe flow (cross-studio, one transaction), the approve row (`BUSINESS_OPTED_OUT` at approval and the order), and the `email-queue` order.
- `spec.md`: a US4 requirement.
- `database-expertise.md`: the `leads.outreachError` codes and the `suppressedaddresses` and `businesses.optedOutAt` rows (now written by unsubscribe).
- OpenAPI: approve 409 `BUSINESS_OPTED_OUT`, the `outreachError` code enum, CHANGELOG 2.3.0.
- `errors.md` (the `BUSINESS_OPTED_OUT` row now covers approval).
- `npm run docs:index` and `docs:check-dictionary`.
