# REV-210: tenant-scoped workers (E1.5)

Ticket: https://linear.app/revamp-proect/issue/REV-210 (child of REV-169, E1 US2). Branch `ymorpheus/rev-210-e15-tenant-scoped-workers` (worktree `../Revamp-dev-rev210`), from `main` after REV-209 (PR #136).

## Goal

The API is tenant-scoped (REV-209) but the workers still load and write by lead id alone. After this ticket every queue payload carries `tenantId`, and a worker touches only records of that tenant; a job whose tenant is missing, or differs from its lead's, fails without writing anything.

## Rulings (open for your veto)

1. **Strict, no legacy pass.** `tenantId` is required in the audit, ai-generation, deploy, email-dispatch, email-test and mvp-page payload types. A job without it, or whose lead has another (or no) `tenantId`, fails with an `UnrecoverableError` before any write, so a lead is never moved into a working status by it. Cost: jobs queued before the deploy, and every lead before `migrate:tenants` ran, fail until retried or migrated; the startup warning from REV-209 already tells the operator to migrate first. Chosen over a "no tenant = allowed" fallback, which would let a forged or lost tenant through.
2. **The tenant travels with the job, never from the lead alone.** Producers set it: the API from `req.tenant.tenantId` (audit, generation, email approve, test send, mvp-page), and the workers pass the payload's own value on to the next job (audit → generation → deploy). The check compares the payload with the lead's stored `tenantId`.
3. **Workers' queries carry the tenant too** (defence in depth): `Lead`, `MvpProject` and `EmailCampaign` filters in the workers add `tenantId` via one helper (`apps/workers/src/tenant.ts`: `assertJobTenant`, `tenantFilter`). No second scope layer and no source-scan test for the workers (the ticket asks for per-worker isolation tests); the tests below cover each worker.
4. **The discovery worker's per-studio dedupe is already done** (REV-209 review fix); this ticket only ticks it.
5. **Failure handlers** (`audit-failure`, `generation-failure`, stalled jobs) filter on the job's tenant as well, so a stale job cannot fail another studio's lead.

## Tasks (TDD)

1. **Types.** `tenantId: string` on `IAuditJobData`, `IAiGenerationJobData`, `IDeployJobData`, `IEmailDispatchJobData`, `IEmailTestJobData`, `IMvpPageJobData`; Zod schema checks where payloads are validated.
2. **Worker helper + tests** (`assertJobTenant`: missing, mismatched, lead without tenant, match; `tenantFilter`).
3. **Workers**: audit, ai, deploy, email, email-test, mvp-page and the two failure handlers use the helper before any write; each with tests (missing tenant → UnrecoverableError, no model write, no status change; mismatched likewise; matching runs as before). Workers pass `tenantId` onward.
4. **API producers**: audit (`enqueueAuditOrFail`, trigger, create), ai-generation (generate, reused-audit path), email approve and revert, test send, mvp-page jobs add `tenantId` from the scope; route/service tests assert it.
5. **Real-MongoDB test** (one file, `real-mongo.spec.ts`): a worker's tenant-filtered write does not touch another studio's lead with the same id shape; mismatch leaves lead status unchanged.
6. **Docs**: workers `AGENTS.md`, README, `../Revamp-docs` (blueprint queue payloads, spec), `milestones.md`; `docs:index`.

## Gates and checks

`build:packages`, `typecheck`, `lint`, `npm test` (root), `build`; end to end on an isolated Mongo + Redis DB 1 with a real worker: an audit job with a wrong tenant fails and leaves the lead QUEUED, with the right tenant it runs; dashboard Add lead still works (built-in browser).

## Not in this ticket

Per-tenant concurrency and quotas, per-studio sender identity, a lint rule for the workers' queries.
