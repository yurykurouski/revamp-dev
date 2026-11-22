# REV-204: workers startup recovery skips seeded demo leads

Ticket: [REV-204](https://linear.app/revamp-proect/issue/REV-204/workers-startup-recovery-queues-paid-mvp-generation-for-seeded-demo)

**Goal:** starting the workers against a database loaded by `npm run db:seed` queues no MVP generation for the two seeded `AUDITED` leads (Demo Law Office, Demo Beauty Salon). Every other `AUDITED` lead with a completed audit is still queued. Generate MVP by hand still works on a demo lead (the API route does not go through the recovery step, so nothing changes there).

**Rule:** skip leads whose `tags` contain `DEMO_SEED_TAG` (`demo-seed`). Not `.test` domains: the tag is written only by the seed, so it names exactly the data we mean, while a `.test` rule would also skip leads an operator adds by hand for local checks, where auto-chaining is wanted.

## Steps

1. **Filter in `@revamp/db`.** New `packages/db/src/stalled-lead-recovery.ts` exports `stalledAuditedLeadFilter()` → `{ status: 'AUDITED', tags: { $ne: DEMO_SEED_TAG } }` (on an array field `$ne` means "does not contain"). Export it from `packages/db/src/index.ts`. Keeping the filter in the db package lets the real-MongoDB test live in the one shared `real-mongo.spec.ts` (AGENTS.md §3.2.7: no second `mongod` per file). It reads only the tag constant, never seed data, so REV-45 holds.
2. **Real-MongoDB test (fails first).** In `real-mongo.spec.ts`, a `describe('stalledAuditedLeadFilter (REV-204)')`: seed the demo dataset plus an ordinary `AUDITED` lead, an ordinary `AUDITED` lead with an unrelated tag, and a lead with tags `['demo-seed', 'x']`; `Lead.find(stalledAuditedLeadFilter())` returns exactly the two ordinary leads. Also asserts the seed really holds `AUDITED` leads, so the test can't pass vacuously.
3. **Move the recovery out of `index.ts`.** `recoverStalledAuditedLeads` moves to `apps/workers/src/services/stalled-lead-recovery.ts` (`index.ts` starts the workers on import outside tests, so a service file is easier to test), uses the filter, and logs `Skipped N demo leads (demo-seed)` when it skipped any (one `countDocuments`), so an operator sees why seeded leads stay put. `index.ts` imports it.
4. **Worker unit test.** `apps/workers/src/services/__tests__/stalled-lead-recovery.spec.ts` with mocked `Lead`, `Audit` and `addAiGenerationJob`: `Lead.find` is called with the filter; a lead with a completed audit is queued with its ids; a lead without one is not; an error returns 0.
5. **Gates:** `build:packages`, `typecheck`, `lint`, `npm test`, `build`.
6. **End to end on an isolated stack:** a `mongodb-memory-server` replica set (script in the scratchpad, never the shared `revamp-mongo`), `npm run db:seed` against it (`MONGODB_URI` override, `assertLocalSeedTarget` allows localhost), then start the workers with that URI and `REDIS_URL` on DB 1. The log shows `Skipped 2 demo leads` and `Auto-enqueued 0`, and the ai-gen queue in Redis DB 1 is empty. No ordinary lead is added here, so no model call can happen; steps 2 and 4 cover the ordinary lead still being queued. The bug itself was already seen in the REV-203 check, so it is not reproduced on `main` (that would start real generation jobs). No dashboard change, so the Chrome check is a load of the review queue with no new console errors.
7. **One Opus review** of the whole branch, one fix pass.
8. **PR**, ticket In Review, merge after the user confirms Gates is green, `npm test` on main.
9. **Docs:** README "Demo data and database export" and AGENTS.md §3.1.1 (demo data paragraph) state that the startup recovery skips `demo-seed` leads; `../Revamp-docs` (blueprint/spec where the recovery is described, if anywhere) with `docs(REV-204): ...`. Ticket → Done.
