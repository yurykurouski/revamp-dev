# REV-221 Per-Studio Mailbox Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) as one run, task by task, TDD. Steps use checkbox (`- [ ]`) syntax. Report every deviation from this plan under `Plan deviations`.

**Goal:** Every approved outreach email (and every test send) goes out through the mailbox the lead's studio connected (Gmail through Google OAuth, or SMTP). The platform-wide provider is removed.

**Architecture:** A new `Mailbox` collection in `@revamp/db` holds one mailbox per studio, with its secret (SMTP password or Gmail refresh token) encrypted with AES-256-GCM. The API connects, verifies and disconnects it under `/organization/mailbox` (owner only). Any member reads its public view at `GET /outreach/sender`. Approve and test send refuse a studio without a usable mailbox. The email workers load the lead's studio mailbox, apply its rolling 24-hour limit by delaying the job, and send through a `MailboxTransport` (SMTP through Nodemailer, or the Gmail REST API with a raw MIME message built by Nodemailer). An auth failure marks the mailbox `NEEDS_RECONNECT` and returns the lead to review with a readable `outreachError`.

**Tech Stack:** Node 20, TypeScript, Express, Mongoose, BullMQ 5.81 (`DelayedError`, `job.moveToDelayed`), Nodemailer 10 (`streamTransport` with `buffer: true` builds the MIME), Node `crypto` (AES-256-GCM, HMAC), Zod, React 18 + MUI v6 + React Query, Vitest.

**Spec:** Linear REV-221 (problem, expected, acceptance criteria) and BA US18 (`../Revamp-docs/ba-expertise.md:254`). Read root `AGENTS.md`, `apps/api/AGENTS.md`, `apps/workers/AGENTS.md`, `apps/dashboard/AGENTS.md` and `packages/db/AGENTS.md` before starting.

## Rulings made in this plan (the ticket left them open)

1. **The platform-wide provider is removed entirely, not kept for notifications.** The platform sends no notification email today: invitations are a link the owner copies (REV-207), and sign-in sends nothing. `EMAIL_PROVIDER`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `EMAIL_FROM`, `SMTP_HOST/PORT/USER/PASS`, `ResendEmailProvider`, `SendGridEmailProvider`, `createEmailProvider` and `EMAIL_PROVIDER_NOT_CONFIGURED` (constant and error code) are deleted.
2. **Gmail scopes:** `openid email https://www.googleapis.com/auth/gmail.send`. `gmail.send` alone cannot read the account's address, so the `email` claim of the ID token gives it. Sending goes through the Gmail REST API (`users/me/messages/send`), because SMTP XOAUTH2 needs the full `https://mail.google.com/` scope.
3. **Gmail is optional per deployment.** Without `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, the start endpoint answers `503 GMAIL_OAUTH_NOT_CONFIGURED` and the dashboard shows the Gmail option as unavailable. SMTP always works.
4. **Daily limit window:** a rolling 24 hours (Gmail counts that way). Count = the studio's campaigns `DELIVERED` with `sentAt` in the last 24 h and `senderEmail` equal to the mailbox address. Default `dailyLimit` is 500 for both kinds. The owner may set 1–2000. Test sends are not counted.
5. **When a mailbox is gone or rejected at send time, the lead goes back to review.** The worker returns the lead `SCHEDULED → NEEDS_APPROVAL` (existing edge), unstamps the campaign (existing `revertOutreachApproval`), and sets `Lead.outreachError = { code, message, at }`. The operator sees the reason, the owner reconnects, and the operator approves again. Transient errors (network, 5xx, timeouts) keep today's retry with the claim released. `outreachError` is cleared by the next successful approval.
6. **The OAuth callback is a public route** (`GET /oauth/google/callback`). The studio comes from a signed `state` (HMAC-SHA256 with `JWT_SECRET`, purpose `gmail-mailbox`, organization id, user id, nonce, 10-minute expiry). On callback the user must still be an owner of that studio. The browser is then redirected to `${DASHBOARD_URL}/settings?mailbox=connected` or `?mailbox=error&reason=<code>`.
7. **SMTP credentials are verified on connect from the API** (`transporter.verify()`, 10 s timeout, with `nodemailer` added to `apps/api`). A failure answers `422 MAILBOX_VERIFY_FAILED` with the server's reply, after any echo of the password is removed.
8. **The From header** is `"<displayName>" <address>`, where `displayName` defaults to the studio name at connect time. The owner can change it with PATCH.
9. **Unchanged:** the global worker limiter of one email per 180 s (shared by all studios). It is noted under "Deferred" in the report, not changed here.
10. **No mailbox in the demo seed:** credentials are never seeded. Approving in the demo studio shows the "connect a mailbox" message.
11. **Gmail end to end is not possible without a real Google client.** It is covered with tests that mock `fetch`. The e2e run uses SMTP against the local sink, and in Chrome checks the Gmail button's "not configured" state.

## Global Constraints

- HITL unchanged: only a `SCHEDULED` lead is emailed (NFR7). The new code adds refusals, never a send path.
- Every API error goes through `AppError` with codes from `API_ERROR_CODES`. New codes: `MAILBOX_NOT_CONNECTED` (409), `MAILBOX_NEEDS_RECONNECT` (409), `MAILBOX_VERIFY_FAILED` (422), `GMAIL_OAUTH_NOT_CONFIGURED` (503), `MAILBOX_OAUTH_FAILED` (400, used only as the redirect `reason`). Removed code: `EMAIL_PROVIDER_NOT_CONFIGURED`.
- Schemas only in `packages/db`. Every request body is validated with a Zod schema from `@revamp/validation`, and Google's token response with `GoogleTokenResponseSchema` before use.
- No secret ever appears in an API response, a log line, an error message or a queue payload. Queue payloads stay `{ campaignId, leadId, tenantId }` and the test payload stays as it is. The worker reads the secret from Mongo.
- Tenant isolation: the API reaches `Mailbox` only through `req.tenant.mailboxes` / `scopeFor()`. `'Mailbox'` joins `GUARDED` in `tenant-guard.ts`. Workers read it with `withTenant(tenant, …)` after `assertJobTenant`.
- `MAILBOX_ENCRYPTION_KEY`: 32 bytes as base64 (44 chars). Required by the API and the workers (startup fails without it). `npm run setup` generates it. In the container stack and in prod it is a Docker secret (`MAILBOX_ENCRYPTION_KEY_FILE`), and so is `GOOGLE_OAUTH_CLIENT_SECRET`.
- New dashboard strings in all five locales (`en`, `ru`, `be`, `pl`, `lt`). Theme tokens only.
- Tests are `.spec.ts` only (`.spec.tsx` is skipped). Run vitest from the repo root. Real-MongoDB tests go in `packages/db/src/__tests__/real-mongo.spec.ts`.

## Review Focus

1. **An owner disconnects or reconnects the mailbox while an approved email is waiting in the delayed queue.** The worker must read the mailbox at send time, not at approval: disconnected means the lead goes back to review with `MAILBOX_NOT_CONNECTED`, and reconnected to another address means it sends from the new address and records it. Covered by `email.worker.spec.ts › returns the lead to review when the mailbox was disconnected after approval` and `› sends from the mailbox address current at send time` (Task 5).
2. **The SMTP server echoes the password in its error reply** (some do on AUTH failures), or Nodemailer puts the auth object in the error. The text must be redacted before it reaches the 422 body, `Mailbox.lastError`, `Lead.outreachError` or a log. Covered by `redactSecret` tests (Task 2) and `mailbox.routes.spec.ts › MAILBOX_VERIFY_FAILED never echoes the password` (Task 3).
3. **A studio at its limit with many approved emails.** Each must be delayed to when the window frees up, not failed and not retried in a hot loop (attempts must not be consumed). Covered by `email.worker.spec.ts › delays the job to the end of the window when the mailbox is at its daily limit` (asserts `moveToDelayed` with the oldest `sentAt + 24h`, and `DelayedError`) (Task 5).
4. **Callback replay or a forged state:** an expired, tampered or other-purpose state, or a user who is no longer an owner. The callback must write nothing and redirect with `reason=MAILBOX_OAUTH_FAILED`. Covered by `oauth.routes.spec.ts` cases (Task 4).
5. **Google returns no refresh token** (the user had granted access before, so no `prompt=consent`), or `email_verified` is false. Connecting must fail visibly instead of storing a mailbox that can never send. Covered by `gmail-oauth.spec.ts › refuses a token response without refresh_token` / `› refuses an unverified email` (Task 4). The auth URL always sends `access_type=offline&prompt=consent`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared-types/src/index.ts` | `MAILBOX_KINDS`, `MailboxKind`, `MAILBOX_STATUSES`, `IMailboxView`, `MAILBOX_DEFAULT_DAILY_LIMIT = 500`, `MAILBOX_MAX_DAILY_LIMIT = 2000`, `ILeadOutreachError`, `OUTREACH_ERROR_CODES`, the new error codes. `EMAIL_PROVIDER_NOT_CONFIGURED` removed |
| `packages/validation/src/mailbox.ts` (new, exported from the index) | `ConnectSmtpMailboxSchema`, `UpdateMailboxSchema`, `GoogleTokenResponseSchema`, `GoogleIdTokenClaimsSchema`, `LeadOutreachErrorSchema` |
| `packages/db/src/models/Mailbox.model.ts` (new) | `Mailbox` model, unique `tenantId`, `secret` with `select: false`, `toJSON` without the secret |
| `packages/db/src/mailbox-secret.ts` (new) | `encryptSecret`, `decryptSecret`, `parseEncryptionKey`, `redactSecret` |
| `packages/db/src/approve-outreach.ts` | `revertOutreachApproval(leadId, options?)` gains `outreachError`, and `approveOutreachWithCampaign` clears `Lead.outreachError` |
| `packages/db/src/models/Lead.model.ts` | `outreachError` subdocument |
| `apps/api/src/data/tenant-scope.ts` | `mailboxes` repository |
| `apps/api/src/services/mailbox.service.ts` (new) | `mailboxView`, `connectSmtpMailbox`, `verifySmtp`, `requireUsableMailbox` |
| `apps/api/src/services/gmail-oauth.ts` (new) | `signOAuthState`, `readOAuthState`, `gmailAuthUrl`, `exchangeGmailCode` |
| `apps/api/src/routes/mailbox.routes.ts` (new, mounted at `/organization/mailbox`) | owner writes |
| `apps/api/src/routes/oauth.routes.ts` (new, mounted public at `/oauth`) | Google callback |
| `apps/api/src/routes/outreach.routes.ts` | `GET /sender`, and the mailbox checks on approve and test |
| `apps/workers/src/services/mailbox-transport.ts` (new) | `MailboxTransport`, `SmtpTransport`, `GmailTransport`, `MailboxAuthError`, `loadStudioMailbox` |
| `apps/workers/src/services/email.service.ts` | compliance wrapping only; it takes a transport and a from |
| `apps/workers/src/workers/email.worker.ts`, `email-test.worker.ts` | studio mailbox, daily limit, auth failure handling |
| `apps/dashboard/src/api/client.ts`, `hooks/useMailbox.ts` (new), `components/settings/MailboxSection.tsx` (new), `pages/SettingsPage.tsx`, `components/leadReview/ReviewActionBar.tsx`, locales | UI |
| env/config: `apps/*/src/config/env.ts`, `.env.example`, `.env.production.example`, `scripts/lib/dev-stack.mjs`, `docker-compose.full.yml`, `docker-compose.prod.yml`, `deploy/prepare-secrets.sh`, `scripts/verify-production-env.ts` | keys and secrets |

---

### Task 1: Shared types, validation schemas, Mailbox model, secret crypto

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Create: `packages/validation/src/mailbox.ts` and its export in `packages/validation/src/index.ts`
- Create: `packages/db/src/models/Mailbox.model.ts` and `packages/db/src/mailbox-secret.ts`, with exports in `packages/db/src/index.ts`
- Modify: `packages/db/src/models/Lead.model.ts`, `packages/db/src/approve-outreach.ts`
- Test: `packages/validation/src/__tests__/mailbox.spec.ts` (follow the existing test folder of the package), `packages/db/__tests__/mailbox-secret.spec.ts`, `packages/db/__tests__/models.spec.ts`, `packages/db/src/__tests__/real-mongo.spec.ts`

**Interfaces (Produces):**
```ts
// shared-types
export const MAILBOX_KINDS = ['gmail', 'smtp'] as const; export type MailboxKind = (typeof MAILBOX_KINDS)[number];
export const MAILBOX_STATUSES = ['CONNECTED', 'NEEDS_RECONNECT'] as const; export type MailboxStatus = ...;
export const MAILBOX_DEFAULT_DAILY_LIMIT = 500; export const MAILBOX_MAX_DAILY_LIMIT = 2000;
export interface IMailboxView { connected: boolean; kind?: MailboxKind; address?: string; displayName?: string;
  status?: MailboxStatus; lastError?: string; dailyLimit?: number; sentLast24h?: number; gmailAvailable: boolean;
  smtp?: { host: string; port: number; secure: boolean; user: string } }   // never a password or token
export const OUTREACH_ERROR_CODES = ['MAILBOX_NOT_CONNECTED', 'MAILBOX_NEEDS_RECONNECT', 'MAILBOX_AUTH_FAILED'] as const;
export interface ILeadOutreachError { code: (typeof OUTREACH_ERROR_CODES)[number]; message: string; at: string | Date }
// ILead gains: outreachError?: ILeadOutreachError
// API_ERROR_CODES: + MAILBOX_NOT_CONNECTED, MAILBOX_NEEDS_RECONNECT, MAILBOX_VERIFY_FAILED, GMAIL_OAUTH_NOT_CONFIGURED,
//   MAILBOX_OAUTH_FAILED; − EMAIL_PROVIDER_NOT_CONFIGURED (and delete the EMAIL_PROVIDER_NOT_CONFIGURED constant)

// validation
ConnectSmtpMailboxSchema: { host: string 1..253 trimmed, port: int 1..65535, secure: boolean default (port === 465),
  user: string 1..320, password: string 1..1024 (not trimmed), address: email lowercased, displayName?: string 1..100 trimmed }
UpdateMailboxSchema: { dailyLimit?: int 1..MAILBOX_MAX_DAILY_LIMIT, displayName?: string 1..100 } with at least one key
GoogleTokenResponseSchema: { access_token: string, expires_in: number, refresh_token?: string, id_token?: string, scope: string, token_type: 'Bearer' }
GoogleIdTokenClaimsSchema: { email: email, email_verified: literal(true) }
LeadOutreachErrorSchema: { code: enum(OUTREACH_ERROR_CODES), message: string 1..500, at: date }

// db
export interface EncryptedSecret { iv: string; tag: string; data: string }   // base64 each
export function parseEncryptionKey(raw: string | undefined): Buffer            // throws unless exactly 32 bytes after base64 decode
export function encryptSecret(plain: string, key: Buffer): EncryptedSecret     // AES-256-GCM, random 12-byte iv
export function decryptSecret(secret: EncryptedSecret, key: Buffer): string    // throws on a wrong key or tampering
export function redactSecret(text: string, secrets: string[]): string          // replaces each non-empty secret with '[redacted]'
export interface IMailboxDocument extends Document { tenantId: Types.ObjectId; kind: MailboxKind; address: string;
  displayName: string; status: MailboxStatus; lastError?: string; dailyLimit: number;
  smtp?: { host: string; port: number; secure: boolean; user: string }; secret: EncryptedSecret;
  connectedBy: Types.ObjectId; connectedAt: Date; createdAt: Date; updatedAt: Date }
export const Mailbox: Model<IMailboxDocument>   // collection 'mailboxes'
export async function revertOutreachApproval(leadId: string, options?: { outreachError?: ILeadOutreachError }): Promise<boolean>
```

- [ ] **Step 1: Write failing tests**
  - `mailbox.spec.ts` (validation): an SMTP body with port 465 and no `secure` parses to `secure: true`, and 587 parses to `false`. Port 0 and port 70000 fail. Bad email fails. `password: '  pw  '` keeps its spaces. `address` is lowercased. `UpdateMailboxSchema` accepts `{dailyLimit: 2000}` and rejects 0, 2001, 1.5 and `{}`. `GoogleIdTokenClaimsSchema` rejects `email_verified: false`. `LeadOutreachErrorSchema` rejects an unknown code.
  - `mailbox-secret.spec.ts`: round trip. Two encryptions of the same text differ (`iv`). Decrypting with another key throws. A flipped `data` byte throws. `parseEncryptionKey` rejects `undefined`, 16 bytes and non-base64, and accepts `randomBytes(32).toString('base64')`. `redactSecret('535 bad pw hunter2', ['hunter2', ''])` returns `'535 bad pw [redacted]'`.
  - `models.spec.ts`: `new Mailbox({...}).toJSON()` has no `secret` key. `Mailbox.schema.path('secret').options.select === false`. `dailyLimit` defaults to 500. `Lead` accepts `outreachError` and rejects an unknown code via the enum.
  - `real-mongo.spec.ts`: a second `Mailbox` for the same `tenantId` is E11000. `revertOutreachApproval(id, { outreachError })` on a SCHEDULED lead sets the lead to NEEDS_APPROVAL with `outreachError.code`. `approveOutreachWithCampaign` on a lead with `outreachError` clears it (`$unset`).
- [ ] **Step 2:** Run `npx vitest run packages/validation packages/db` from the repo root. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement to the interfaces above. `Lead.outreachError` is a subdocument `{ code: enum OUTREACH_ERROR_CODES, message: String maxlength 500, at: Date }` with `_id: false`. Validate it with `LeadOutreachErrorSchema` inside `revertOutreachApproval` before writing (packages/db AGENTS rule for structured values). `approveOutreachWithCampaign` adds `$unset: { outreachError: '' }` to its lead update.
- [ ] **Step 4:** Run `npm run build:packages && npx vitest run packages`. Expected: PASS. (The dictionary rows for `mailboxes.*` and `leads.outreachError` go into `../Revamp-docs` after the merge; list them under `Docs to update`.)
- [ ] **Step 5:** Commit `feat(REV-221): mailbox model, encrypted secret and outreach error`.

### Task 2: Environment, secrets plumbing, removal of the platform provider config

**Files:**
- Modify: `apps/api/src/config/env.ts`, `apps/workers/src/config/env.ts`, `.env.example`, `.env.production.example`, `scripts/lib/dev-stack.mjs`, `docker-compose.full.yml`, `docker-compose.prod.yml`, `deploy/prepare-secrets.sh`, `scripts/verify-production-env.ts`, `apps/workers/src/services/provider-config.ts`
- Test: `scripts/__tests__/dev-stack.spec.ts`, `deploy/__tests__/deployment.spec.ts`, `apps/workers/src/services/__tests__/provider-config.spec.ts`, plus env tests if present

**Interfaces (Produces):**
```ts
// both env schemas: MAILBOX_ENCRYPTION_KEY: z.string() refined by parseEncryptionKey (message names the variable)
// api only:  GOOGLE_OAUTH_CLIENT_ID?: string, GOOGLE_OAUTH_CLIENT_SECRET?: string (empty → undefined, like EMAIL_PROVIDER did),
//            GOOGLE_OAUTH_REDIRECT_URI: string default `${PUBLIC_API_URL}/oauth/google/callback`,
//            DASHBOARD_URL: string url default 'http://localhost:5173', MAILBOX_VERIFY_TIMEOUT_MS: number default 10000
// workers:   GOOGLE_OAUTH_CLIENT_ID?, GOOGLE_OAUTH_CLIENT_SECRET? (to refresh tokens)
// both: remove EMAIL_FROM, EMAIL_PROVIDER, RESEND_API_KEY, SENDGRID_API_KEY, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
// dev-stack.mjs: export function ensureMailboxKey(root): boolean   // like ensureJwtSecret; randomBytes(32).toString('base64')
```

- [ ] **Step 1: Write failing tests**
  - `dev-stack.spec.ts`: `ensureMailboxKey` adds `MAILBOX_ENCRYPTION_KEY` (44 chars, decodes to 32 bytes) when it is missing or invalid, leaves a valid one unchanged, and returns `false` then. `writeStackSecretFiles` writes `mailbox_encryption_key` and `google_oauth_client_secret` (empty file when unset). The REV-95 `.env` fixtures no longer mention `EMAIL_FROM`.
  - `deployment.spec.ts`: `.env.production.example` contains `MAILBOX_ENCRYPTION_KEY=`, `GOOGLE_OAUTH_CLIENT_ID=`, `GOOGLE_OAUTH_CLIENT_SECRET=` and `DASHBOARD_URL=`, and does not contain `RESEND_API_KEY`. `prepare-secrets.sh` `SECRET_KEYS` includes `MAILBOX_ENCRYPTION_KEY` and `GOOGLE_OAUTH_CLIENT_SECRET`. `docker-compose.prod.yml` and `docker-compose.full.yml` mount both secrets on api and workers and set the `_FILE` variables.
  - `provider-config.spec.ts`: no email warning at all (the mailbox is per studio). Remove the old email-warning case and assert that `providerConfigWarnings({})` has no item matching `/email/i`.
- [ ] **Step 2:** Run the three specs. Expected: FAIL.
- [ ] **Step 3:** Implement. Call `ensureMailboxKey` in setup next to `ensureJwtSecret` (log `Generated MAILBOX_ENCRYPTION_KEY in .env`). In `verify-production-env.ts`, replace the Resend/SendGrid check with: `MAILBOX_ENCRYPTION_KEY` decodes to 32 bytes (ERROR otherwise), and the Google client is set (WARNING otherwise: "Gmail connect unavailable; SMTP still works"). Remove the `EMAIL_PROVIDER` field from `ProviderConfigInputs`.
- [ ] **Step 4:** Rerun. Expected: PASS. Give the worktree's `.env` a key by calling `ensureMailboxKey` (don't edit the main checkout's `.env`; report that it needs `npm run setup` after the merge, which adds the key without touching other lines).
- [ ] **Step 5:** Commit `feat(REV-221): mailbox encryption key and Google client config; drop platform email provider settings`.

Compile errors in code that still reads the removed env keys are expected until Tasks 3 and 5. Keep those tasks in the same run, and run the full gates only at the end of Task 5.

### Task 3: API: tenant scope, mailbox service, SMTP connect, sender view, approve/test checks

**Files:**
- Modify: `apps/api/src/data/tenant-scope.ts`, `apps/api/src/__tests__/tenant-guard.ts` (`GUARDED` += `'Mailbox'`), `apps/api/src/routes/index.ts`, `apps/api/src/routes/outreach.routes.ts`, `apps/api/package.json` (+ `nodemailer`, `@types/nodemailer` at the workers' versions), `apps/api/src/models/` (re-export `Mailbox` like the others)
- Create: `apps/api/src/services/mailbox.service.ts`, `apps/api/src/routes/mailbox.routes.ts`
- Test: `apps/api/src/services/__tests__/mailbox.service.spec.ts`, `apps/api/src/routes/__tests__/mailbox.routes.spec.ts`, `api.routes.spec.ts` (outreach cases), `route-auth.spec.ts`, `tenant-isolation.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`Mailbox`, `encryptSecret`, `parseEncryptionKey`, `redactSecret`, schemas, `IMailboxView`), Task 2 env.
- Produces:
```ts
// tenant-scope: TenantScope.mailboxes: Repository<IMailboxDocument>
// mailbox.service.ts
export async function mailboxView(scope: TenantScope): Promise<IMailboxView>   // sentLast24h = scope.campaigns.countDocuments({status:'DELIVERED', senderEmail: address, sentAt: {$gte: now-24h}}); gmailAvailable from env
export async function verifySmtp(input: ConnectSmtpMailbox, timeoutMs?: number): Promise<void>  // throws AppError 422 MAILBOX_VERIFY_FAILED, message redacted
export async function connectSmtpMailbox(scope: TenantScope, input: ConnectSmtpMailbox, userId: string, studioName: string): Promise<IMailboxView>
export async function saveMailbox(scope: TenantScope, fields: { kind; address; displayName; smtp?; secretPlain: string }, userId: string): Promise<void>
  // upsert on {} in scope, status CONNECTED, lastError unset, connectedAt now; dailyLimit kept if present else default (via $setOnInsert)
export async function requireUsableMailbox(scope: TenantScope): Promise<IMailboxDocument>  // 409 MAILBOX_NOT_CONNECTED / MAILBOX_NEEDS_RECONNECT
```
- Routes, `mailbox.routes.ts` (mounted `router.use('/organization/mailbox', requireAuth, requireOwner, mailboxRoutes)` **before** `/organization`):
  `PUT /smtp` (body `ConnectSmtpMailboxSchema`) → 200 `{success, data: IMailboxView}`. `PATCH /` (`UpdateMailboxSchema`) → 200 view, 409 `MAILBOX_NOT_CONNECTED` when there is none. `DELETE /` → 200 `{success, data: {connected:false, gmailAvailable}}`, idempotent. `POST /gmail/start` is added in Task 4.
- `GET /outreach/sender` → 200 `{success, data: IMailboxView}` for every role.
- Approve: after the `NO_CONTACT_EMAIL` check, `const mailbox = await requireUsableMailbox(req.tenant!)`, and `senderEmail: mailbox.address` replaces `env.EMAIL_FROM`. The test send replaces the `EMAIL_PROVIDER` check with `requireUsableMailbox`. A worker failure reason that starts with an outreach error code maps to that 409 code; otherwise it stays 502 `EMAIL_SEND_FAILED`.

- [ ] **Step 1: Write failing tests**
  - `mailbox.service.spec.ts` (nodemailer mocked): `verifySmtp` passes host, port, secure and auth to `createTransport`, and rejects after `timeoutMs` with `MAILBOX_VERIFY_FAILED`. An `EAUTH` error whose message contains the password produces an AppError whose message and `details` do not contain the password. `mailboxView` never has `secret` or a password key (`JSON.stringify(view)` does not contain the plain secret).
  - `mailbox.routes.spec.ts` (real-MongoDB pattern of `tenant-isolation.spec.ts`, queues mocked):
    - `PUT /organization/mailbox/smtp` stores an encrypted secret (`Mailbox.findOne().select('+secret')`: `decryptSecret` returns the password), the response body string does not contain the password, and `console.*` spies saw no call containing it.
    - Invalid body → 400.
    - `MAILBOX_VERIFY_FAILED never echoes the password`.
    - The operator gets 403 on PUT, PATCH and DELETE. The viewer gets 200 on `GET /outreach/sender`.
    - Studio B's `GET /outreach/sender` shows `connected:false` while studio A is connected.
    - PATCH `{dailyLimit: 2000}` → 200. DELETE removes it and is idempotent.
  - `api.routes.spec.ts`:
    - approve without a mailbox → 409 `MAILBOX_NOT_CONNECTED`, `addEmailDispatchJob` not called, lead still NEEDS_APPROVAL.
    - With `NEEDS_RECONNECT` → 409 `MAILBOX_NEEDS_RECONNECT`.
    - With a mailbox, the campaign `senderEmail` is the mailbox address.
    - Test send without a mailbox → 409 `MAILBOX_NOT_CONNECTED` and no job.
    - Remove the `EMAIL_PROVIDER_NOT_CONFIGURED` cases.
  - `route-auth.spec.ts`: the new routes are covered by its walk (owner-only for `/organization/*` already, so no list change for them).
  - `tenant-isolation.spec.ts`: classify `PUT /organization/mailbox/smtp`, `PATCH /organization/mailbox`, `DELETE /organization/mailbox` and `GET /outreach/sender` as `TENANT_OWNED`, with a wrong-studio test: studio B's DELETE does not remove studio A's mailbox.
  - `tenant-guard.spec.ts`: add `'await Mailbox.findOne({});'` to `planted`.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: new tests FAIL.
- [ ] **Step 3:** Implement. Read `parseEncryptionKey(env.MAILBOX_ENCRYPTION_KEY)` once at module load. The studio name for `displayName` comes from `Organization.findById(req.auth.organizationId)` (not tenant-owned, so this is allowed). Never pass `input` or the transporter options to `console`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): connect an SMTP mailbox per studio; approval and test send require it`.

### Task 4: Gmail OAuth: start, callback, token exchange

**Files:**
- Create: `apps/api/src/services/gmail-oauth.ts`, `apps/api/src/routes/oauth.routes.ts`
- Modify: `apps/api/src/routes/mailbox.routes.ts` (`POST /gmail/start`), `apps/api/src/routes/index.ts` (`router.use('/oauth', oauthRoutes)`, public, with a comment)
- Test: `apps/api/src/services/__tests__/gmail-oauth.spec.ts`, `apps/api/src/routes/__tests__/oauth.routes.spec.ts`, `route-auth.spec.ts` (`PUBLIC_ROUTES` += `GET /oauth/google/callback`), `tenant-isolation.spec.ts` (`PUBLIC_BY_SECRET` += it)

**Interfaces:**
```ts
export const GMAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send'];
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export function signOAuthState(p: { organizationId: string; userId: string }, now?: number): string   // base64url(json).base64url(hmac)
export function readOAuthState(state: string, now?: number): { organizationId: string; userId: string } | null  // null: bad mac (timingSafeEqual), purpose, expiry, shape
export function gmailAuthUrl(state: string): string   // accounts.google.com/o/oauth2/v2/auth with client_id, redirect_uri, response_type=code, scope, access_type=offline, prompt=consent, include_granted_scopes=false, state
export async function exchangeGmailCode(code: string, fetchImpl?: typeof fetch): Promise<{ address: string; refreshToken: string }>
  // POST https://oauth2.googleapis.com/token (form); GoogleTokenResponseSchema; requires refresh_token, scope containing gmail.send, id_token;
  // claims = base64url-decoded id_token payload (direct TLS response from Google's token endpoint, OIDC §3.1.3.7 allows skipping the signature) → GoogleIdTokenClaimsSchema
  // any failure throws Error('MAILBOX_OAUTH_FAILED: <short reason>') without the code or tokens in it
```
- `POST /organization/mailbox/gmail/start` → 503 `GMAIL_OAUTH_NOT_CONFIGURED` without client id and secret, else 200 `{success, data: {url}}`.
- `GET /oauth/google/callback?code&state` (or `?error=access_denied&state`): `readOAuthState`, then check that the membership `{userId, organizationId}` is `owner` (`Membership` from `@revamp/db`), then `exchangeGmailCode`, then `saveMailbox(scopeFor(organizationId), {kind:'gmail', address, displayName: studio name, secretPlain: refreshToken}, userId)`, then `302 ${DASHBOARD_URL}/settings?mailbox=connected`. Any failure → `302 …?mailbox=error&reason=MAILBOX_OAUTH_FAILED` (or `GMAIL_OAUTH_NOT_CONFIGURED`), with a `console.warn` naming only the reason (never the code, state or tokens). The route never writes JSON errors: it always redirects.

- [ ] **Step 1: Write failing tests**
  - `gmail-oauth.spec.ts`:
    - A state round trip works. A tampered mac, a tampered payload, `now + 10 min + 1 ms` and another `purpose` each give `null`.
    - The URL contains each scope, `access_type=offline` and `prompt=consent`.
    - `exchangeGmailCode` with a mocked fetch returns the address and refresh token.
    - `refuses a token response without refresh_token`, `refuses an unverified email`, refuses a scope without `gmail.send`, and refuses a 400 from Google. None of the thrown messages contains the code or the tokens.
  - `oauth.routes.spec.ts` (real Mongo, fetch mocked):
    - A valid state for an owner stores a gmail mailbox (decrypted secret = refresh token) and redirects to `…?mailbox=connected`.
    - An operator's state, an expired state, `error=access_denied` and an exchange failure each redirect with `reason=MAILBOX_OAUTH_FAILED` and write nothing.
    - No auth header is needed.
    - Studio A's state never writes studio B's mailbox.
  - `mailbox.routes.spec.ts`: `/gmail/start` → 503 without config, and 200 with a url when the env is stubbed.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): connect a Gmail mailbox through Google OAuth`.

### Task 5: Workers: transports, studio mailbox, daily limit, auth failures

**Files:**
- Create: `apps/workers/src/services/mailbox-transport.ts`
- Modify: `apps/workers/src/services/email.service.ts`, `apps/workers/src/workers/email.worker.ts`, `apps/workers/src/workers/email-test.worker.ts`, `apps/workers/src/models/` (re-export `Mailbox`)
- Test: `apps/workers/src/services/__tests__/mailbox-transport.spec.ts`, `email.service.spec.ts`, `apps/workers/src/workers/__tests__/email.worker.spec.ts` (create if it does not exist, following `email-test.worker.spec.ts`), `email-test.worker.spec.ts`

**Interfaces:**
```ts
export interface OutgoingMessage { from: string; to: string; subject: string; html: string; text: string; headers: Record<string, string> }
export interface MailboxTransport { kind: MailboxKind; send(m: OutgoingMessage): Promise<{ messageId: string }> }
export class MailboxAuthError extends Error {}   // the mailbox refused our credentials; message already redacted
export class SmtpTransport implements MailboxTransport   // ctor(cfg: {host,port,secure,user,password}, createTransport = nodemailer.createTransport); EAUTH or responseCode 535/534 → MailboxAuthError
export class GmailTransport implements MailboxTransport  // ctor(refreshToken, fetchImpl = fetch); refresh at oauth2.googleapis.com/token (400 invalid_grant → MailboxAuthError);
  // raw MIME via nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' }).sendMail(m) → info.message;
  // POST gmail.googleapis.com/gmail/v1/users/me/messages/send {raw: base64url}; 401/403 → MailboxAuthError; other non-2xx → Error (retry)
export interface StudioMailbox { address: string; from: string; dailyLimit: number; transport: MailboxTransport }
export type StudioMailboxResult = { ok: true; mailbox: StudioMailbox } | { ok: false; code: 'MAILBOX_NOT_CONNECTED' | 'MAILBOX_NEEDS_RECONNECT'; message: string }
export async function loadStudioMailbox(tenant: Types.ObjectId): Promise<StudioMailboxResult>   // Mailbox.findOne(withTenant(tenant, {})).select('+secret'); decrypt with parseEncryptionKey(env.MAILBOX_ENCRYPTION_KEY)
export async function markMailboxNeedsReconnect(tenant: Types.ObjectId, reason: string): Promise<void>
// email.service.ts
export class EmailService { sendEmail(transport: MailboxTransport, options: ISendEmailOptions & { from: string }): Promise<ISendEmailResult> }  // same compliance headers, footer and pixel as today; provider field = transport.kind
```
- `email.worker.ts` flow (the existing order is kept, and the new steps are marked):
  1. Lead, tenant, HITL gate, campaign and DELIVERED short-circuit, as today.
  2. **NEW: `loadStudioMailbox(tenant)`.** If not ok, call `returnToReview(code, message)` and return `{ success:false, aborted:true, reason }`.
  3. MX check, as today.
  4. **NEW: daily limit.** `count` = DELIVERED campaigns with `withTenant`, `senderEmail === mailbox.address` and `sentAt >= now-24h`. If `count >= dailyLimit`, find the oldest such `sentAt`, call `await job.moveToDelayed(oldest + 24h + 1000, token)` and `throw new DelayedError()`. The processor signature becomes `(job, token)`.
  5. Claim, as today.
  6. Send: `emailService.sendEmail(mailbox.transport, { from: mailbox.from, … })`. On `MailboxAuthError`: release the claim to SCHEDULED, `markMailboxNeedsReconnect(tenant, err.message)`, `returnToReview('MAILBOX_AUTH_FAILED', err.message)`, then `throw new UnrecoverableError(err.message)`. Any other error behaves as today (release, rethrow, retry).
  7. DELIVERED with `sentAt` **and `senderEmail: mailbox.address`**. Lead SENT, as today.
  - `returnToReview(code, message)` = `revertOutreachApproval(leadId, { outreachError: { code, message, at: new Date() } })`.
- `email-test.worker.ts`: `loadStudioMailbox(jobTenant(data.tenantId))`. If not ok, `throw new Error(\`${code}: ${message}\`)` (the API maps the prefix, Task 3). On a `MailboxAuthError`, call `markMailboxNeedsReconnect` and then throw `MAILBOX_AUTH_FAILED: …`.
- Logs: name the mailbox `kind` and `address` only.

- [ ] **Step 1: Write failing tests**
  - `mailbox-transport.spec.ts`:
    - `SmtpTransport` maps `{code:'EAUTH'}` to `MailboxAuthError` with the password redacted, and passes other errors through.
    - `GmailTransport` refreshes, then POSTs base64url raw whose decoded text contains `From: "Studio" <a@studio.test>`, `Subject:` and `List-Unsubscribe:`.
    - Refresh `400 {error:'invalid_grant'}` gives `MailboxAuthError`. Send 401 gives `MailboxAuthError`. Send 500 gives a plain Error.
    - `loadStudioMailbox` returns `MAILBOX_NOT_CONNECTED` for none and `MAILBOX_NEEDS_RECONNECT` for that status, and for another studio's tenant returns not connected (the query has `tenantId`).
  - `email.service.spec.ts`: adapt to `sendEmail(transport, …)`. The compliance header, footer and pixel assertions stay. Remove the Resend/SendGrid and no-provider cases.
  - `email.worker.spec.ts`:
    - `sends through the lead's studio mailbox with its From`: the transport mock got `from` = studio A's, and the campaign `senderEmail` = studio A's address.
    - `never uses another studio's mailbox`: the `Mailbox.findOne` filter contains the job tenant.
    - `returns the lead to review when the mailbox was disconnected after approval`: lead NEEDS_APPROVAL, `outreachError.code === 'MAILBOX_NOT_CONNECTED'`, transport not called.
    - `sends from the mailbox address current at send time`.
    - `delays the job to the end of the window when the mailbox is at its daily limit`.
    - `a revoked Gmail token fails the campaign with a reason and the lead does not move to SENT`: `UnrecoverableError`, mailbox NEEDS_RECONNECT, lead NEEDS_APPROVAL with `MAILBOX_AUTH_FAILED`, campaign not DELIVERED.
    - A transient error releases the claim and rethrows (retry), and `outreachError` is not set.
    - The existing HITL and tenant-mismatch cases stay green.
  - `email-test.worker.spec.ts`: uses the studio mailbox. With no mailbox it throws `MAILBOX_NOT_CONNECTED: …`.
- [ ] **Step 2:** Run `npx vitest run apps/workers/src/services apps/workers/src/workers` from the root. Expected: FAIL.
- [ ] **Step 3:** Implement. Delete `ResendEmailProvider`, `SendGridEmailProvider`, `createEmailProvider`, `IEmailProvider` and `setProvider`/`getProvider`.
- [ ] **Step 4:** Rerun, then run the full gates: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. Expected: all green, and `grep -rnE "EMAIL_PROVIDER|EMAIL_FROM|RESEND_API_KEY|SENDGRID_API_KEY" apps packages scripts deploy --include='*.ts' --include='*.mjs' --include='*.yml' --include='*.sh'` finds nothing outside the docs.
- [ ] **Step 5:** Commit `feat(REV-221): workers send through the studio mailbox with a daily limit and visible auth failures`.

### Task 6: Dashboard: mailbox settings, review gate, error texts

**Files:**
- Modify: `apps/dashboard/src/api/client.ts` (`mailboxApi`), `apps/dashboard/src/pages/SettingsPage.tsx`, `apps/dashboard/src/components/leadReview/ReviewActionBar.tsx`, `apps/dashboard/src/i18n/locales/{en,ru,be,pl,lt}.ts`
- Create: `apps/dashboard/src/hooks/useMailbox.ts`, `apps/dashboard/src/components/settings/MailboxSection.tsx`
- Test: `apps/dashboard/src/api/__tests__/client.spec.ts`, `apps/dashboard/src/hooks/__tests__/useMailbox.spec.ts`, `apps/dashboard/src/components/settings/__tests__/MailboxSection.spec.ts`, `apps/dashboard/src/components/leadReview/__tests__/ReviewActionBar.spec.ts` (extend the existing one), the locale parity test

**Interfaces:**
```ts
export const mailboxApi = {
  sender(): Promise<IMailboxView>,                                   // GET /outreach/sender
  connectSmtp(body: ConnectSmtpMailbox): Promise<IMailboxView>,      // PUT /organization/mailbox/smtp
  update(body: UpdateMailbox): Promise<IMailboxView>,                // PATCH
  disconnect(): Promise<IMailboxView>,                               // DELETE
  startGmail(): Promise<{ url: string }>,                            // POST /organization/mailbox/gmail/start
};
// useMailbox.ts
export const MAILBOX_QUERY_KEY = ['mailbox'] as const;
export function useMailboxQuery(); export function useConnectSmtpMutation(); export function useUpdateMailboxMutation();
export function useDisconnectMailboxMutation(); export function useStartGmailMutation();  // onSuccess: window.location.assign(url)
// each mutation writes the returned view into MAILBOX_QUERY_KEY
```
- `MailboxSection` (in Settings, below the existing sections, `aria-label` = section title). Every role sees the status: address, kind, status chip, `sentLast24h / dailyLimit`, and `lastError` when `NEEDS_RECONNECT`. Only the owner (`useAuthStore` role) sees:
  - "Connect Gmail", disabled with a hint when `gmailAvailable` is false;
  - the SMTP form (host, port, security switch, user, password `type=password`, from address, display name), validated with `ConnectSmtpMailboxSchema` before the request;
  - a daily limit field;
  - Disconnect, with a confirm dialog.

  Others see "Only the studio owner can connect the mailbox." On mount, `?mailbox=connected|error&reason=` from the URL shows a success or error Alert. Then remove the params with `setSearchParams` (`replace: true`).
- `ReviewActionBar`:
  - It reads `useMailboxQuery()`. When the mailbox is not connected or `NEEDS_RECONNECT`, Approve and "Send test" are disabled and an `Alert severity="warning"` shows `email.mailbox.notConnected` / `needsReconnect`, with a `Link` to `ROUTES.settings` (owner) or `email.mailbox.askOwner` (others).
  - When `lead.outreachError` exists and the lead is `NEEDS_APPROVAL`, an `Alert severity="error"` shows `email.outreachError.<code>` with the message.
  - `runAction` maps `ApiError` codes `MAILBOX_NOT_CONNECTED` and `MAILBOX_NEEDS_RECONNECT` to the same texts and invalidates `MAILBOX_QUERY_KEY`.
  - The approve path and its shortcut are unchanged otherwise.
- Locale keys (all five): `settings.mailbox.{title,connectGmail,gmailUnavailable,smtpTitle,host,port,secure,user,password,address,displayName,save,dailyLimit,sentToday,disconnect,disconnectConfirm,ownerOnly,connected,error,statusConnected,statusNeedsReconnect}`, `email.mailbox.{notConnected,needsReconnect,askOwner,openSettings}`, `email.outreachError.{MAILBOX_NOT_CONNECTED,MAILBOX_NEEDS_RECONNECT,MAILBOX_AUTH_FAILED}`. Remove any `EMAIL_PROVIDER_NOT_CONFIGURED` text.

- [ ] **Step 1: Write failing tests**
  - `client.spec.ts`: each `mailboxApi` call hits its method and path, and `ApiError` carries `MAILBOX_NOT_CONNECTED`.
  - `useMailbox.spec.ts`: a connect mutation writes the view into the cache, disconnect sets `connected:false`, and `startGmail` calls `window.location.assign` with the url.
  - `MailboxSection.spec.ts` (createElement, happy-dom):
    - The owner sees the SMTP form and the viewer does not.
    - With `gmailAvailable:false` the Gmail button is disabled.
    - An invalid port blocks submit, with no request.
    - `?mailbox=connected` shows the success alert and clears the param.
    - The password value never appears in the rendered DOM after save (the form resets it).
  - `ReviewActionBar.spec.ts`:
    - With `connected:false`, Approve is disabled and the warning has a settings link for the owner.
    - `outreachError` renders its text.
    - An approve that rejects with `MAILBOX_NOT_CONNECTED` shows the localized text and not the raw message.
- [ ] **Step 2:** Run `npx vitest run apps/dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement with theme tokens only.
- [ ] **Step 4:** Rerun plus the locale parity test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): dashboard connects the studio mailbox and gates approval on it`.

### Task 7: Docs in this repository, gates, end to end

**Files:** `README.md`, `AGENTS.md` (root §3.2: a new item "Studio mailbox (REV-221)" with one line on the rules: mailbox per studio, secret encrypted and never returned or logged, worker reads it at send time), `apps/api/AGENTS.md` (mailbox routes, public OAuth callback, `requireUsableMailbox` in approve and test), `apps/workers/AGENTS.md` (transports, daily limit via `DelayedError`, auth failure → review with `outreachError`), `apps/dashboard/AGENTS.md` (MailboxSection, review gate), `packages/db/AGENTS.md` (Mailbox model, `select:false` secret, `MAILBOX_ENCRYPTION_KEY`), `.env.example`

- [ ] **Step 1:** Remove every "interim" note listed by `grep -rnE "[Ii]nterim|REV-221" README.md AGENTS.md apps/*/AGENTS.md packages/*/AGENTS.md .env.example`. Describe the shipped design instead: env table rows for `MAILBOX_ENCRYPTION_KEY`, `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` and `DASHBOARD_URL`, plus the Google Cloud setup (OAuth client, redirect URI, `gmail.send` scope, test users while unverified). Remove the old provider rows.
- [ ] **Step 2:** Run the five gates. Expected: all green, 0 lint errors, no new warnings.
- [ ] **Step 3: E2E on an isolated stack** (memory `email-e2e-isolated-stack`: Redis DB 1, a separate Mongo DB `revamp_e2e_rev221`, API on :4100 with `CORS_ORIGIN=http://localhost:5174`, Vite on :5174, branch workers on Redis DB 1 only, and a Python socket SMTP sink on :2525 that records each message and answers 535 when the AUTH password is `wrong`).
  1. Register a studio, add a lead, and get it to NEEDS_APPROVAL. Approve: the dashboard shows the "connect a mailbox" warning and the API answers 409 `MAILBOX_NOT_CONNECTED`, with no job in `bull:email-queue` (`redis-cli -n 1 KEYS 'bull:email-queue:*'`).
  2. Settings → SMTP with password `wrong` → the error alert shows and no mailbox is stored. Connect with the right password → Connected. The network tab responses and the API/worker logs do not contain the password (`grep` the captured logs).
  3. Send a test → it arrives at the sink with `From: "<studio>" <address>`.
  4. Approve → the sink receives the email, its From is the studio's, the campaign `senderEmail` is that address, and the lead is SENT.
  5. Change the sink to answer 535 for the next send, then approve another lead → the lead is back in review with the auth-failure alert and the mailbox shows "Needs reconnect".
  6. Set `dailyLimit` to 1 with one DELIVERED in the window, then approve → the job is delayed (`redis-cli -n 1 ZRANGE bull:email-queue:delayed 0 -1 WITHSCORES`, score about `sentAt + 24h`).
  7. Gmail button: shows "not configured" without a Google client.
  Screenshot steps 1, 2, 4, 5 and 7. Expect no new console errors. Then drop `revamp_e2e_rev221`, flush Redis DB 1 and stop the extra processes.
- [ ] **Step 4:** Commit `docs(REV-221): studio mailbox replaces the platform email provider`.

Docs in `../Revamp-docs` (done by the orchestrator after the merge, listed here for the implementer's `Docs to update`):
- `blueprint.md`: lines ~52, ~93 and 1142–1143 (drop "interim"), §5 error codes (+5, −1), the `mailboxes` schema, and `email-queue` settings (daily limit, `DelayedError`).
- `spec.md`: the new endpoints and DTOs, and approve's 409s.
- `database-expertise.md`: `senderEmail` row (line 149) and the dictionary rows from Task 1.
- `milestones.md`: lines 20, 125 and 183.
- `api-docs/guides/concepts.md:24` and `tutorial-lead-to-outreach.md:116`.
- `README.md:71`, `:147` and `:216`.
- `ba-expertise.md`: nothing (US18 stays as written).
- Then `npm run docs:index`.
