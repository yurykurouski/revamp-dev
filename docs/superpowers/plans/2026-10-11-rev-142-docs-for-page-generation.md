# REV-142 Docs for model page generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every doc describes the model-designed MVP page (REV-136 – REV-141) as the current pipeline, and none describes the removed rebuild/Bento pipeline as current.

**Architecture:** Docs only, plus two stale code comments. Repo docs (AGENTS.md, README, `.env.example`) change in the ticket's PR. `../Revamp-docs` (written in Russian; keep it Russian) is committed there as `docs(REV-142): ...` and pushed. Facts are copied from the code on `main`, never from memory: `packages/shared-types/src/index.ts` (`MVP_PAGE_CHECKS`, `MVP_PAGE_FAILURES`, `MVP_THEME_VARS`, `MVP_PLACEHOLDERS`, `MVP_BRIEF_LIMITS`, `MVP_GROUNDING_KINDS`, `MVP_MAX_VERSIONS`, `MVP_PAGE_VERSION_KINDS`, `MVP_FONT_CHOICES`, `MVP_MIN_CONTRAST`, `QUEUE_NAMES`, `IMvpProject`), `apps/workers/src/services/mvp-page-generator.ts` (`MVP_PAGE_SYSTEM_PROMPT`, temperatures, retry), `mvp-page-check.ts`, `mvp-grounding.ts`, `mvp-page-finish.ts`, `mvp-source-brief.ts`, `mvp-page-publish.ts`, `workers/mvp-page.worker.ts`, `workers/deploy.worker.ts`, `packages/db` MvpProject schema, `scripts/generate_mvp_page.ts`.

**Tech Stack:** Markdown, Mermaid.

**Spec:** `docs/superpowers/specs/2026-10-10-llm-page-generation-design.md` (§10; §3–§8 are the content to document). Ticket: REV-142.

## Global Constraints

- "No doc still describes the removed pipeline as current" (ticket AC). History may stay when it is marked as history: a milestones row or ADR that names a removed feature carries "удалено в REV-141" / "заменено REV-135" (Russian docs) or "removed in REV-141" (English).
- Revamp-docs commit: `docs(REV-142): ...`, pushed, commit link on the ticket. Repo changes in this ticket's PR.
- Write what the code does today; where the spec and code differ, the code wins (e.g. version kinds are `generate | change | restore`, no `controls` kind; storage is `v/<slug>/versions/<n>.html`; queue `mvp-page-queue`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Don't touch the main checkout (`../Revamp-dev`, another session's branch); work in the worktree `../Revamp-dev-rev142`.

## Stale-term check (the "test" for every task)

Run per file; RED = lines printed, GREEN = nothing printed:

```bash
T='rebuild|Rebuild|Bento|bento|modernize|Modernize|grouping|Grouping|siteSections|siteLayout|site-sections|site-grouping|layout-selection|MvpContentAgent|generatedContent|colorPalette|renderFailure|mvp-edit|MVP_EDIT_FAILED|relayout|IMvpDesign|customCss|planRebuild|MVP_LAYOUT|REVAMP_SET_LAYOUT|template\.service|mvp-content'
grep -nE "$T" FILE | grep -vE 'REV-141|REV-135|удален|заменен|removed in|superseded|rebuilds stale'
```

`MVP_EDIT_TIMEOUT` and `MVP_EDIT_NOT_ALLOWED` are live codes and are not in the list.

## Review Focus

1. A fact copied wrong from code (a check code, failure code, queue name, storage path, timeout, version kind) — the reviewer diffs each listed constant against `packages/shared-types/src/index.ts` and the workers.
2. A removed thing still described as current in a section the term list does not catch (e.g. "K-Means палитра" templating, "Tailwind" templates, "четыре макета", the `deploy-queue` relayout job, "Faithful/Modernized").
3. Mermaid diagrams that no longer parse after edits (blueprint §2, §3 Module 2, §4 ER, §6 queues; spec §3).
4. Cross-doc contradictions: blueprint §5 error table vs spec §3.5.1 code list vs `API_ERROR_CODES`.
5. History rows rewritten instead of marked: milestones/ADR entries must keep what was done then and add the marker, not be deleted.

---

### Task 1: Repo docs and stale comments

**Files:**
- Modify: `AGENTS.md` (§2 docs-map item 5; §3.2.2 the REV-141 pointer bullet)
- Modify: `README.md` (Scripts table; check Features/LLM providers/Repository layout)
- Modify: `packages/shared-types/src/index.ts:710-711` (dangling `QUEUE_NAMES` comments), `:507-510` (`provider`/`modelUsed` comments say "copy"/"deterministic")
- Check: `.env.example` (expected: no change; say so in the ledger)

- [ ] **Step 1:** Run the stale-term check on `AGENTS.md README.md .env.example`. Expected: AGENTS.md:52 (`MvpContentAgent`), AGENTS.md:97 (REV-141 pointer is allowed, but "REV-142 documents…" must go).
- [ ] **Step 2:** AGENTS.md §2 item 5: list the embedded agents as they are now: `DesignCritiqueAgent`, the MVP page generator (`MVP_PAGE_SYSTEM_PROMPT`, the model writes the whole page, code grounds it), `OutreachPersonalizerAgent`, the completeness judge.
- [ ] **Step 3:** AGENTS.md §3.2.2: replace the pointer bullet with the rule set, one bullet, same density as its neighbors: the model writes layout and markup, never facts (copy from the brief only, reworded lightly); `buildMvpSourceBrief` decides what it reads (`MVP_BRIEF_LIMITS`, no contact values); contacts and booking only as `MVP_PLACEHOLDERS`, filled by `finishMvpPage` from verified data; `checkMvpPage` rejects (`MVP_PAGE_CHECKS`), one retry with the reasons, else `MVP_PAGE_FAILURES` and nothing published; `checkMvpGrounding` flags (`MVP_GROUNDING_KINDS`), never rejects; `--rv-*` theme variables (`MVP_THEME_VARS`) read into `theme`, operator `controls` over them; versions `v/<slug>/versions/<n>.html`, at most `MVP_MAX_VERSIONS`; a new rule goes into the prompt, the check, its code in `MVP_PAGE_CHECKS`, recorded fixtures and the five locales; try it with `npx tsx scripts/generate_mvp_page.ts`.
- [ ] **Step 4:** README Scripts table: add the `generate_mvp_page.ts` row (usage line from the script header). Verify Repository layout lists no removed directories.
- [ ] **Step 5:** shared-types comments: delete the dangling REV-85 line and the "previous generator's" line, give `MVP_PAGE` its own comment (the page jobs: change, controls, restore, REV-139); `provider`/`modelUsed`: "Provider/model that wrote the page".
- [ ] **Step 6:** Stale-term check on the three files → nothing. Gates: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass, lint 8 pre-existing warnings.
- [ ] **Step 7:** Commit `docs(REV-142): AGENTS.md rule set for the page generator, README script, queue comments`.

### Task 2: Revamp-docs/AGENTS.md — agent prompts and schemas

**Files:** Modify `../Revamp-docs/AGENTS.md` (§3.4 workers, §4 agents table ~line 95, Agents 2, 5, 6, 7, 8, §4.5, §5 guardrails)

- [ ] **Step 1:** Stale-term check → RED (≈30 lines).
- [ ] **Step 2:** Replace Agent 2 (MvpContentAgent) with "Агент 2: Генератор страницы MVP (MVP Page Generator) — REV-137": purpose; model (`VISION_LLM_PROVIDER`, else `MVP_LLM_PROVIDER`, else first key, else CLI; operator pick wins; desktop screenshot as image); input `MvpSourceBriefSchema` fields and `MVP_BRIEF_LIMITS`; system prompt = `MVP_PAGE_SYSTEM_PROMPT` copied verbatim from the code in a code block; output: one HTML document, no Zod schema for the body — `checkMvpPage` table of `MVP_PAGE_CHECKS` with one-line rules and the placeholder grammar; retry once (temperatures 0.7 then 0.3, rejected page and reasons in the retry); `change` mode (current page + instruction); failures `MVP_PAGE_FAILURES`; grounding flags; budget/timeout constants from the generator.
- [ ] **Step 3:** Delete Agents 5 (MVP Edit, incl. design vocabulary), 6 (Section Grouping), 7 (Rebuild Edit), 8 (Rebuild Modernize); one line under Agent 2 says the free-text change is Agent 2's `change` mode and that agents 5–8 were removed in REV-141. Renumber nothing else (Agent 3, 4 keep numbers).
- [ ] **Step 4:** Update the agents table, §3.4 worker list (`mvp-page.worker.ts`), §4.5 and §5 lines that name removed agents.
- [ ] **Step 5:** Stale-term check → nothing; `grep -c 'MVP_PAGE_SYSTEM_PROMPT'` ≥ 1; diff the prompt block against the code: `diff <(sed -n '/^export const MVP_PAGE_SYSTEM_PROMPT/,/;$/p' apps/workers/src/services/mvp-page-generator.ts) <(the block)` — only the template wrapper and `${themeVars}` expansion differ.

### Task 3: Revamp-docs/spec.md — requirements, endpoints, DTOs, failures

**Files:** Modify `../Revamp-docs/spec.md` (§3 diagram ~71, §3.2.2, §3.2.3, §3.2.5.1 ~226, §3.5.1 codes ~390, §3.5.3 queues ~410–413, §5 roadmap ~471)

- [ ] **Step 1:** Stale-term check → RED (17 lines).
- [ ] **Step 2:** Diagram node: "Генератор страницы (LLM) + проверки кода".
- [ ] **Step 3:** Rewrite §3.2.2 as numbered requirements: 3.2.2.1 model designs the whole page (free layout); 3.2.2.2 brief; 3.2.2.3 copy grounded, no new facts; 3.2.2.4 placeholders; 3.2.2.5 `checkMvpPage` + retry + failures; 3.2.2.6 grounding flags; 3.2.2.7 theme vars and controls; keep 3.2.2.5f (SEO, REV-118) reworded for the page (`finishMvpPage` replaces the model's tags); delete 3.2.2.5/5a/5b/5c/5d/5e/5g content with one line "Макеты, чтение секций, группировка, перестройка и модернизация удалены в REV-141 (REV-135)".
- [ ] **Step 4:** §3.2.5.1: remove `layout` (an old client's `layout` is ignored); §3.2.3 versions (`v/<slug>/versions/<n>.html`, `MVP_MAX_VERSIONS` 20, index.html overwritten, preview URL unchanged).
- [ ] **Step 5:** §3.5.1 MVP code list = the MVP codes in `API_ERROR_CODES` today (read it); §3.5.3: `deploy-queue` publishes a page (no relayout); `mvp-page-queue` (REV-139) jobs change/controls/restore with their waits (420 s / 120 s); §5 stage 2 text: model-designed page.
- [ ] **Step 6:** Stale-term check → nothing; also `grep -nE 'Tailwind|макет' spec.md` and fix any line that presents templates/layouts as current.

### Task 4: Revamp-docs/blueprint.md — queues, schemas, diagrams, storage, §5

**Files:** Modify `../Revamp-docs/blueprint.md` (§2 diagram 49–50; Module 1 line ~247; Module 2 258–342; §4 ER 497–523, leads ~579, audits 664–673, mvp_projects 699–800; §5 rows 897–950; §6 diagram ~1001, workers 1046–1064; §8 Gantt ~1105)

- [ ] **Step 1:** Stale-term check → RED (≈54 lines).
- [ ] **Step 2:** §2 diagram: AI worker = "MvpPageGenerator через LlmClient", deploy worker = "finishMvpPage + проверки + S3"; Module 1: delete the grouping bullet (era facts bullet stays).
- [ ] **Step 3:** Module 2: new flowchart (brief → generator → checkMvpPage ↺ once → raw page → finishMvpPage → upload index.html + versions/n → standards, performance, completeness, grounding, banner → NEEDS_APPROVAL); 2.1 rewritten as steps: brief, generator, checks, grounding, finishing (placeholders, SEO, controls `<style id="rv-controls">`, booking, tracker, preview script), publish and versions, changes (edit/tokens/restore). Keep the kept parts (language REV-25/116, icon REV-56, completeness REV-36/37, tracker REV-52, banner REV-126, regeneration REV-31) reworded where they mention templates/layouts.
- [ ] **Step 4:** §4: ER diagram and `mvp_projects` schema = `IMvpProject` today (copy from shared-types + db schema); `leads.generationFailure` = `IMvpRenderFailure` `{ code: 'MVP_PAGE_UNAVAILABLE', reason: MvpPageFailure, message?, at }`; `audits`: drop `siteLayout*`, `siteSections*`.
- [ ] **Step 5:** §5: fix rows for `/mvp/:id/tokens` (page tokens, contrast, fonts), `/mvp/:id/edit` (mvp-page-queue, waits), drop `/mvp/:id/rebuild` *(план)* row, `MVP_EDIT_FAILED` text (no Zod/Strict Grounding wording; `details` with page problems as the code gives).
- [ ] **Step 6:** §6: queue diagram node `mvp-page-queue`; deploy worker = publish a page (`NO_PAGE_REFUSAL` without one); `mvp-page` worker section (change/controls/restore, deadline and `PUBLISH_MARGIN_MS`, REV-139); §8 Gantt label marked as history or renamed "Генератор страницы MVP".
- [ ] **Step 7:** Stale-term check → nothing; render-check every edited Mermaid block: `npx -y @mermaid-js/mermaid-cli@11.4.2 -i <block.mmd> -o /dev/null` per block (extract with awk into the scratchpad). Expected: no parse error.

### Task 5: research.md ADR, milestones.md, Revamp-docs README.md

**Files:** Modify `../Revamp-docs/research.md`, `../Revamp-docs/milestones.md`, `../Revamp-docs/README.md`

- [ ] **Step 1:** Stale-term check on the three → RED.
- [ ] **Step 2:** research.md: add "ADR 17: MVP проектирует модель, факты держит код (REV-135)": context (rebuild rigid, every MVP the original re-skinned), decision (spec §2 table in prose), rejected options (keep rebuild + modernize; model output in a component vocabulary; reject pages on grounding flags), consequences (no fallback page; flags for the operator; dated-site check kept). ADR 12, 13, 14, 16 get "**Заменено ADR 17 (REV-135); удалено в REV-141.**" under their title; §3 scenario line 234 describes the page generator.
- [ ] **Step 3:** milestones.md: rows REV-90, 85, 93, 104, 109, 110, 112, 113, 111, 114, 119, 122, 132 get "(удалено в REV-141)" / "(заменено REV-135)" where the feature is gone; add rows REV-135 … REV-142 (one line each, what shipped) and tick REV-142; week-2 Bento plan and risk row get one marker line "Исторический план; Bento заменен страницей, которую проектирует модель (REV-135)".
- [ ] **Step 4:** README.md (docs): lines 43, 59, 88 describe the model-designed page; 241 is the sprint history → marker.
- [ ] **Step 5:** Stale-term check on all six Revamp-docs files → nothing. Commit in `../Revamp-docs`: `docs(REV-142): the model-designed MVP page in spec, blueprint, agents, ADR 17 and milestones`; push.

### Task 6: Hand-off

- [ ] **Step 1:** Final grep across all nine doc files (stale-term check) → nothing.
- [ ] **Step 2:** Ticket comment with the Revamp-docs commit link; PR per pipeline.
