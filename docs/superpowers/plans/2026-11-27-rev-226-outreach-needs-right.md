# REV-226 (E2.3) Outreach Needs an Active Contact Right Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch each new test fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** Approving outreach requires an active contact right of the caller's studio for the lead's business (`409 CONTACT_RIGHT_REQUIRED` otherwise). The email worker re-checks at send time: if the right is gone, it records nothing, returns the lead to review, and leaves a readable reason on the lead. The state-machine table gains a guard that names which target statuses need a right.

**Architecture:**
* A guard `requiresContactRight(to)` sits next to `LEAD_TRANSITIONS` in `@revamp/validation`, true for `SCHEDULED` and `SENT`.
* The API reads the right through the tenant scope: a new `rights` repository of `scopeFor`, with `ContactRight` added to the tenant guard.
* The worker uses `findActiveContactRight` (REV-224) with the job's checked tenant.
* A failed check at send time reuses `revertOutreachApproval`, which gains an optional `outreachError`. That error is stored on the lead as a typed subdocument and cleared by the next approval.

**Tech Stack:** Mongoose, Express, BullMQ, Zod, Vitest.

**Spec:** Linear REV-226 and epic REV-170. The registry is from REV-224, the claim on add from REV-225. Read root `AGENTS.md`, `apps/api/AGENTS.md`, `apps/workers/AGENTS.md` and `packages/db/AGENTS.md` first.

## Rulings

1. **Active right** = `findActiveContactRight({ tenantId: <lead's studio>, businessId: lead.businessId }, now)`: granted, not expired, not ended. A lead without `businessId` (before REV-208's migration) has no right, so approval is refused.
2. **Approve order:** keep every existing check (id, lead found, `canApproveOutreach`, `NO_CONTACT_EMAIL`, `SENDER_NOT_CONFIGURED`). Then `requiresContactRight('SCHEDULED')` plus the right check: `409 CONTACT_RIGHT_REQUIRED`, message "Your studio's right to contact this business has ended; outreach can no longer be approved.", `details: { expiredAt? }` (the studio's latest right's `expiresAt` or `endedAt` when there is one). Nothing is written or queued. Add the code to `API_ERROR_CODES`.
3. **Test sends stay allowed** (to the operator, not outreach).
4. **Worker,** after the sender check and before the MX check: if `requiresContactRight('SENT')` and there is no active right, call `revertOutreachApproval(leadId, { outreachError: { code: 'CONTACT_RIGHT_EXPIRED', message: 'The right to contact this business ended before the email was sent. Nothing was sent.', at: now } })`, log, and return `{ success: false, aborted: true, reason }`. Nothing is claimed, no outbox is written, no `SENT`.
   * An opt-out (REV-227) ends the right (`endContactRight`) and moves the lead to `UNSUBSCRIBED`. The existing HITL gate then aborts, and if the lead somehow is still `SCHEDULED`, this same check catches it, since an ended right is not active.
5. **`Lead.outreachError`:** a typed subdocument `{ code: enum ['CONTACT_RIGHT_EXPIRED'], message: String max 500, at: Date }`, `_id: false`. It is validated with `LeadOutreachErrorSchema` (`@revamp/validation`) before it is written (packages/db rule). `approveOutreachWithCampaign` clears it (`$unset`). The dashboard shows it in REV-228. The code list `LEAD_OUTREACH_ERROR_CODES` lives in shared-types so REV-227 can extend it.
6. **No new lead status.** `SCHEDULED → NEEDS_APPROVAL` already exists (REV-203), and "right ended" is a reason, not a stage. The `LEAD_TRANSITIONS` table is unchanged: the guard sits next to it, with tests.
7. **Tenant scope:** `TenantScope.rights: Repository<IContactRightDocument>`. Add `'ContactRight'` to `GUARDED` in `apps/api/src/__tests__/tenant-guard.ts`, with a planted test line. The API's active-right read is `activeContactRight(scope, businessId, now)` in `apps/api/src/data/contact-rights.ts` (inside `data/`).

## Global Constraints

- HITL unchanged: a right never sends anything by itself; only an approved `SCHEDULED` lead is processed.
- The state machine stays the single source: use `requiresContactRight` in both places, never a local status list.
- Errors via `AppError` with codes from `API_ERROR_CODES`.
- Worker writes add the studio (`withTenant`); `findActiveContactRight` is called with the job's checked tenant.
- Real-MongoDB tests only in `real-mongo.spec.ts`. Worker specs mock models as today.

## Review Focus

1. **The right expires between approval and the delayed job (15–45 s, or longer behind the limiter).** The worker must abort with `CONTACT_RIGHT_EXPIRED` and write nothing. Test: `email.worker.spec.ts › returns the lead to review when the right expired after approval` (Task 3).
2. **A retried job after the outbox was written** (campaign `DELIVERED`) while the right has meanwhile expired. The existing DELIVERED short-circuit must still finish the lead as `SENT`: the email was recorded while the right was active. Test: `› a delivered campaign finishes as SENT even if the right expired since` (Task 3). The right check therefore comes **after** the DELIVERED short-circuit.
3. **Studio B's lead for a business studio A holds** (a conflict from the REV-224 migration) must be refused at approval: the right check uses B's tenant. Test: `tenant-isolation.spec.ts › a studio without the right cannot approve its conflicting lead` (Task 2).
4. **Approving again after a CONTACT_RIGHT_EXPIRED revert** (once a new right exists) clears `outreachError`. Test: real-MongoDB `› approveOutreachWithCampaign clears outreachError` (Task 1).
5. **The worker on an opted-out business whose lead is still SCHEDULED** (REV-227 not yet shipped, right ended by hand). Test: `› an ended right is not active: lead returned to review` (Task 3).

---

### Task 1: Guard, outreach error and the revert option

**Files:**
- Modify: `packages/validation/src/lead-status.ts` (`requiresContactRight`), `packages/validation/src/index.ts` (`LeadOutreachErrorSchema`), `packages/shared-types/src/index.ts` (`LEAD_OUTREACH_ERROR_CODES = ['CONTACT_RIGHT_EXPIRED'] as const`, `ILeadOutreachError`, `ILead.outreachError?`, `API_ERROR_CODES` += `CONTACT_RIGHT_REQUIRED`), `packages/db/src/models/Lead.model.ts`, `packages/db/src/approve-outreach.ts`
- Test: the validation package's lead-status spec, `packages/db/__tests__/models.spec.ts`, `packages/db/src/__tests__/real-mongo.spec.ts` (the existing REV-203 describe)

**Interfaces:**
```ts
export function requiresContactRight(to: LeadStatus): boolean        // true for 'SCHEDULED' and 'SENT' only
export const LeadOutreachErrorSchema = z.object({ code: z.enum(LEAD_OUTREACH_ERROR_CODES), message: z.string().min(1).max(500), at: z.coerce.date() });
export async function revertOutreachApproval(leadId: string, options?: { outreachError?: ILeadOutreachError }): Promise<boolean>
  // with outreachError: parsed by LeadOutreachErrorSchema, then $set on the lead in the same update that moves it back
// approveOutreachWithCampaign: the lead update adds $unset: { outreachError: '' }
```
- [ ] **Step 1: Failing tests:**
  - `requiresContactRight` is true exactly for `SCHEDULED` and `SENT`, checked over every value of `LEAD_STATUSES`. Every status for which it is true is a target in `LEAD_TRANSITIONS`.
  - The schema accepts a valid error and rejects an unknown code and a 501-character message.
  - `Lead` accepts `outreachError` and rejects an unknown code.
  - Real MongoDB: `revertOutreachApproval(id, { outreachError })` sets it and moves the lead back. `approveOutreachWithCampaign` clears `outreachError`. An invalid `outreachError` throws before anything is written.
- [ ] **Step 2:** Run `npx vitest run packages`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm run build:packages && npx vitest run packages`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-226): requiresContactRight guard and the lead's outreach error`.

### Task 2: API: approval needs an active right

**Files:**
- Modify: `apps/api/src/data/tenant-scope.ts` (`rights`), `apps/api/src/__tests__/tenant-guard.ts` and its spec (`GUARDED` += `ContactRight`, plus a planted line), `apps/api/src/routes/outreach.routes.ts`, `apps/api/src/models/` (re-export `ContactRight` if the API needs it), `apps/api/AGENTS.md` (approval: the right check and its order, test send exempt)
- Create: `apps/api/src/data/contact-rights.ts`
- Test: `apps/api/src/routes/__tests__/api.routes.spec.ts`, `apps/api/src/routes/__tests__/tenant-isolation.spec.ts`, `apps/api/src/__tests__/tenant-guard.spec.ts`

**Interfaces:**
```ts
// data/contact-rights.ts
export async function activeContactRight(scope: TenantScope, businessId: Types.ObjectId | string | undefined, now?: Date): Promise<IContactRightDocument | null>
export async function latestContactRight(scope: TenantScope, businessId: Types.ObjectId | string | undefined): Promise<IContactRightDocument | null>   // for details.expiredAt
```
- [ ] **Step 1: Failing tests:**
  - Route spec: approve with no active right gives `409 CONTACT_RIGHT_REQUIRED`, `approveOutreachWithCampaign` and `addEmailDispatchJob` are not called, and `details.expiredAt` is set when a past right exists. With an active right, approve works as today. The test send still works with no right.
  - `tenant-isolation.spec.ts`, real MongoDB: studio A holds the business; studio B has a conflicting `NEEDS_APPROVAL` lead (inserted directly, as the migration would leave it). B's approve gives `409 CONTACT_RIGHT_REQUIRED`, A's approve succeeds.
  - Tenant guard: the scanner catches `ContactRight.findOne(…)` outside `data/`.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement. The check goes after `requireSender` and before the transaction.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-226): approving outreach needs the studio's active contact right`.

### Task 3: Worker re-checks the right at send time

**Files:**
- Modify: `apps/workers/src/workers/email.worker.ts`, `apps/workers/src/models/` (re-export `findActiveContactRight` and `ContactRight` the way `revertOutreachApproval` is re-exported), `apps/workers/AGENTS.md` (the order: HITL, campaign, DELIVERED short-circuit, sender, **right**, MX, claim, outbox)
- Test: `apps/workers/src/workers/__tests__/email.worker.spec.ts`

- [ ] **Step 1: Failing tests:**
  - `returns the lead to review when the right expired after approval`: `findActiveContactRight` resolves null. `revertOutreachApproval` is called with `outreachError.code === 'CONTACT_RIGHT_EXPIRED'`. No claim, no campaign update to `DELIVERED`, no lead `SENT`, no MX call.
  - `an ended right is not active: lead returned to review`.
  - `a delivered campaign finishes as SENT even if the right expired since`.
  - `reads the right of the job's studio only`: `findActiveContactRight` is called with `{ tenantId: <job tenant ObjectId>, businessId: lead.businessId }`.
  - With an active right, the simulated send works as today.
- [ ] **Step 2:** Run `npx vitest run apps/workers/src/workers`. Expected: FAIL.
- [ ] **Step 3:** Implement per Ruling 4, placed after the DELIVERED short-circuit and the sender check.
- [ ] **Step 4:** Rerun, then run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green, lint 0 errors and no new warnings.
- [ ] **Step 5:** Check end to end on an isolated stack (memory `email-e2e-isolated-stack`: in-memory replset :27118, a spare Redis DB with DBSIZE 0, API :4100, **workers on that DB only**, no Vite needed). With curl:
  1. Register a studio and set its sender.
  2. Insert a business, a `NEEDS_APPROVAL` lead with a real-MX address (for example `@gmail.com`) and an active right for it directly in the isolated DB (`grantContactRight` through a small `tsx` script, or raw inserts matching the schema).
  3. Approve → 200. Before the job runs (it waits 15–45 s), set the right's `expiresAt` and the hold's `expiresAt` into the past in the DB.
  4. After the job: the lead is `NEEDS_APPROVAL` with `outreachError.code CONTACT_RIGHT_EXPIRED`, the campaign is not `DELIVERED`, and there is no `outbox`.
  5. Approve again → `409 CONTACT_RIGHT_REQUIRED` with `details.expiredAt`.
  6. Restore an active right and approve again → 200, and after the job the lead is `SENT` with `outreachError` cleared.

  Paste the responses and DB reads into the report. Tear down by port/PID only and flush the spare Redis DB.
- [ ] **Step 6:** Commit `feat(REV-226): the email worker re-checks the contact right before sending`.

No dashboard change (`dashboardTouched: false`). Showing `outreachError` and the refusal is REV-228.

**Docs to update in `../Revamp-docs`** (orchestrator, after merge):
- `blueprint.md`: §5 `CONTACT_RIGHT_REQUIRED`, the approve row, and `email-queue` (the right check and its place in the order).
- `spec.md`: a requirement for US3.
- `database-expertise.md`: `leads.outreachError`.
- The OpenAPI approve 409, the error enum, and a CHANGELOG entry (2.2.0).
- `errors.md`.
- `npm run docs:index` and `docs:check-dictionary`.
