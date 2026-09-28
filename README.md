# Revamp

Revamp finds local businesses with dated websites, audits each site, builds a modern one-page MVP from the site's own content, and prepares a personalised outreach email. A human operator reviews everything in the dashboard. Nothing is sent until they approve it.

```
Maps search ─┐
             ├─► Audit ─► MVP copy ─► MVP build + completeness check ─► Operator review (HITL) ─► Email ─► Tracking
Manual URL ──┘
```

- **Discovery:** searches OpenStreetMap (no key needed) or Google Places by niche and city. The operator picks which businesses become leads.
- **Audit:** Playwright captures above-the-fold and full-page screenshots (cookie banners dismissed first), then runs axe-core (WCAG 2.1 AA), Core Web Vitals and a Vision LLM design critique. It also extracts the brand palette, logo, contacts and the site's own text. A site that cannot be audited (unresolvable domain, invalid certificate, repeated browser crashes) moves the lead to `AUDIT_FAILED` with a one-line reason; the operator can retry the audit or reject the lead.
- **MVP:** an LLM rewrites the original site's content in the site's own language. One of four layouts (Bento, split, editorial, compact), picked deterministically from the audit data, renders it, and the page is checked against the original site's data before it is published to S3/MinIO.
- **Dashboard:** a review-queue layout with an icon rail and client-side routes (`/` review queue: tabs for the Needs you, In progress, Outreach and Closed buckets with counts, a list of the bucket's leads next to the selected lead's review, quick filters by status and score band (Filter next to the list caption; they reset when the bucket changes), the next lead selected after an approve or reject while a lead a worker or a regeneration moves to another bucket stays selected, J / K / Enter to move and open, and an open-full-screen button in the selected lead's header; `/leads` all leads as a table or board filtered by bucket, niche and site type, `/leads/:id` a lead's review, `/leads/:id/preview` the lead's MVP full-window with the same Design tools (opened in a new tab from the Prototype step, with a link to the published page the lead receives), `/settings` theme, language and the default LLM), a lead review in three steps (1 Audit: original-site screenshots, metrics, the MVP data check, flaws and quick wins; 2 Prototype: the sandboxed MVP with breakpoints, regeneration with a choice of LLM provider and model, and a Design tools panel floating over the preview (drag it by its handle or move it with the arrow keys, Home or reset position puts it back in the top-right corner, collapse it to its header; its place lasts for the browser session) holding the color toolbar, a layout picker that switches the MVP between its four layouts live, with an animated transition and no regeneration, and a "Describe a change" field where the operator asks for a change in their own words (the LLM applies it to the copy, primary color, layout and/or a custom design — section order and hiding, the hero's arrangement, element styles, font, density, corners, hero style and up to three custom blocks — without inventing facts, and says what it changed or why it changed nothing; "Reset custom design" drops the design); a color, layout or described change also re-renders the published MVP, so the page opened in a new tab and sent to the lead matches it, and the tools lock once the lead leaves review; 3 Email: the email editor with an inbox preview) and a bottom action bar where Approve & send exists only on the email step and Reject on every step. Keyboard shortcuts (REV-47), listed in an overlay opened with `?` or the keyboard button on the rail: `1` / `2` / `3` go to the review queue, all leads and settings, `D` opens Find businesses, `N` Add lead, `/` focuses the lead search, J / K / Enter move through and open the queue, Esc closes a dialog or drawer, and ⌘ + Enter (Ctrl + Enter off macOS) approves on the email step through the Approve button's usual checks and confirmations. Shortcuts are off while typing in a field or working in a dialog, and plain shortcuts never fire with a modifier held, so browser shortcuts keep working. The UI is available in English, Russian, Belarusian, Polish and Lithuanian, with a Hyperliquid-inspired dark theme (the default target) and a matching light theme.

## Quick start

You need three things installed:

- [Node.js](https://nodejs.org) 20 or newer (`node -v` to check)
- [Docker Desktop](https://www.docker.com/products/docker-desktop), running (it provides MongoDB, Redis and MinIO)
- Git

Then, from the cloned folder:

```bash
npm run setup   # once: dependencies, Chromium, .env, databases, shared packages
npm run dev     # every time: starts everything, then open http://localhost:5173
```

`npm run setup` checks Node and Docker, runs `npm install`, downloads the Chromium build Playwright uses for site audits, creates `.env` from `.env.example` (an existing `.env` is never overwritten), starts MongoDB, Redis and MinIO in Docker and waits until they are healthy, creates the MinIO buckets and builds the shared packages. It is safe to run again, for example after pulling changes that add dependencies.

`npm run dev` starts the Docker services if they are not running, rebuilds a shared package only when its sources changed, then runs the API, the workers and the dashboard in one terminal. Every line is tagged with the app it came from (`[api      ]`, `[workers  ]`, `[dashboard]`). If one app crashes the others stop too, so the error stays at the bottom of the output.

| Address | What |
|---|---|
| http://localhost:5173 | Dashboard |
| http://localhost:4000/api/v1 | API |
| http://localhost:9001 | MinIO console (`minioadmin` / `minioadmin`), where the generated MVPs are stored |

Press **Ctrl+C** to stop the apps. The Docker containers keep running so the next start is fast; `npm run docker:down` stops them (your data stays in Docker volumes).

### Add an LLM provider

The app starts without one, but audits and MVP generation need an LLM, and nothing is faked when it is missing. Pick one:

- Put `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in `.env`, then restart `npm run dev`.
- Or install the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), log in (`claude`) and set `MVP_LLM_PROVIDER=claude-cli` in `.env`. It uses the account the CLI is logged into, so no API key is needed.

`npm run setup` ends by listing the providers it found and warns about anything still missing. [LLM providers](#llm-providers) covers every option. Discovery (OpenStreetMap) works with no key; sending email needs `EMAIL_PROVIDER` (see [Email](#email)).

### Troubleshooting

| Message | Fix |
|---|---|
| `Docker is installed but not running.` | Start Docker Desktop and wait until it reports it is running. |
| `Port 5173 (dashboard) is already in use.` (or 4000) | Another copy of the app is running, maybe in another terminal. Stop it, or find it with `lsof -i :5173`. |
| `docker compose up` fails with a port error | Another MongoDB (27017), Redis (6379) or MinIO (9000/9001) is running on your machine. Stop it, then run `npm run dev` again. |
| `The project is not set up yet.` | Run `npm run setup` first. |
| An audit fails at the design critique | No LLM provider is configured, see above. |

## Repository layout

```
apps/
  api/          Express REST API (/api/v1), BullMQ producers
  workers/      BullMQ workers: discovery, audit, AI generation, deploy, email
  dashboard/    Operator UI: React, Vite, MUI v6, TanStack Query, Zustand, i18next
packages/
  shared-types/ Types, enums, DTOs and queue names shared across the monorepo
  validation/   Zod schemas for HTTP payloads and LLM output
  db/           Mongoose models shared by the API and the workers
deploy/         Production Docker, Nginx and deploy script
scripts/        setup / dev launchers, maintenance and live-crawl scripts
```

## Local development

See [Quick start](#quick-start) to get the app running. The pieces behind `npm run setup` and `npm run dev`, if you want to run them yourself:

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run docker:up        # MongoDB :27017, Redis :6379, MinIO :9000 (console :9001)
npm run build:packages   # the apps typecheck against the packages' compiled dist
npm run dev:api          # http://localhost:4000/api/v1
npm run dev:workers
npm run dev:dashboard    # http://localhost:5173
```

The `minio-init` container creates the `revamp-assets` and `revamp-demos` buckets. The API and workers read the root `.env`.

### LLM providers

All LLM settings live in `.env`. Nothing is faked when a provider is missing: without a Vision provider (an `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, or the local Claude Code CLI) audits fail at the design critique, and without an MVP provider generation fails with an error the dashboard shows. Deterministic copy and critique are only used as a fallback after a configured LLM fails every retry (the result is marked `aiFallbackUsed`). The workers log a warning at startup for each missing provider.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | Enable the matching API provider |
| `MVP_LLM_PROVIDER` | Default provider: `anthropic`, `openai`, `gemini` or `claude-cli`. When empty, the first provider with a key is used |
| `CLAUDE_CLI_PATH`, `CLAUDE_CLI_MODEL`, `CLAUDE_CLI_TIMEOUT_MS` | `claude-cli` runs the local Claude Code CLI with the account it is logged into, so it needs no API key |
| `VISION_LLM_PROVIDER` | Design critique provider: `anthropic`, `openai` or `claude-cli`. When empty: the Anthropic key, then the OpenAI key, then the CLI if `CLAUDE_CLI_PATH` is found. The CLI receives both screenshots as images and uses `CLAUDE_CLI_MODEL` |
| `MVP_COMPLETENESS_LLM` | `true` lets the LLM judge the MVP completeness check (every verdict is verified in code); `false` uses the code-only check |

The operator can override the provider and model for each generation from the dashboard.

A described change to an MVP (`POST /mvp/:id/edit`, "Describe a change" in the Design tools) uses the default provider. The API queues it on `mvp-edit-queue` and waits up to 150 s while the workers ask the LLM, check its answer (Zod schema; every number, email address and link in the new copy must already be on the original site or in the current copy; the color must be a brand color or a dashboard preset), save it and re-render the published page. The custom design is a spec (`MvpDesignSchema`) of fixed names and tokens that the template turns into CSS and markup itself (`apps/workers/src/templates/design.ts`), so the model never writes CSS or HTML; it is saved on the MVP, kept by regenerations and live layout switches, and custom block text goes through the same facts check. For looks the tokens can't express (gradient text, a hover tilt, an accent line) the design may carry `customCss` (up to 4 KB): the workers parse it with PostCSS (`apps/workers/src/templates/css-sanitizer.ts`) and accept it only as a whole when every selector targets the page's own hooks or classes and nothing loads external resources, adds text, hides, shrinks, covers or moves content off the page, or fixes anything but the header; it is checked again at render and left out if it no longer passes. `DELETE /mvp/:id/design` drops it the same way. A change that breaks these rules is not applied: the API returns `502 MVP_EDIT_FAILED` with the reason, as it does when no provider is configured. It returns `409 MVP_EDIT_NOT_ALLOWED` once the lead has left review, and `504 MVP_EDIT_TIMEOUT` when the workers do not answer in time; a late answer is then discarded rather than applied.

### Email

`EMAIL_PROVIDER` picks the outreach provider: `resend` (`RESEND_API_KEY`), `sendgrid` (`SENDGRID_API_KEY`) or `smtp` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). It has no default: without it, an approved email fails at dispatch instead of being reported as sent.

A lead can be added without a contact email; the audit then fills it in from the email published on the site. Outreach cannot be approved for a lead that still has no email (409). Outreach can be approved only while the lead awaits review (`NEEDS_APPROVAL`), and a lead can be rejected only until its outreach is approved; otherwise the API answers `409 LEAD_NOT_AWAITING_APPROVAL` or `409 LEAD_NOT_REJECTABLE` and the dashboard disables the action. The dashboard approves the draft exactly as its preview shows it, with every `{{variable}}` substituted; the API stores the plain-text draft as `bodyPlainText` and as escaped HTML that keeps its paragraphs and line breaks (`draftToHtml` in `@revamp/shared-types`), the same conversion the test send uses.

"Send a test to myself" sends the current draft, exactly as the preview shows it, to the operator's address through the same provider (`POST /outreach/:id/test`). The API queues it on `email-test-queue` and waits up to 30 s for the result: the test has `[Test]` in the subject, no open-tracking pixel, and it never changes the lead or its campaign. Both the API and the workers read `EMAIL_PROVIDER`. Without it the API answers `503 EMAIL_PROVIDER_NOT_CONFIGURED`. A provider error returns `502 EMAIL_SEND_FAILED`, and if no worker picks the job up in time the API returns `504 EMAIL_TEST_TIMEOUT` and drops the job.

### Discovery

OpenStreetMap works with no configuration. Google Places needs `GOOGLE_PLACES_API_KEY`. Set `DISCOVERY_USER_AGENT` to something that identifies you: the Nominatim and Overpass usage policies require it.

Discovery opens in a side drawer with three steps: **Where** (the search form), **Review** (progress, then the businesses found) and **Import** (what was imported). Closing the drawer keeps the search and its step, so reopening it lands where the operator left off.

A search can keep running in the background after the operator closes the drawer. When it finishes, the dashboard shows a notification on any page: the number of new businesses to review, "nothing new", or a failure. Clicking the notification opens the results. The drawer never opens by itself.

### MVP telemetry

Generated MVPs are served from the `revamp-demos` bucket, not the API, so the page loads `revamp-tracker.js` from the absolute `PUBLIC_API_URL` (e.g. `http://localhost:4000/api/v1`) and posts pageview, dwell time, scroll and CTA events to `<PUBLIC_API_URL>/track/mvp-event`. The API accepts these cross-origin calls on `/track/*` only, from the `S3_ENDPOINT` origin (local MinIO) and `https://PREVIEW_DOMAIN`. Set `PUBLIC_API_URL` to the address visitors can reach before generating MVPs. It is written into each page when the page is generated, so after changing it, regenerate existing MVPs.

## Scripts

| Command | What it does |
|---|---|
| `npm run setup` | First-time setup, safe to re-run (see [Quick start](#quick-start)) |
| `npm run dev` | Docker services + API, workers and dashboard in one terminal |
| `npm run dev:api` / `dev:workers` / `dev:dashboard` | One app on its own |
| `npm run build` | Builds the packages, then every app |
| `npm run typecheck` | Type-checks every workspace |
| `npm run lint` | ESLint |
| `npm test` | Vitest, all workspaces |
| `npm run docker:up` / `docker:down` / `docker:logs` | Local infrastructure |
| `npm run verify:env` | Checks production dependencies (MongoDB, Redis, S3, API keys) |
| `npm run backfill:stuck-audits --workspace=@revamp/api` | One-off: moves leads left in `AUDITING` after a failed audit to `AUDIT_FAILED` (`-- --dry-run` to preview) |
| `npm run migrate:lead-statuses --workspace=@revamp/api` | One-off (REV-62): moves leads stored with a removed status (`PENDING`, `MVP_READY`, `AWAITING_APPROVAL`, `APPROVED`, `DISPATCHED`, `REPLIED`) to the status that replaces it (`-- --dry-run` to preview) |

Production deployment uses `.env.production.example`, `docker-compose.prod.yml` and `deploy/deploy.sh`.

## Engineering rules

- **Human in the loop:** workers stop at `NEEDS_APPROVAL`. Emails go out only after an operator approves them in the dashboard.
- **Strict grounding:** metrics and contact data come from deterministic code, never from an LLM. The MVP shows only data found on the original site.
- **No mock data at runtime:** the dashboard shows only what the API returns. When the API is unreachable or a request fails, it shows an error or an empty state, and a value the audit did not measure is shown as missing (`—`). Mocks live only in test files.
- **Zod everywhere:** HTTP payloads and LLM responses are validated with `@revamp/validation` before they are processed or stored.
- **Sandboxed previews:** MVPs are static bundles in the `revamp-demos` bucket, embedded with `<iframe sandbox="allow-scripts allow-same-origin">`.
- **Tests:** every change ships with Vitest tests, and `npm test` must pass with 0 failures.

## Contributing

Work is tracked in the [Linear REV team](https://linear.app/revamp-proect/team/REV/overview). Every bug fix and feature follows the same pipeline: ticket → branch → tests and local gates → PR → merge → close ticket. See [AGENTS.md](./AGENTS.md) for branch and commit conventions and the full checklist.

## Documentation

The architecture, requirements, ADRs, agent prompts and roadmap live in [revamp-docs](https://github.com/yurykurouski/revamp-docs), checked out next to this repo as `../Revamp-docs`:

- `blueprint.md`: architecture, data model, REST API, queues
- `spec.md`: requirements
- `research.md`: ADRs and edge cases
- `AGENTS.md`: in-app AI agent prompts and schemas
- `milestones.md`: roadmap and ticket status
