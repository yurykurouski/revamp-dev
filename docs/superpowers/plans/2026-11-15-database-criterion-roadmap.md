# Database Criterion Fixes: Roadmap

> **For agentic workers:** this is the cross-ticket roadmap. Each ticket gets its own detailed plan (superpowers:writing-plans), committed on its branch when the ticket starts, then executed with superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Revamp meets the minimum (5-point) NoSQL level of the diploma Database rubric, and the two integrity bugs found in the review are fixed.

**Architecture:** Mongo gets authentication and runs as a single-node replica set. The app connects as a least-privilege user. Integrity rules move from application code into the database (unique indexes, one transaction). A seed and a dump make the data reproducible. The docs then describe the finished state: ER diagram, indexes, data dictionary.

**Tech Stack:** MongoDB 7.0 (docker locally, Atlas in production), Mongoose (`packages/db`), BullMQ/Redis, MinIO, Vitest, `mongodb-memory-server` (new dev dependency, see D2).

**Spec:** Linear REV-198, REV-199, REV-200, REV-201, REV-202, REV-180 (all Urgent), plus the rubric at `04-technical-requirements/04b-data-layer/database/` (NoSQL section).

## Order

| # | Ticket | What | Depends on | Size |
|---|---|---|---|---|
| 1 | REV-198 | Mongo auth, three users, **plus** single-node replica set with keyFile | none | M |
| 2 | REV-201 | Unique `leadId` on MvpProject and EmailCampaign; real-Mongo test helper | none (can run in parallel with 1) | S |
| 3 | REV-202 | Lead + Audit in one transaction; enqueue failure → `AUDIT_FAILED` | 1 (replica set), 2 (test helper) | S |
| 4 | REV-199 | `db:seed`, `db:dump`, `db:restore` | 1 (auth URI), 2 (unique keys) | M |
| 5 | REV-180 | ER diagram and index list, checked with `explain` | 2 (final indexes) | S |
| 6 | REV-200 | Data dictionary, integrity, data quality, Mixed fields | 1–5 (describes their result) | M |

The code tickets (1–4) come first because the docs (5–6) describe what they produce. Tickets 1 and 2 touch different files and can run in parallel sessions.

## Decisions (please confirm or change)

- **D1. The replica set goes into REV-198, not REV-202.** Auth on a replica set needs a keyFile, so both changes rewrite the same Mongo service in `docker-compose.yml` and the same setup path in `scripts/lib/dev-stack.mjs`. One change avoids two migrations of existing dev volumes. REV-202 is left with only code changes. I will move that acceptance criterion from REV-202 to REV-198 when the work starts.
- **D2. Real-Mongo tests use `mongodb-memory-server` (`MongoMemoryReplSet`, binary pinned to 7.0).** Today every test mocks Mongo, so no test can prove a unique index or a transaction. CI has no Mongo service, and memory-server needs no Docker. Cost: one dev dependency and a binary download of about 70 MB, cached in CI. The alternative is a `services: mongo` block in `ci.yml` plus Docker locally. That is heavier, and tests would then fail on machines where the stack isn't running.
- **D3. When enqueue fails (REV-202), the lead becomes `AUDIT_FAILED` with `auditError` rather than being deleted.** It reuses the existing Retry audit path (`POST /audits/trigger`), and the operator sees what happened. Deleting would make the lead disappear silently.
- **D4. Concurrent upserts (REV-201) rely on MongoDB's own retry.** Since MongoDB 4.2, the server retries an upsert that hits a duplicate key when the filter is an equality match on the unique index's fields, which `{ leadId }` is. So the fix is the unique index plus a test that proves it; no retry code in the app. A test that still sees E11000 maps it to `DUPLICATE` (already in `API_ERROR_CODES`).
- **D5. The seed uploads real MVP HTML to MinIO**, using `StorageService.uploadHtml` from the workers, so previews open in the dashboard. Seed records use `*.example.com` domains and `@example.com` contacts only.
- **D6. Production (Atlas) changes need you.** Creating the Atlas database users (REV-198), running the duplicate cleanup before the unique index builds on Atlas (REV-201), and running the stuck-lead backfill on production (REV-202) all need Atlas access. Each ticket ships a dry-run script and exact steps; you run them or give me access.

## Open questions

- **Q1. REV-180 scope.** The ticket asks for an ER diagram that includes tenants, businesses, rights, interests, purchases and ledger (E1–E3), which aren't built yet. Proposal: diagram the five existing collections now, and show the E1–E3 entities as planned and visually marked as such. They get real schemas when those epics are built.
- **Q2. REV-180 first criterion.** "Supervisor confirms how the criterion applies to MongoDB" is yours to do. Until then, the docs follow the NoSQL section of the rubric.
- **Q3. Language of the data dictionary.** `blueprint.md` is in Russian; the rubric and tickets are in English. Proposal: a new English `data-dictionary.md` in `../Revamp-docs`, linked from `blueprint.md` §4.

## Global Constraints

- Schemas are defined only in `packages/db` (AGENTS.md §3.2.7). Lead status writes go through `LEAD_TRANSITIONS` (§3.2.8). Errors use `AppError` with codes from `API_ERROR_CODES` (§3.2.9).
- No mock data in runtime code (REV-45). Seed data is a script run on demand, never loaded by the app.
- No secrets in the repository. Local dev credentials live in `.env` (from `.env.example`), like the existing `minioadmin` values. Production credentials stay in the GitHub `production` environment and Atlas.
- `npm run setup` and `npm run dev` keep working on a fresh clone **and** on an existing `mongo_data` volume.
- Every ticket follows AGENTS.md §4.3: its own worktree (`../Revamp-dev-rev<N>`), all gates (`build:packages`, `typecheck`, `lint`, `test`, `build`), a Chrome check of the affected flow, a PR, a merge, docs, Done.
- Don't run `npm ci` while the shared dev stack runs; use `npm install <pkg> -w <workspace>` for the new dev dependency.

## Review Focus

1. **An existing dev volume after REV-198.** Someone with data in `mongo_data` runs `npm run dev`. Expected: their leads survive, users are created, and the replica set initializes. They are not told to delete the volume.
2. **Duplicates already in a database when the unique index builds (REV-201).** Expected: the build doesn't crash API startup. The cleanup script is the documented first step, and `autoIndex` failure is logged with what to run.
3. **Redis down during discovery import (REV-202).** Expected: every failed candidate ends up `AUDIT_FAILED` or not created, and the import result names them. There are no leads stuck in `QUEUED`.
4. **`db:seed` pointed at Atlas (REV-199).** Expected: it refuses before writing anything (host isn't localhost/127.0.0.1, or the URI is `mongodb+srv://`, or `NODE_ENV=production`).
5. **Docs drifting from the models (REV-200).** Expected: a test fails when a model field is missing from the dictionary.

---

## 1. REV-198 — Least-privilege users, auth, replica set

**Files:** `docker-compose.yml`, new `deploy/mongo/init-users.js` and keyFile handling, `scripts/lib/dev-stack.mjs` (+ `scripts/__tests__/dev-stack.spec.ts`), `.env.example`, new `scripts/check-mongo-roles.ts`, README, AGENTS.md §3.1.1, `blueprint.md` §7.

- [ ] Mongo service: `MONGO_INITDB_ROOT_USERNAME/PASSWORD` from `.env`, `--replSet rs0 --keyFile /data/keyfile --bind_ip_all`. The keyFile is generated once by setup into a docker volume, never committed. The healthcheck authenticates.
- [ ] `dev-stack.mjs` gets a step `ensureMongoReady()` that runs after `compose up`, is idempotent, and is unit-tested with the runner mocked like the existing steps. It runs `rs.initiate` if needed, then creates `revamp_app` (`readWrite@revamp`), `revamp_read` (`read@revamp`) and `revamp_admin` (`dbAdmin` + `userAdmin@revamp`) if missing. Passwords come from `.env`.
- [ ] Existing-volume path: a volume without users or a replica set is detected and upgraded in place (Review Focus 1). Covered by a dev-stack test case.
- [ ] `.env.example`: `MONGODB_URI=mongodb://revamp_app:<pw>@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true`. Migration and backfill scripts run as `revamp_app` too, since `readWrite` is enough (detailed plan: `2026-11-15-rev-198-least-privilege-mongodb.md`).
- [ ] `scripts/check-mongo-roles.ts` (`npm run db:check-roles`): as `revamp_app`, `dropDatabase` and `createUser` must fail with "not authorized" and a write must succeed. As `revamp_read`, a write must fail. Run against the local stack and recorded in the PR.
- [ ] Docs: Atlas setup (three database users with the same roles, app uses `revamp_app`), README migration notes.

## 2. REV-201 — Unique `leadId`

**Files:** `packages/db/src/models/MvpProject.model.ts`, `EmailCampaign.model.ts`, new `packages/db/src/testing/mongo-memory.ts` (exported only for tests), new `apps/api/src/scripts/dedupe-lead-children.ts` (+ npm script `dedupe:lead-children`), tests in `packages/db/src/__tests__/`.

**Produces:** `startMongoReplSet(): Promise<{ uri: string; stop(): Promise<void> }>`, used by REV-202 and REV-199 tests.

- [ ] Add the `mongodb-memory-server` dev dependency at the root (pinned to Mongo 7.0) and cache its binary in `ci.yml`. Update `deploy/__tests__/ci-workflow.spec.ts`.
- [ ] Test: both schemas declare `{ leadId: 1 }` with `unique: true`.
- [ ] Test (real Mongo): 20 concurrent `findOneAndUpdate({ leadId }, …, { upsert: true })` calls produce exactly one document and no thrown error (D4). The same holds for EmailCampaign.
- [ ] Implement `unique: true` on both `leadId` fields.
- [ ] Dedupe script: `--dry-run` by default. For each `leadId` with more than one document, it keeps the MvpProject whose `previewSlug` matches the lead's `previewUrl`, otherwise the newest by `updatedAt`. For campaigns it keeps the most advanced status, otherwise the newest. It prints what it would delete, and `--apply` deletes. Tested with memory-server.
- [ ] Startup: Mongoose `autoIndex` failure on `leadId` logs the dedupe command (Review Focus 2). Covered by a test on a database seeded with duplicates.
- [ ] Run the dry run on dev data; production run per D6.

## 3. REV-202 — Atomic lead creation

**Files:** `apps/api/src/services/lead.service.ts`, `apps/api/src/services/discovery.service.ts`, new `apps/api/src/scripts/backfill-orphan-queued.ts`, tests.

**Consumes:** `startMongoReplSet` (REV-201), replica set (REV-198).

- [ ] Test (real Mongo): when `Audit.create` throws inside the transaction, no Lead exists afterwards.
- [ ] Test: when `addAuditJob` rejects, the lead is `AUDIT_FAILED`, its `auditError` says the job couldn't be queued, and the call throws `AppError(503, 'INTERNAL', …)`. Use an existing code; add a `QUEUE_UNAVAILABLE` code only if the review says so.
- [ ] Test: discovery import with the second of three candidates failing to enqueue gives two `QUEUED` leads, one `AUDIT_FAILED` lead, and a result that names the failed one (Review Focus 3).
- [ ] Implement: `mongoose.connection.transaction(async (session) => { Lead.create([...], { session }); Audit.create([...], { session }) })`, then enqueue. On enqueue failure, do a guarded update `Lead.findOneAndUpdate({ _id, status: { $in: leadStatusesInto('AUDIT_FAILED') } }, …)` (`QUEUED → AUDIT_FAILED` is **not** in `LEAD_TRANSITIONS` today (`packages/validation/src/lead-status.ts:18`), so add the edge with its test, plus a stale-job check: a worker that later picks up that lead's job must not move it back), and mark the Audit `FAILED`.
- [ ] Backfill script (dry-run by default): finds `QUEUED` leads older than 10 minutes whose audit is missing or has no BullMQ job, and moves them to `AUDIT_FAILED`. Production run per D6.

## 4. REV-199 — Seed, dump, restore

**Files:** new `scripts/seed/` (`dataset.ts` with pure data builders, `run.ts` with the CLI), `scripts/seed/__tests__/dataset.spec.ts`, root `package.json` scripts `db:seed`, `db:dump`, `db:restore`, README.

- [ ] `dataset.ts` exports `buildSeedDataset(now: Date): SeedDataset`. It is pure and deterministic: fixed ObjectIds, dates relative to `now`.
- [ ] Contents: 12 leads covering `QUEUED`, `AUDITING`, `AUDITED`, `AUDIT_FAILED`, `GENERATING`, `NEEDS_APPROVAL` ×2, `SENT`, `OPENED`, `CLICKED`, `REJECTED`, `UNSUBSCRIBED`. Each audited lead gets an Audit, and there is at least one with a `design` measurement error and the template critique. Leads at `NEEDS_APPROVAL` or later get an MvpProject with one version. Leads at `SENT` or later get an EmailCampaign plus AnalyticsEvents (open, click, pageview, dwell_time). One lead has no contact email.
- [ ] Tests: every document passes its Mongoose `validateSync()`. Every Mixed field passes its Zod schema (`SiteEraSchema`, `MvpThemeSchema`, `MvpPageVersionSchema`, …). Every reference resolves inside the dataset. Every domain and email ends in `example.com`. A real-Mongo test inserts everything, re-runs the seed, and checks the counts are unchanged (idempotent).
- [ ] `run.ts`: refuses non-local URIs (Review Focus 4, tested). `--reset` drops only the seeded `_id`s, never the collections. It uploads each MVP's HTML with `StorageService.uploadHtml` (D5).
- [ ] `db:dump` / `db:restore`: `docker compose exec mongo mongodump/mongorestore --archive`, authenticated as `revamp_admin` (`--authenticationDatabase admin`; give it `backup`/`restore` if `dbAdmin` falls short), writing to `./backups/` (gitignored).
- [ ] Chrome check: after seeding, the review queue shows every bucket, a seeded lead opens at `/leads/:id`, and its preview loads. Never approve a seeded lead.

## 5. REV-180 — ER diagram and indexes (docs repo)

**Files:** `../Revamp-docs/blueprint.md` §4, plus `data-dictionary.md` if Q3 is accepted.

- [ ] ER diagram (Mermaid): five collections with references and real cardinalities. `||--o|` is now backed by the REV-201 unique indexes. E1–E3 entities are marked as planned (Q1).
- [ ] Index table with every index from `packages/db` (single, compound, unique), the query it serves (file:line), and the `explain('executionStats')` result on the seeded database showing `IXSCAN`.
- [ ] A test in `packages/db` lists every declared index and compares it with a checked-in `indexes.json`, so the docs table can't drift silently.

## 6. REV-200 — Data dictionary (docs repo + one test)

**Files:** `../Revamp-docs/data-dictionary.md` (Q3), `blueprint.md` §4 link, `research.md` (MongoDB + Redis + MinIO roles), new `packages/db/src/__tests__/dictionary-coverage.spec.ts`.

- [ ] Per collection: purpose, key, and every field with type, required, default, allowed values and nesting.
- [ ] Per Mixed field: the Zod schema that validates it and the line where it's checked before the write. Any Mixed field found **without** validation is listed, and a follow-up ticket is opened for it (not fixed silently here).
- [ ] Embed vs reference for each relationship, with the reason.
- [ ] Integrity section: Mongoose validation, Zod at the boundaries, the state machine, unique keys (`previewSlug`, `trackingToken`, `leadId` ×2), the transaction from REV-202, stalled-job handling. Known gaps: no cascade delete (there's no delete endpoint).
- [ ] Data quality expectations per collection.
- [ ] `dictionary-coverage.spec.ts` reads every path in each schema (`Model.schema.paths`) and fails if one isn't named in `data-dictionary.md`. It reads the doc from `REVAMP_DOCS_DIR` and skips with a warning when the docs repo isn't next to this one, so CI without the sibling repo still passes.

## Not in this roadmap (10-point level, no tickets yet)

TTL index on `analyticsevents`, a text index for lead search, aggregation-pipeline reports (funnel, event analytics), and a written embed-vs-reference rationale beyond REV-200. I'll open tickets for these after the six above if you want the 10-point level.
