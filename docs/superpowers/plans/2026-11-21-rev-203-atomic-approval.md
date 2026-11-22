# REV-203 Atomic Outreach Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Approving outreach is all-or-nothing. Either the lead is `SCHEDULED` with its approved campaign and a queued send, or it is back in `NEEDS_APPROVAL` with a readable error, and the operator can approve again.

**Architecture:** This mirrors REV-202.
- A new `approveOutreachWithCampaign` in `@revamp/db` writes the lead status (`NEEDS_APPROVAL → SCHEDULED`, atomic filter) and the campaign upsert in one transaction.
- A new `enqueueEmailOrRevert` in `apps/api/src/services/email-enqueue.ts` queues the send with a bounded timeout. It refuses at once while Redis isn't `ready`.
- On failure, a second transaction moves the lead `SCHEDULED → NEEDS_APPROVAL` and the campaign back to `NEEDS_APPROVAL`, clearing its approval stamps. The API then answers `503 EMAIL_QUEUE_UNAVAILABLE`.
- A new `SCHEDULED → NEEDS_APPROVAL` edge in `LEAD_TRANSITIONS` allows that revert.
- A dry-run repair script moves leads already stranded in `SCHEDULED` back to review.

**Tech Stack:** Mongoose 8 transactions, BullMQ/ioredis, Express, Vitest, mongodb-memory-server (`real-mongo.spec.ts`).

**Spec:** Linear REV-203 acceptance criteria, plus AGENTS.md §3.2.1 (HITL), §3.2.7, §3.2.8 (state machine, REV-202 pattern) and §3.2.9 (error format).

## Global Constraints

- HITL holds. Nothing is sent unless the lead is `SCHEDULED` at send time; the email worker already aborts otherwise (`canTransition(lead.status, 'SENT')`). A reverted lead is never sent, even if a job lands late.
- Every status write filters on the one status it moves from: `NEEDS_APPROVAL` into `SCHEDULED`, `SCHEDULED` back to `NEEDS_APPROVAL`. Never use `leadStatusesInto` for the revert, so a lead already `SENT` or `REJECTED` is never moved back.
- The campaign upsert keeps the REV-201 shape: filter `{ leadId }`, and `leadId` stays out of the update body.
- The error goes through `AppError` with a code added to `API_ERROR_CODES`. The dashboard shows `error.message`, so it needs no change.

## Review Focus

1. **Redis goes down after the transaction commits.** The lead and campaign are reverted, the response is 503, and a second approval succeeds once Redis is back.
2. **A late job lands after the revert** (ioredis offline queue). The worker aborts because the lead isn't `SCHEDULED`. The `ready` check before `add` keeps such a job from being sent in the first place.
3. **Two approvals at once.** One wins and the other gets `409 NOT_AWAITING_APPROVAL`, as today. The loser's transaction must not leave a half-written campaign.
4. **The revert races the email worker.** If the job did land and the worker already moved the lead to `SENT` (or the campaign to `SENDING`/`DELIVERED`), the revert filters match nothing and leave both alone.
5. **The repair script on a lead with a delayed job still waiting** (the 15–45 s jitter). It must not revert that lead: only leads older than the minimum age with no waiting, delayed or active email job.

---

### Task 1: State edge and transactional approval write

**Files:**
- `packages/validation/src/lead-status.ts` (`SCHEDULED: ['SENT', 'NEEDS_APPROVAL', 'REJECTED', 'UNSUBSCRIBED']`) and `lead-status.spec.ts`.
- New `packages/db/src/approve-outreach.ts`, exported from `index.ts`.
- `real-mongo.spec.ts`.

**Interfaces:** `approveOutreachWithCampaign(leadId: string, campaign: Record<string, unknown>): Promise<{ lead, campaign } | null>`. It returns `null` when the lead isn't `NEEDS_APPROVAL`; the route maps that to 409. `revertOutreachApproval(leadId: string): Promise<boolean>` sets the lead `SCHEDULED → NEEDS_APPROVAL`, and the campaign with `status: 'SCHEDULED'` back to `NEEDS_APPROVAL`, unsetting `approvedAt`, `approvedBy` and `scheduledAt`. Both run in one transaction.

- [ ] **Failing tests:**
  - `lead-status.spec`: `canTransition('SCHEDULED', 'NEEDS_APPROVAL')` is true. Existing tests that list `SCHEDULED`'s targets or `leadStatusesInto('NEEDS_APPROVAL')` are updated to match.
  - real-Mongo:
    - Approval writes both documents.
    - A failing campaign write (`vi.spyOn(EmailCampaign, 'findOneAndUpdate')` rejects) leaves the lead `NEEDS_APPROVAL`, with no campaign.
    - A lead not `NEEDS_APPROVAL` returns `null` and writes nothing.
    - The revert restores both.
    - The revert leaves a `SENT` lead and a `DELIVERED` campaign alone.
- [ ] **Implement; commit** `fix(REV-203): approval writes the lead and its campaign in one transaction`.

**Widening check:** the new edge adds `SCHEDULED` to `leadStatusesInto('NEEDS_APPROVAL')`. Its writers are the deploy worker (`NEEDS_APPROVAL` after a publish) and `generation-failure`. Neither should move a `SCHEDULED` lead back to review: a regeneration is refused for `SCHEDULED` (`canChangeMvpLayout`), and the deploy filter comes from `leadStatusesInto('NEEDS_APPROVAL')`. Narrow that writer to its real sources (`GENERATING`, plus `NEEDS_APPROVAL` for a regeneration), with a test, as REV-202 did for `AUDIT_FAILED`.

### Task 2: Bounded enqueue with revert, and the route

**Files:**
- New `apps/api/src/services/email-enqueue.ts`, with spec.
- `apps/api/src/routes/outreach.routes.ts`.
- `packages/shared-types` (`EMAIL_QUEUE_UNAVAILABLE`).
- `api.routes.spec.ts`.

**Interfaces:**
- `EMAIL_ENQUEUE_TIMEOUT_MS = 5000`.
- `enqueueEmailOrRevert(data: IEmailDispatchJobData, delayMs: number, timeoutMs?): Promise<{ jobId?: string }>`. It throws `AppError(503, 'EMAIL_QUEUE_UNAVAILABLE', …, { leadId })` after `revertOutreachApproval`, refuses at once when `redisConnection.status !== 'ready'`, and uses the same `withTimeout` as `audit-enqueue.ts`. That helper is extracted to `apps/api/src/services/with-timeout.ts` and shared.

- [ ] **Failing tests:**
  - email-enqueue spec:
    - Ready plus `add` resolving gives the job id.
    - Not ready reverts, throws 503, and never calls `add`.
    - `add` rejecting, or hanging past the timeout, reverts and throws 503.
    - A failing revert still throws 503.
  - Routes:
    - Redis down gives 503 with code `EMAIL_QUEUE_UNAVAILABLE`.
    - The existing success and 409 tests pass with the transactional write.
- [ ] **Implement; commit** `fix(REV-203): a failed or slow email enqueue returns the lead to review with 503`.

### Task 3: Repair for leads already stranded

**Files:**
- New `apps/api/src/services/scheduled-lead-repair.ts` (pure `planScheduledLeadRepair`), with spec.
- New `apps/api/src/scripts/repair-scheduled-leads.ts`, with the npm script `repair:scheduled-leads` (dry run by default, `--apply`).

The planner selects `SCHEDULED` leads unchanged for at least 10 minutes that meet both conditions:
- They have no waiting, delayed, active or prioritized email job.
- Their campaign is missing or not `SENDING`/`DELIVERED`.

It returns each lead with the reason.

- [ ] **Failing tests:**
  - Planned: a fresh lead (skipped), one with a delayed job (skipped), one with a `DELIVERED` campaign (skipped), one with no campaign, and one with an orphan `SCHEDULED` campaign.
- [ ] **Implement:** `--apply` uses `revertOutreachApproval`.
- [ ] **Commit** `feat(REV-203): dry-run repair for leads stranded in SCHEDULED`.

### Task 4: Gates, e2e, review, docs

- Gates (`build:packages`, `typecheck`, `lint`, `test`, `build`).
- **E2E on an isolated stack** (replica set from mongodb-memory-server, Redis DB 1, dashboard):
  - Approve a seeded `NEEDS_APPROVAL` demo lead (`db:seed`, `.test` recipient, so the MX check bounces it and nothing is sent) with the API's Redis pointed at a dead port. The dashboard shows the 503 message, and the lead stays in review.
  - Then approve with Redis up: the lead becomes `SCHEDULED`, and the worker bounces it on the `.test` MX.
  - No console errors.
- One Opus review, then PR, merge, and docs:
  - AGENTS.md §3.2.8.
  - README (script).
  - Revamp-docs: `spec.md` and `blueprint.md` (503 code, edge), and `database-expertise.md` §7 (the gap is removed, and approval joins the transactional writes).
  - Close the ticket.
