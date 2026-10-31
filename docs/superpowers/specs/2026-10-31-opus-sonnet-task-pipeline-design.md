# Opus/Sonnet task pipeline — design

## Goal
`/next-task` run in a Sonnet session takes the next Linear issue, has an Opus subagent implement it, verifies the result itself (code quality, plus e2e for dashboard changes), then merges, updates docs, closes the ticket and gives the user a walkthrough of what changed. It follows `AGENTS.md` §4.3; it does not replace it.

## Scope
- Repo: `Revamp-dev` only. Linear team REV, project "Revamp: Lead Generation SaaS (Diploma)".
- One issue per run. No autonomous looping.
- Files added: `.claude/agents/implementer.md` (model: opus), `.claude/skills/next-task/SKILL.md` (orchestrator + verifier checklist). No product code changes.

## Flow
1. **Preflight (Sonnet).** Working tree clean, on `main`, up to date. Otherwise stop and say why.
2. **Pick.** Linear `list_issues`: team REV, project Diploma, status Todo, ordered by priority (then oldest). Read description and acceptance criteria (and project documents per §4.3 step 1 when the ticket is thin). Skip and report an issue that is ambiguous, blocked, or needs a product decision; take the next one.
3. **Start.** Move to In Progress. Branch `ymorpheus/rev-<n>-<slug>` from `main`.
4. **Implement (Opus `implementer`).** Input: ticket text, acceptance criteria, pointer to `AGENTS.md`. It writes code and tests, runs `npm run lint`, `typecheck`, `test`, `build`, commits `fix|feat(REV-n): …`. It does not touch Linear, push, or open PRs. Returns: summary, changed files, `dashboardTouched` flag, gate output, any docs in `../Revamp-docs` that need updating.
5. **Verify (Sonnet).**
   - *Quality:* read the diff against acceptance criteria and `AGENTS.md` constraints (no runtime mocks, schemas only in `packages/db`, Zod at boundaries, five locales for new strings, human-in-the-loop preserved, resources closed). Re-run all gates independently.
   - *E2E (only if `apps/dashboard` changed):* `npm run dev` (needs Docker infra), drive the changed flow with Chrome DevTools MCP, take screenshots, check console and network for errors, assert each acceptance criterion. If the flow cannot be reached, the verdict says "e2e not possible: <reason>" and the pipeline does not merge; it stops for the user.
   - Verdict: PASS or FAIL with itemised findings.
6. **Fix loop.** On FAIL, send findings to the same `implementer` (SendMessage), re-verify. Max 2 rounds. Then stop: comment on the ticket, leave it In Progress, report to the user.
7. **Ship (PASS only).** Push, `gh pr create` with `Fixes [REV-n](url)`, `## Problem`, `## Changes`, `## Verification` (exact commands and results). Link PR on the ticket, move to In Review. Merge `main` into the branch, re-run gates, `gh pr merge --merge`, pull `main`, run `npm test` again. Any failure here stops the pipeline; nothing is force-merged.
8. **Docs.** Update `../Revamp-docs` (`spec.md`, `blueprint.md`, `milestones.md`, `AGENTS.md`, `research.md` as relevant), commit `docs(REV-n): …`, push, add the commit link to the ticket. If nothing needed updating, say so in a ticket comment.
9. **Close.** Move ticket to Done once PR is merged, `main` is green and docs are current.
10. **Walkthrough.** Final message to the user: ticket and PR links; plain-language summary of what changed and why; per-file/area change list; verification evidence (gates, e2e steps and screenshots, or why e2e was not possible); docs updated; anything skipped or worth a second look.

## Safeguards
- Verification is independent: Sonnet re-runs gates and does not rely on Opus's report.
- Merge requires: verifier PASS, all gates green on the merged result, no e2e gap for dashboard changes.
- Stops (never guesses) on: dirty tree, ambiguous ticket, failed merge/gates, two failed fix rounds.
- Every Linear/GitHub/docs write is reported in the walkthrough.

## Testing the pipeline
Dry run on one low-risk Todo issue; check each stage's output and the walkthrough, then adjust the skill text.

## Open risks
- Auto-merge to `main` is the user's explicit choice; mitigated by the safeguards above.
- E2E needs Docker and a working local stack; first run will show how reliable that is.
- `AGENTS.md` currently has uncommitted edits; commit or stash before the first run.
