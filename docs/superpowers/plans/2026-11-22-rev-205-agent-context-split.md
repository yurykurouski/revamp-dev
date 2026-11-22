# REV-205: cut the context agents load per session

Ticket: https://linear.app/revamp-proect/issue/REV-205
Branch: `ymorpheus/rev-205-cut-agent-context` (worktree `../Revamp-dev-rev205`)

## Goal

Every session and subagent loads the root `AGENTS.md` (39 KB, ~10k tokens) whatever it works on. The aim is a root file of at most 12 KB, with area rules in nested files that load only when an agent works in that area. The large docs in `../Revamp-docs` get a section index so agents read one section, not a whole 100 KB+ file.

## Verified first

Claude Code loads a nested `AGENTS.md` when it reads a file in that folder. I tested two scratch repos with `claude -p --model haiku`, one with a `CLAUDE.md` `@AGENTS.md` shim and one without, and both picked up the area rule. So **no `CLAUDE.md` shims**. Cursor, Codex and Antigravity read nested `AGENTS.md` natively.

## Where each rule goes

Wording moves as is; only the root gets new summary lines.

| Current section | Destination |
|---|---|
| §1 ecosystem, §2 doc map | root (doc map shortened, plus "read sections via `INDEX.md`") |
| §3.1 tree | root, with the nested `AGENTS.md` files added |
| §3.1.1 running the stack: setup/dev bullets | root |
| §3.1.1 MongoDB users (REV-198), demo data (REV-199) | `packages/db/AGENTS.md`, one-line pointer in root |
| §3.2.1 HITL | root |
| §3.2.2 strict grounding: the principle + the no-mock (REV-45) and no-stand-in (REV-100) rules | root (short) |
| §3.2.2 site assessment, happy-dom, language, standards, SEO, site era, the MVP generator paragraph, critique fallback, Before/After banner | `apps/workers/AGENTS.md` |
| §3.2.3 sandboxed hosting | root (2 lines) |
| §3.2.4 Zod, §3.2.5 tests | root |
| §3.2.6 dashboard styling, routes, review, shortcuts, design tools | `apps/dashboard/AGENTS.md` |
| §3.2.7 one schema per collection: principle | root |
| §3.2.7 unique `leadId`, Mixed-field validation, real-Mongo tests | `packages/db/AGENTS.md` |
| §3.2.8 state machine: principle + atomic-filter rule | root |
| §3.2.8 add-lead / approval transactions, enqueue-or-revert, repair scripts | `apps/api/AGENTS.md` (the `@revamp/db` halves cross-linked from `packages/db/AGENTS.md`) |
| §3.2.8 stalled jobs (REV-145), deploy worker publishes only over `GENERATING` | `apps/workers/AGENTS.md` |
| §3.2.8 Kanban/bucket mapping | `apps/dashboard/AGENTS.md` |
| §3.2.9 error format: principle, `AppError`, `API_ERROR_CODES` | root; dashboard `ApiError` / `Serialized<T>` → `apps/dashboard/AGENTS.md` |
| §4 Linear pipeline, §5 DoD | root (step 6 also names the area files) |

The root gets an **"Area rules"** table: each file, when it applies, and the rule *"changing `packages/shared-types` or `packages/validation` for a feature → read the area file of the app that uses it"*. That rule exists because the "a new sign goes into …" checklists in the workers file span packages.

## Steps

1. **Rule-preservation check (written first).** `scratchpad/rule-tokens.mjs` collects every backticked token and every `REV-n` from the old `AGENTS.md` and fails if any is missing from the union of the new files. It runs before the split (expect: nothing missing, a trivial pass) and after it (expect: nothing missing). It is a one-off for this PR, not committed; its output goes in the PR's Verification section.
2. **Split.** Write `apps/workers/AGENTS.md`, `apps/dashboard/AGENTS.md`, `apps/api/AGENTS.md`, `packages/db/AGENTS.md`, then rewrite the root. Check the root with `wc -c AGENTS.md` (≤ 12 KB) and re-run the check from step 1.
3. **Load check.** In the worktree, run `claude -p --model haiku` after reading a file in `apps/dashboard/src` and confirm the dashboard rules are present. Then do the same at the root and confirm they are absent.
4. **Docs index (TDD).** `scripts/lib/docs-index.mjs` gets a pure `buildDocsIndex(files)` (markdown → `## heading → file:start-end`, h2/h3, code fences skipped). It is tested first in `scripts/__tests__/docs-index.spec.ts`: headings, fenced `#` lines ignored, ranges end before the next heading of the same or a higher level, last section ends at EOF. `scripts/docs-index.ts` writes `../Revamp-docs/INDEX.md` (`npm run docs:index`) or checks it (`npm run docs:check-index`, exit 1 when stale), like `docs:check-dictionary`. Local only: CI has no docs checkout.
5. **Agent tooling.** `.claude/agents/implementer.md`: read the root plus the area file of each touched area, and read docs sections through `INDEX.md`. `.claude/skills/next-task/SKILL.md` step 5: check the diff against the root and the touched area files instead of §3.2. Step 8: run `docs:index` after doc edits.
6. **Gates.** Run `build:packages`, `typecheck`, `lint`, `test` and `build`. No runtime code changes, so the Chrome check doesn't apply; the PR says so.
7. **Review, PR, merge, docs, Done**, per AGENTS.md §4.3 and the usual rhythm. Docs: `README.md` (the new scripts), `../Revamp-docs/INDEX.md` committed and pushed, and the docs `README.md` names it.

## Measuring the saving

Report the root `AGENTS.md` bytes before and after, and the bytes an agent loads for a workers-only task (root + workers file) against today's 39 KB.

## Rulings (cost if wrong)

- Stand-in and no-mock rules stay in the root even though their examples are worker-specific. Cost if wrong: about 1 KB extra per session.
- `INDEX.md` is generated from Revamp-dev scripts rather than tooling inside the docs repo, which has no package.json. Cost if wrong: the generator has to move later.
- The rule-token check stays uncommitted: a permanent check would freeze the wording of AGENTS.md. Cost if wrong: a later rule loss isn't caught automatically.
