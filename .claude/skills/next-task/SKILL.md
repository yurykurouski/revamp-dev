---
name: next-task
description: Pick the top Todo Linear issue of the Diploma project, have the Opus implementer build it, verify it (code quality plus dashboard e2e), merge, update ../Revamp-docs, close the ticket and report a walkthrough.
disable-model-invocation: true
---

# /next-task

Run in the Sonnet main session. You orchestrate and verify; the `implementer` agent (Opus) writes the code. One issue per run. Follows `AGENTS.md` §4.1 and §4.3.

Any **stop** below means: stop, report the reason to the user, change nothing further.

## 1. Preflight
`git status --porcelain` must be empty, the branch must be `main`, then `git pull --ff-only`. Otherwise **stop** before any Linear call.

## 2. Pick
`list_issues`: team REV, project "Revamp: Lead Generation SaaS (Diploma)", state Todo, ordered by priority then oldest. None → **stop** ("no Todo issues"). Read the top issue in full (and the project documents per `AGENTS.md` §4.3 step 1 if the ticket is thin). If it has no acceptance criteria or needs a product decision, skip it, report why, and take the next one.

## 3. Start
Set the issue to In Progress. `git switch -c ymorpheus/rev-<n>-<short-slug>`.

## 4. Implement
Dispatch the `implementer` agent with: ticket key, title, description, acceptance criteria, branch name. Keep its agent id for the fix loop.

## 5. Verify (do not trust the report)
**Quality.** Read `git diff main...HEAD` against the acceptance criteria and `AGENTS.md` §3.2: no mock data in runtime code, Mongoose schemas only in `packages/db`, Zod at boundaries, new strings in all five locales, human-in-the-loop preserved, resources closed, no unrelated changes. Re-run `npm run lint`, `typecheck`, `npm test`, `npm run build` yourself.

**E2E, only if `dashboardTouched` is true or the diff touches `apps/dashboard`.** Start `npm run dev` in the background, drive the changed flow with the Chrome DevTools MCP tools, screenshot each acceptance criterion, check console and network for errors, then stop the dev server. If the flow cannot be reached (Docker down, no data, auth), the verdict is `e2e not possible: <reason>` and you do **not** merge: **stop**.

Verdict: PASS, or FAIL with itemised findings.

## 6. Fix loop
On FAIL, `SendMessage` the findings to the same `implementer`, then repeat step 5. After 2 failed rounds, add a ticket comment with the findings and **stop** (ticket stays In Progress).

## 7. Ship (PASS only)
1. Push the branch; `gh pr create` with body starting `Fixes [REV-<n>](<ticket url>)` and sections `## Problem`, `## Changes`, `## Verification` (exact commands and results).
2. Attach the PR link to the ticket; set it to In Review.
3. `git merge origin/main` into the branch, re-run the four gates. Conflict or red gate → **stop** (ticket stays In Review).
4. `gh pr merge --merge`, `git switch main && git pull --ff-only`, `npm test`. Red → **stop**.

## 8. Docs
Update `../Revamp-docs` per the implementer's `Docs to update` and `AGENTS.md` §4.3 step 6. Commit `docs(REV-<n>): …` there and push; add the commit link to the ticket. If nothing needed updating, comment that on the ticket.

## 9. Close
Set the ticket to Done only when the PR is merged, `main` is green and the docs are current.

## 10. Walkthrough
Final message to the user:
- ticket and PR links;
- plain-language summary of what changed and why;
- change list by area or file;
- verification evidence: gate results, e2e steps and screenshots (or why e2e was not possible);
- docs updated;
- anything skipped, deferred or worth a second look.
