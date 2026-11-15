# REV-201 One MVP and One Campaign per Lead — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MongoDB itself rejects a second `MvpProject` or `EmailCampaign` for one lead. The existing upserts stay correct under concurrency, and existing data can be moved to the new index safely.

**Architecture:** `leadId` becomes `unique: true` on both schemas in `packages/db`. The server's own upsert retry (MongoDB 4.2+, roadmap D4) covers concurrent upserts. A real-Mongo test proves it, running on `mongodb-memory-server` (D2). An existing database already has a non-unique `leadId_1` index, and Mongoose's autoIndex cannot turn it unique. So a migration script removes duplicates (dry run by default), drops the old index and builds the unique one. API and workers check the index at startup and log the command to run when it isn't unique yet.

**Tech Stack:** Mongoose 8.24, MongoDB driver 6.20, MongoDB 7.0, `mongodb-memory-server` 11.3.0, Vitest, tsx.

**Spec:** Linear [REV-201](https://linear.app/revamp-proect/issue/REV-201) acceptance criteria. Roadmap `docs/superpowers/plans/2026-11-15-database-criterion-roadmap.md` §2 and decisions D2, D4 and D6.

## Global Constraints

- Schemas change only in `packages/db` (AGENTS.md §3.2.7).
- Migrations run as `revamp_app` (`MONGODB_URI`). `readWrite` covers `createIndex`, `dropIndex` and `delete` (REV-198). Never connect as root.
- Scripts are dry-run by default, and `--apply` writes. This follows the existing backfill scripts in `apps/api/src/scripts`.
- An E11000 that still reaches the API becomes `409 DUPLICATE` through `errorHandler`, a code already in `API_ERROR_CODES`. No new code is added.
- `mongodb-memory-server` is a root dev dependency, pinned to the MongoDB `7.0.14` binary. The helper is never exported from `@revamp/db`'s `index.ts`, so production code never loads it.
- Production (Atlas) runs only with you (D6). The PR ships the dry-run script and the exact steps.

## Review Focus

1. **The existing non-unique `leadId_1` index on dev and Atlas.** Mongoose autoIndex fails to replace it (IndexKeySpecsConflict) and swallows the error, so without the migration the unique index never exists. Pinned by the Task 3 migration test and the Task 4 startup check.
2. **Duplicates already in the data.** The unique build fails with E11000 until they are removed. The keep rules have to keep the record the lead and the dashboard point at. Pinned by Task 3 tests.
3. **`leadId` written in the update body itself.** That can stop the server retry from applying, or make an upsert rewrite the key. Both call sites drop it from the update, because an upsert copies equality filter fields into the insert. Pinned by the Task 2 concurrency tests.
4. **Deleting a duplicate `MvpProject` leaves its MinIO files.** The script deletes database records only and prints the slugs it orphaned. Storage cleanup is out of scope (asserted on the dry-run output in Task 3).
5. **A campaign of an unsubscribed lead must survive the dedupe**, because its `trackingToken` handles later opt-outs. The keep rule ranks `UNSUBSCRIBED` highest (Task 3).

---

### Task 1: Real-Mongo test helper

**Files:**
- Create: `packages/db/src/testing/mongo-memory.ts`
- Create: `packages/db/src/__tests__/mongo-memory.spec.ts`
- Modify: root `package.json` (devDependency `mongodb-memory-server@11.3.0`; `"config": { "mongodbMemoryServer": { "version": "7.0.14" } }`)
- Modify: `.github/workflows/ci.yml` (an `actions/cache@v4` step for `~/.cache/mongodb-binaries`, keyed on `mongodb-7.0.14`, before **Test**)
- Modify: `deploy/__tests__/ci-workflow.spec.ts`
- Modify: `tsconfig` / `packages/db/tsconfig.json` so `src/testing` and `__tests__` stay out of `dist` (follow whatever the package already excludes)

**Interfaces:**
- Produces: `startMongoReplSet(): Promise<{ uri: string; stop(): Promise<void> }>`. It starts a single-node `MongoMemoryReplSet` (REV-202 needs transactions) and returns a URI with a database name such as `revamp-test`.

- [ ] **Step 1: Write the failing test** `mongo-memory.spec.ts`: "starts a replica set Mongoose can connect to". It calls `startMongoReplSet()`, then `mongoose.createConnection(uri).asPromise()`, then `db.admin().command({ hello: 1 })`. It expects `setName` to be defined and the server version to start with `7.0`. Then it closes the connection and calls `stop()`. The test has a 120 s timeout, because the first run downloads the binary.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/__tests__/mongo-memory.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Add the dependency** (`npm install -D mongodb-memory-server@11.3.0` at the root) **and the config pin, then implement the helper.**
- [ ] **Step 4: Run the test again.** Expected: PASS.
- [ ] **Step 5: CI cache test first.** In `ci-workflow.spec.ts`, add "caches the MongoDB test binary before the tests". It finds a step that uses `actions/cache@` with a path containing `mongodb-binaries`, and checks that step's index comes before the step whose `run` is `npm test`. Run it and watch it FAIL. Add the step and watch it PASS.
- [ ] **Step 6: Commit** `test(REV-201): real-Mongo test helper on mongodb-memory-server`.

### Task 2: Unique `leadId` and safe concurrent upserts

**Files:**
- Modify: `packages/db/src/models/MvpProject.model.ts:15-20` and `EmailCampaign.model.ts:46-51` (`unique: true` replaces `index: true`)
- Modify: `apps/workers/src/workers/deploy.worker.ts:92-99` (drop `leadId` from `$set`)
- Modify: `apps/api/src/routes/outreach.routes.ts:102-105` (drop `leadId` from the update)
- Create: `packages/db/src/__tests__/lead-children-unique.spec.ts`

**Interfaces:**
- Consumes: `startMongoReplSet` (Task 1).

- [ ] **Step 1: Write the failing tests:**
  - "declares leadId unique on MvpProject and EmailCampaign". For each model, `Model.schema.indexes()` contains `[{ leadId: 1 }, expect.objectContaining({ unique: true })]`.
  - "rejects a second MvpProject for one lead". On real Mongo after `Model.init()`, inserting a second document with the same `leadId` rejects with `code: 11000`. The same test runs for EmailCampaign.
  - "20 concurrent MVP upserts for one lead leave one document". 20 parallel `MvpProject.findOneAndUpdate({ leadId }, { $set: {...required fields, a distinct previewSlug per call } }, { upsert: true, new: true })` calls all resolve, and `countDocuments({ leadId })` is 1. The update has the same shape as deploy.worker, without `leadId` in `$set`. The same test runs for EmailCampaign, shaped like outreach approve.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/__tests__/lead-children-unique.spec.ts`. Expected: FAIL. The schema test fails, the second insert is accepted, and the count is above 1 (or flaky).
- [ ] **Step 3: Implement** `unique: true` on both fields, and drop `leadId` from both call sites' update documents. Keep the call sites' existing unit tests green, and update any assertion that expects `leadId` in the update body.
- [ ] **Step 4: Run the new file, then** `npx vitest run apps/workers/src/workers apps/api/src/routes`. Expected: PASS. If a concurrent upsert still throws E11000, D4 is wrong for this shape. Ledger a ruling and switch the call sites to one retry on 11000.
- [ ] **Step 5: Commit** `fix(REV-201): one MvpProject and one EmailCampaign per lead, enforced by a unique index`.

### Task 3: Migration — dedupe and rebuild the index

**Files:**
- Create: `packages/db/src/lead-children-migration.ts` (exported from `index.ts`)
- Create: `apps/api/src/scripts/migrate-unique-lead-children.ts`, plus the npm script `migrate:unique-lead-children` in `apps/api/package.json`
- Create: `packages/db/src/__tests__/lead-children-migration.spec.ts`

**Interfaces:**
- Produces:
  - `planLeadChildDedupe(kind: 'mvp' | 'campaign', docs: DedupeDoc[], previewUrl?: string): { keep: string; remove: string[] }`. This is pure.
    - MVP: keep the one whose `previewSlug` occurs in the lead's `previewUrl`, otherwise the newest `updatedAt`.
    - Campaign: keep by status rank (`UNSUBSCRIBED` > `ENGAGED` > `CLICKED` > `OPENED` > `DELIVERED` > `SENDING` > `SCHEDULED` > others), then the newest `updatedAt`.
  - `migrateLeadChildren(conn: mongoose.Connection, { apply }: { apply: boolean }): Promise<MigrationReport>`. `MigrationReport` holds, per collection, the duplicate groups (lead id, kept id, removed ids, and orphaned slugs for MVPs) and `index: 'unique' | 'rebuilt' | 'would-rebuild'`.
  - The script prints the report; `--apply` writes.

- [ ] **Step 1: Write the failing tests.** Pure `planLeadChildDedupe`:
  - keeps the slug in `previewUrl`
  - falls back to the newest
  - ranks `UNSUBSCRIBED` above a newer `SCHEDULED`
  - ties on status go to the newest

  Real Mongo, on raw collections seeded with duplicates and the old non-unique `leadId_1` index (the unique schema index not built yet):
  - "dry run reports and changes nothing": counts and indexes are unchanged, and the report lists the groups, with the orphaned slugs for MVPs.
  - "apply removes duplicates and leaves leadId_1 unique": `indexes()` has `leadId_1` with `unique: true`, and each lead has 1 document.
  - "second apply is a no-op": no groups, `index: 'unique'`.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/__tests__/lead-children-migration.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.**
  1. Find duplicate groups with an aggregation: `$group` by `leadId`, `count > 1`.
  2. Load the leads' `previewUrl`.
  3. Delete the removed ids with `deleteMany`.
  4. If `leadId_1` is not unique, `dropIndex('leadId_1')`, then `createIndex({ leadId: 1 }, { unique: true })`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-201): migration that removes duplicate lead children and makes leadId unique`.

### Task 4: Startup check

**Files:**
- Modify: `packages/db/src/lead-children-migration.ts` (add `checkLeadChildIndexes`)
- Modify: `apps/api/src/index.ts` and `apps/workers/src/index.ts` (after `mongoose.connect`, log each warning)
- Test: add to `lead-children-migration.spec.ts`, plus a source guard in the same style as REV-198's `redact-uri.spec.ts`

**Interfaces:**
- Produces: `checkLeadChildIndexes(conn): Promise<string[]>`. It returns one warning per collection whose `leadId_1` is missing or not unique. Each warning names `npm run migrate:unique-lead-children --workspace=@revamp/api`. It never throws: a failure to list indexes becomes a warning.

- [ ] **Step 1: Write the failing tests:**
  - On the old index, it returns 2 warnings that contain the command.
  - After `migrateLeadChildren({ apply: true })`, it returns `[]`.
  - Source guard: both `index.ts` files call `checkLeadChildIndexes`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement it and wire it in** (`console.warn` per warning; startup continues).
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-201): API and workers warn at startup until leadId is unique`.

### Task 5: Live check, gates, docs

- [ ] **Isolated compose project** (other names and ports, per AGENTS.md §3.1.1):
  1. Seed duplicates, then dry run and `--apply`.
  2. Run the API and workers against it: the startup warning shows before the migration and not after.
  3. Add a lead and generate it so the deploy upsert runs, then use the dashboard on the isolated stack to check the Prototype step.
  4. Check the console.
- [ ] **Read-only dry run on the shared dev database.** Report its output and never `--apply` there.
- [ ] **Gates:** build:packages, typecheck, lint, test, build.
- [ ] **Docs:**
  - README scripts table and an upgrade note.
  - AGENTS.md §3.2.7: one MvpProject and one EmailCampaign per lead, enforced by unique `leadId`; real-Mongo tests use `startMongoReplSet`.
  - Revamp-docs `blueprint.md` §4: the unique keys and the migration.
  - A ticket comment with the Atlas steps (D6).
