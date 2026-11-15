# REV-198 Least-Privilege MongoDB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local MongoDB requires a login and runs as a single-node replica set. The API and workers connect as `revamp_app` (readWrite on `revamp`), never as a superuser. `revamp_read` and `revamp_admin` exist for reading and administration.

**Architecture:** The `mongo` service generates its own keyFile inside a named volume and starts with `--replSet rs0 --keyFile … --bind_ip_all`. No `MONGO_INITDB_*` variables are used, so fresh and existing volumes go through **one** path. After `compose up`, `startInfrastructure` calls `ensureMongoReady`, which runs `scripts/mongo/ensure-ready.js` in mongosh inside the container. That script uses the localhost exception on a volume with no users to initiate the replica set and create the root user, then authenticates as root and creates or updates the three app users. Passwords live only in `.env`; `ensureMongoSecrets` adds random ones to an existing `.env` and moves the old default URI to the authenticated one.

**Tech Stack:** Docker Compose, mongo:7.0 + mongosh, plain Node (`scripts/lib/dev-stack.mjs`, no dependencies), Vitest, tsx + mongoose for the check script.

**Spec:** Linear [REV-198](https://linear.app/revamp-proect/issue/REV-198/run-the-app-under-least-privilege-mongodb-users-with-read-write-and), plus the roadmap `docs/superpowers/plans/2026-11-15-database-criterion-roadmap.md` (D1, Review Focus 1).

## Global Constraints

- Users and roles, exactly:
  - `revamp_app`: built-in `readWrite` on `revamp`
  - `revamp_read`: `read` on `revamp`
  - `revamp_admin`: `dbAdmin` + `userAdmin` on `revamp`
  - `revamp_root`: `root` on `admin`, used only by `ensure-ready.js`
- Users are created in the `admin` database (`authSource=admin`), so one auth source covers all four and `mongodump --authenticationDatabase admin` works later (REV-199).
- `.env` variables: `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `MONGO_READ_PASSWORD`, `MONGO_ADMIN_PASSWORD`. Generated passwords are `crypto.randomBytes(18).toString('base64url')` (24 URL-safe characters). `.env.example` leaves them empty, with a comment saying setup fills them.
- App URI: `mongodb://revamp_app:<pw>@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true`. `directConnection=true` keeps the host-side app from resolving the member's hostname. The replica set member is `localhost:27017`.
- `scripts/lib/dev-stack.mjs` stays plain Node with no dependencies (it runs before `npm install`).
- Passwords never appear in command arguments (`ps`) or in output. They reach `docker compose exec` through `-e NAME` (value taken from the spawned process's environment).
- `apps/*/src/config/env.ts` keep their current default URI; `.env` always sets it after setup. No app code changes.
- Built-in `readWrite` (not a custom role): it includes `createIndex`, which Mongoose `autoIndex` needs. It doesn't include `dropDatabase`, `createUser` or `grantRole`. A custom role without `dropCollection` was considered and rejected: it would mean enumerating every action BullMQ-adjacent code and Mongoose use, for no grading gain. This is recorded in the docs.
- No separate admin URI for scripts: migrations and backfills only change documents, and `readWrite` is enough. Each script's header says "runs as revamp_app (MONGODB_URI)".
- Verification must not touch the shared `revamp-mongo` container that other sessions use: use a separate compose project (Task 5).

## Review Focus

1. **Existing volume with data and no users** (every current dev machine). Expected: `npm run dev` initiates the replica set, creates the users and keeps every document. Pinned by the Task 5 live check and by the `ensureMongoReady` exit-code mapping test.
2. **`.env` root password no longer matches the volume** (`.env` deleted and regenerated). Expected: a clear `SetupError` saying the volume has users this `.env` can't log in as, with both ways out (restore the old password, or `docker compose down -v`, which deletes data). Never a silent loop or a raw mongosh stack trace. Pinned in Task 3.
3. **Custom `MONGODB_URI` in an existing `.env`** (Atlas, another host). Expected: left untouched, with a warning. Pinned in Task 2.
4. **`npm run docker:up` used instead of `npm run dev`.** Expected: users and the replica set are ensured too, because `docker:up` goes through the same `startInfrastructure`. Pinned in Task 4.
5. **Running setup twice.** Expected: no new passwords, no duplicate users, exit 0. Pinned in Tasks 2 and 3.

---

### Task 1: Compose service with keyFile and replica set

**Files:**
- Modify: `docker-compose.yml` (mongo service, volumes)
- Test: `deploy/__tests__/deployment.spec.ts` (it already parses compose with `yaml`; add a describe block)

- [ ] **Step 1: Write the failing test** `describe('docker-compose mongo service (REV-198)')`, with these assertions:
  - the `command` contains `--replSet rs0`, `--keyFile /data/configdb/keyfile` and `--bind_ip_all`;
  - `volumes` include `mongo_config:/data/configdb` and `./scripts/mongo:/revamp-scripts:ro`;
  - no `MONGO_INITDB_ROOT_*` in `environment`;
  - top-level `volumes` has `mongo_config`.
- [ ] **Step 2:** `npx vitest run deploy/__tests__/deployment.spec.ts`. Expected: FAIL on the replSet assertion.
- [ ] **Step 3: Implement.** The command is `bash -c`: create `/data/configdb/keyfile` from `head -c 756 /dev/urandom | base64` only if it's missing, `chmod 400`, `chown 999:999`, then `exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/configdb/keyfile --bind_ip_all`. Keep the ping healthcheck (`ping` needs no auth). Remove `MONGO_INITDB_DATABASE`.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(REV-198): run local MongoDB as a keyFile replica set`.

### Task 2: `.env` secrets and URI (`ensureMongoSecrets`, `mongoUri`)

**Files:**
- Modify: `scripts/lib/dev-stack.mjs`, `.env.example`, `scripts/setup.mjs` (call after `ensureEnvFile`), `scripts/dev.mjs` (call in `preflight` before `startInfrastructure`)
- Test: `scripts/__tests__/dev-stack.spec.ts`

**Interfaces (Produces):**
- `MONGO_PASSWORD_VARS = ['MONGO_ROOT_PASSWORD', 'MONGO_APP_PASSWORD', 'MONGO_READ_PASSWORD', 'MONGO_ADMIN_PASSWORD']`
- `LEGACY_MONGODB_URI = 'mongodb://localhost:27017/revamp'`
- `mongoUri(user: string, password: string): string`: the app URI from Global Constraints, with the password `encodeURIComponent`-encoded.
- `ensureMongoSecrets(root: string, randomPassword = () => crypto.randomBytes(18).toString('base64url')): { added: string[]; uriUpdated: boolean; warning?: string }`.

- [ ] **Step 1: Write the failing tests** in `describe('ensureMongoSecrets')`, using a temp-dir `.env` like the existing file-helper tests:
  - `adds missing passwords and the app URI to an existing .env`: given `.env` with `MONGODB_URI=mongodb://localhost:27017/revamp` and `PORT=4000`, `added` equals the four vars, `uriUpdated` is true, the file still has `PORT=4000`, and `parseEnv(file).MONGODB_URI === mongoUri('revamp_app', <generated app pw>)`.
  - `is idempotent`: a second call gives `added: []`, `uriUpdated: false`, and the file is byte-identical.
  - `keeps a custom URI and warns`: `MONGODB_URI=mongodb+srv://x@cluster0.example.net/revamp` is unchanged, and `warning` contains `MONGODB_URI` and `revamp_app`.
  - `keeps existing passwords`: a preset `MONGO_APP_PASSWORD=keep` is not overwritten, and the URI uses `keep`.
  - `mongoUri encodes the password`: `mongoUri('u', 'a/b@c')` contains `u:a%2Fb%40c@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true`.
- [ ] **Step 2:** `npx vitest run scripts/__tests__/dev-stack.spec.ts`. Expected: FAIL (`ensureMongoSecrets` is not a function).
- [ ] **Step 3: Implement.** Missing vars are appended under a `# MongoDB users (REV-198), generated by npm run setup` comment. The `MONGODB_URI` line is replaced in place only when its value equals `LEGACY_MONGODB_URI` or is empty. `.env.example`: the URI line becomes the `revamp_app` form with an empty password placeholder and a comment, and the four empty `MONGO_*_PASSWORD=` lines are added. Since `ensureEnvFile` copies the example first, a fresh clone takes the "empty value" path.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(REV-198): generate MongoDB user passwords into .env`.

### Task 3: `ensureMongoReady` and the mongosh script

**Files:**
- Create: `scripts/mongo/ensure-ready.js` (mongosh script; add an ESLint override with mongosh globals `db`, `rs`, `print`, `sleep`, `process`, `quit`)
- Modify: `scripts/lib/dev-stack.mjs` (`startInfrastructure` calls `ensureMongoReady` after `compose up --wait`, before `minio-init`), `eslint.config.*`
- Test: `scripts/__tests__/dev-stack.spec.ts`

**Interfaces (Produces):**
- `ENSURE_READY_EXIT = { ok: 0, failed: 1, rootPasswordMismatch: 2 }`
- `ensureMongoReady(root: string, env: Record<string,string>, run = runQuiet): void`. It throws a `SetupError` on failure.

- [ ] **Step 1: Write the failing tests** with a stub `run` that records `(cmd, args, options)` and returns `{ status }`:
  - `runs ensure-ready.js in the mongo container without passwords in argv`: the args equal `['compose', 'exec', '-T', '-e', 'MONGO_ROOT_PASSWORD', '-e', 'MONGO_APP_PASSWORD', '-e', 'MONGO_READ_PASSWORD', '-e', 'MONGO_ADMIN_PASSWORD', 'mongo', 'mongosh', '--quiet', '--norc', '/revamp-scripts/ensure-ready.js']`, `options.env.MONGO_APP_PASSWORD === env.MONGO_APP_PASSWORD`, and `options.cwd === root`.
  - `maps exit 2 to a root-password hint`: it throws a `SetupError` whose message contains `MONGO_ROOT_PASSWORD` and whose hint contains `docker compose down -v` and `deletes`.
  - `maps any other failure to a SetupError with mongosh's stderr`.
  - `refuses to run with a missing password`: an env without `MONGO_READ_PASSWORD` throws before calling `run` and says to run `npm run setup`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement `ensureMongoReady`**, then write `ensure-ready.js` with this behavior, in order:
  1. Try `db.getSiblingDB('admin').auth('revamp_root', process.env.MONGO_ROOT_PASSWORD)`.
  2. If that failed: if `db.getSiblingDB('admin').getUsers()` is denied or lists users, the volume has users this password doesn't match, so `quit(2)`. Otherwise (localhost exception): `rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] })`, ignoring `AlreadyInitialized`. Wait up to 30 s for `db.hello().isWritablePrimary`, create `revamp_root` with `root@admin`, then authenticate as it.
  3. If authenticated: run `rs.status()` and initiate on `NotYetInitialized` (an existing volume that has users but no replica set). Wait for primary.
  4. For each app user, call `updateUser` (password plus roles) if it exists, otherwise `createUser`, in the `admin` db with roles on `revamp`. `.env` stays the source of truth, so changing a password there and re-running setup rotates it.
  5. Print one line per user (`ensured revamp_app (readWrite@revamp)`). Never print passwords.
- [ ] **Step 4:** Run the tests again. Expected: PASS. Run `npm run lint`. Expected: 0 errors.
- [ ] **Step 5:** Commit: `feat(REV-198): create MongoDB users and initiate the replica set on start`.

### Task 4: One entry point for the infrastructure, and the role check

**Files:**
- Create: `scripts/infra-up.mjs` (calls `checkDocker`, `ensureEnvFile`, `ensureMongoSecrets`, `startInfrastructure`, and prints the user lines)
- Create: `scripts/check-mongo-roles.ts`
- Modify: `package.json` scripts: `"docker:up": "node scripts/infra-up.mjs"`, `"db:check-roles": "tsx scripts/check-mongo-roles.ts"`
- Modify: headers of `apps/api/src/scripts/*.ts` (one line: runs as revamp_app via `MONGODB_URI`; readWrite is enough)
- Test: `scripts/__tests__/dev-stack.spec.ts` (`package.json` `docker:up` points at `infra-up.mjs`, Review Focus 4)

**Interfaces (Produces):** `checkRoles(): Promise<Array<{ user: string; action: string; expected: 'allowed' | 'denied'; actual: 'allowed' | 'denied' }>>`. The CLI exits 1 if any `actual !== expected`.

- [ ] **Step 1:** Write the failing test for `docker:up`, then run it. Expected: FAIL.
- [ ] **Step 2: Implement `infra-up.mjs` and the script change.** Run the test. Expected: PASS.
- [ ] **Step 3: Implement `check-mongo-roles.ts`.** It reads `.env` and connects once per user with `mongoUri(...)`. Its checks:

  | User | Action | Expected |
  |---|---|---|
  | `revamp_app` | insert + delete in `revamp.__rolecheck` | allowed |
  | `revamp_app` | `dropDatabase` on `revamp` | denied |
  | `revamp_app` | `createUser` | denied |
  | `revamp_app` | `listDatabases` | denied |
  | `revamp_read` | find | allowed |
  | `revamp_read` | insert | denied |
  | `revamp_admin` | `createIndex` + `dropIndex` on `__rolecheck` | allowed |

  "Denied" means the error code is 13 (Unauthorized). It prints a table and cleans up `__rolecheck` as `revamp_admin`. No Vitest test: it's an integration script against the live container, run in Task 5. This is a ruling; the reviewer may challenge it.
- [ ] **Step 4:** Commit: `feat(REV-198): docker:up ensures users; add db:check-roles`.

### Task 5: Live verification on an isolated stack

The shared `revamp-mongo` container stays untouched. Use the scratchpad override `compose.rev198.yml`, which sets `container_name: rev198-mongo`, port `27018:27017`, and named volumes `rev198_mongo_data` / `rev198_mongo_config`. Run commands with `docker compose -p rev198 -f docker-compose.yml -f <override> … mongo`. Point a temp `.env` at port 27018 (`mongoUri` gains an optional `port` argument only if needed; prefer setting `MONGODB_URI` directly in the temp `.env`).

- [ ] **Step 1 (fresh volume):** run `startInfrastructure` against the override, then `db:check-roles`. Expected: every row matches. Run it again. Expected: same output, no new users (Review Focus 5).
- [ ] **Step 2 (existing volume, Review Focus 1):** start plain `mongo:7.0` with no auth on a new volume, insert 3 leads, stop it. Start the override on that volume, then run `ensureMongoReady` and `db:check-roles`. Expected: the 3 leads are still there when read as `revamp_read`, and all rows match.
- [ ] **Step 3 (password mismatch, Review Focus 2):** change `MONGO_ROOT_PASSWORD` in the temp `.env` and run `ensureMongoReady`. Expected: the `SetupError` with the `down -v` hint.
- [ ] **Step 4 (app end to end):** run the branch's API and workers against the isolated Mongo, with ports changed via env (`PORT=4100`, workers default). Then `POST /api/v1/leads` with `https://example.com`. Expected: 201, the audit runs, and the lead reaches `AUDITED` or `AUDIT_FAILED` with no auth errors in the logs. Then `GET /health` gives 200.
- [ ] **Step 5:** Tear down with `docker compose -p rev198 … down -v` and delete the scratch files. Record the outputs for the PR's Verification section.

### Task 6: Docs, gates, PR

**Files:** `README.md` (Quick start, Troubleshooting row for the root-password mismatch, Scripts table: `db:check-roles`, `docker:up`; a "MongoDB users" subsection with the role table and the Atlas setup), `AGENTS.md` §3.1.1 (setup now ensures users and the replica set; scripts run as `revamp_app`), `../Revamp-docs/blueprint.md` §7 (database access control) and §4 note (replica set for transactions), `research.md` (one line: built-in `readWrite` over a custom role, with the reason).

- [ ] **Step 1:** Write the docs. The Atlas setup lists three database users with the same roles. The app's `MONGODB_URI` in the GitHub `production` environment uses `revamp_app`. This needs your Atlas access, so it's a step for you (roadmap D6).
- [ ] **Step 2:** Run the gates: `npm run build:packages`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Expected: all pass.
- [ ] **Step 3:** One whole-branch review (Opus) and one fix pass for Critical/Important findings, each with a check that fails first.
- [ ] **Step 4:** PR `feat(REV-198): run the app under least-privilege MongoDB users`. The body says: "Merging this changes the shared dev stack. The next `npm run dev` on the main checkout migrates `revamp-mongo` in place (users plus replica set). Other running sessions must restart their API and workers after that." Attach it to the ticket and move the ticket to In Review.
- [ ] **Step 5:** Before merging: rebase on main, re-run the gates, and **ask you** before the shared stack migrates (it affects other sessions). Then merge, run `npm test` on main, push the docs to `../Revamp-docs`, comment on the ticket, and move it to Done.

## Rulings to confirm

- Users are created in `admin` with `authSource=admin`, not in the `revamp` db. This simplifies dump/restore and the root bootstrap; roles are still scoped to `revamp`.
- Built-in `readWrite` for the app (it can still drop a collection, but not the database or users).
- `check-mongo-roles.ts` has no Vitest test and is verified live (Task 5). Its logic is a table of calls against a real server, and the alternative, mocking the driver, would prove nothing.
- No separate admin URI for scripts.
