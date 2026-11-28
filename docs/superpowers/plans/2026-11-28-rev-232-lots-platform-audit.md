# REV-232 (E3.2): Lots and the platform audit of a business — Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (Sonnet), whole plan in one run, TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The platform (a platform admin) can audit a shared `Business` without any studio lead, create a priced `Lot` from that audit, open it and withdraw it; a studio's later Add lead reuses the platform audit and withdraws a draft or open lot of that business.

**Architecture:** `Audit.leadId` becomes optional. A platform audit is a job named `platform-audit` on the existing `audit-queue` (same worker, same concurrency and browser leases), dispatched by `job.name` to a new processor that writes only the `Audit` (by `_id`). The measurement code of the lead audit (steps 2–9 of `audit.worker.ts`) moves unchanged into one shared function. `Lot` is a new platform-owned collection in `@revamp/db` with its own status table in `@revamp/validation`. Admin routes live under `/admin`, guarded by `requirePlatformAdmin` (email in `PLATFORM_ADMIN_EMAILS`).

**Tech Stack:** TypeScript, Express, Mongoose, BullMQ, Zod, Vitest, mongodb-memory-server.

**Spec:** Linear REV-232; REV-171 decisions comment (2026-11-28); user ruling 2026-11-28: *a studio's Add lead or discovery import of a business with a draft or open lot wins: the studio gets its free right and the lot is withdrawn in the same transaction; nothing tells the studio it was a lot.* Read first: root `AGENTS.md` §3.2, `packages/db/AGENTS.md`, `apps/api/AGENTS.md`, `apps/workers/AGENTS.md`.

## Global Constraints

- §3.2.2: the platform audit is the same deterministic audit; failed measurements are left out (REV-100). The lot price comes only from `priceFromAudit` (REV-231), never an LLM.
- §3.2.4: every request body and query validated with a Zod schema from `@revamp/validation`.
- §3.2.7: schemas only in `packages/db`; apps re-export. Real-MongoDB tests only in `packages/db/src/__tests__/real-mongo.spec.ts` (one server).
- §3.2.8 pattern for lots: one status table (`LOT_TRANSITIONS`), every `Lot.status` write is an atomic filter on the statuses allowed into the target. No local status lists anywhere.
- §3.2.9: errors only through `AppError` with codes from `API_ERROR_CODES` (add new codes there).
- `@revamp/db` still does not depend on `@revamp/validation`: callers pass status lists and price results in.
- Platform jobs carry **no** `tenantId`: they write only shared records (`Audit`, `Business` untouched, analytics events with no studio). This is the one written exception to the REV-210 rule; document it in `apps/workers/AGENTS.md`.
- The workers' startup recovery and every new automatic job skip `demo-seed` (unchanged here: nothing new runs automatically).
- New strings: none in the dashboard (no dashboard change in this ticket).

## Decisions (fixed here)

**Types (`@revamp/shared-types`, new section `// 13. Lots (REV-232)`):**
- `LOT_STATUSES = ['DRAFT', 'OPEN', 'RESERVED', 'SOLD', 'WITHDRAWN'] as const`, `LotStatus`.
- `LOT_WITHDRAW_REASONS = ['admin', 'claimed_by_studio'] as const`, `LotWithdrawReason`.
- `ILot`: `_id, businessId, auditId, niche: NicheType, city: string, priceCents: number, currency: string, band: LotBand-like string 'A'|'B'|'C'|'D', need: number, priceSignals: { signal: string; value: number; need: number; weight: number }[], status: LotStatus, releaseAt?: string|Date, withdrawnAt?, withdrawReason?, createdAt, updatedAt`. Define `LOT_BANDS` here (move it from `lot-price.ts`, which re-exports it) so the db enum and validation share one list.
- `IAudit.leadId` becomes `leadId?: string` with doc comment "absent on a platform audit (REV-232)".
- `IPlatformAuditJobData { auditId: string; businessId: string; url: string; niche: NicheType }`; `AUDIT_JOB_NAMES = { LEAD: 'audit-website', PLATFORM: 'platform-audit' } as const` (the existing name `audit-website` stays).
- New `API_ERROR_CODES`: `LOT_NOT_FOUND`, `LOT_NOT_ELIGIBLE` (business opted out, held or in cooldown, or no city), `LOT_ALREADY_LIVE`, `LOT_NOT_PRICEABLE` (no measured price signal), `LOT_TRANSITION_NOT_ALLOWED`, `PLATFORM_AUDIT_NOT_FOUND`, `NO_COMPLETED_PLATFORM_AUDIT`. Non-admins get the existing `403 FORBIDDEN`.

**Lot state machine (`packages/validation/src/lot-status.ts`, exported):**
```
DRAFT:     ['OPEN', 'WITHDRAWN']
OPEN:      ['RESERVED', 'WITHDRAWN']
RESERVED:  ['OPEN', 'SOLD', 'WITHDRAWN']
SOLD:      []
WITHDRAWN: []
```
`LotStatusSchema`, `LOT_TRANSITIONS`, `canLotTransition(from, to)`, `lotStatusesInto(to)`, `LOT_LIVE_STATUSES = ['DRAFT','OPEN','RESERVED']` (derived: statuses with an outgoing edge), `LOT_CLAIMABLE_BY_STUDIO = ['DRAFT','OPEN']` (the ruling: what an Add lead withdraws; a `RESERVED` lot is handled by REV-234).

**`Lot` model (`packages/db/src/models/Lot.model.ts`):** fields as `ILot`, `businessId`/`auditId` ObjectId refs required, `niche` enum as `Business`, `city` required trimmed, `band` enum `LOT_BANDS`, `status` enum default `DRAFT`, `priceSignals` typed subdocument array (no Mixed), plus `live: true` (Boolean, set while status is live, `$unset` on `SOLD`/`WITHDRAWN`). Indexes: `{ businessId: 1 }` unique with `partialFilterExpression: { live: true }` (one live lot per business), `{ status: 1, niche: 1, city: 1, band: 1 }` (listings, REV-233), `{ auditId: 1 }`. Re-export from `apps/api/src/models` and `apps/workers/src/models` like the others.

**db functions (`packages/db/src/lots.ts`, exported from the index):**
- `createPlatformAudit({ domain, originalUrl, businessName, niche, city })` → `{ business, audit, queued: boolean }`. One transaction: upsert the `Business` on `{ domain }` exactly as `addLeadToBusiness` does (extract that upsert into `upsertBusinessByDomain(fields, session)` in `add-lead-to-business.ts` and use it in both; retry once on E11000 with `retryOnDuplicateKey`); then, if the business has a COMPLETED audit, return it with `queued: false`; if it has a QUEUED/PROCESSING audit with no `leadId`, return that with `queued: false`; else create `Audit { businessId, status: 'QUEUED' }` (no `leadId`) and return `queued: true`. A `city` given for a business that has none is `$set`; an existing city is kept.
- `createLot({ businessId, price: { amountCents, currency, need, signals, band }, now })` → `ILotDocument`. Caller passes the price (computed by the API with `priceFromAudit` + `lotBandFromNeed`) and the audit id. Refuses with `LotError(code)` (class with `code: 'LOT_NOT_ELIGIBLE' | 'LOT_ALREADY_LIVE' | 'NO_COMPLETED_PLATFORM_AUDIT'`): business missing → `LOT_NOT_ELIGIBLE`; `optedOutAt` set, or `contactHold.cooldownUntil > now` (held or cooling down) → `LOT_NOT_ELIGIBLE`; no `city` → `LOT_NOT_ELIGIBLE`; E11000 on the live index → `LOT_ALREADY_LIVE`. Exact signature: `createLot(input: { businessId; auditId; niche; city; price: LotPriceInput; now?: Date }): Promise<ILotDocument>`; the API looks up the audit and business first (below).
- `transitionLot(lotId, to, { allowedFrom, set?, now? })` → updated doc or `null`: `Lot.findOneAndUpdate({ _id, status: { $in: allowedFrom } }, …)`; `to` in `SOLD`/`WITHDRAWN` also `$unset: { live: '' }`; `WITHDRAWN` sets `withdrawnAt` and `withdrawReason` from `set`. Caller passes `allowedFrom = lotStatusesInto(to)`.
- `addLeadToBusiness`: new optional input `withdrawLots?: { statuses: LotStatus[]; now?: Date }`. When a contact right was claimed (tenant path, both the reused and the own-audit branch), in the same session: `Lot.updateMany({ businessId, status: { $in: statuses } }, { $set: { status: 'WITHDRAWN', withdrawnAt, withdrawReason: 'claimed_by_studio' }, $unset: { live: '' } })`. The result gets `withdrawnLots: number`. Nothing about the lot goes into the API response.

**Workers:**
- New `apps/workers/src/services/site-audit.ts`: `measureSite(input: { url: string; niche: NicheType; businessName: string; storageOwnerId: string; logLabel: string; recordTokens: (stage, model, usage) => Promise<void> }): Promise<{ update: Record<string, unknown>; unmeasured: string[] }>` containing steps 2–9 of today's processor verbatim (bucket, crawl, complexity, WebP, uploads with `storageOwnerId` as the folder, brand, critique, era, scores, measurement errors) and returning the exact `$set` body and `$unset` keys the processor writes today. The lead processor calls it with `storageOwnerId: leadId` — **behavior and existing tests unchanged** (this is a refactor; run the audit worker specs before and after).
- `createAuditWorker` processor: `if (job.name === AUDIT_JOB_NAMES.PLATFORM) return processPlatformAudit(job)` before `jobTenant`. `processPlatformAudit` (`apps/workers/src/workers/platform-audit.ts`): claim `Audit.findOneAndUpdate({ _id: auditId, businessId, leadId: { $exists: false }, status: { $in: ['QUEUED', 'PROCESSING'] } }, { status: 'PROCESSING' })`; no match → return `{ success: false, skipped: true }` and write nothing. Run `measureSite` with `storageOwnerId: \`business-${businessId}\``, `businessName` from the `Business`, token events `AnalyticsEvent.create({ eventType: 'token_usage', metadata: { …, stage, auditId, businessId } })` with no `leadId`/`tenantId`. Write COMPLETED by `_id` (same `$set`/`$unset`). On error: `FAILED` with `sanitizeAuditError`, rethrow unless `isPermanentAuditError` (same retry policy as the lead path). No lead, no generation job.
- `handleAuditJobFailed` (`audit-failure.ts`): for a `platform-audit` job, mark that audit (`_id`, no `leadId`, status QUEUED/PROCESSING) `FAILED` with the reason; never touch a lead.

**API:**
- Env: `PLATFORM_ADMIN_EMAILS` (comma separated, trimmed, lowercased, default empty → nobody is admin), in `EnvSchema` as `z.string().default('')` and an exported `platformAdminEmails: ReadonlySet<string>`.
- `requirePlatformAdmin` (`middlewares/requireAuth.ts`): after `requireAuth`, loads `User.findById(req.auth.userId, { email: 1 })`; not in the set → `403 FORBIDDEN 'Platform admins only'`. `isPlatformAdmin(email)` helper exported for `/auth/me`, which adds `platformAdmin: boolean` to its `data`.
- `apps/api/src/routes/admin.routes.ts`, mounted in `routes/index.ts` as `router.use('/admin', requireAuth, requirePlatformAdmin, adminRoutes)`; service `apps/api/src/services/lot.service.ts`. Routes (bodies validated by new schemas in `@revamp/validation`):
  - `POST /admin/platform-audits` `CreatePlatformAuditSchema { url (http/https), businessName (1–100), niche (NicheEnumSchema), city (1–100, trimmed) }` → `createPlatformAudit` (domain via `normalizeDomain`); when `queued`, `addPlatformAuditJob({ auditId, businessId, url, niche })` with `AUDIT_ENQUEUE_TIMEOUT_MS`; on enqueue failure mark the audit `FAILED` (`'Could not queue the audit'`) and answer `503 AUDIT_QUEUE_UNAVAILABLE`. `201 { data: { auditId, businessId, status, queued } }` (`200` when not queued).
  - `GET /admin/platform-audits/:id` → the audit's `status`, `scores`, `measurementErrors`, `completedAt`, `businessId`; `404 PLATFORM_AUDIT_NOT_FOUND` for an unknown id or an audit with a `leadId`.
  - `POST /admin/lots` `CreateLotSchema { businessId }` → newest COMPLETED audit of the business (any audit, lead or platform: the audit is shared) else `409 NO_COMPLETED_PLATFORM_AUDIT`; `priceFromAudit(audit, lotPriceSettings)`; `need === null` → `409 LOT_NOT_PRICEABLE`; `createLot` with `niche`/`city` from the business; `LotError` → `409` with its code. `201 { data: lot }`.
  - `POST /admin/lots/:id/open` `OpenLotSchema { releaseAt?: ISO datetime }` (default now) → `transitionLot(id, 'OPEN', { allowedFrom: lotStatusesInto('OPEN'), set: { releaseAt } })`; `null` → `404 LOT_NOT_FOUND` if missing else `409 LOT_TRANSITION_NOT_ALLOWED`. **Note:** `lotStatusesInto('OPEN')` includes `RESERVED` (the expiry edge for REV-234); this route must pass `['DRAFT']` explicitly via `LOT_ADMIN_OPENABLE = ['DRAFT']` exported next to the table.
  - `POST /admin/lots/:id/withdraw` → `transitionLot(id, 'WITHDRAWN', { allowedFrom: lotStatusesInto('WITHDRAWN'), set: { withdrawReason: 'admin' } })`.
  - `GET /admin/lots` `AdminLotsQuerySchema { status?, page?, limit? (≤100) }` → newest first, full documents (admins see everything).
- `LeadService.createLead` and the discovery import pass `withdrawLots: { statuses: [...LOT_CLAIMABLE_BY_STUDIO] }` to `addLeadToBusiness`.
- Shared-audit lookups with no `leadId` (`services/audit-lookup.ts:49`, `routes/audit.routes.ts:88`): build the `$or` from `found.leadId` only when it is set. Without this, `{ _id: undefined }` is dropped by Mongoose and matches **every** lead of the studio.
- `route-auth.spec.ts`: `/admin/*` are guarded (401 without a token); add a check that a non-admin owner gets 403 on each. `tenant-isolation.spec.ts`: add the admin routes to `NO_TENANT_DATA` with the reason "platform-owned lots and audits; admin only".
- `.env.example` and `README.md` env table: `PLATFORM_ADMIN_EMAILS` (api).

## Review Focus

1. **A platform audit read through a studio's lead** (`GET /audits/:id` with the platform audit id, studio has a lead of that business): answers it; a studio without such a lead gets `404`. Test in `audit.routes` spec — this pins the `{ _id: undefined }` bug.
2. **Add lead of a business with an OPEN lot**: 201 for the studio, the lot is `WITHDRAWN` (`claimed_by_studio`), the response has no lot field; with the add aborted (right refused), the lot stays `OPEN`. Real-MongoDB tests.
3. **Two concurrent `createLot` for one business**: exactly one succeeds, the other is `LOT_ALREADY_LIVE`. Real-MongoDB test with `Promise.allSettled` of 5.
4. **Platform audit job retried after it completed** (stale retry): the claim filter refuses a COMPLETED audit, nothing is overwritten. Worker test.
5. **An admin email with different case or spaces** in `PLATFORM_ADMIN_EMAILS` (`' Admin@X.test '`) matches the user `admin@x.test`; an empty variable makes nobody admin. Middleware test.

---

### Task 1: Types, lot status table, schemas, REV-231 follow-ups

**Files:** Modify `packages/shared-types/src/index.ts`; create `packages/validation/src/lot-status.ts`; modify `packages/validation/src/index.ts`, `packages/validation/src/lot-price.ts`; tests `packages/validation/__tests__/lot-status.spec.ts`, `packages/validation/__tests__/lot-schemas.spec.ts`, `packages/validation/__tests__/lot-price.spec.ts`.

**Produces:** everything in "Types" and "Lot state machine" above; `CreatePlatformAuditSchema`, `CreateLotSchema`, `OpenLotSchema`, `AdminLotsQuerySchema` (in `lot-status.ts` or a new `lot-schemas.ts`, exported).

- [ ] **Step 1: Failing tests.** `lot-status.spec.ts`: every status has an entry; `SOLD` and `WITHDRAWN` are final; `canLotTransition('OPEN','RESERVED')` true, `('SOLD','OPEN')` false; `lotStatusesInto('WITHDRAWN')` is `['DRAFT','OPEN','RESERVED']`; `LOT_LIVE_STATUSES` equals the statuses with an outgoing edge; `LOT_CLAIMABLE_BY_STUDIO` ⊂ `LOT_LIVE_STATUSES` and excludes `RESERVED`; `LOT_ADMIN_OPENABLE` is `['DRAFT']`. `lot-schemas.spec.ts`: valid/invalid per schema (url without protocol, `ftp:`, empty city, 101-char name, bad niche, bad ObjectId, `releaseAt` not ISO, `limit` 101, unknown status).
- [ ] **Step 2: REV-231 follow-ups, tests first** in `lot-price.spec.ts`: weight `'1e308'` for two signals is rejected (each weight `.max(1000)`); `LOT_CURRENCY ' eur '` → `'EUR'` (trim the value in `get`); a need that is mathematically 0.75 but floats to 0.7499999999999999 (weights `{ siteEra: 0.1, accessibility: 0.1, standards: 0.1, lcp: 0 }`, audit `siteEra.score 1.5`, `violationsCount 20`, `scores.standards 0`; check first that the unrounded value is below 0.75) gives band `'A'` and `need` exactly `0.75` (round `need` to 12 decimals before returning it); the throwing cases assert `ZodError` and the issue path (`capCents`, `weights`).
- [ ] **Step 3: Run** `npx vitest run packages/validation` → FAIL.
- [ ] **Step 4: Implement**; move `LOT_BANDS` to shared-types and re-export from `lot-price.ts`.
- [ ] **Step 5: Run** → PASS; `npm run build:packages`; **commit** `feat(REV-232): lot status table, lot types and admin schemas`.

### Task 2: `@revamp/db` — optional audit lead, `Lot`, platform audit, lot functions, Add lead withdraws

**Files:** modify `packages/db/src/models/Audit.model.ts` (drop `required` on `leadId`, keep the index), create `packages/db/src/models/Lot.model.ts`, `packages/db/src/lots.ts`; modify `packages/db/src/add-lead-to-business.ts`, `packages/db/src/index.ts`, `packages/db/src/data-dictionary.ts` if it lists collections/fields (check), re-exports in `apps/api/src/models/` and `apps/workers/src/models/`; tests in `packages/db/src/__tests__/real-mongo.spec.ts` (new `describe('lots (REV-232)')`) and unit tests next to existing db specs where no server is needed.

**Consumes:** Task 1 types. **Produces:** `Lot`, `ILotDocument`, `createPlatformAudit`, `createLot`, `transitionLot`, `LotError`, `upsertBusinessByDomain`, `addLeadToBusiness` `withdrawLots` input and `withdrawnLots` result.

- [ ] **Step 1: Failing real-MongoDB tests:** `createPlatformAudit` creates business + QUEUED audit without `leadId`; a second call returns the same audit with `queued: false`; with a COMPLETED audit returns it, `queued: false`. `createLot`: refuses opted-out, held (`cooldownUntil` in the future), no-city → `LOT_NOT_ELIGIBLE`; succeeds after the cooldown passed; Review Focus 3 (5 concurrent → 1 winner); a `WITHDRAWN` lot does not block a new one. `transitionLot`: `DRAFT→OPEN` sets `releaseAt`; `OPEN→WITHDRAWN` unsets `live`; a wrong `allowedFrom` returns `null` and writes nothing. Review Focus 2: Add lead (tenant + `contactRight` + `withdrawLots`) of a business with an OPEN lot → lot `WITHDRAWN`/`claimed_by_studio`, `withdrawnLots: 1`, lead reuses the COMPLETED platform audit (`reused: true`, no new audit); a `RESERVED` lot is not touched; a refused right (business in cooldown) leaves the lot `OPEN`. Existing `addLeadToBusiness` tests still pass unchanged (the business-upsert extraction is behavior-preserving).
- [ ] **Step 2: Run** `npx vitest run packages/db` → FAIL.
- [ ] **Step 3: Implement.** Make `IAudit.leadId` optional and fix every type error `npm run typecheck` reports by handling the absent case (never by `!`), except in code that only reads a lead's own audit.
- [ ] **Step 4: Run** → PASS; **commit** `feat(REV-232): lots, platform audits and withdrawal on add lead in @revamp/db`.

### Task 3: Workers — shared measurement, platform audit job

**Files:** create `apps/workers/src/services/site-audit.ts`, `apps/workers/src/workers/platform-audit.ts`; modify `apps/workers/src/workers/audit.worker.ts`, `apps/workers/src/workers/audit-failure.ts`; tests `apps/workers/src/workers/__tests__/platform-audit.spec.ts` (+ extend the audit-failure spec).

- [ ] **Step 1: Refactor first.** Move steps 2–9 into `measureSite` with no behavior change; run the existing audit worker specs → still PASS. Commit `refactor(REV-232): move the audit measurement into measureSite`.
- [ ] **Step 2: Failing tests** (mocks as in the existing audit worker spec): a `platform-audit` job claims its audit, writes COMPLETED by `_id` with the measured fields and no lead write, no `addAiGenerationJob`, token events without `leadId`/`tenantId`, screenshots under `business-<id>`; a job for an audit with a `leadId` or a COMPLETED audit is skipped and writes nothing (Review Focus 4); a crawl error writes `FAILED` and rethrows (non-permanent) / does not rethrow (permanent); `handleAuditJobFailed` on a stalled platform job marks only that audit `FAILED`; a lead job still goes through `jobTenant` (a platform job without `tenantId` is not refused).
- [ ] **Step 3: Run** `npx vitest run apps/workers/src/workers` (repo root) → FAIL; **implement**; → PASS.
- [ ] **Step 4: Commit** `feat(REV-232): platform audit job on the audit queue`.

### Task 4: API — admin role, admin routes, Add lead withdrawal, audit lookup fix

**Files:** modify `apps/api/src/config/env.ts`, `apps/api/src/middlewares/requireAuth.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/routes/auth.routes.ts`, `apps/api/src/queues/audit.queue.ts` (`addPlatformAuditJob(data, timeoutMs)` using job name `AUDIT_JOB_NAMES.PLATFORM`, same timeout helper as `enqueueAuditOrFail`), `apps/api/src/services/lead.service.ts`, `apps/api/src/services/discovery.service.ts`, `apps/api/src/services/audit-lookup.ts`, `apps/api/src/routes/audit.routes.ts`, `apps/api/src/routes/__tests__/route-auth.spec.ts`, `apps/api/src/routes/__tests__/tenant-isolation.spec.ts`; create `apps/api/src/routes/admin.routes.ts`, `apps/api/src/services/lot.service.ts`, tests `apps/api/src/routes/__tests__/admin.routes.spec.ts`, `apps/api/src/middlewares/__tests__/platform-admin.spec.ts`.

- [ ] **Step 1: Failing tests.** Middleware: Review Focus 5; a non-admin owner → 403; an admin → next. `/auth/me` returns `platformAdmin` true/false. Admin routes (status codes 200/201/400/403/404/409/503 and payloads per the Decisions): platform audit created and queued once, second call `200 queued:false`, enqueue failure → audit `FAILED` + `503`; lot created with the price `priceFromAudit` gives for the audit (assert `priceCents`, `band`, `currency`), `LOT_NOT_PRICEABLE` for an audit with no signals, `NO_COMPLETED_PLATFORM_AUDIT`, the three `LOT_NOT_ELIGIBLE` cases, `LOT_ALREADY_LIVE`; open from DRAFT ok, open from OPEN → `409 LOT_TRANSITION_NOT_ALLOWED`, unknown id → `404`; withdraw; list with status filter. Lead service: `addLeadToBusiness` called with `withdrawLots: { statuses: ['DRAFT','OPEN'] }` for Add lead and import, and the 201 body has no lot field. Review Focus 1 in the audit routes spec (real MongoDB, existing pattern). `route-auth.spec` and `tenant-isolation.spec` classify every `/admin` route.
- [ ] **Step 2: Run** `npx vitest run apps/api` → FAIL; **implement**; → PASS.
- [ ] **Step 3:** `.env.example` (`PLATFORM_ADMIN_EMAILS=` with comment `# REV-232: comma-separated emails of platform admins (scans, lots); empty = nobody`) and the README env table row.
- [ ] **Step 4: Commit** `feat(REV-232): platform admin routes for audits and lots`.

### Task 5: Area rules

- [ ] `packages/db/AGENTS.md`: new section "Lots (REV-232)" (Lot fields, `live` unique index, `createLot` eligibility, `transitionLot` with caller-passed `allowedFrom`, `createPlatformAudit`, Audit without `leadId`, Add lead's `withdrawLots`).
- [ ] `apps/workers/AGENTS.md`: under Tenant isolation, the platform-audit exception (no `tenantId`, writes only the audit and studio-less token events); under Shared audits, that a platform audit has no `leadId` and is reused by Add lead.
- [ ] `apps/api/AGENTS.md`: "Platform admin and lots (REV-232)": `PLATFORM_ADMIN_EMAILS`, `requirePlatformAdmin`, the `/admin` routes, the Add-lead withdrawal ruling, and the rule "build an audit-readers `$or` without `_id` when `leadId` is absent".
- [ ] Root `AGENTS.md` §3.2.8: one line that lots have their own table (`LOT_TRANSITIONS`) with the same atomic-filter rule.
- [ ] **Commit** `docs(REV-232): area rules for lots and platform audits`.

### Task 6: Gates and end-to-end

- [ ] `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings vs main's 8), `npm test` (0 failures), `npm run build`, `npm run docs:check-dictionary` (report what it lists for `lots` / `Audit.leadId`; the Opus session updates the dictionary).
- [ ] E2E (no dashboard change, so API only; the stack is shared with other sessions — use an isolated API port and **never** touch existing leads): run `npm run dev:api` with `PORT=4232 PLATFORM_ADMIN_EMAILS=<the demo owner email from DEMO_OWNER_EMAIL>` and `npm run dev:workers` only if no workers process is already running (`pgrep -f apps/workers`); otherwise rely on the running workers having the new code is **not** possible — in that case report e2e of the job as not possible and run only the API part. Sign in as the demo owner (`POST /auth/login`), then: `POST /admin/platform-audits` for `https://example.com` (`businessName 'Example'`, `niche 'other'`, `city 'Vilnius'`), poll `GET /admin/platform-audits/:id` until COMPLETED or FAILED, `POST /admin/lots`, `POST /admin/lots/:id/open`, `GET /admin/lots`; then sign in as `DEMO_OPERATOR_EMAIL` and confirm `403` on `/admin/lots`. Paste the responses. Afterwards withdraw the lot (`POST /admin/lots/:id/withdraw`) and stop every process you started.

## Docs to update (Opus session, after merge)

- `../Revamp-docs/blueprint.md`: `lots` collection, `platform-audit` job on `audit-queue`, admin routes; `spec.md`: lot lifecycle, admin endpoints, Add-lead ruling; `database-expertise.md` §4.6: `lots` fields, `Audit.leadId` optional; OpenAPI (version bump) with `/admin/*` and `/auth/me.platformAdmin`; `research.md` ADR 21 "Platform audit as a job on the audit queue; Add lead withdraws a listed lot"; `npm run docs:index`.
- Linear: REV-234 gets a note that a `RESERVED` lot is not withdrawn by Add lead and REV-234 must decide what the add does then.
