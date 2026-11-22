# REV-209: tenant-scoped data-access layer and API (E1.4)

Ticket: https://linear.app/revamp-proect/issue/REV-209 (child of [REV-169](https://linear.app/revamp-proect/issue/REV-169), E1 US2)
Branch: `ymorpheus/rev-209-e14-tenant-scoped-data-access-layer-and` (worktree `../Revamp-dev-rev209`), cut from `main` after REV-208 (PR #135).

## Goal

After REV-206 to REV-208 every lead carries its studio (`tenantId`) and a business, but every route still reads and writes every studio's data: any registered user sees all leads, and open registration makes that a public leak. After this ticket a studio sees and changes **only its own leads, MVPs, campaigns and events**; another studio's record answers 404 as if it did not exist; the public tracking, unsubscribe and preview routes resolve the studio from the secret they carry; and a test fails when code reads a tenant-owned collection without the studio filter.

## Rulings (open for your veto)

1. **The migration that gives old records a studio moves into this ticket** (it was in REV-210). Filtering by studio makes every record without one invisible to everyone, so shipping the filter without the migration would empty every existing database. `npm run migrate:tenants --workspace=@revamp/api` (dry run, `-- --apply`, idempotent) assigns every lead, MVP, campaign and event without a `tenantId` to the studio you name (`--organization <id>`) or, by default, the oldest organization; the API and workers warn at startup until it ran. REV-210 keeps the queue payloads and the workers' isolation, and I will update its description. Cost if wrong: this ticket is bigger by one script.
2. **A record of another studio answers the same 404 as a missing one**, with the code each endpoint already uses (`LEAD_NOT_FOUND`, `MVP_NOT_FOUND`, `AUDIT_NOT_FOUND`, `DISCOVERY_JOB_NOT_FOUND`), not a new generic `NOT_FOUND`: the dashboard already branches on these, and an answer that differs from "missing" would tell a studio that the id exists.
3. **Audits are shared, so they are reached through leads**, never by tenant. `GET /audits/:id` by audit id answers only when a lead of the caller's studio reads that audit (its own, or one of its business); `GET /audits/:leadId` goes through the lead. `Business` is not tenant-owned and is never returned by an endpoint.
4. **Public routes take the studio from their secret.** Tracking (`/track/*`) and unsubscribe resolve the campaign by its unguessable `trackingToken`; every later lookup (lead, MVP, event) is scoped to that campaign's studio. `GET /mvp/preview/:slug` and `mvp-event` resolve the project by slug or id and scope the rest the same way. Records that still have no studio (before the migration) form a **legacy bucket reachable only through those public secrets**, never by a signed-in studio.
5. **A discovery search belongs to the studio that started it.** The job's data carries `tenantId`; status and import of another studio's job answer `DISCOVERY_JOB_NOT_FOUND`. The "already a lead" check of a candidate is per studio now, so a studio can import a site another studio has (it then reuses that business's audit, REV-208). Searches queued before this ticket have no owner and answer 404 (they are short-lived).
6. **Workers copy the lead's `tenantId` onto the `MvpProject`, `EmailCampaign` and `AnalyticsEvent` they write** (and `approveOutreachWithCampaign` onto the campaign), so the API's filters find them. Tenant in the queue payloads, per-tenant concurrency and the workers' own isolation stay REV-210.
7. **Enforcement is two checks.** (a) One data-access layer, `apps/api/src/data/tenant-scope.ts`: `scopeFor(tenantId)` returns repositories for `Lead`, `MvpProject`, `EmailCampaign` and `AnalyticsEvent` whose every read, update, delete and create adds `tenantId`; a filter or update that names another `tenantId` is refused; routes and services get it from `req.tenant` and never import those four models. (b) A source-scan test fails when anything under `apps/api/src` outside `data/` queries one of the four models directly. The operator scripts (`scripts/`) run unscoped on purpose and are the only allow-list.
8. **Indexes** `{ tenantId: 1, onePageBrochure: -1, createdAt: -1 }` and `{ tenantId: 1, status: 1 }` on `leads` (the studio's list and its filters), `{ tenantId: 1 }` on the three children; each checked with `explain`. Cost: the old global list index stays for the legacy bucket and is dropped once nothing reads it.
9. **The demo seed** gives its MVPs, campaigns and events the demo studio's `tenantId`.

## Design

`tenantId` (ObjectId, ref `Organization`, optional until the migration) on `MvpProject`, `EmailCampaign`, `AnalyticsEvent`, with the indexes above.

`scopeFor(tenantId)` (`apps/api/src/data/tenant-scope.ts`) returns `{ leads, mvps, campaigns, events }`. Each repository wraps the model and exposes the operations the API uses (`findById`, `findOne`, `find`, `count`, `aggregate`, `updateOne`, `findOneAndUpdate`, `create`, `exists`); every filter becomes `{ $and: [{ tenantId }, filter] }` (a filter that names `tenantId` itself is rejected, so a request body cannot widen the scope), every create stamps `tenantId`, and `scopeFor(undefined)` is the legacy bucket (`tenantId` missing). A `tenantScope` middleware after `requireAuth` sets `req.tenant = scopeFor(req.auth.organizationId)`; the public routes build their scope from the campaign or project they found by secret.

The services that took ids (`LeadService`, `findGenerationAudit`, `enqueueAuditOrFail`, `TrackingService`, `DiscoveryService`) take a scope instead of reading the models; routes lose their direct `Lead.findById` calls.

## Tasks (TDD: each starts with a failing test)

1. **Models and indexes.** `tenantId` on the three children; the indexes; the data dictionary. Real-MongoDB test: the indexes exist and the studio's list query uses one (`explain`: `IXSCAN`, no in-memory sort).
2. **`scopeFor` and its unit tests.** Every operation adds the studio; a foreign `tenantId` in a filter or update is refused; `$or`/`$and` filters keep their meaning; creates are stamped; the legacy bucket matches only records without a studio; two scopes never see each other's documents (real MongoDB).
3. **Routes and services onto the scope**, one group at a time with its cross-tenant tests: leads (list, stats, one, create), audits (trigger, get), MVP (generate, get, edit, tokens, restore), outreach (pending, approve, test, reject), discovery (start, status, import, dedupe). Studio B requesting studio A's record answers the endpoint's usual 404, writes nothing, and queues nothing.
4. **Public routes.** Tracking open, click, mvp-event, unsubscribe (GET and POST) and preview: the scope comes from the campaign or project found by the secret; a lead of another studio is never touched even when ids are forged in the request; events are stamped with the studio.
5. **Workers and `@revamp/db`.** The deploy and MVP-page workers stamp `tenantId` on the project, the email worker's events and `approveOutreachWithCampaign` on the campaign.
6. **Migration and warning.** `migrate-tenants.ts` + `checkTenantLinks` at API and worker startup; real-MongoDB tests (assigns the named or the oldest organization, children get their lead's studio, idempotent, dry run writes nothing, refuses an unknown organization).
7. **The guard test.** `apps/api/src/__tests__/tenant-guard.spec.ts` scans the source and fails with the file and line of any direct query on the four models outside `data/` and the listed scripts; its own test proves it catches a planted violation.
8. **Cross-tenant suite.** `apps/api/src/routes/__tests__/tenant-isolation.spec.ts` on one real in-memory MongoDB with the real app (queues mocked): two studios, one request per guarded route from the wrong studio (404 and no change) and from the right one (success), and a table that walks every registered route so a new route fails until it is classified (tenant-owned, shared, or public).
9. **Seed and scripts.** Demo children get the demo studio; `demo-dataset.spec.ts`; reseed after the migration works.
10. **Browser check** on an isolated MongoDB: studio B sees none of studio A's leads in the dashboard, opening A's lead URL shows not found, A's tracking link still works for its recipient, and the migration on a database made before this ticket.
11. **Docs.** spec (isolation rules, public routes), blueprint (schemas, the scope layer, endpoint notes), database-expertise (fields, indexes, migration), README, area `AGENTS.md` files (api: never query the four models outside `data/`), REV-210's ticket text; `docs:index`, `docs:check-dictionary`.

## Gates

`npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures, from the repo root), `npm run build`, then the browser check.

## Not in this ticket

Tenant in queue payloads, per-tenant concurrency and the workers' isolation (REV-210); a lint rule for the workers' queries; per-studio sender identity and quotas; shared `Business` contacts masking (E3); removing the old global list index.
