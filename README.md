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
- **Dashboard:** Kanban/DataGrid pipeline, a side-by-side inspector, MVP regeneration with a choice of LLM provider and model, an email editor and the approval gate. The UI is available in English, Russian, Belarusian, Polish and Lithuanian, with a Hyperliquid-inspired dark theme (the default target) and a matching light theme.

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
scripts/        Maintenance and live-crawl scripts
```

## Requirements

- Node.js 20+
- Docker with Docker Compose (MongoDB 7, Redis 7, MinIO)
- Chromium for Playwright: `npx playwright install chromium`

## Getting started

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run docker:up        # MongoDB :27017, Redis :6379, MinIO :9000 (console :9001)
npm run build:packages   # the apps typecheck against the packages' compiled dist
```

Then start the three apps, each in its own terminal:

```bash
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

### Email

`EMAIL_PROVIDER` picks the outreach provider: `resend` (`RESEND_API_KEY`), `sendgrid` (`SENDGRID_API_KEY`) or `smtp` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). It has no default: without it, an approved email fails at dispatch instead of being reported as sent.

A lead can be added without a contact email; the audit then fills it in from the email published on the site. Outreach cannot be approved for a lead that still has no email (409).

### Discovery

OpenStreetMap works with no configuration. Google Places needs `GOOGLE_PLACES_API_KEY`. Set `DISCOVERY_USER_AGENT` to something that identifies you: the Nominatim and Overpass usage policies require it.

A search can keep running in the background after the operator closes the discovery window. When it finishes, the dashboard shows a notification on any page: the number of new businesses to review, "nothing new", or a failure. Clicking the notification opens the results. The window never opens by itself.

### MVP telemetry

Generated MVPs are served from the `revamp-demos` bucket, not the API, so the page loads `revamp-tracker.js` from the absolute `PUBLIC_API_URL` (e.g. `http://localhost:4000/api/v1`) and posts pageview, dwell time, scroll and CTA events to `<PUBLIC_API_URL>/track/mvp-event`. The API accepts these cross-origin calls on `/track/*` only, from the `S3_ENDPOINT` origin (local MinIO) and `https://PREVIEW_DOMAIN`. Set `PUBLIC_API_URL` to the address visitors can reach before generating MVPs. It is written into each page when the page is generated, so after changing it, regenerate existing MVPs.

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds the packages, then every app |
| `npm run typecheck` | Type-checks every workspace |
| `npm run lint` | ESLint |
| `npm test` | Vitest, all workspaces |
| `npm run docker:up` / `docker:down` / `docker:logs` | Local infrastructure |
| `npm run verify:env` | Checks production dependencies (MongoDB, Redis, S3, API keys) |
| `npm run backfill:stuck-audits --workspace=@revamp/api` | One-off: moves leads left in `AUDITING` after a failed audit to `AUDIT_FAILED` (`-- --dry-run` to preview) |

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
