# REV-224 (E2.1) Contact Registry Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD (watch each new test fail first). Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** One registry across all studios in `@revamp/db`. It records who may contact which business, until when, and the cooldown after. It records opt-outs as a business flag plus hashed addresses. A single atomic `grantContactRight` refuses with a reason when the business is held, in cooldown or opted out. A dry-run-first migration gives existing leads rights, and the demo seed includes them.

**Architecture:** Each right is a `ContactRight` document. Exclusivity is enforced by a compare-and-set on a per-business `contactHold` subdocument of the shared `Business`: the grant writes the hold only when the business has none, or its cooldown has ended, and the business has not opted out. That one-document atomic write decides concurrent grants without a date-based index. The grant runs in the caller's session, so E2.2 can put it in the add-lead transaction. Opt-out lives on `Business.optedOutAt`, plus a `SuppressedAddress` collection keyed by the SHA-256 of the normalized address.

**Tech Stack:** Mongoose 8, MongoDB replica set transactions, Node `crypto`, Vitest with `mongodb-memory-server` (`real-mongo.spec.ts`).

**Spec:** Linear REV-224, epic REV-170 (decisions comment of 2026-11-27), BA US3/US4 (`../Revamp-docs/ba-expertise.md:256-257`). Read root `AGENTS.md` and `packages/db/AGENTS.md` first.

## Rulings

1. **Durations** come from the caller (`{ rightDays, cooldownDays }`). `@revamp/db` reads no env. The defaults are in shared-types: `DEFAULT_CONTACT_RIGHT_DAYS = 14`, `DEFAULT_CONTACT_COOLDOWN_DAYS = 30`. The API env gets `CONTACT_RIGHT_DAYS` and `CONTACT_COOLDOWN_DAYS` (positive integers with those defaults) for the migration script. The workers' env waits for REV-226, which uses it.
2. **Windows:** a right is active while `grantedAt <= now < expiresAt` and it has no `endedAt`. The cooldown runs `expiresAt <= now < cooldownUntil`, where `cooldownUntil = expiresAt + cooldownDays`. The cooldown blocks **every** studio, including the former holder (epic decision).
3. **Refusal reasons, checked in this order:** `opted_out` (business flag or suppressed address hash), then `held` (an active hold), then `cooldown`. `held` returns `expiresAt` and `cooldown` returns `availableAt` (= `cooldownUntil`). The other studio's identity is never returned.
4. **The grant returns a result and never throws a refusal:** `{ granted: true, right } | { granted: false, reason, expiresAt?, availableAt? }`. E2.2 maps refusals to API errors. A refused grant writes nothing.
5. **Address hash:** `sha256(email.trim().toLowerCase())` as hex. `hashAddress` is the one place that normalizes. The grant checks the lead's `contactEmail` hash when one is given.
6. **Ending a right early** (`endContactRight(rightId, { at, reason: 'opted_out' })`) is provided now for REV-227: it sets `endedAt` and moves the hold's `expiresAt` to `at`, so the cooldown starts. Not wired anywhere yet.
7. **Migration (`migrateContactRights`):**
   * For every business with leads that have a studio and no `contactHold`, the **oldest** such lead (by `createdAt`, then `_id`) gets a right with `source: 'MIGRATION'`, granted **at migration time** for `rightDays`. Back-dating would expire every live pipeline at once.
   * Other studios' leads of the same business are reported in `conflicts`. They are not changed; REV-226 blocks their outreach.
   * A business with an `UNSUBSCRIBED` lead gets `optedOutAt` (its earliest `updatedAt`), plus the hash of that lead's `contactEmail`, and no right.
   * Dry run by default, idempotent.
   * Command: `npm run migrate:contact-rights --workspace=@revamp/api` (`-- --apply`).
8. **Startup warning:** `checkContactRights(connection)` warns while a business with a studio lead has neither a `contactHold` nor `optedOutAt`. The API and the workers log it, like `checkTenantLinks`.
9. **Seed:**
   * Each demo business gets a right for the demo studio's lead: `grantedAt = now - 1 day`, `expiresAt = grantedAt + 14d`, `source: 'MIGRATION'`, fixed ids under the new collection kind.
   * The `UNSUBSCRIBED` florist gets `optedOutAt`, a suppressed hash of `flowers@florist.test`, and no right.
10. **Not in this ticket:** API routes, `scopeFor`, the tenant guard list (REV-225 / REV-226 add `ContactRight` when the API first reads it), the workers, the dashboard, the opt-out write path (REV-227).

## Global Constraints

- Schemas only in `packages/db`, and no `Schema.Types.Mixed`. Every new field gets a data-dictionary row in `../Revamp-docs/database-expertise.md` (done after the merge; list them under `Docs to update`).
- Real-MongoDB tests only in `packages/db/src/__tests__/real-mongo.spec.ts`, inside its existing `describe`. Don't start another server.
- `npm run docs:check-dictionary` will list the new fields until the docs land. That's expected; mention it in the report.

## Review Focus

1. **20 grants for one business at once, from 20 studios** must leave exactly one right and one hold. Under transactions some attempts hit WriteConflict and are retried by `connection.transaction`; the retry must then see the hold and refuse. Test: `› 20 concurrent grants leave exactly one right` (Task 2).
2. **Grant inside an aborted outer transaction** (E2.2's enqueue fails after the add): the hold and the right must both disappear. Test: `› a grant in a transaction that aborts leaves no hold and no right` (Task 2).
3. **A suppressed address on a different business** must still refuse (the hash, not the business, matches). Test: `› refuses a lead whose contact email is suppressed under another business` (Task 2).
4. **Exact window boundaries:** at `expiresAt` the result is cooldown, not held; at `cooldownUntil` a grant succeeds. Tests use an injected `now` (Task 2).
5. **Rerunning the migration** after new leads were added by the normal path (with holds) must not touch them or double-grant. Test: `› a second apply changes nothing` (Task 3).

---

### Task 1: Types, schemas and the address hash

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Create: `packages/db/src/models/ContactRight.model.ts`, `packages/db/src/models/SuppressedAddress.model.ts`, `packages/db/src/address-hash.ts`
- Modify: `packages/db/src/models/Business.model.ts`, `packages/db/src/index.ts`
- Test: `packages/db/__tests__/models.spec.ts`, `packages/db/__tests__/address-hash.spec.ts` (new)

**Interfaces (Produces):**
```ts
// shared-types
export const DEFAULT_CONTACT_RIGHT_DAYS = 14; export const DEFAULT_CONTACT_COOLDOWN_DAYS = 30;
export const CONTACT_RIGHT_SOURCES = ['ADD_LEAD', 'PURCHASE', 'MIGRATION'] as const; export type ContactRightSource = …;
export const CONTACT_RIGHT_REFUSALS = ['opted_out', 'held', 'cooldown'] as const; export type ContactRightRefusal = …;
export interface IContactRightView { expiresAt: string; active: boolean }   // what a studio may see of its own right (used from REV-225)

// db
export interface IContactRightDocument extends Document { tenantId: Types.ObjectId; businessId: Types.ObjectId; leadId: Types.ObjectId;
  source: ContactRightSource; grantedAt: Date; expiresAt: Date; cooldownUntil: Date; endedAt?: Date; endReason?: 'opted_out'; createdAt; updatedAt }
  // collection 'contactrights'; indexes { tenantId, businessId, expiresAt }, { leadId }, { businessId, expiresAt }
export const ContactRight: Model<IContactRightDocument>
export interface IContactHold { rightId: Types.ObjectId; tenantId: Types.ObjectId; expiresAt: Date; cooldownUntil: Date }
// Business gains: contactHold?: IContactHold (_id: false subdocument), optedOutAt?: Date
export interface ISuppressedAddressDocument extends Document { hash: string; createdAt: Date }   // collection 'suppressedaddresses', hash unique, /^[0-9a-f]{64}$/
export const SuppressedAddress: Model<ISuppressedAddressDocument>
export function hashAddress(email: string): string            // sha256 hex of trim().toLowerCase()
```

- [ ] **Step 1: Failing tests**
  - `address-hash.spec.ts`:
    - `hashAddress(' Owner@Example.COM ') === hashAddress('owner@example.com')`.
    - The result is 64 hex characters.
    - It differs for different addresses.
    - It never contains the address.
  - `models.spec.ts`:
    - `ContactRight` requires `tenantId`, `businessId`, `leadId`, `grantedAt`, `expiresAt` and `cooldownUntil`, and rejects `source: 'GIFT'`.
    - `SuppressedAddress` rejects a hash that is not 64 hex characters.
    - `Business` accepts `contactHold` and `optedOutAt`.
- [ ] **Step 2:** `npx vitest run packages/db/__tests__`. Expected: FAIL.
- [ ] **Step 3:** Implement to the interfaces and export from `index.ts`.
- [ ] **Step 4:** `npm run build:packages && npx vitest run packages/db/__tests__`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-224): contact right, business hold and suppressed address schemas`.

### Task 2: Grant, read and end a right

**Files:**
- Create: `packages/db/src/contact-rights.ts` (exported from `index.ts`)
- Test: `packages/db/src/__tests__/real-mongo.spec.ts`, a new `describe('contact registry (REV-224)')`

**Interfaces:**
```ts
export interface ContactRightDurations { rightDays: number; cooldownDays: number }
export interface GrantContactRightInput { tenantId: Types.ObjectId | string; businessId: Types.ObjectId | string; leadId: Types.ObjectId | string;
  contactEmail?: string; source: ContactRightSource; durations: ContactRightDurations; now?: Date; session?: ClientSession }
export type GrantContactRightResult =
  | { granted: true; right: IContactRightDocument }
  | { granted: false; reason: 'opted_out' }
  | { granted: false; reason: 'held'; expiresAt: Date }
  | { granted: false; reason: 'cooldown'; availableAt: Date };
export async function grantContactRight(input: GrantContactRightInput): Promise<GrantContactRightResult>
export async function findActiveContactRight(q: { tenantId; businessId } | { leadId }, now?: Date, session?: ClientSession): Promise<IContactRightDocument | null>
export async function endContactRight(rightId: Types.ObjectId | string, end: { at: Date; reason: 'opted_out' }, session?: ClientSession): Promise<void>
```
Algorithm of the grant, all in `session` when one is given:
1. If `contactEmail` is given and its hash is in `SuppressedAddress`, return `opted_out`.
2. `const rightId = new Types.ObjectId()`. Run `Business.findOneAndUpdate({ _id: businessId, optedOutAt: { $exists: false }, $or: [{ contactHold: { $exists: false } }, { contactHold: null }, { 'contactHold.cooldownUntil': { $lte: now } }] }, { $set: { contactHold: { rightId, tenantId, expiresAt, cooldownUntil } } }, { new: true, session })`.
3. If that matched nothing, read the business and return its refusal: `opted_out`, or `held` with the hold's `expiresAt` while `now < hold.expiresAt`, else `cooldown` with `hold.cooldownUntil`. A business id that doesn't exist throws `Error('Business … not found')`.
4. Create `ContactRight` with `_id: rightId` in the same session and return it.

`endContactRight` sets `endedAt` and `endReason` on the right. If the business's `contactHold.rightId` is that right, it sets `contactHold.expiresAt = at` and `contactHold.cooldownUntil = at + (original cooldownUntil - original expiresAt)`.

- [ ] **Step 1: Failing tests** (inside the existing real-MongoDB `describe`; use an injected `now`):
  - `grants a free business and writes the hold`: the right's `expiresAt = now + 14d` and `cooldownUntil = expiresAt + 30d`, and the business's `contactHold.rightId` is the right's id.
  - `refuses another studio while held, with expiresAt, writing nothing`: the right count is unchanged.
  - `refuses the same studio while held` (the hold is the business's, whatever the studio).
  - `at expiresAt it is cooldown with availableAt`. `at cooldownUntil a new grant succeeds`, and the hold now names the new right.
  - `refuses an opted-out business` and `refuses a lead whose contact email is suppressed under another business`.
  - `20 concurrent grants leave exactly one right`: 20 studios and 20 leads, `Promise.allSettled` of grants each in its own `connection.transaction`. Exactly one is `granted`, the rest are `held`, and the count is 1.
  - `a grant in a transaction that aborts leaves no hold and no right`.
  - `findActiveContactRight` returns the right by `{ tenantId, businessId }` and by `{ leadId }` while active; returns null after `expiresAt` and after `endContactRight`.
  - `endContactRight starts the cooldown at the end time`.
- [ ] **Step 2:** `npx vitest run packages/db/src/__tests__/real-mongo.spec.ts -t "contact registry"`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-224): grantContactRight with an atomic per-business hold`.

### Task 3: Migration, startup warning, script, env

**Files:**
- Create: `packages/db/src/contact-rights-migration.ts` (exported), `apps/api/src/scripts/migrate-contact-rights.ts`
- Modify: `apps/api/package.json` (`"migrate:contact-rights": "tsx src/scripts/migrate-contact-rights.ts"`), `apps/api/src/config/env.ts` (`CONTACT_RIGHT_DAYS`, `CONTACT_COOLDOWN_DAYS`: `z.coerce.number().int().positive()` with the shared defaults), `apps/api/src/index.ts` and `apps/workers/src/index.ts` (log `checkContactRights` warnings like `checkTenantLinks`), `.env.example`
- Test: `real-mongo.spec.ts`, `describe('migrateContactRights and checkContactRights (REV-224)')`, plus the API env test if one covers defaults

**Interfaces:**
```ts
export const MIGRATE_CONTACT_RIGHTS_COMMAND = 'npm run migrate:contact-rights --workspace=@revamp/api';
export interface ContactRightsMigrationReport { applied: boolean; rightsToGrant: number; businessesToOptOut: number; addressesToSuppress: number;
  conflicts: Array<{ businessId: string; keptLeadId: string; otherLeadIds: string[] }> }
export async function migrateContactRights(opts: { apply: boolean; durations: ContactRightDurations; now?: Date }): Promise<ContactRightsMigrationReport>
export async function checkContactRights(connection: mongoose.Connection): Promise<string[]>   // one warning naming the command, or []
```
The migration grants through `grantContactRight` (source `MIGRATION`), so the same atomic rule applies. Leads without `tenantId` or `businessId` are skipped (the earlier migrations cover them).

- [ ] **Step 1: Failing tests:**
  - A dry run reports and writes nothing.
  - An apply grants the oldest studio lead of each business and lists the other studio's lead in `conflicts`.
  - A business with an `UNSUBSCRIBED` lead gets `optedOutAt` and a suppressed hash, and no right.
  - `a second apply changes nothing`.
  - `checkContactRights` warns before the migration and returns `[]` after it.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The script follows `migrate-tenants.ts`: dry run by default, logs the URI only through `redactMongoUri`, prints the counts and each conflict.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-224): migrate existing leads to contact rights; startup warning`.

### Task 4: Demo seed, docs, gates

**Files:**
- Modify: `packages/db/src/seed/demo-dataset.ts` (new collections `contactRights` and `suppressedAddresses` in `DemoDataset` and `DemoCollection`, `KIND` 10 and 11; businesses get `contactHold` / `optedOutAt` per Ruling 9), `packages/db/src/seed/seed-demo.ts` (write and `--reset` the new collections like the others), `packages/db/AGENTS.md` (a "Contact registry (REV-224)" section: the hold is the one atomic rule; grant only through `grantContactRight`; durations from the caller; hashes only; the migration command), `README.md` (env rows and the migrate command)
- Test: `packages/db/src/__tests__/demo-dataset.spec.ts`, and the seed case in `real-mongo.spec.ts`

- [ ] **Step 1: Failing tests:**
  - Every non-opted-out demo business has a `contactHold` whose right is in `contactRights`, for the demo studio's lead, active at `now`.
  - The florist business has `optedOutAt` and no hold, and `suppressedAddresses` holds `hashAddress('flowers@florist.test')`.
  - The documents pass the Mongoose schemas.
  - `seedDemoDataset` twice leaves the same counts, and `--reset` removes them.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and update the docs.
- [ ] **Step 4:** Run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green, lint 0 errors and no new warnings.
- [ ] **Step 5:** Check the migration against a throwaway database, never the shared `revamp`: start an in-memory replset on port 27118 (the repo's `mongodb-memory-server`), insert two studios' leads for one business plus an UNSUBSCRIBED lead, then run `MONGODB_URI=… npm run migrate:contact-rights --workspace=@revamp/api` dry, then `-- --apply`, then again. Paste the three outputs into the report and stop the server.
- [ ] **Step 6:** Commit `feat(REV-224): demo dataset with contact rights; docs`.

No dashboard change, so no Chrome check (`dashboardTouched: false`).

**Docs to update in `../Revamp-docs`** (orchestrator, after merge):
- `database-expertise.md`: sections for `contactrights` and `suppressedaddresses`, plus `businesses.contactHold.*` and `businesses.optedOutAt`. Then `npm run docs:check-dictionary`.
- `blueprint.md`: the schemas, the ER diagram (Business 1–N ContactRight, Organization 1–N ContactRight) and the migration.
- `research.md`: an ADR "Exclusive contact right as a compare-and-set hold on the shared business".
- `npm run docs:index`.
