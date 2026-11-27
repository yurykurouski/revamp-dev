# REV-225 (E2.2) Claim the Contact Right on Add Lead Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch each new test fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** Adding a lead (`POST /leads`) and importing from discovery claim the studio's contact right for the business in the same transaction that creates the lead. A business held by another studio, in cooldown, or opted out is refused with a dedicated 409, and no lead is created. Discovery candidates carry an `unavailable` marker so the dashboard (REV-228) can show them.

**Architecture:** `addLeadToBusiness` (`@revamp/db`) gains an optional `contactRight: { durations, source }`. With a studio and that option, it calls `grantContactRight` (REV-224) inside its transaction right after creating the lead. A refusal throws `ContactRightRefusedError`, which aborts the transaction, so the lead, its audit and a new business all roll back. `LeadService.createLead` passes the API's durations and maps the error to `AppError`. The discovery service reads the shared `Business` (`contactHold`, `optedOutAt`) and the suppressed hashes for its `new` candidates.

**Tech Stack:** Mongoose transactions, Express, Zod, Vitest (route specs with `authedRequest`, real-MongoDB `tenant-isolation.spec.ts`, `real-mongo.spec.ts`).

**Spec:** Linear REV-225 and epic REV-170. The registry API is from REV-224 (`packages/db/src/contact-rights.ts`). Read root `AGENTS.md`, `apps/api/AGENTS.md` and `packages/db/AGENTS.md` first.

## Rulings

1. **Error codes** (add to `API_ERROR_CODES` and blueprint §5):
   * `409 CONTACT_RIGHT_HELD` with `details: { expiresAt }`
   * `409 BUSINESS_IN_COOLDOWN` with `details: { availableAt }`
   * `409 BUSINESS_OPTED_OUT`, with no details

   Messages: "Another studio holds the right to contact this business until <ISO>.", "This business can be contacted again from <ISO>.", "This business asked not to be contacted." No other studio's id, name or lead appears anywhere.
2. **The order of checks:** today's `LEAD_ALREADY_EXISTS` (the studio's own lead) comes first and is unchanged. Then the grant.
3. **A failed audit enqueue keeps the right.** This deviates from the ticket's wording ("the right is reverted"). Today a failed enqueue does not remove the lead: it becomes `AUDIT_FAILED` and the operator presses Retry audit (REV-202). The lead exists and can continue, so its right stays. Reverting it would leave a live lead without a right. Only an aborted add transaction (no lead at all) leaves no right, and the transaction guarantees that.
4. **The suppression check** passes the lead's `contactEmail` to the grant. Discovery's guessed `info@<domain>` is checked the same way.
5. **Response:** `POST /leads` 201 `data` gains `contactRight: { expiresAt }` (ISO). The service returns it as `contactRightExpiresAt`.
6. **Discovery candidate marking:** the `status` values are unchanged, so the dashboard's count maps keep compiling. A `new` candidate gains an optional `unavailable?: { reason: ContactRightRefusal; until?: string }` (`until` = `expiresAt` for held, `availableAt` for cooldown). It is set in `withCurrentLeads` (every status read) and re-checked at import.
   * Import outcomes gain `'right_held' | 'cooldown' | 'opted_out'`, and a result carries `until` when there is one.
   * A business held by **this** studio has a lead already, so it shows as `existing_lead` as today.
   * Showing and disabling these in the dashboard is REV-228; this ticket only provides the data.
7. **Scripts** (no `tenantId`) never claim a right: unchanged behavior.
8. **Durations:** the API env `CONTACT_RIGHT_DAYS` and `CONTACT_COOLDOWN_DAYS` (added in REV-224) are passed as `{ rightDays, cooldownDays }`.
9. **The reused-audit path** (business already audited → lead `AUDITED`, generation queued) claims the right the same way, in the same transaction.

## Global Constraints

- Errors only through `AppError` and `errorHandler`; codes from `API_ERROR_CODES`.
- Tenant isolation: the `Business` and `SuppressedAddress` reads are shared data, not tenant-owned, so they are allowed outside `data/`. They must return only the refusal reason and date, never the holder. `ContactRight` is not queried by the API in this ticket.
- New route behavior needs tests in `api.routes.spec.ts` (or the lead route spec), and the cross-studio case in `tenant-isolation.spec.ts` (real MongoDB).
- OpenAPI: `../Revamp-docs/api-docs/reference/openapi.yaml` is updated by the orchestrator after the merge; list the changes under `Docs to update`.

## Review Focus

1. **Two studios add the same new site at the same moment.** One gets 201 with a right, the other `CONTACT_RIGHT_HELD`, and exactly one lead exists. Test: real-MongoDB `› two studios adding one new site at once: one lead, one right, one CONTACT_RIGHT_HELD` (Task 1).
2. **A refused add for a site nobody had before must not leave an orphan `Business`.** The business upsert is in the aborted transaction. Test: `› a refused add leaves no lead, no audit and no new business` (Task 1, with a pre-suppressed contact email so a brand-new business is refused).
3. **The 409 body must not leak studio A.** Test: assert the JSON string doesn't contain studio A's id or name (Task 2).
4. **A discovery import of 3 candidates where the middle one is held:** the first and third are imported, the middle reports `right_held` with `until`, and the loop continues (it does not trip `queueDown`). Test (Task 3).
5. **A lead added with the audit reused** gets its right too. Test (Task 1).

---

### Task 1: `addLeadToBusiness` claims the right

**Files:**
- Modify: `packages/db/src/add-lead-to-business.ts`, `packages/db/src/contact-rights.ts` (export the error)
- Test: `packages/db/src/__tests__/real-mongo.spec.ts`, inside the existing `describe('addLeadToBusiness (REV-208)')` or a new nested `describe('… claims the contact right (REV-225)')`

**Interfaces:**
```ts
// contact-rights.ts
export class ContactRightRefusedError extends Error {
  readonly code = 'CONTACT_RIGHT_REFUSED';
  constructor(readonly reason: ContactRightRefusal, readonly until?: Date) { … }   // until: expiresAt (held) | availableAt (cooldown)
}
// add-lead-to-business.ts
export interface AddLeadInput { …; contactRight?: { durations: ContactRightDurations; source: ContactRightSource; now?: Date } }
export interface AddLeadResult { …; contactRight?: IContactRightDocument }
```
Inside the transaction, after the lead is created (both paths), and only when `input.tenantId && input.contactRight`: call `grantContactRight({ tenantId, businessId, leadId, contactEmail: lead.contactEmail, source, durations, now, session })`. On `granted: false`, throw `ContactRightRefusedError`. The outer `.catch` must rethrow it unchanged (not treated as E11000).

- [ ] **Step 1: Failing tests:**
  - A free business: the result has `contactRight` with `expiresAt = now + rightDays`, and the business's `contactHold.rightId` equals it.
  - The reused-audit path gets a right too.
  - Business held by studio A, studio B adds it: `ContactRightRefusedError('held', expiresAt)`, no lead for B, no new audit.
  - Cooldown gives `('cooldown', availableAt)`. Opted out gives `('opted_out')`.
  - `a refused add leaves no lead, no audit and no new business`: a suppressed contact email on a brand-new domain; `Business.countDocuments({ domain })` is 0.
  - `two studios adding one new site at once: one lead, one right, one CONTACT_RIGHT_HELD`.
  - Without `contactRight` (script path), no right is written: existing behavior.
- [ ] **Step 2:** `npx vitest run packages/db/src/__tests__/real-mongo.spec.ts -t "REV-225"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, plus the whole `real-mongo.spec.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-225): adding a lead claims the contact right in the same transaction`.

### Task 2: API: `POST /leads` claims and maps refusals

**Files:**
- Modify: `packages/shared-types/src/index.ts` (`API_ERROR_CODES` += `CONTACT_RIGHT_HELD`, `BUSINESS_IN_COOLDOWN`, `BUSINESS_OPTED_OUT`), `apps/api/src/services/lead.service.ts`, `apps/api/src/controllers/lead.controller.ts`, `apps/api/AGENTS.md` (Transactions section: Add lead claims the right; the three codes; a failed enqueue keeps the right; Ruling 3)
- Test: the lead route spec (`apps/api/src/routes/__tests__/api.routes.spec.ts` or the existing lead spec) and `apps/api/src/routes/__tests__/tenant-isolation.spec.ts`

**Interfaces:**
```ts
// lead.service.ts createLead(...) passes contactRight: { durations: { rightDays: env.CONTACT_RIGHT_DAYS, cooldownDays: env.CONTACT_COOLDOWN_DAYS }, source: 'ADD_LEAD' }
// returns { …, contactRightExpiresAt?: Date }; maps ContactRightRefusedError → AppError per Ruling 1
export function contactRightRefusal(error: ContactRightRefusedError): AppError   // in lead.service.ts, reused by discovery
// controller: data.contactRight = { expiresAt: result.contactRightExpiresAt.toISOString() } when present
```

- [ ] **Step 1: Failing tests:**
  - Route specs (models mocked as today): each refusal maps to its status, code and details. 201 has `data.contactRight.expiresAt`. A refusal queues no audit job (`addAuditJob` not called).
  - `tenant-isolation.spec.ts` (real MongoDB): studio A adds `https://shared.example`, studio B adds the same: `409 CONTACT_RIGHT_HELD`. `details.expiresAt` equals A's right. `JSON.stringify(body)` contains neither A's organization id nor its name. B's lead count is 0.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-225): POST /leads answers CONTACT_RIGHT_HELD, BUSINESS_IN_COOLDOWN or BUSINESS_OPTED_OUT`.

### Task 3: Discovery marks and refuses unavailable candidates

**Files:**
- Modify: `packages/shared-types/src/index.ts` (`IDiscoveryCandidate.unavailable?`; `DiscoveryImportOutcome` += `'right_held' | 'cooldown' | 'opted_out'`; import result item gains `until?: string`), `apps/api/src/services/discovery.service.ts`
- Create: `packages/db/src/contact-availability.ts` (exported):
```ts
export interface ContactAvailability { reason: ContactRightRefusal; until?: Date }
export async function contactAvailabilityByDomain(
  items: Array<{ domain: string; email?: string }>, now?: Date,
): Promise<Map<string, ContactAvailability>>   // key: domain; only unavailable domains appear
```
  It runs one `Business.find({ domain: { $in } }, { domain, contactHold, optedOutAt })` and one `SuppressedAddress.find({ hash: { $in } })`, then applies the same order as the grant: opted_out (flag or email hash), then held (`now < expiresAt`), then cooldown (`now < cooldownUntil`).
- Test: `real-mongo.spec.ts` for `contactAvailabilityByDomain`; the discovery service or route spec.

- [ ] **Step 1: Failing tests:**
  - `contactAvailabilityByDomain`: a held domain gives `held` with `until = expiresAt`, a cooldown domain gives `until = cooldownUntil`, a flagged domain or suppressed email gives `opted_out`, and an unknown or free domain is absent.
  - `withCurrentLeads` adds `unavailable` to `new` candidates only, and leaves `existing_lead` and others unchanged.
  - Import of three candidates with the middle one held: outcomes `imported`, `right_held` (with `until`), `imported`. `imported` is 2.
  - A race where the domain becomes held between the read and the create: `createLead` throws `CONTACT_RIGHT_HELD`, mapped to outcome `right_held`, and the loop continues.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. In `importCandidates`, check `unavailable` (re-computed at import) before `createLead`, and also map the three `AppError` codes from `createLead` to their outcomes.
- [ ] **Step 4:** Rerun, then run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green, lint 0 errors and no new warnings.
- [ ] **Step 5:** Check against the real API on an isolated stack (memory `email-e2e-isolated-stack`: in-memory replset :27118, a spare Redis DB with DBSIZE 0, API :4100). With curl:
  1. Register studios A and B.
  2. A adds a lead for `https://shared.example` → 201 with `contactRight.expiresAt`.
  3. B adds the same → 409 `CONTACT_RIGHT_HELD` with `expiresAt`, and no mention of A.
  4. In the DB, set the business's hold to cooldown (`expiresAt` in the past, `cooldownUntil` in the future); B adds → `BUSINESS_IN_COOLDOWN`.
  5. Set `optedOutAt`; B adds → `BUSINESS_OPTED_OUT`.

  Audit jobs will be queued for A's lead. **Don't run the workers** (that would start a paid audit); flush the spare Redis DB afterwards. Paste the responses into the report and tear down by port only.
- [ ] **Step 6:** Commit `feat(REV-225): discovery marks and refuses businesses another studio holds`.

No dashboard change (`dashboardTouched: false`). The dashboard work is REV-228.

**Docs to update in `../Revamp-docs`** (orchestrator, after merge):
- `blueprint.md` §5 (three codes) and the `POST /leads` and discovery import rows.
- `spec.md` (add-lead requirement).
- `api-docs/reference/openapi.yaml`: `POST /leads` 409s and `data.contactRight`, the candidate `unavailable`, the import outcomes, the error enum. Then rebundle, and add a CHANGELOG entry (minor version).
- `api-docs/guides/errors.md`.
- `npm run docs:index`.
