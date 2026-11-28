# REV-233 (E3.3): Masked lot listings API with the k threshold and a per-tenant rate limit — Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (Sonnet), whole plan in one run, TDD (write each test, run it, see it fail, then implement). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Any signed-in studio member can list open, released lots through `GET /lots` with filters (niche, city, band), seeing only masked fields; a (niche, city, band) group with fewer than k listed lots is withheld; requests are rate limited per studio.

**Architecture:** One aggregation over `lots` (`@revamp/db`, `listMaskedLots`) matches listed lots, counts each group with `$setWindowFields`, drops small groups, pages and projects an allow-list. The API parses every item with a strict Zod schema (`MaskedLotSchema`) before sending, so an identity field can never be serialized even if the projection changes. A small Redis fixed-window limiter (`createTenantRateLimiter`, no new dependency) guards the route.

**Tech Stack:** TypeScript, Express, Mongoose aggregation (MongoDB 7), ioredis, Zod, Vitest, mongodb-memory-server.

**Spec:** Linear REV-233 acceptance criteria; Business Analysis US10 ("The view and its API return only masked fields; requests are rate limited per tenant to hinder scraping"), NFR "Masking and anti-scraping: identity fields are never serialized before purchase; per-tenant rate limits on listings", "listing page loads within 2 seconds for 100 open lots"; REV-171 decisions (area = city). Read first: root `AGENTS.md` §3.2, `apps/api/AGENTS.md`, `packages/db/AGENTS.md` (Lots section).

## Global Constraints

- §3.2.4: query validated with a Zod schema from `@revamp/validation`; the response items parsed with `MaskedLotSchema` (strict).
- §3.2.9: errors via `AppError` and `API_ERROR_CODES` (new codes added there).
- §3.2.10: lots are platform-owned (no `tenantId`); the route reads no studio data. The rate-limit key is the caller's `req.auth.organizationId`.
- No new npm dependency. No mock store in runtime code: the limiter's store is Redis; tests inject a test double.
- Real-MongoDB tests for the db function go in `packages/db/src/__tests__/real-mongo.spec.ts`; API route tests follow `admin.routes.spec.ts` (its own in-memory replset with a 60 s `afterAll`).

## Decisions (fixed here)

**Listed lot:** `status: 'OPEN'` and `releaseAt <= now`. `DRAFT`, `RESERVED`, `SOLD`, `WITHDRAWN` and future releases are never listed.

**Masked item (`IMaskedLot` in `@revamp/shared-types`, `MaskedLotSchema` `.strict()` in `@revamp/validation`):**
```
{ id: string; niche: NicheType; city: string; band: 'A'|'B'|'C'|'D';
  priceCents: number; currency: string; releaseAt: string (ISO);
  signals: { signal: LotPriceSignal; level: 'low' | 'medium' | 'high' }[] }
```
- `signals` is built from `Lot.priceSignals` in `LOT_PRICE_SIGNALS` order, measured signals only. Exact values (`value`, `need`, `weight`) are never exposed: an LCP in ms or a violation count could be matched against public tools.
- `needLevel(need: number): 'low' | 'medium' | 'high'` in `lot-price.ts`: `< 1/3` low, `< 2/3` medium, else high. Exported constant `NEED_LEVELS = ['low','medium','high'] as const`.
- Never in the item: `businessId`, `auditId`, `need`, `priceSignals`, `status`, `live`, `withdraw*`, `createdAt`, `updatedAt`, and nothing from `Business`/`Audit` (name, domain, URL, screenshots, contacts, address).

**k threshold:** `LOT_LISTING_MIN_GROUP` (API env, positive int, default **3**). The group is `(niche, city, band)` over **all** listed lots; since every filter is one of the group keys, the API may filter first and count after (a filter keeps or drops whole groups). A withheld group's lots are absent and not counted in `total`; the response does not say anything was withheld.

**Query (`LotListingQuerySchema`):** `niche?` (`NicheEnumSchema`), `city?` (trimmed, 1–100; matched case-insensitively with an escaped anchored regex `^…$` / `i`), `band?` (`LotBandSchema`), `page?` (int ≥1, default 1), `limit?` (int 1–50, default 20). Empty params count as missing (reuse `optionalQueryParam` from `index.ts`; if it is not exported, export it). Unknown params are ignored (non-strict), like `GetLeadsQuerySchema`.

**Order:** `releaseAt` descending, then `_id` ascending (stable paging).

**Response:** `200 { success: true, data: { items: IMaskedLot[], total: number, page: number, limit: number } }`.

**Rate limit:** fixed window per studio. Env `LOT_LISTING_RATE_LIMIT` (default **30**) requests per `LOT_LISTING_RATE_WINDOW_SECONDS` (default **60**), both positive ints. Key `rl:lots:<organizationId>:<floor(nowSec / window)>`.
- Redis store: `MULTI` `INCR key` + `EXPIRE key <window> NX`, one round trip; if `redisConnection.status !== 'ready'` or the call takes longer than **500 ms**, the request is refused with `503 LISTINGS_UNAVAILABLE` (fail closed: the limit is the anti-scraping control, and `maxRetriesPerRequest: null` would otherwise hang the request).
- Over the limit: `429 RATE_LIMITED`, `details: { retryAfterSeconds }` (seconds to the window's end, ≥1), header `Retry-After`.
- Every allowed response sets `RateLimit-Limit` and `RateLimit-Remaining`.
- The limiter is generic: `createTenantRateLimiter({ name, limit, windowSeconds, store, now? })` returns an Express middleware; `RateLimitStore = { hit(key: string, windowSeconds: number): Promise<number> }`; `redisRateLimitStore(connection, timeoutMs)` is the runtime store. Files: `apps/api/src/middlewares/rateLimit.ts`.

**New `API_ERROR_CODES`:** `RATE_LIMITED`, `LISTINGS_UNAVAILABLE`.

**Mount:** `router.use('/lots', requireAuth, requireWriter, lotRoutes)` (GET passes for a viewer). Route file `apps/api/src/routes/lot.routes.ts`, service function in `apps/api/src/services/lot.service.ts` (`listLots(query, now)`). Middleware order on the route: `validate query` → limiter → handler (an invalid query still counts? **No**: validate first, so a 400 does not use the budget — decided).

## Review Focus

1. **A projection change leaks a field:** the handler must parse each item with `MaskedLotSchema` (strict) and answer 500 if parsing fails, never send the raw item. Test: stub `listMaskedLots` to return an item with an extra `businessId`; expect 500 and no `businessId` in the body.
2. **Group of exactly k vs k−1:** 3 listed lots in one group are listed, 2 are withheld, and a filter on `band` that selects a group of 3 returns 3 with `total: 3`. Real-MongoDB test.
3. **Release time boundary:** a lot with `releaseAt` = now is listed, `now + 1 ms` is not; a future lot does not count toward its group's k. Real-MongoDB test with an injected `now`.
4. **Window rollover and tenant separation:** studio A at the limit gets 429 while studio B still gets 200; after the window rolls over A gets 200. Unit test with a fake clock and an in-memory test store.
5. **Redis not ready:** `503 LISTINGS_UNAVAILABLE`, handler not called, and a hung store call times out at 500 ms. Unit test with a store whose promise never resolves and fake timers.

---

### Task 1: Types and schemas

**Files:** modify `packages/shared-types/src/index.ts` (`IMaskedLot`, `IMaskedLotSignal`, `NEED_LEVELS`/`NeedLevel`, error codes; put `NEED_LEVELS` in shared-types and re-export from validation), `packages/validation/src/lot-price.ts` (`needLevel`), `packages/validation/src/lot-status.ts` (`MaskedLotSchema`, `LotListingQuerySchema`), `packages/validation/src/index.ts` (export `optionalQueryParam` if needed); tests `packages/validation/__tests__/lot-listing.spec.ts`.

- [ ] **Failing tests:** `needLevel(0)` low, `(0.3333)` low, `(1/3)` medium, `(0.6666)` medium, `(2/3)` high, `(1)` high. `MaskedLotSchema` accepts a full valid item; rejects each forbidden extra key (`businessId`, `auditId`, `businessName`, `domain`, `need`, `status`) one by one; rejects a signal with `value`. `LotListingQuerySchema`: defaults page 1 / limit 20, `limit 51` and `0` rejected, `band 'E'` rejected, `niche 'cars'` rejected, `city '  Vilnius '` → `'Vilnius'`, `city ''` → absent.
- [ ] Run `npx vitest run packages/validation` → FAIL; implement; → PASS; `npm run build:packages`.
- [ ] Commit `feat(REV-233): masked lot and listing query schemas`.

### Task 2: `listMaskedLots` in `@revamp/db`

**Files:** modify `packages/db/src/lots.ts`, `packages/db/src/index.ts`; tests in `real-mongo.spec.ts` (`describe('masked lot listings (REV-233)')`).

**Produces:** `listMaskedLots(input: { niche?: NicheType; city?: string; band?: LotBandCode; page: number; limit: number; minGroup: number; now: Date }): Promise<{ items: MaskedLotRow[]; total: number }>` where `MaskedLotRow = { id: string; niche; city; band; priceCents; currency; releaseAt: Date; signals: { signal: string; need: number }[] }` (the db returns `need` per signal; the API maps it to `level`, because the band/level rule lives in `@revamp/validation`, which `@revamp/db` does not depend on).

Pipeline: `$match { status: 'OPEN', releaseAt: { $lte: now }, ...filters }` (city as escaped anchored case-insensitive regex) → `$setWindowFields { partitionBy: { niche: '$niche', city: '$city', band: '$band' }, output: { groupSize: { $count: {} } } }` → `$match { groupSize: { $gte: minGroup } }` → `$sort { releaseAt: -1, _id: 1 }` → `$facet { items: [ $skip, $limit, $project allow-list ], total: [ $count ] }`. Add index `{ status: 1, releaseAt: -1 }` to `Lot.model.ts`.

- [ ] **Failing tests:** Review Focus 2 and 3; filters by niche, city (case-insensitive, `'vilnius'` matches `'Vilnius'`; a regex metacharacter city `'a.b'` matches only `'a.b'`), band; paging (`limit 2`, `page 2`) with a stable order; `total` counts only listed lots in kept groups; `DRAFT`/`RESERVED`/`WITHDRAWN` lots never appear; projected rows have exactly the `MaskedLotRow` keys.
- [ ] Run `npx vitest run packages/db` → FAIL; implement; → PASS.
- [ ] Commit `feat(REV-233): masked lot listing query with the k threshold`.

### Task 3: Rate limiter

**Files:** create `apps/api/src/middlewares/rateLimit.ts`; tests `apps/api/src/middlewares/__tests__/rateLimit.spec.ts`.

- [ ] **Failing tests** (in-memory `Map` store double inside the test file, fake clock via the `now` option): allows `limit` requests and sets `RateLimit-Limit`/`RateLimit-Remaining` (`limit-1` … `0`); the next one is `429 RATE_LIMITED` with `details.retryAfterSeconds` ≥ 1 and the `Retry-After` header equal to it; Review Focus 4; Review Focus 5 (store promise never resolves → 503 after 500 ms with fake timers; a store that throws → 503); `redisRateLimitStore` against a stubbed connection: status `'connecting'` → rejects without calling `multi`; `'ready'` → calls `multi().incr(key).expire(key, window, 'NX').exec()` and returns the INCR count.
- [ ] Run `npx vitest run apps/api/src/middlewares` → FAIL; implement; → PASS.
- [ ] Commit `feat(REV-233): per-studio rate limiter on Redis`.

### Task 4: `GET /lots`

**Files:** modify `apps/api/src/config/env.ts` (three env vars), `apps/api/src/services/lot.service.ts` (`listLots`), `apps/api/src/routes/index.ts`; create `apps/api/src/routes/lot.routes.ts`; tests `apps/api/src/routes/__tests__/lot.routes.spec.ts` (real in-memory replset, like `admin.routes.spec.ts`), and update `route-auth.spec.ts` and `tenant-isolation.spec.ts` (`NO_TENANT_DATA`, reason "platform lots, masked, the same for every studio").

- [ ] **Failing tests:** 401 without a token; 200 for owner, operator and viewer; the body's items have exactly the `IMaskedLot` keys and no identity value anywhere in the serialized body (assert the business's name, domain and URL strings are absent from `JSON.stringify(res.body)`); `signals[].level` matches `needLevel` of the stored need; k withholding through the API with `LOT_LISTING_MIN_GROUP` 3; `400 VALIDATION_ERROR` for `limit=0` and does not consume the budget (the next 30 requests still pass); Review Focus 1; rate limit 429 after 30 requests in a window for one studio with another studio unaffected (inject the store through a factory in `lot.routes.ts`: `createLotRoutes({ store?, now? })`, default `redisRateLimitStore(redisConnection, 500)`); `503 LISTINGS_UNAVAILABLE` when the store rejects.
- [ ] Run `npx vitest run apps/api` → FAIL; implement; → PASS.
- [ ] `.env.example` (block after the `LOT_*` price vars: `# REV-233: masked listings: minimum lots per (niche, city, band) group, and requests per studio per window`) and the README env table rows for the three vars.
- [ ] Commit `feat(REV-233): GET /lots masked listings`.

### Task 5: Area rules

- [ ] `apps/api/AGENTS.md`, under "Platform admin and lots": "Masked listings (REV-233)": listed = OPEN and released; the item is `MaskedLotSchema` (strict) and every item is parsed before it is sent; a new listing field needs a decision that it cannot identify a business, the schema, and the leak test; k groups; the limiter (fail closed, 503 when Redis is not ready, validate before the limiter). `packages/db/AGENTS.md` Lots section: `listMaskedLots` and the new index.
- [ ] Commit `docs(REV-233): area rules for masked listings`.

### Task 6: Gates and end-to-end

- [ ] `npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, 8 warnings as main), `npm test`, `npm run build`, `npm run docs:check-dictionary`.
- [ ] E2E, API only (no dashboard change), on an **isolated** stack, never the shared one: in-memory replset on port 27118 (`MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' }, instanceOpts: [{ port: 27118 }] })` from the worktree's `node_modules`), Redis DB 7 (`REDIS_URL=redis://:<REDIS_PASSWORD from .env>@localhost:6379/7`, check `DBSIZE` is 0 first, `FLUSHDB` after), API from the worktree on `PORT=4100` with `LOT_LISTING_RATE_LIMIT=5`. **Do not start the workers.** Register two studios through `POST /auth/register`, insert businesses and lots straight into the isolated DB with a small script (4 OPEN released lots in `dental/Vilnius/B`, 2 in `auto/Kaunas/A`, 1 future-release lot), then: `GET /lots` shows only the 4 (`total 4`), with masked keys only; `GET /lots?city=vilnius&band=B` → 4; `GET /lots?band=A` → 0 (withheld); 6th request in the window → 429 with `Retry-After`; the other studio still 200. Paste the responses. Stop the API and Mongo by their ports and flush Redis DB 7.

## Docs to update (Opus session, after merge)

- `../Revamp-docs/spec.md` §3.8 (or a new 3.9): listing rules, k, rate limit, masked fields; `blueprint.md` §5 (`GET /lots`) and the two error codes; OpenAPI 2.6.0 (`GET /lots`, `MaskedLot`, `RATE_LIMITED` 429, `LISTINGS_UNAVAILABLE` 503, request schema `LotListingQuerySchema`) and CHANGELOG; `database-expertise.md` §6 (new `lots` index); `research.md` ADR 22 "Masked listings: allow-list schema, k groups, fail-closed Redis limiter"; `npm run docs:index`.
