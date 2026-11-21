# REV-202 Atomic Lead Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding a lead either fully succeeds (Lead + Audit + audit job) or leaves the lead in `AUDIT_FAILED` with a readable `auditError`, never `QUEUED` with no audit or no job.

**Architecture:** Lead and Audit are inserted in one MongoDB transaction by a helper in `@revamp/db` (the replica set came with REV-198). The enqueue runs after the commit through an API helper with a timeout, because the API's ioredis connection uses `maxRetriesPerRequest: null`, so `queue.add` waits forever while Redis is down instead of failing. On enqueue failure the lead moves `QUEUED → AUDIT_FAILED` (new edge) and the API answers `503 AUDIT_QUEUE_UNAVAILABLE`. A dry-run repair script fixes leads already stranded.

**Tech Stack:** Mongoose 8 transactions, BullMQ, Vitest, mongodb-memory-server (`startMongoReplSet`).

**Spec:** Linear REV-202; roadmap `docs/superpowers/plans/2026-11-15-database-criterion-roadmap.md` §3 and decision D3.

## Global Constraints

- Every `Lead.status` write checks `LEAD_TRANSITIONS` as an atomic filter (`leadStatusesInto(to)`), AGENTS.md §3.2.8.
- Errors are `AppError(status, code, message, details?)`; codes come from `API_ERROR_CODES` (and blueprint.md §5), AGENTS.md §3.2.9.
- Real-Mongo tests go only in `packages/db/src/__tests__/real-mongo.spec.ts`, sharing its one server.
- Scripts run as `revamp_app`; log URIs only through `redactMongoUri`.

## Rulings (decided here, say so in the PR)

1. **AUDIT_FAILED, not delete** (roadmap D3): reuses Retry audit, the operator sees why, and the discovery `externalId` dedupe keeps working.
2. **Enqueue timeout `AUDIT_ENQUEUE_TIMEOUT_MS = 5000`.** Without it a Redis outage hangs the request rather than failing. If the add lands late, after the timeout, the worker's `QUEUED|AUDITING` filter doesn't match an `AUDIT_FAILED` lead, so the job only marks its audit `FAILED` and the lead stays recoverable (already the worker's behavior, lines 34–43; pinned by one worker test).
3. **Retry audit (`POST /audits/trigger`) uses the same enqueue helper.** It has the identical stranded-`QUEUED` failure, and the fix is one call.
4. **Discovery import stops creating leads after the first enqueue failure.** The rest get `failed` without a lead, so one outage costs one 5 s timeout, not one per candidate. The candidate whose lead was created gets `failed` with its `leadId`. No new outcome, so no new locale strings.
5. **Repair script skips leads younger than 10 minutes**, so it never races a request in flight.

## Review Focus

1. Redis down → request returns 503 within ~5 s, not hanging (Task 3, timeout test with fake timers).
2. The guarded AUDIT_FAILED write finds the lead already moved on (the worker picked up a late job): no overwrite, still 503 (Task 3).
3. Audit insert throws → no Lead document left (Task 2, real Mongo).
4. Discovery batch with Redis down mid-way: earlier imports stay `imported`, later ones are not created (Task 4).
5. Repair script on a lead whose job is waiting or delayed in BullMQ: left alone (Task 5).

---

### Task 1: `QUEUED → AUDIT_FAILED` edge and the error code

**Files:**
- Modify: `packages/validation/src/lead-status.ts:18` (+ doc comment line: "QUEUED → AUDIT_FAILED is a failed enqueue (REV-202)")
- Modify: `packages/shared-types/src/index.ts` (`API_ERROR_CODES`, "Leads and audits" group: `'AUDIT_QUEUE_UNAVAILABLE'`)
- Test: the existing lead-status spec in `packages/validation/src/__tests__/`

**Interfaces:** Produces `canTransition('QUEUED','AUDIT_FAILED') === true`; `leadStatusesInto('AUDIT_FAILED')` includes `QUEUED`; code `AUDIT_QUEUE_UNAVAILABLE`.

- [ ] Test: `canTransition('QUEUED', 'AUDIT_FAILED')` is true; `leadStatusesInto('AUDIT_FAILED')` contains `'QUEUED'` and `'AUDITING'`. Run, see FAIL.
- [ ] Add the edge and the code; `npm run build:packages`; run, see PASS; check that no dashboard test hard-codes the transition table.
- [ ] Commit `feat(REV-202): allow QUEUED → AUDIT_FAILED for a failed enqueue`.

### Task 2: `createLeadWithAudit` transaction in `@revamp/db`

**Files:**
- Create: `packages/db/src/create-lead-with-audit.ts`, exported from `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/real-mongo.spec.ts` (new `describe('createLeadWithAudit (REV-202)')`)

**Interfaces:** Produces
`createLeadWithAudit(lead: Record<string, unknown>): Promise<{ lead: ILeadDocument; audit: IAuditDocument }>`.
It runs `mongoose.connection.transaction(async (session) => …)` with `Lead.create([lead], { session })` and `Audit.create([{ leadId, status: 'QUEUED' }], { session })`. The caller sets `status: 'QUEUED'` in `lead`.

- [ ] Tests (real Mongo): happy path → one Lead `QUEUED` and one Audit `QUEUED` with that `leadId`; `vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('boom'))` → rejects with `boom` and `Lead.countDocuments()` is 0. Run, see FAIL.
- [ ] Implement; run, see PASS.
- [ ] Commit `feat(REV-202): create Lead and Audit in one transaction`.

### Task 3: API: transactional create plus a guarded enqueue

**Files:**
- Create: `apps/api/src/services/audit-enqueue.ts`
- Modify: `apps/api/src/services/lead.service.ts:50-104`, `apps/api/src/routes/audit.routes.ts` (the trigger route's `addAuditJob` call)
- Test: `apps/api/src/services/__tests__/audit-enqueue.spec.ts`, `lead.service.spec.ts` (switch the `Lead.create`/`Audit.create` mocks to `createLeadWithAudit`), the audit routes spec (trigger + 503), `apps/workers/.../audit.worker` spec (late job on an `AUDIT_FAILED` lead)

**Interfaces:**
- `export const AUDIT_ENQUEUE_TIMEOUT_MS = 5000`
- `enqueueAuditOrFail(params: { leadId: string; auditId: string; url: string; niche: string }, timeoutMs = AUDIT_ENQUEUE_TIMEOUT_MS): Promise<{ jobId?: string }>`. On reject or timeout:
  - `Lead.findOneAndUpdate({ _id: leadId, status: { $in: leadStatusesInto('AUDIT_FAILED') } }, { $set: { status: 'AUDIT_FAILED', auditError: AUDIT_QUEUE_ERROR } })`
  - `Audit.updateOne({ _id: auditId, status: 'QUEUED' }, { $set: { status: 'FAILED', errorMessage: AUDIT_QUEUE_ERROR } })`
  - then throws `AppError(503, 'AUDIT_QUEUE_UNAVAILABLE', 'The audit could not be queued; retry the audit from the lead', { leadId })`. If either update itself throws, log it and still throw the `AppError`.
- `AUDIT_QUEUE_ERROR = 'The audit queue was unavailable when the lead was added. Retry the audit.'`

- [ ] Tests (`audit-enqueue.spec.ts`, models and queue mocked): resolves `{ jobId }` on success; `addAuditJob` rejects → lead update filter equals `{ _id, status: { $in: leadStatusesInto('AUDIT_FAILED') } }`, audit marked FAILED, throws `AUDIT_QUEUE_UNAVAILABLE` with `details.leadId`; `addAuditJob` never resolves + `vi.useFakeTimers()` + advance 5000 ms → same 503; lead update returns null (already moved on) → still 503 and the audit update is still guarded on `status: 'QUEUED'`; the lead update throws → still 503.
- [ ] Tests (`lead.service.spec.ts`): `createLeadWithAudit` rejects → `addAuditJob` not called and the error propagates; enqueue fails → `createLead` rejects with `AUDIT_QUEUE_UNAVAILABLE`. Routes spec: `POST /audits/trigger` with the enqueue failing → 503, body `error.code === 'AUDIT_QUEUE_UNAVAILABLE'`. Worker spec: an `AUDIT_FAILED` lead gets no status write and its audit is marked FAILED. Run, see FAIL.
- [ ] Implement `audit-enqueue.ts`; `createLead` calls `createLeadWithAudit` and then `enqueueAuditOrFail`; the trigger route calls `enqueueAuditOrFail`. Run, see PASS.
- [ ] Commit `fix(REV-202): a failed audit enqueue moves the lead to AUDIT_FAILED`.

### Task 4: Discovery import stops after a queue failure

**Files:** Modify `apps/api/src/services/discovery.service.ts:151-175`; Test `apps/api/src/services/__tests__/discovery.service.spec.ts`

**Interfaces:** Consumes the `AppError` code `AUDIT_QUEUE_UNAVAILABLE` and `details.leadId` from Task 3.

- [ ] Test: three new candidates; `createLead` resolves for #1, throws `AppError(503,'AUDIT_QUEUE_UNAVAILABLE',…,{leadId:'L2'})` for #2 → results `imported`, `{ outcome:'failed', leadId:'L2' }`, `{ outcome:'failed' }`; `createLead` called twice; `imported === 1`. Any other error still `failed` and the loop continues (existing behavior). Run, see FAIL.
- [ ] Implement with a `queueDown` flag set on that code; once it's set, push `failed` without calling `createLead`. Run, see PASS.
- [ ] Commit `fix(REV-202): discovery import stops creating leads once the audit queue is down`.

### Task 5: Repair script for stranded `QUEUED` leads

**Files:**
- Create: `apps/api/src/services/queued-lead-repair.ts` (pure planner), `apps/api/src/scripts/repair-queued-leads.ts`
- Modify: `apps/api/package.json` (`"repair:queued-leads": "tsx src/scripts/repair-queued-leads.ts"`)
- Test: `apps/api/src/services/__tests__/queued-lead-repair.spec.ts`

**Interfaces:**
- `export const QUEUED_REPAIR_MIN_AGE_MS = 10 * 60_000`
- `planQueuedLeadRepair(input: { leads: Array<{ _id: string; createdAt: Date; updatedAt: Date }>; latestAuditByLead: Map<string, { _id: string; status: AuditStatus } | undefined>; leadIdsWithJob: Set<string>; now: Date }): Array<{ leadId: string; auditId?: string; reason: 'no_audit' | 'no_job' }>`. It skips leads whose `updatedAt` is younger than the minimum age and leads in `leadIdsWithJob`.
- The script is a dry run by default; `-- --apply` writes. It reads `QUEUED` leads, their latest audit, and the jobs in `waiting|active|delayed|prioritized|paused` (their `data.leadId`). It writes the same guarded update as Task 3, with `auditError` "Found in QUEUED with no audit job (REV-202 repair). Retry the audit.", marks a `QUEUED` audit `FAILED`, prints one line per lead plus a total, connects as `MONGODB_URI` and closes Mongo and the queue at the end.

- [ ] Tests: no audit → `no_audit`; audit `QUEUED` and no job → `no_job`; has a job → skipped; younger than 10 min → skipped; audit `PROCESSING` and no job → `no_job`. Run, see FAIL.
- [ ] Implement the planner and the script; run the tests, see PASS; run the script once against local dev in dry-run mode and paste the output into the PR.
- [ ] Commit `feat(REV-202): dry-run repair for leads stranded in QUEUED`.

### Task 6: Gates, e2e, docs

- [ ] `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`, all green.
- [ ] E2E on the dev stack: stop Redis only (`docker stop revamp-redis`, briefly, other sessions share it, so restart right away), Add lead in the dashboard → error shown within ~5 s, the lead shows in Needs you as Audit failed with the message; start Redis, Retry audit → it audits. No new console errors.
- [ ] Docs in this PR: README (the `repair:queued-leads` script; the integrity note), AGENTS.md §3.2.8 (one line: lead creation is transactional, a failed enqueue gives `AUDIT_FAILED`). In `../Revamp-docs`: `blueprint.md` §5 (`AUDIT_QUEUE_UNAVAILABLE`) plus the add-lead sequence; `spec.md` (`POST /leads` 503, the new transition); the integrity section of the data dictionary is REV-200, not written yet, so leave a comment on REV-200.
