# REV-199 Reproducible Seed Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run db:seed` loads a fixed, clearly marked demo dataset (all five collections, every main lead status) into a local database, and `npm run db:dump` / `db:restore` export and import the database.

**Architecture:** A pure builder in `@revamp/db` returns the dataset for a given `now`, with fixed ObjectIds. A seeder writes it through the Mongoose models in one transaction: by default it inserts only the seed documents that are missing, and with `--reset` it deletes the seed documents by id and inserts them again. It never touches documents that aren't seed documents. A root script guards the target, uploads the MVP pages to MinIO and calls the seeder. The dump and restore script runs `mongodump` / `mongorestore` inside the `revamp-mongo` container.

**Tech Stack:** Mongoose 8 (transactions on `rs0`), `@aws-sdk/client-s3` (MinIO), tsx scripts, Vitest, mongodb-memory-server (`real-mongo.spec.ts` only).

**Spec:** Linear REV-199 (acceptance criteria), plus AGENTS.md §3.1.1, §3.2.2 (REV-45: no mock data at runtime), §3.2.7 and §3.2.8.

## Global Constraints

- All seed data is written through the `@revamp/db` models (`insertMany` runs schema validation). There are no raw collection writes.
- Every seed domain and email ends in `.test` (RFC 2606). A `.test` name never resolves, so the email worker's MX pre-flight check bounces any send. Don't use `example.com`: it publishes a null MX record, which the MX check reads as a valid record.
- The script refuses to run when `NODE_ENV=production` or when any host in `MONGODB_URI` isn't `localhost`, `127.0.0.1`, `::1` or `mongo` (the compose service name). `mongodb+srv` is always refused.
- The seeder never deletes or changes a document whose `_id` isn't in `DEMO_IDS`. The shared `revamp-mongo` database holds other sessions' leads.
- Leads carry the tag `demo-seed` and business names that start with `Demo `.
- The app runs as `revamp_app`, never root. Passwords never go in argv; they travel in the environment.
- Real-Mongo tests go in `packages/db/src/__tests__/real-mongo.spec.ts` only.

## Review Focus

1. Seeding while non-seed leads exist: those leads stay untouched by both modes, including `--reset`.
2. A seed document the operator changed in the dashboard (for example, approving the NEEDS_APPROVAL lead): a plain run leaves it as it is; `--reset` restores it.
3. A unique index clash with a non-seed document (the same `trackingToken` or `previewSlug`): avoided by `demo-` prefixed values; a clash aborts the whole transaction, so nothing is half seeded.
4. A `MONGODB_URI` with several hosts, one of them remote, or `mongodb+srv`: refused.
5. MinIO down: the upload fails before any database write, and the script exits 1 with a clear message; there's no half-seeded state.

---

### Task 1: Pure dataset builder

**Files:**
- Create: `packages/db/src/seed/demo-dataset.ts`
- Modify: `packages/db/src/index.ts` (export `buildDemoDataset`, `DEMO_IDS`, `DemoDataset`, `demoDocumentIds`)
- Test: `packages/db/src/__tests__/demo-dataset.spec.ts`

**Interfaces:**
- Produces:
  - `buildDemoDataset(now: Date): DemoDataset`, where `DemoDataset = { leads; audits; mvpProjects; emailCampaigns; analyticsEvents; pages: { slug: string; indexHtml: string; versionHtml: string }[] }`. Each array holds plain objects with a fixed `_id: Types.ObjectId`.
  - `DEMO_IDS`: fixed hex ids (prefix `5eed`).
  - `demoDocumentIds(ds): Record<'leads'|'audits'|'mvpProjects'|'emailCampaigns'|'analyticsEvents', Types.ObjectId[]>`.

Leads (10), with dates relative to `now`:

| Lead | Status | Children / edge case |
|---|---|---|
| Demo Dental Studio | QUEUED | audit QUEUED |
| Demo Auto Repair | AUDIT_FAILED | audit FAILED, `auditError` |
| Demo Law Office | AUDITED | audit with `measurementErrors` (performance) and a template critique (`design` error, `aiFallbackUsed`) |
| Demo Beauty Salon | AUDITED | no `contactEmail` |
| Demo Fitness Club | NEEDS_APPROVAL | audit, MVP, campaign NEEDS_APPROVAL |
| Demo Bistro | SENT | campaign DELIVERED |
| Demo Builders | OPENED | campaign DELIVERED, open event |
| Demo Clinic | CLICKED | open, click, pageview, dwell_time and scroll_depth events, metrics |
| Demo Realty | ENGAGED | plus `cta_click`, `booking_intent` |
| Demo Florist | UNSUBSCRIBED | campaign UNSUBSCRIBED, unsubscribe event |

MVPs (on the five outreach leads) have a `theme` (all `MVP_THEME_VARS`), `standards`, `controls` (none), and one `versions` entry with `kind: 'generation'` and `storagePath: v/<slug>/versions/1.html`. Each also has `previewSlug: demo-<name>` and the `fullPreviewUrl` / `storageHtmlPath` that `uploadHtml` would give. The page is a small handwritten HTML page in the page rules' shape: `lang`, one `<h1>`, theme variables in `:root`, no scripts, and placeholders in the version and filled fake contacts in `index.html`.

- [ ] **Step 1: Write failing tests** in `demo-dataset.spec.ts`:
  - `covers every required status`: lead statuses ⊇ QUEUED, AUDITED, AUDIT_FAILED, NEEDS_APPROVAL, SENT, CLICKED, UNSUBSCRIBED.
  - `every collection has documents`.
  - `every document passes its Mongoose schema`: `new Model(doc).validateSync()` is `undefined` for each.
  - `references point at seeded documents`: every `leadId`, `auditId`, `mvpProjectId` and `campaignId` is in the dataset; an MVP's audit belongs to the same lead.
  - `Mixed fields pass their Zod schemas`: `MvpThemeSchema`, `MvpStandardsSchema`, `MvpPageVersionSchema` for each version, and `DesignCritiqueOutputSchema` for completed audits that aren't template critiques.
  - `edge cases present`: a lead without `contactEmail`, an audit with `measurementErrors`, an audit with a `design` measurement error.
  - `only .test domains`: every `domain`, `originalUrl` host and email ends in `.test`.
  - `deterministic`: two builds with the same `now` are deep equal, and ids are unique across the dataset.
  - `marked`: every lead has the tag `demo-seed` and a name starting with `Demo `.
- [ ] **Step 2: Run** `npx vitest run packages/db/src/__tests__/demo-dataset.spec.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `demo-dataset.ts`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(REV-199): fixed demo dataset covering every collection and the main lead statuses`.

### Task 2: Seeder and target guard

**Files:**
- Create: `packages/db/src/seed/seed-demo.ts` (export from `index.ts`)
- Test: `packages/db/src/__tests__/seed-demo.spec.ts` (guard, pure), `real-mongo.spec.ts` (seeding)

**Interfaces:**
- Consumes: `DemoDataset`, `demoDocumentIds`.
- Produces:
  - `assertLocalSeedTarget(uri: string, nodeEnv: string | undefined): void`, which throws `Error` with the reason.
  - `seedDemoDataset(ds: DemoDataset, opts: { reset: boolean }): Promise<Record<collection, { inserted: number; kept: number }>>`.

  It runs in `mongoose.connection.transaction`. With reset, it runs `deleteMany({ _id: { $in: ids } })` for each model and then `insertMany(all)`. Without reset, it finds the existing ids and runs `insertMany(missing)`.

- [ ] **Step 1: Write failing guard tests**:
  - accepted: `mongodb://u:p@localhost:27017/revamp?replicaSet=rs0`, `mongodb://127.0.0.1`, `mongodb://mongo:27017/revamp`.
  - refused: `mongodb+srv://…`, `mongodb://db.example.net`, `mongodb://localhost,remote.host/x`, and any URI with `nodeEnv: 'production'`.
- [ ] **Step 2: Write failing real-Mongo tests** in a new `describe('demo seed')` block:
  - `seeds every collection`: counts equal the dataset sizes.
  - `a second run inserts nothing`: every collection reports `inserted: 0`.
  - `plain run keeps an operator change; reset restores it`.
  - `leaves non-seed documents alone`: a foreign lead survives both modes.
  - `a unique clash rolls everything back`: insert a foreign campaign with a seed `trackingToken`; the seeder rejects and no seed lead exists.
- [ ] **Step 3: Run** both specs. Expected: FAIL.
- [ ] **Step 4: Implement** `seed-demo.ts`.
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(REV-199): transactional demo seeder that only touches seed documents`.

### Task 3: `npm run db:seed` script with MinIO upload

**Files:**
- Create: `scripts/db-seed.ts`
- Modify: root `package.json` (`db:seed` script; `@aws-sdk/client-s3` as a root devDependency at the workers' version)

**Interfaces:**
- Consumes: `assertLocalSeedTarget`, `buildDemoDataset`, `seedDemoDataset`, `redactMongoUri`, and `parseEnv` (`scripts/lib/dev-stack.mjs`).

The script reads `.env` (`ENV_FILE` overrides it), guards the target, and uploads each page first: `v/<slug>/index.html` and `v/<slug>/versions/1.html` to `S3_BUCKET_DEMOS`, creating the bucket if it's missing, with the same content type and cache headers as `uploadHtml`. It then connects and seeds, and prints a per-collection report. Pass `--reset` for reset mode. Any failure prints the reason and exits 1.

- [ ] **Step 1: Verify against an isolated stack**: a mongodb-memory-server replica set URI with `ENV_FILE`, plus the shared MinIO (the `demo-*` keys can't collide). Run it twice, then with `--reset`, and read the reports. Expected: the first run inserts everything, the second inserts 0, and reset inserts everything. Then run `curl` on one `fullPreviewUrl`. Expected: 200, HTML.
- [ ] **Step 2: Verify the guard**: `MONGODB_URI=mongodb+srv://x/y npm run db:seed`. Expected: exit 1, refusal message, no upload.
- [ ] **Step 3: Commit** `feat(REV-199): npm run db:seed uploads the demo pages and seeds through the models`.

### Task 4: `npm run db:dump` / `db:restore`

**Files:**
- Create: `scripts/db-archive.ts`
- Test: `scripts/__tests__/db-archive.spec.ts`
- Modify: root `package.json`

**Interfaces:**
- Produces `archiveCommand(mode: 'dump' | 'restore', opts: { uri: string; drop: boolean }): { args: string[]; env: Record<string, string> }`, which builds `docker exec -i -e … revamp-mongo sh -c …`.
  - The password goes in an env var that a `--config` YAML written inside the container reads, so it's never in argv.
  - Dump: `mongodump --archive --gzip --db <db>` streams to `backups/<db>-<timestamp>.archive.gz`, or a given path. `backups/` is gitignored.
  - Restore: `mongorestore --archive --gzip`, with `--drop` only when the `--drop` flag is passed. It needs a file argument and applies the same local guard.

- [ ] **Step 1: Failing tests**: the args never contain the password; `--drop` is present only when asked; the db comes from the URI path; restore without a file throws.
- [ ] **Step 2: Implement; tests pass.**
- [ ] **Step 3: Verify** on a throwaway compose project: dump, then restore into it. Don't use the shared `revamp-mongo`. Its read-only dump is fine.
- [ ] **Step 4: Commit** `feat(REV-199): db:dump and db:restore through mongodump in the mongo container`.

### Task 5: Gates, Chrome check, docs

- [ ] Gates: `build:packages`, `typecheck`, `lint`, `test`, `build`.
- [ ] Chrome: point the dashboard at the isolated seeded database. Check that the review queue buckets, a CLICKED lead's Audit, Prototype (the MVP iframe loads from MinIO) and Email steps, and analytics all have data, with no console errors.
- [ ] Docs: README (scripts, dataset table), AGENTS.md §3.1.1 (one bullet), `.gitignore` (`backups/`), and `../Revamp-docs/blueprint.md` (seed and export section).
