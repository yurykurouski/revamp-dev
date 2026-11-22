# REV-208: split the shared Business from the tenant-owned Lead (E1.3)

Ticket: https://linear.app/revamp-proect/issue/REV-208 (child of [REV-169](https://linear.app/revamp-proect/issue/REV-169), E1 US2)
Branch: `ymorpheus/rev-208-e13-split-shared-business-from-tenant` (worktree `../Revamp-dev-rev208`), cut from `main` after REV-207 (PR #134).

## Goal

Today `Lead` holds both the company and one studio's pursuit of it, so two studios cannot share an audit. After this ticket a `Business` is the company and its site (one per domain, shared), a `Lead` is one studio's pursuit of it (`tenantId` + `businessId`), and a studio that adds a site another studio already audited gets that audit at once instead of paying for a second one. **Filtering data by tenant is not in this ticket** (REV-209) and neither is assigning existing leads to a tenant (REV-210); this ticket makes the data model and the add-lead path ready for both.

## Rulings (open for your veto)

1. **Lead keeps copies of the identity fields** (`businessName`, `originalUrl`, `domain`, `niche`, `city`, contacts). `Business` holds the shared identity (`domain` unique, `originalUrl`, `businessName`, `niche`, `city`) and is what audits hang on. Moving the reads (list, search, outreach) to `Business` would touch about 25 files for no behavior change; E3's masking of contacts is the point to do it. Cost if wrong: a lead's copy can drift from its business; nothing reads the business's copy yet except the add-lead path.
2. **Audits stay keyed by `leadId`** (the lead that ran them) and gain `businessId`. The audit worker and its states are unchanged. A read for a lead resolves **its own newest audit first, else the newest COMPLETED audit of its business** (`findAuditForLead`, API and workers). So tenant A's retry or failure never changes what tenant B sees. Cost: tenant B keeps the older shared audit until B re-audits, even if A re-audited later and better.
3. **Reuse at add time.** When the business already has a COMPLETED audit, the new lead is created directly as `AUDITED` with `totalScore`, `siteComplexity`, `onePageBrochure` and enriched contacts computed from that audit by the same function the audit worker uses (extracted, so the two cannot drift), and the MVP generation job is queued as after an audit. Creating a lead with an initial status is not a transition, so `LEAD_TRANSITIONS` is untouched and still enforced for every later write. If queueing the generation job fails the lead stays `AUDITED` (the operator can press Generate MVP), so no revert is needed.
4. **No COMPLETED audit yet** (first studio, or the audit is running or failed): the new lead gets its own `QUEUED` audit as today. Two studios adding the same new site within the audit's few minutes both audit it. Cost: one extra audit in a rare overlap.
5. **`tenantId` comes from the caller's organization** (`req.auth.organizationId`) on Add lead and on discovery import. It is optional in the schema until REV-210 migrates old leads. **Unique partial index `{ tenantId, businessId }`** (only where both exist): a studio has at most one lead per business. Adding the same site again from one studio answers `409 LEAD_ALREADY_EXISTS` with `details.leadId`, instead of a silent duplicate. Discovery import already skips known sites; that check stays global until REV-209.
6. **Backfill script** `npm run migrate:businesses --workspace=@revamp/api` (dry run, then `-- --apply`, idempotent): every lead without a `businessId` gets the `Business` of its domain (created on first sight; leads sharing a domain share it) and every audit gets the `businessId` of its lead. API and workers warn at startup until it ran, like REV-201. Tenant assignment of old leads stays REV-210.
7. **Reads and writes of leads are not filtered by tenant yet.** A signed-in user still sees every lead (REV-209).

## Design

`Business` (`packages/db`): `domain` (required, lowercase, **unique**), `originalUrl`, `businessName`, `niche`, `city`, timestamps. Written by an upsert filtered on `{ domain }` with `domain` kept out of the update body (the REV-201 pattern), retried once on E11000 (`retryOnDuplicateKey`).

`Lead`: `tenantId` (ObjectId, ref `Organization`, optional), `businessId` (ObjectId, ref `Business`, optional until the backfill), partial unique index `{ tenantId: 1, businessId: 1 }` with `partialFilterExpression` on both fields existing, plus `{ businessId: 1 }`. `Audit`: `businessId` (ObjectId, index `{ businessId: 1, status: 1, createdAt: -1 }`).

`createLeadWithAudit` becomes `addLeadToBusiness` (`@revamp/db`, one transaction): upsert the business; refuse with `LEAD_ALREADY_EXISTS` when this tenant already has a lead for it; read the newest COMPLETED audit of the business; then either insert the lead as `AUDITED` (no new audit) or insert the lead as `QUEUED` with its own `QUEUED` audit (ruling 4). Returns `{ lead, audit?, business, reused }`; the service queues the audit job or the generation job accordingly.

`findAuditForLead(lead, { completedOnly })` replaces the `leadId` lookups in `apps/api/src/services/audit-lookup.ts`, `apps/workers/src/services/audit-lookup.ts`, `LeadService.getLeadById`, `audit.routes.ts` (`GET /audits/:id`), and `mvp.routes.ts` (generate). Audit lookups by id check that the audit belongs to the lead **or to its business**.

New API code `LEAD_ALREADY_EXISTS` (409) in `API_ERROR_CODES` and blueprint §5. Dashboard: Add lead shows the API message; no new screen.

## Tasks (TDD: each starts with a failing test)

1. **Shared types and validation.** `LEAD_ALREADY_EXISTS`, `IBusiness`, `leadFieldsFromAudit` (pure: total score, complexity class, one-page flag, phone and email enrichment with the guessed-email rule; moved out of the audit worker with its tests). Tests: the function's truth table (phone kept, email guessed replaced, no contacts, complexity classes).
2. **`Business` model; `tenantId` and `businessId` on `Lead`; `businessId` on `Audit`; indexes.** Real-MongoDB tests (one file): the business is unique per domain under 20 racing upserts; the partial unique index allows many legacy leads without a tenant and refuses a second lead of one tenant on one business, but allows two tenants on one business.
3. **`addLeadToBusiness`.** Real-MongoDB tests: first add creates business, lead and audit together; a failed audit insert leaves no business-less lead; second tenant adding the same site gets an `AUDITED` lead with the shared audit's score and no new audit; same tenant twice is `LEAD_ALREADY_EXISTS`; a business with a FAILED or running audit gives a normal `QUEUED` lead; 20 racing adds of one site by two tenants leave one business, one lead each.
4. **`findAuditForLead` and the lookups.** Tests: own audit wins over the business's; a reused lead sees the shared COMPLETED audit; tenant A's FAILED retry does not change tenant B's view; completed-only; an audit id of another business is refused; legacy leads (no business) behave as before.
5. **API and workers.** `LeadService.createLead(tenantId, dto)` and the add-lead and discovery-import routes pass `req.auth.organizationId`; queue the generation job for a reused lead; the audit worker uses `leadFieldsFromAudit`; retry-audit creates its audit with the lead's `businessId`; `LEAD_ALREADY_EXISTS` mapped. Tests: service, route (201, 409, 400), worker.
6. **Backfill and startup warning.** `migrate-businesses.ts` (dry run, `--apply`, idempotent), `checkBusinessLinks` warning in API and worker startup. Real-MongoDB tests: leads sharing a domain share one business, audits get the id, a second run changes nothing, a legacy lead keeps working before the run.
7. **Seed and scripts.** The demo dataset gets `Business` documents, `businessId` on leads and audits and the demo tenant on the leads (the demo studio), so a fresh seed is already migrated; `demo-dataset.spec.ts` checks it. `crawl_live.ts` and `test_bullmq_audit.ts` create businesses.
8. **Browser check** on an isolated in-memory MongoDB: studio A adds a site and it audits (or, without an LLM provider, fails honestly); studio B adds the same site and gets the audit at once; A adding it again gets the 409 message; the backfill on a database made before this ticket.
9. **Docs.** spec (the Business/Lead model, add-lead behavior, error code), blueprint (schemas, ER diagram with `Business`, §5 code and the add-lead endpoint), database-expertise (§3, §4 dictionary `businesses` and the new fields, §5 ER, §6 indexes, §7 keys, §9 migrations, §10 seed), README (script, startup warning), area `AGENTS.md` files; `npm run docs:index` and `docs:check-dictionary`.

## Gates

`npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures, from the repo root), `npm run build`, then the browser check.

## Not in this ticket

Filtering any query by tenant (REV-209); tenant on queue payloads and workers' isolation, and assigning old leads to a default tenant (REV-210); masking the business's contacts before purchase (E3); moving list, search and outreach reads from the lead's copies to `Business`; price or purchase of a shared audit.
