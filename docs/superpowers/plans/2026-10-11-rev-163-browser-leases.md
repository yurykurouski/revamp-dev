# REV-163 Browser Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recycling the shared Chromium never closes it under an open context: jobs already running finish on the old browser, new jobs get the fresh one.

**Architecture:** Each browser job (`captureFullAudit`, `measurePageVitals`, `captureHtmlScreenshot`) takes a *lease* on the current browser and gives it back in `finally`. Leases are counted per browser. When the job limit is reached, the current browser is *retired* (no new leases), and a fresh one is launched. A retired browser closes as soon as its last lease ends, or right away when it has none.

**Tech Stack:** TypeScript, Playwright, Vitest.

**Spec:** Linear [REV-163](https://linear.app/revamp-proect/issue/REV-163/shared-chromium-restart-closes-the-browser-under-in-flight-contexts) (Problem / Expected / Acceptance criteria).

## Global Constraints

- One file of runtime code: `apps/workers/src/services/browser.service.ts`. No public method changes its signature; `getBrowser()` and `close()` stay public.
- `maxJobsPerBrowser` stays at 20 (constructor default). One job = one lease, even when it opens several contexts in turn (`captureFullAudit` opens desktop, then mobile, both on the leased browser).
- Choosing a browser and leasing it happen in the same synchronous step (no `await` in between). Otherwise another caller could retire and close that browser in between (see Review Focus 1).
- Closing a retired browser never throws to the job that released it (errors are logged with `console.warn`, like `close()` does now).
- `close()` (worker shutdown, `apps/workers/src/index.ts:89`) closes the current browser **and** every retired one, then clears all state. It runs after the workers have closed, so no lease is expected to still be open.
- Tests: Vitest `.spec.ts`, run from the repo root (`npx vitest run apps/workers/src/services/__tests__/browser.service.spec.ts`).
- Work in `../Revamp-dev-rev163`; commits `fix(REV-163): …` / `test(REV-163): …` / `docs(REV-163): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Lease vs. retire race:** caller A gets a browser that is still under the limit, and before A's continuation runs, caller C hits the limit and retires that browser with 0 leases, which closes it under A. The pick and the lease must be synchronous. Test: `two jobs that start together at the limit share one launch and neither gets a closed browser` (Task 1).
2. **A job that fails** (navigation throws, `newContext` rejects) still gives its lease back, so a retired browser is not left open forever. Test: `a failing job on a retired browser still closes it` (Task 1).
3. **Several jobs waiting on one launch:** all of them lease the new browser, with only one `chromium.launch`. Covered by the test in 1.
4. **Shutdown while a retired browser still has a lease:** `close()` closes it anyway. Test: `close() also closes retired browsers` (Task 1).
5. **A browser that crashed** (`isConnected()` false) is replaced without being counted as retired. Its leases end on their own errors, and the release must not throw or close the new browser. Test: `a disconnected browser is replaced and its late release leaves the new one open` (Task 1).

---

### Task 1: Lease the shared browser per job

**Files:**
- Modify: `apps/workers/src/services/browser.service.ts` (class fields ~86–91, `getBrowser` ~95–131, `captureFullAudit` ~478, `measurePageVitals` ~577, `captureHtmlScreenshot` ~600, `close` ~624)
- Test: `apps/workers/src/services/__tests__/browser.service.spec.ts`

**Interfaces:**
- Produces (private): `acquire(): Promise<BrowserLease>` with `interface BrowserLease { browser: Browser; release(): Promise<void> }`. `release` is idempotent (a second call does nothing).
- State: `leases: Map<Browser, number>` (open leases per browser), `retired: Set<Browser>`, plus the existing `browser`, `jobCount`, `isLaunching`.

- [ ] **Step 1: Make the mocks return a new browser per launch**

In the spec's `beforeEach`, add `makeBrowser()`, which returns a fresh `{ isConnected, newContext, close }` mock using the shared `mockContext`. Set `chromium.launch` to `mockImplementation(async () => makeBrowser())` and keep `mockBrowser` as the first one built (the existing tests read `mockBrowser.close`). Check that the existing suite still passes before adding tests.

- [ ] **Step 2: Write the failing tests** (in `describe('BrowserService')`, new `describe('browser recycling (REV-163)')`)

```ts
it('a job holding a context while the 21st job starts is not interrupted', async () => {
  const service = new BrowserService(20);
  const held = deferred<void>();            // small local helper: { promise, resolve, reject }
  mockPage.setContent = vi.fn()
    .mockImplementationOnce(() => held.promise)  // job 1 stays inside its context
    .mockResolvedValue(undefined);
  const first = service.captureHtmlScreenshot('<p>1</p>');
  for (let i = 2; i <= 20; i++) await service.captureHtmlScreenshot(`<p>${i}</p>`);
  const [browserA] = launched();            // launched(): the browsers launch returned so far
  await service.captureHtmlScreenshot('<p>21</p>');
  const [, browserB] = launched();
  expect(browserB.newContext).toHaveBeenCalledTimes(1);   // the 21st ran on the fresh browser
  expect(browserA.close).not.toHaveBeenCalled();          // job 1's browser is still open
  held.resolve();
  await expect(first).resolves.toBeInstanceOf(Buffer);
  expect(browserA.close).toHaveBeenCalledTimes(1);        // closed once its last lease ended
  expect(browserB.close).not.toHaveBeenCalled();
});

it('two jobs that start together at the limit share one launch and neither gets a closed browser', async () => {
  const service = new BrowserService(1);
  await service.captureHtmlScreenshot('<p>1</p>');
  await Promise.all([service.captureHtmlScreenshot('<p>2</p>'), service.captureHtmlScreenshot('<p>3</p>')]);
  // 2 takes the fresh browser B; 3 finds B at its limit too and retires it for C; no context opened on a closed browser
  for (const b of launched()) {
    if (b.close.mock.invocationCallOrder[0] !== undefined) {
      expect(b.newContext.mock.invocationCallOrder.every((n: number) => n < b.close.mock.invocationCallOrder[0])).toBe(true);
    }
  }
  expect(launched()).toHaveLength(3);
});

it('a failing job on a retired browser still closes it', async () => {
  // limit 1: job 1 holds A (setContent pending), job 2 retires A; job 1 then rejects -> A.close called once, release not thrown
});

it('close() also closes retired browsers', async () => {
  // limit 1: job 1 holds A, job 2 runs on B; service.close() -> A.close and B.close each once
});

it('a disconnected browser is replaced and its late release leaves the new one open', async () => {
  // job 1 holds A; A.isConnected -> false; job 2 launches B; job 1 resolves -> B.close not called, no throw
});
```

The last three follow the first test's pattern; their assertions are the comments.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run apps/workers/src/services/__tests__/browser.service.spec.ts -t "REV-163"`
Expected: the first test fails on `expect(browserA.close).not.toHaveBeenCalled()` (today the 21st job closes A), and the close()/race tests fail as well.

- [ ] **Step 4: Implement the leases in `browser.service.ts`**

- `acquire()`: a loop. If `this.browser` is connected and `jobCount < maxJobsPerBrowser`, then (synchronously) `jobCount++`, increment `leases` for it, and return the lease. Otherwise `await this.getBrowser()` and check again.
- `getBrowser()`: same contract as today (returns a connected browser, launches when needed), but at the limit it *retires* instead of `await this.close()`. Retiring means: move `this.browser` into `retired`, or close it right away without awaiting (`closeQuietly`) when its lease count is 0. Then set `this.browser = null` and `jobCount = 0`, then launch. Retiring must not `await` before `isLaunching` is set, so concurrent callers join one launch. A disconnected browser is dropped (`this.browser = null`) and not retired.
- `release(browser)`: decrement. At 0, delete the map entry, and if `retired.has(browser)`, remove it and `await closeQuietly(browser)`.
- `private async closeQuietly(browser: Browser): Promise<void>`: `browser.close()` with errors logged by `console.warn('[BrowserService] Error closing browser:', err)`.
- The three job methods replace `const browser = await this.getBrowser(); this.jobCount++;` with `const lease = await this.acquire();` and wrap the body in `try { … } finally { await lease.release(); }`. Context `finally` blocks stay inside, so contexts close before the lease is released.
- `close()`: close `this.browser` and every `retired` browser, then clear `leases`, `retired` and `jobCount`.
- Log the retire like today's restart message, adding the open lease count: `[BrowserService] Reached ${n} jobs. Retiring browser (${open} jobs still running) and launching a fresh one...`.

- [ ] **Step 5: Run the file to verify everything passes**

Run: `npx vitest run apps/workers/src/services/__tests__/browser.service.spec.ts`
Expected: all pass, including the existing `should recycle browser instance after reaching maxJobsPerBrowser threshold` (idle browser closed on the 3rd job).

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/services/browser.service.ts apps/workers/src/services/__tests__/browser.service.spec.ts
git commit -m "fix(REV-163): recycle the shared browser only after its last job ends"
```

### Task 2: Gates, live check and docs

- [ ] **Step 1: Gates** — `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`; all green, no new lint warnings.
- [ ] **Step 2: Live check** — a scratch script (scratchpad, `npx tsx`, not committed) runs `new BrowserService(2)` against real Chromium: 6 `captureHtmlScreenshot` calls in parallel, with every other one slow (an inline `<script>` that delays `load` with a 2 s busy image, e.g. an `<img>` served by a local `http.createServer` that answers after 2 s). Expected: all 6 resolve with PNG buffers, and no "Target page, context or browser has been closed" error. On `main` the same script fails with that error (the before/after proof). Chrome gate: there's no dashboard surface, so open the dashboard, run Add lead on a real URL, and check that the audit completes with no new console errors.
- [ ] **Step 3: Docs** — `../Revamp-docs/blueprint.md`, in the audit/Playwright section: one line saying the shared Chromium is recycled after 20 jobs without closing it under running jobs (leases per browser; retired browser closes when its last job ends, REV-163). README/AGENTS.md/.env.example: nothing to change (no setting, no convention change); say so in the ticket comment.
