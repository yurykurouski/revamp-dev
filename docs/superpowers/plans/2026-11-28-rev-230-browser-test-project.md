# REV-230 Browser Specs in Their Own Vitest Project Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run. Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** The specs that launch a real Chromium stop failing when the machine is busy. They run in their own Vitest project, **after** the unit project has finished, one file at a time, with timeouts sized for a browser launch. A guard test keeps the list complete. `npm test` stays one command.

**Architecture:**
* Vitest 5 `test.projects` with two inline projects that extend the root config (`extends: true`).
* `unit` excludes the browser specs and keeps today's timeouts and parallelism.
* `browser` includes only them, with `testTimeout: 30_000`, `hookTimeout: 60_000` and `fileParallelism: false`, and `sequence.groupOrder: 1` (`unit` is `0`). Projects in different groups run one after the other, so Chromium never competes with about 200 parallel unit files.
* The list lives in one exported constant, `BROWSER_SPECS` in `vitest.browser-specs.ts` at the root. Both the config and the guard test import it.

**Tech Stack:** Vitest 5.0.1, Playwright Chromium.

**Spec:** Linear REV-230 (covers REV-57). Read root `AGENTS.md` §3.2.5 and the memories `test-timeouts-under-load` and `fake-interval-restart-race`.

## Rulings

1. **`BROWSER_SPECS`** (repo-relative paths, exact files, no globs), as of today:
   - `apps/workers/src/services/__tests__/mvp-page-finish.browser.spec.ts`
   - `apps/workers/src/services/__tests__/vitals.service.spec.ts`
   - `apps/workers/src/services/__tests__/browser.service.spec.ts`
   - `apps/workers/src/services/__tests__/cookie-consent.service.spec.ts`
   - `apps/workers/src/services/__tests__/site-era.page.spec.ts`
2. **Guard** (`scripts/__tests__/browser-specs.spec.ts`, in `unit`):
   * It walks `apps/**`, `packages/**` and `scripts/**`, skipping `node_modules`, `dist` and `.claude`, for `*.spec.ts` files whose source matches `/chromium\.launch|from ['"]playwright['"]|from ['"]@playwright\/test['"]/`.
   * Every match must be in `BROWSER_SPECS`, and every `BROWSER_SPECS` entry must exist and match. The failure message names the file and says to add it to `vitest.browser-specs.ts`.
   * A planted-source check proves the regex catches `chromium.launch(` and both import forms.
3. **Timeouts per test inside the files are not raised one by one.** The project setting covers them. Explicit small `timeoutMs` values passed to the code under test (for example `FAST` in `cookie-consent.service.spec.ts`) stay as they are: they test the service's own timeouts. If one of them still flakes under load (see Step 3), raise only that value and say so in the report.
4. **No change to CI or `package.json` scripts.** `vitest run` runs both projects. `npx vitest run <file>` still works for one file, whichever project it belongs to.
5. **`vitest.setup.ts` and the `env`/`alias` settings** are inherited by both projects (`extends: true`).

## Global Constraints

- The unit project's `testTimeout`/`hookTimeout`/parallelism stay at Vitest defaults, i.e. unchanged.
- Never leave background load processes running: the load generator in Step 3 must kill itself (hard time limit) and be checked with `ps` afterwards (memory `concurrent-sessions-shared-dev-data`: orphaned busy loops starve the machine).

## Review Focus

1. **A new spec that launches Chromium but is not listed** fails the guard with a clear message. Test: the guard's planted case.
2. **`npx vitest run <browser spec>` alone** still picks the browser project's timeouts. Check by hand in Step 3 (the reported duration and no timeout).
3. **The `.claude/**` exclusion** (nested worktrees) still applies to both projects.
4. **Wall time:** the browser group now runs after the unit group instead of in parallel. Measure before and after on an idle-ish machine and report both numbers (acceptance: at most about 20% slower).
5. **REV-57's case** (`handles a banner injected shortly after load`) passes under load.

---

### Task 1: Projects, list and guard

**Files:**
- Create: `vitest.browser-specs.ts` (exports `BROWSER_SPECS: readonly string[]`), `scripts/__tests__/browser-specs.spec.ts`
- Modify: `vitest.config.ts` (`test.projects` per the Architecture; the root `test` block keeps the shared settings), root `AGENTS.md` §3.2.5 (one bullet: "Specs that launch a real browser are listed in `vitest.browser-specs.ts` and run in the `browser` project after the unit tests, one file at a time, with 30 s/60 s timeouts (REV-230); the guard test fails on an unlisted one.")

- [ ] **Step 1:** Write the guard test first. Run `npx vitest run scripts/__tests__/browser-specs.spec.ts` and watch it fail (no `vitest.browser-specs.ts` yet).
- [ ] **Step 2:** Add the list and the projects config, then rerun the guard (PASS). Run `npx vitest run --project browser` (5 files, PASS) and `npx vitest run --project unit` (PASS; it contains no browser spec). Check that `npx vitest list --project browser` (or the run output) shows exactly the 5 files.
- [ ] **Step 3: Load check.**
  1. Record `uptime`, then time a baseline `npm test` on `main` in the main checkout (`/usr/bin/time -p npm test`, read-only use) or on this branch before the config change. Then time `npm test` on the branch.
  2. Under load: start a self-limiting generator from the scratchpad, `node -e` spawning `os.cpus().length` child processes that busy-loop with `setTimeout(() => process.exit(), 240_000)` inside each child, plus a parent `setTimeout` that kills them at 250 s.
  3. While it runs, do `npm test` twice. Report both results (browser specs must pass; if any test fails, name it and show it is not a launch timeout).
  4. After the generator ends, confirm with `ps -Ao pid,pcpu,command | grep -c "busy"` (or by pid) that no loop is left.
- [ ] **Step 4:** Run the five gates: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green.
- [ ] **Step 5:** Commit `fix(REV-230): browser specs run in their own Vitest project after the unit tests`.

No dashboard or API behavior change (`dashboardTouched: false`). Docs in `../Revamp-docs`: probably none (testing policy lives in this repo); say so in the report.
