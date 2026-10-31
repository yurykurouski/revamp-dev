# Opus/Sonnet Task Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/next-task` in a Sonnet session picks the top Todo Linear issue, has an Opus subagent implement it, verifies it (quality + dashboard e2e), merges, updates docs, closes the ticket and reports a walkthrough.

**Architecture:** Two Claude Code config files in the repo: a custom subagent `implementer` pinned to Opus, and a user-invocable skill `next-task` that holds the orchestration and verification procedure and runs in the Sonnet main session. No product code changes. It follows `AGENTS.md` §4.1/§4.3.

**Tech Stack:** Claude Code subagents and skills (markdown + frontmatter), Linear MCP, `gh`, git, Chrome DevTools MCP, npm scripts (`lint`, `typecheck`, `test`, `build`, `dev`).

**Spec:** `docs/superpowers/specs/2026-10-31-opus-sonnet-task-pipeline-design.md`

## Global Constraints

- Linear team `REV`, project "Revamp: Lead Generation SaaS (Diploma)"; pick status `Todo`, ordered by priority then oldest.
- Branch name `ymorpheus/rev-<n>-<slug>`; commits `fix(REV-n): …` / `feat(REV-n): …`; docs commits `docs(REV-n): …`.
- Implementer model: `opus`. Orchestrator/verifier: the Sonnet main session (no model override in the skill).
- Implementer never touches Linear, pushes, or opens PRs.
- Fix loop: max 2 rounds, then stop, comment on the ticket, leave it In Progress.
- No merge unless: verifier PASS, all gates green on the merged result, and no e2e gap for dashboard changes.
- Gates: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Docs repo: `../Revamp-docs` (`spec.md`, `blueprint.md`, `milestones.md`, `AGENTS.md`, `research.md`).
- One issue per run; no autonomous looping.

## Review Focus

- Empty Todo list: stop with "no Todo issues", change nothing.
- Dirty working tree or not on `main` at start: stop before touching Linear.
- Issue with no acceptance criteria or a product decision: skipped and reported, next issue tried.
- Dashboard change but Docker/stack unavailable: verdict is "e2e not possible", no merge.
- Merge conflict or red gate after merging `main`: stop, nothing force-merged, ticket stays In Review.

## File Structure

- Create `.claude/agents/implementer.md`: Opus implementer role and its output contract.
- Create `.claude/skills/next-task/SKILL.md`: the ten-step orchestration, verifier checklist, stop conditions, walkthrough format.
- Modify `.claude/settings.json`: allowlist the commands the pipeline needs (only if prompts block the dry run).

---

### Task 1: `implementer` agent

**Files:**
- Create: `.claude/agents/implementer.md`

**Interfaces:**
- Produces: agent type `implementer`. Input prompt contains ticket key, title, description, acceptance criteria, branch name. Output is a report with these headings: `Summary`, `Changed files`, `dashboardTouched: true|false`, `Gate results` (command and result for each of the four gates), `Docs to update` (paths in `../Revamp-docs` and what), `Open concerns`.

- [ ] **Step 1: Write the file.** Frontmatter: `name: implementer`, `description` (implements one Linear REV ticket on an existing branch; used by `/next-task`), `model: opus`. Body, in the imperative, states: read `AGENTS.md` first and obey §3.2 and §5; work only on the current branch and only on the given ticket; test-first; run all four gates and fix failures; commit per §4.1; never touch Linear, push or open PRs; do not widen scope (unrelated findings go under `Open concerns`); return exactly the report in the Interfaces block; when called again with verifier findings, fix those and nothing else, then return the same report.

- [ ] **Step 2: Validate the frontmatter.** Run `head -6 .claude/agents/implementer.md`. Expected: a `---` block with `name: implementer` and `model: opus`.

- [ ] **Step 3: Smoke test.** In a Claude Code session in the repo, run `/agents`. Expected: `implementer` is listed with model opus. Then dispatch it with the prompt "Report only: list the four gate commands from AGENTS.md and the output headings you owe me; change nothing." Expected: a reply naming `lint`, `typecheck`, `test`, `build` and the six headings.

- [ ] **Step 4: Commit.**

```bash
git add .claude/agents/implementer.md
git commit -m "chore: add opus implementer agent for the task pipeline"
```

### Task 2: `next-task` skill

**Files:**
- Create: `.claude/skills/next-task/SKILL.md`

**Interfaces:**
- Consumes: agent `implementer` and its report format from Task 1.
- Produces: user-invocable skill `/next-task` (frontmatter `name: next-task`, `disable-model-invocation: true`, description "Pick the top Todo Linear issue, implement via Opus, verify, merge, update docs, close").

- [ ] **Step 1: Write the file** with these sections, mirroring the spec's flow:
  1. *Preflight*: `git status --porcelain` empty, branch `main`, `git pull --ff-only`; otherwise stop and say why.
  2. *Pick*: `list_issues` (team REV, project Diploma, state Todo, order by priority); read the issue; skip-and-report rule for missing acceptance criteria or a product decision; stop if none left.
  3. *Start*: `save_issue` state In Progress; `git switch -c ymorpheus/rev-<n>-<slug>`.
  4. *Implement*: dispatch `implementer` with the Interfaces input from Task 1.
  5. *Verify*: quality checklist (acceptance criteria met; `AGENTS.md` §3.2 constraints: no runtime mocks, schemas only in `packages/db`, Zod at boundaries, five locales for new strings, human-in-the-loop kept, resources closed; no unrelated changes) plus independent re-run of the four gates. If `dashboardTouched` or the diff touches `apps/dashboard`: run `npm run dev` in the background, drive the changed flow with Chrome DevTools MCP, screenshot each acceptance criterion, check console and network for errors, stop the dev server afterwards; if unreachable, verdict "e2e not possible: <reason>". Verdict PASS or FAIL with itemised findings.
  6. *Fix loop*: FAIL → `SendMessage` findings to the same `implementer`, re-verify; after 2 failed rounds comment on the ticket (`save_comment`), stop.
  7. *Ship*: push, `gh pr create` in the §4.3 format (body starts `Fixes [REV-n](url)`, sections Problem/Changes/Verification with exact commands and results), add PR link to the ticket, state In Review; `git merge origin/main`, re-run gates, `gh pr merge --merge`, `git switch main && git pull`, `npm test`.
  8. *Docs*: update `../Revamp-docs` per the implementer's `Docs to update` and §4.3 step 6, commit `docs(REV-n): …`, push, add the commit link to the ticket (or comment that nothing needed updating).
  9. *Close*: state Done only when PR merged, `main` green, docs current.
  10. *Walkthrough*: final message with ticket and PR links, plain-language summary, per-area change list, verification evidence (gates, e2e steps and screenshots or why impossible), docs updated, anything skipped or worth a second look.
  Add a "Stop conditions" list copying the Global Constraints and Review Focus bullets, each as "stop and report, change nothing further".

- [ ] **Step 2: Validate.** Run `head -8 .claude/skills/next-task/SKILL.md`. Expected: frontmatter with `name: next-task`. In a fresh session, `/next-task` appears in the slash-command list.

- [ ] **Step 3: Check the stop conditions without side effects.** Run `/next-task` with `git stash -u` active so the tree is dirty-free, then create a stray file to dirty it. Expected: the skill stops at Preflight, names the dirty file, and makes no Linear call.

- [ ] **Step 4: Commit.**

```bash
git add .claude/skills/next-task/SKILL.md
git commit -m "chore: add next-task skill orchestrating the opus/sonnet pipeline"
```

### Task 3: Permissions and dry run

**Files:**
- Modify (if needed): `.claude/settings.json`

**Interfaces:**
- Consumes: Tasks 1 and 2.

- [ ] **Step 1: Pick a dry-run issue.** Choose a low-risk Todo issue (one backend-only, small). Ask the user which, or take the top one if they say so.

- [ ] **Step 2: Run `/next-task` end to end** on it. Note every permission prompt that blocks unattended progress.

- [ ] **Step 3: Allowlist the blocked, safe commands** in `.claude/settings.json` `permissions.allow` (for example `Bash(npm run lint:*)`, `Bash(npm test:*)`, `Bash(npm run typecheck:*)`, `Bash(npm run build:*)`, `Bash(gh pr:*)`, `Bash(git switch:*)`, the Linear MCP tools). Do not allowlist destructive commands.

- [ ] **Step 4: Verify the outcome.** Expected: the ticket is Done; the PR is merged; `main` passes `npm test`; the `../Revamp-docs` commit exists or a "nothing to update" comment is on the ticket; the walkthrough lists every item in Step 10 of the skill.

- [ ] **Step 5: Dashboard dry run.** Repeat on a small dashboard-touching Todo issue. Expected: screenshots in the walkthrough and no console errors, or an explicit "e2e not possible" with the pipeline stopped before merge.

- [ ] **Step 6: Tighten the skill text** wherever the dry runs showed ambiguity, then commit.

```bash
git add .claude/settings.json .claude/skills/next-task/SKILL.md
git commit -m "chore: tune next-task pipeline after dry runs"
```

---

## Self-review

- Spec coverage: pick, start, implement, verify (quality and e2e), fix loop, ship, merge, docs, close, walkthrough, safeguards and dry run are all in Tasks 1 to 3.
- Names match across tasks: `implementer`, `next-task`, `dashboardTouched`, the six report headings.
- Left as the implementer's choice: the exact wording of the two files and the slug rules.
