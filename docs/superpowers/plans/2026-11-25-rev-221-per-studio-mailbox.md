# REV-221 Studio Sender and Simulated Outbox Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) as one run, task by task, TDD. Steps use checkbox (`- [ ]`) syntax. Report every deviation from this plan under `Plan deviations`.

**Goal:** Every studio sets its own sender (name and address). Approved outreach and test sends are rendered exactly as they would be sent, From that studio, and recorded in the campaign's outbox as **simulated**. No email leaves the platform. The platform-wide provider (Resend, SendGrid, SMTP, `EMAIL_FROM`) is removed.

**Architecture:** `Organization` gains a `sender` subdocument that the owner edits under `/organization/sender`. Every member reads it at `GET /outreach/sender`. Approve and test send refuse a studio without a sender (`409 SENDER_NOT_CONFIGURED`). The email worker keeps every gate it has today: HITL, tenant check, campaign claim, MX pre-check, and the compliance headers, footer and pixel. Instead of handing the message to a provider, it writes the rendered message to `EmailCampaign.outbox` with `deliveryMode: 'SIMULATED'`, marks the campaign DELIVERED and the lead SENT. The dashboard labels every such email "Simulated – not delivered" and shows it at `GET /outreach/:id/outbox` in a frame that loads nothing, so viewing it never counts as an open or a click.

**Tech Stack:** Node 20, TypeScript, Express, Mongoose, BullMQ, Zod, React 18 + MUI v6 + React Query, Vitest.

**Spec:** Linear REV-221, rescoped on 2026-11-25 by the user: an in-app simulated outbox; the lead goes to SENT with the campaign marked simulated; outbox only; each studio has its own sender. Gmail OAuth, SMTP credentials, encryption and daily limits are out. BA US18 (`../Revamp-docs/ba-expertise.md:254`) still holds for the sender identity. Read root `AGENTS.md`, `apps/api/AGENTS.md`, `apps/workers/AGENTS.md`, `apps/dashboard/AGENTS.md` and `packages/db/AGENTS.md` first.

## Rulings

1. **A written exception to REV-45** (root `AGENTS.md` §3.2.2): email delivery is simulated. It is the one allowed stand-in, it is always labelled (`deliveryMode: 'SIMULATED'` on the record, "Simulated – not delivered" in the UI), and no text may present it as delivered. Every other REV-45 rule is unchanged: no made-up leads, metrics or contacts.
2. **What a simulated send is:** all the checks of a real send run, then the final message is stored: `from` header, `to`, `subject`, compliance `headers`, final `html` (with the unsubscribe footer and the open pixel) and final `text`. Campaign → `DELIVERED` with `sentAt`, `senderEmail` and `senderName` from the studio sender **at send time**. Lead → `SENT`. The MX pre-check stays: it is a real DNS lookup and still bounces dead domains.
3. **Opens and clicks are never invented.** The outbox view loads the html with `sandbox=""`, a CSP `<meta>` (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`) and `<base target="_blank">`, so the pixel does not load and links cannot open: the sandbox blocks popups. Engagement statuses (`OPENED` and beyond) are reached only through the real `/track/*` routes, as today.
4. **Test send:** the same queue and worker render the message with the `[Test] ` prefix, without the pixel, and store nothing. The API answers `{ to, from, subject, simulated: true }`. The dashboard says "Test email simulated – not delivered".
5. **The sender cannot be removed, only changed** (`PUT` only, no `DELETE`). A campaign queued before this ships, whose studio has no sender, is returned to review by the worker through the existing `revertOutreachApproval`. The dashboard then shows the "set a sender" warning.
6. **The sender address is not verified.** Without delivery there is nothing to verify it with. It must be a valid email.
7. **Removed:** `ResendEmailProvider`, `SendGridEmailProvider`, `SmtpEmailProvider`, `createEmailProvider`, `IEmailProvider`, the `nodemailer` and `@types/nodemailer` dependencies of the workers, the env keys `EMAIL_PROVIDER`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `EMAIL_FROM` and `SMTP_HOST/PORT/USER/PASS`, the constant and error code `EMAIL_PROVIDER_NOT_CONFIGURED`, and the startup email warning.
8. **Unchanged:** the throttle (15–45 s jitter, one email per 180 s), approval transaction, revert, `EmailCampaign` statuses and the lead state machine.
9. **Demo seed:** `Demo Studio` gets the sender `Demo Studio <hello@demo-studio.test>`. Its DELIVERED campaigns get `deliveryMode: 'SIMULATED'` and an outbox built by the same render function (Task 1 `renderOutreachMessage`), so the seed matches runtime.

## Global Constraints

- HITL unchanged: only a `SCHEDULED` lead is processed into SENT (NFR7).
- Errors through `AppError` with codes from `API_ERROR_CODES`. Add `SENDER_NOT_CONFIGURED` (409) and `OUTBOX_NOT_FOUND` (404). Remove `EMAIL_PROVIDER_NOT_CONFIGURED`.
- Schemas only in `packages/db`; request bodies validated with `@revamp/validation`. No `Schema.Types.Mixed`: `outbox.headers` is a `Map` of `String`.
- Tenant isolation: the outbox route reads the campaign through `req.tenant.campaigns` (another studio's lead → `404 LEAD_NOT_FOUND`, the usual answer). Sender routes act on `req.auth.organizationId` only, never on an id from the request. The worker reads the studio's `Organization` by the job's checked tenant.
- New dashboard strings in all five locales (`en`, `ru`, `be`, `pl`, `lt`). Theme tokens only.
- Tests are `.spec.ts`, run from the repo root. Real-MongoDB tests go only in `packages/db/src/__tests__/real-mongo.spec.ts`.

## Review Focus

1. **The owner changes the sender after approval, before the job runs.** The email must carry the sender current at send time, and the campaign must record that one. Test: `email.worker.spec.ts › uses the studio sender current at send time` (Task 4).
2. **Opening the outbox in the dashboard must not move the lead to OPENED or CLICKED.** Test: `OutboxDialog.spec.ts › frame is sandboxed with no permissions and the srcdoc carries the CSP meta and base target` (Task 5). The API side has no route that writes on read, asserted in `api.routes.spec.ts › GET outbox writes nothing` (Task 3: the campaign's `updatedAt` and the lead status are unchanged).
3. **A sender name containing quotes, commas or non-ASCII** (`Studio "Kraków", Ltd`) must produce a valid From header. Test: `outreach-message.spec.ts › formats a From header with quotes and non-ASCII` (Task 1). Expected: `"Studio \"Kraków\", Ltd" <a@b.test>`, with the name quoted and inner quotes escaped.
4. **A retried job after the outbox write** must not write twice or change `sentAt`. The existing DELIVERED short-circuit covers it. Test: `email.worker.spec.ts › a retry of a delivered campaign leaves the outbox and sentAt as they were` (Task 4).
5. **A viewer or operator tries to change the sender.** They get 403 and nothing is written. Test: `route-auth.spec.ts` walk (owner-only `/organization/*`) plus `sender.routes.spec.ts › operator gets 403` (Task 3).

---

### Task 1: Types, schemas, models, the message renderer, seed

**Files:**
- Modify: `packages/shared-types/src/index.ts`, `packages/validation/src/index.ts` (or a new `packages/validation/src/sender.ts` exported from it), `packages/db/src/models/Organization.model.ts`, `packages/db/src/models/EmailCampaign.model.ts`, `packages/db/src/seed/demo-dataset.ts`
- Create: `packages/shared-types/src/outreach-message.ts` (exported from the index; pure, no Node APIs, so the seed and the workers share it)
- Test: the validation package's spec folder (`sender.spec.ts`), `packages/shared-types` spec folder (`outreach-message.spec.ts`), `packages/db/__tests__/models.spec.ts`, `packages/db/src/__tests__/demo-dataset.spec.ts`

**Interfaces (Produces):**
```ts
// shared-types
export interface IStudioSender { name: string; address: string }
export interface ISenderView { configured: boolean; name?: string; address?: string }
export const EMAIL_DELIVERY_MODES = ['SIMULATED'] as const; export type EmailDeliveryMode = (typeof EMAIL_DELIVERY_MODES)[number];
export interface IOutboxMessage { from: string; to: string; subject: string; headers: Record<string, string>; html: string; text: string }
export interface IOutboxView extends IOutboxMessage { deliveryMode: EmailDeliveryMode; sentAt: string }
export interface IEmailTestJobResult { to: string; from: string; subject: string; simulated: true }   // replaces messageId/provider/sentAt
// IEmailCampaign gains: senderName?: string; deliveryMode?: EmailDeliveryMode; outbox?: IOutboxMessage
// API_ERROR_CODES: + 'SENDER_NOT_CONFIGURED', 'OUTBOX_NOT_FOUND'; − 'EMAIL_PROVIDER_NOT_CONFIGURED' (and delete the constant)

// outreach-message.ts (moved out of the workers' EmailService.sendEmail, behavior identical)
export function formatFromHeader(sender: IStudioSender): string
export function renderOutreachMessage(input: { sender: IStudioSender; to: string; subject: string; html: string; text?: string;
  trackingToken: string; publicApiUrl: string; trackOpens?: boolean; unsubscribeEmail?: string }): IOutboxMessage
  // List-Unsubscribe + List-Unsubscribe-Post headers, footer in html and text, pixel unless trackOpens === false

// validation
export const StudioSenderSchema = z.object({ name: z.string().trim().min(1).max(100), address: z.string().trim().toLowerCase().email().max(320) });

// db
// Organization: sender?: { name: String maxlength 100, address: String lowercase }  (_id: false)
// EmailCampaign: senderName?: String; deliveryMode?: enum EMAIL_DELIVERY_MODES;
//   outbox?: { from, to, subject, html, text: String; headers: { type: Map, of: String } }  (_id: false)
```

- [ ] **Step 1: Write failing tests**
  - `sender.spec.ts`: a valid sender parses, and the address is lowercased and trimmed. An empty name, a 101-char name and an invalid address fail.
  - `outreach-message.spec.ts`:
    - `formats a From header with quotes and non-ASCII`.
    - The html has the footer link `${url}/track/unsubscribe/${token}` and the pixel `${url}/track/open/${token}.gif`, and `trackOpens: false` leaves the pixel out.
    - The footer goes before `</body>` when there is one.
    - The text ends with the unsubscribe line.
    - The headers equal `{ 'List-Unsubscribe': '<mailto:…?subject=unsubscribe>, <…>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }`.
    - The output matches what today's `email.service.spec.ts` asserts: port those assertions.
  - `models.spec.ts`: `Organization` accepts `sender` and lowercases the address. `EmailCampaign` accepts `deliveryMode: 'SIMULATED'` and rejects `'REAL'`. `outbox.headers` round-trips as a Map.
  - `demo-dataset.spec.ts`: the demo studio has a sender. Every DELIVERED demo campaign has `deliveryMode: 'SIMULATED'` and an outbox whose `from` is `formatFromHeader(demo sender)`. No demo record mentions `revampdemo.com`.
- [ ] **Step 2:** Run `npx vitest run packages`. Expected: FAIL.
- [ ] **Step 3:** Implement to the interfaces. The seed calls `renderOutreachMessage` with `publicApiUrl: 'http://localhost:4000/api/v1'`.
- [ ] **Step 4:** Run `npm run build:packages && npx vitest run packages`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): studio sender, simulated outbox fields and shared message renderer`.

### Task 2: Remove the platform provider configuration

**Files:** `apps/api/src/config/env.ts`, `apps/workers/src/config/env.ts`, `apps/workers/package.json` (drop `nodemailer` and `@types/nodemailer`, then `npm install` to update the lockfile), `apps/workers/src/services/provider-config.ts`, `scripts/verify-production-env.ts`, `.env.example`, `.env.production.example`, `scripts/__tests__/dev-stack.spec.ts`, `deploy/__tests__/deployment.spec.ts`, `apps/workers/src/services/__tests__/provider-config.spec.ts`

- [ ] **Step 1: Failing tests.**
  - `provider-config.spec.ts`: `providerConfigWarnings({})` has no item matching `/email/i`.
  - `deployment.spec.ts`: `.env.production.example` does not contain `RESEND_API_KEY`, `SENDGRID_API_KEY` or `EMAIL_PROVIDER`. Replace the old `toContain('RESEND_API_KEY=')`.
  - `dev-stack.spec.ts`: the `.env` fixtures drop `EMAIL_FROM`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Remove the keys from both env schemas, the `emailProvider` input from `ProviderConfigInputs`, and the email check from `verify-production-env.ts`. In `.env.example`, replace the Email Outreach block with a comment: delivery is simulated (REV-221) and each studio sets its sender in Settings.
- [ ] **Step 4:** Rerun. Expected: PASS. Compile errors in the email code are expected until Tasks 3 and 4.
- [ ] **Step 5:** Commit `refactor(REV-221): drop the platform-wide email provider settings`.

### Task 3: API: sender routes, approve and test gates, outbox route

**Files:**
- Create: `apps/api/src/routes/sender.routes.ts` (mounted `router.use('/organization/sender', requireAuth, requireOwner, senderRoutes)` before `/organization`), `apps/api/src/services/sender.service.ts`
- Modify: `apps/api/src/routes/index.ts`, `apps/api/src/routes/outreach.routes.ts`
- Test: `apps/api/src/routes/__tests__/sender.routes.spec.ts`, `api.routes.spec.ts`, `tenant-isolation.spec.ts`, `route-auth.spec.ts` (no list change expected; it must stay green)

**Interfaces:**
```ts
// sender.service.ts
export async function readSender(organizationId: string): Promise<ISenderView>
export async function saveSender(organizationId: string, sender: IStudioSender): Promise<ISenderView>   // Organization.findByIdAndUpdate $set sender
export async function requireSender(organizationId: string): Promise<IStudioSender>                    // 409 SENDER_NOT_CONFIGURED
```
- `PUT /organization/sender` (body `StudioSenderSchema`) → 200 `{ success, data: ISenderView }`.
- `GET /outreach/sender` → 200 `{ success, data: ISenderView }`, any role.
- `POST /outreach/:id/approve`: after `NO_CONTACT_EMAIL`, `const sender = await requireSender(req.auth!.organizationId)`. The campaign gets `senderEmail: sender.address, senderName: sender.name` (replaces `env.EMAIL_FROM`).
- `POST /outreach/:id/test`: `requireSender` replaces the `EMAIL_PROVIDER` check. The response `data` is the job result (`IEmailTestJobResult`) and the message is `Test email simulated for ${testEmail}`. A failure reason starting with `SENDER_NOT_CONFIGURED` maps to that 409.
- `GET /outreach/:id/outbox`: `INVALID_ID` → 400. The lead comes from `req.tenant.leads.findById` (none → 404 `LEAD_NOT_FOUND`), then `req.tenant.campaigns.findOne({ leadId })`. No campaign, or no `outbox` → 404 `OUTBOX_NOT_FOUND`. Otherwise 200 `{ success, data: IOutboxView }` (headers converted from the Map to a plain object). It writes nothing.

- [ ] **Step 1: Write failing tests**
  - `sender.routes.spec.ts` (real-MongoDB setup like `tenant-isolation.spec.ts`):
    - The owner's PUT stores the sender, and `GET /outreach/sender` returns it for a viewer.
    - An invalid address → 400.
    - The operator gets 403 and nothing is written.
    - Studio B's `GET /outreach/sender` is `configured:false` after studio A saved one.
  - `api.routes.spec.ts`:
    - Approve without a sender → 409 `SENDER_NOT_CONFIGURED`, `addEmailDispatchJob` not called, lead still NEEDS_APPROVAL.
    - With a sender, the campaign has `senderEmail` and `senderName` from it.
    - Test send without a sender → 409 and no job. With one → 200 with `simulated: true`.
    - Outbox: 200 with the stored message, 404 `OUTBOX_NOT_FOUND` without one, 400 for a bad id.
    - `GET outbox writes nothing`.
    - Remove the `EMAIL_PROVIDER_NOT_CONFIGURED` cases.
  - `tenant-isolation.spec.ts`: `GET /outreach/:id/outbox` in `TENANT_OWNED` with a wrong-studio test (404 `LEAD_NOT_FOUND`). `GET /outreach/sender` in `NO_TENANT_DATA` (it reads the caller's own organization), with a test that it never shows another studio's sender.
- [ ] **Step 2:** Run `npx vitest run apps/api`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): studio sender in the API; approval and test send require it; outbox endpoint`.

### Task 4: Workers: simulated delivery

**Files:**
- Modify: `apps/workers/src/services/email.service.ts` (becomes the simulated outbox; delete the provider classes), `apps/workers/src/workers/email.worker.ts`, `apps/workers/src/workers/email-test.worker.ts`
- Test: `apps/workers/src/services/__tests__/email.service.spec.ts`, `apps/workers/src/workers/__tests__/email.worker.spec.ts` (create if missing, following `email-test.worker.spec.ts`), `email-test.worker.spec.ts`

**Interfaces:**
- Consumes: `renderOutreachMessage`, `formatFromHeader`, `IStudioSender`, `IOutboxMessage` (Task 1); `Organization`, `revertOutreachApproval` from `@revamp/db`.
- Produces:
```ts
// email.service.ts
export async function loadStudioSender(tenant: Types.ObjectId): Promise<IStudioSender | null>   // Organization.findById(tenant, { sender: 1 }).lean()
export function simulateDelivery(input: Omit<Parameters<typeof renderOutreachMessage>[0], 'publicApiUrl'>): IOutboxMessage   // uses env.PUBLIC_API_URL
```
- `email.worker.ts`: keep steps 1–5 as they are. **Between the campaign checks and the MX check**, `const sender = await loadStudioSender(tenant)`. If it is null, call `revertOutreachApproval(leadId)`, log `Studio has no sender; lead returned to review`, and return `{ success:false, aborted:true, reason }`. Step 6 becomes `const message = simulateDelivery({ sender, to, subject, html, text, trackingToken })`; it does not throw, so the claim-release `catch` goes away. Step 7 writes `{ status:'DELIVERED', sentAt, senderEmail: sender.address, senderName: sender.name, deliveryMode:'SIMULATED', outbox: message }` in one `findByIdAndUpdate`. Step 8 is unchanged. The result has `deliveryMode: 'SIMULATED'` in place of `messageId`/`provider`. Log `Simulated delivery recorded (not sent) for lead …`.
- `email-test.worker.ts`: `loadStudioSender(jobTenant(data.tenantId))`. If it is null, `throw new Error('SENDER_NOT_CONFIGURED: this studio has no sender')`. Otherwise `simulateDelivery({…, subject: TEST_SUBJECT_PREFIX + subject, trackingToken: TEST_TRACKING_TOKEN, trackOpens: false })` and return `{ to, from: message.from, subject: message.subject, simulated: true }`. Nothing is stored.

- [ ] **Step 1: Write failing tests**
  - `email.service.spec.ts`: `simulateDelivery` returns the rendered message with `env.PUBLIC_API_URL`. Remove the provider and no-provider cases.
  - `email.worker.spec.ts` (models mocked like the existing worker specs):
    - `records a simulated delivery from the studio sender`: the campaign update has `deliveryMode:'SIMULATED'`, `outbox.from === '"Studio A" <a@studio-a.test>'`, `senderEmail`, and the lead update to SENT.
    - `uses the studio sender current at send time`: Organization returns a sender other than the campaign's approval-time `senderEmail`, and the outbox uses the current one.
    - `reads the sender of the job's studio only`: `Organization.findById` is called with the tenant ObjectId.
    - `returns the lead to review when the studio has no sender`: `revertOutreachApproval` is called and there is no DELIVERED write.
    - `a retry of a delivered campaign leaves the outbox and sentAt as they were`: no campaign update.
    - The HITL abort, MX bounce and tenant mismatch cases still pass, with no outbox write.
  - `email-test.worker.spec.ts`: the result is `{…, simulated: true }` with the `[Test] ` subject, and no pixel in the rendered html (assert through a spy on `simulateDelivery` or the returned message). With no sender it throws `SENDER_NOT_CONFIGURED: …`.
- [ ] **Step 2:** Run `npx vitest run apps/workers/src/services/__tests__/email.service.spec.ts apps/workers/src/workers` from the root. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, then the five gates: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. All green. `grep -rnE "EMAIL_PROVIDER|EMAIL_FROM|RESEND_API_KEY|SENDGRID_API_KEY|nodemailer" apps packages scripts deploy --include='*.ts' --include='*.mjs' --include='*.json' --include='*.yml' | grep -v node_modules` finds nothing.
- [ ] **Step 5:** Commit `feat(REV-221): workers record a simulated delivery from the studio sender`.

### Task 5: Dashboard: sender settings, review gate, simulated labels, outbox view

**Files:**
- Modify: `apps/dashboard/src/api/client.ts`, `apps/dashboard/src/pages/SettingsPage.tsx`, `apps/dashboard/src/components/leadReview/ReviewActionBar.tsx`, `apps/dashboard/src/components/leadReview/LeadReview.tsx` (place the outbox button on the email step), locales `en, ru, be, pl, lt`
- Create: `apps/dashboard/src/hooks/useSender.ts`, `apps/dashboard/src/components/settings/SenderSection.tsx`, `apps/dashboard/src/components/leadReview/OutboxDialog.tsx`, `apps/dashboard/src/utils/outboxFrame.ts`
- Test: `api/__tests__/client.spec.ts`, `hooks/__tests__/useSender.spec.ts`, `components/settings/__tests__/SenderSection.spec.ts`, `components/leadReview/__tests__/OutboxDialog.spec.ts`, `ReviewActionBar.spec.ts` (extend), the locale parity test

**Interfaces:**
```ts
export const senderApi = { get(): Promise<ISenderView>; save(body: IStudioSender): Promise<ISenderView> };  // GET /outreach/sender, PUT /organization/sender
export const outreachApi.outbox: (leadId: string) => Promise<IOutboxView>;   // GET /outreach/:id/outbox (add to the existing outreach client object)
export const SENDER_QUERY_KEY = ['sender'] as const;
export function useSenderQuery(); export function useSaveSenderMutation();   // onSuccess writes the view into the cache
export function useOutboxQuery(leadId: string, enabled: boolean);
export function outboxSrcDoc(html: string): string
  // prepends <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"> and <base target="_blank">
  // inside <head> (adds a <head> when missing)
```
- `SenderSection` (Settings): every role sees the current sender, or "No sender yet". The owner gets a form (name, address) validated with `StudioSenderSchema`, and Save. Others see "Only the studio owner can set the sender." A note under it: `settings.sender.simulatedNote` ("Emails are simulated: they are recorded in the outbox and not delivered.").
- `ReviewActionBar`: without a configured sender, Approve and "Send test" are disabled and an `Alert severity="warning"` shows `email.sender.notConfigured`, with a link to `ROUTES.settings` (owner) or `email.sender.askOwner` (others). `runAction` maps `ApiError.code === 'SENDER_NOT_CONFIGURED'` to that text and invalidates `SENDER_QUERY_KEY`. The success texts become `email.approvedSimulated` and `email.testSimulated`.
- `OutboxDialog`: opened by a "View sent email" button on the email step when the lead's status is SENT or later (`OPENED`, `CLICKED`, `ENGAGED`, `UNSUBSCRIBED`). It shows a `Chip` "Simulated – not delivered", From, To, Subject and sent date (`formatDate`), and `<iframe title=… sandbox="" srcDoc={outboxSrcDoc(html)} />`. 404 `OUTBOX_NOT_FOUND` (campaigns sent before REV-221) → `email.outbox.missing`.
- Locale keys (all five): `settings.sender.{title,name,address,save,saved,none,ownerOnly,simulatedNote}`, `email.sender.{notConfigured,askOwner,openSettings}`, `email.{approvedSimulated,testSimulated}`, `email.outbox.{open,title,simulated,from,to,subject,sentAt,missing}`. Remove the old `email.approved` / `email.testSent` keys only if nothing else uses them.

- [ ] **Step 1: Write failing tests**
  - `client.spec.ts`: paths and methods for `senderApi.get`, `senderApi.save` and `outreachApi.outbox`.
  - `useSender.spec.ts`: the save mutation writes into the cache.
  - `SenderSection.spec.ts` (createElement, happy-dom):
    - The owner sees the form and the viewer does not.
    - An invalid address blocks Save, with no request.
    - The simulated note is shown.
  - `OutboxDialog.spec.ts`:
    - `frame is sandboxed with no permissions and the srcdoc carries the CSP meta and base target`: `getAttribute('sandbox') === ''`.
    - The chip text is shown.
    - 404 shows the missing text.
    - Unit tests of `outboxSrcDoc` cover html with and without `<head>`.
  - `ReviewActionBar.spec.ts`:
    - `configured:false` disables Approve and shows the warning with the settings link for the owner.
    - An approve rejected with `SENDER_NOT_CONFIGURED` shows the localized text.
    - A successful approve shows `approvedSimulated`.
- [ ] **Step 2:** Run `npx vitest run apps/dashboard`. Expected: FAIL.
- [ ] **Step 3:** Implement (theme tokens only).
- [ ] **Step 4:** Rerun plus the locale parity test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(REV-221): dashboard sets the studio sender and shows simulated emails`.

### Task 6: Repo docs, the REV-45 exception, gates, end to end

**Files:** root `AGENTS.md` §3.2.2 (add the exception sentence from Ruling 1 and a line "Studio sender (REV-221): approval needs the studio's sender; the worker reads it at send time"), `apps/api/AGENTS.md`, `apps/workers/AGENTS.md`, `apps/dashboard/AGENTS.md` (OutboxDialog's empty sandbox is the email exception to the MVP iframe rule), `packages/db/AGENTS.md` (sender in the demo dataset), `README.md`, `.env.example`

- [ ] **Step 1:** Replace every "interim" email note (`grep -rnE "[Ii]nterim|REV-221|EMAIL_PROVIDER|RESEND|SENDGRID" README.md AGENTS.md apps/*/AGENTS.md packages/*/AGENTS.md .env.example`) with the shipped behavior: studio sender plus simulated outbox, nothing delivered.
- [ ] **Step 2:** Run the five gates. All green, 0 lint errors, no new warnings.
- [ ] **Step 3: E2E on an isolated stack** (Redis DB 1, Mongo DB `revamp_e2e_rev221`, API on :4100 with `CORS_ORIGIN=http://localhost:5174`, Vite on :5174, branch workers on Redis DB 1). Screenshot each step and expect no new console errors:
  1. Register a studio, add a lead, and wait for NEEDS_APPROVAL. Approve is disabled with the "set a sender" warning. A direct `POST approve` answers 409 `SENDER_NOT_CONFIGURED` and no job is queued (`redis-cli -n 1 KEYS 'bull:email-queue:*'`).
  2. Settings → set the sender as owner. Sign in as a viewer, who sees it read-only.
  3. "Send test" → "Test email simulated – not delivered".
  4. Approve → after the delay (`DEL bull:email-queue:limiter` on DB 1 to skip the limiter) the lead is SENT. "View sent email" shows the chip, the studio's From and the body. The network tab shows no request to `/track/open` or `/track/click` from the frame, and the lead stays SENT after viewing.
  5. Change the sender, approve a second lead: its outbox From is the new sender.
  Then drop `revamp_e2e_rev221`, flush Redis DB 1 and stop the extra processes.
- [ ] **Step 4:** Commit `docs(REV-221): studio sender and simulated outbox replace the platform email provider`.

**Docs to update in `../Revamp-docs`** (done by the orchestrator after the merge):
- `blueprint.md` lines ~52, ~93, 1142–1143, 1165 and 1169 (simulated delivery, studio sender), §5 error codes (+2, −1), and the `EmailCampaign`/`Organization` schema fields.
- `spec.md`: `GET/PUT` sender, the outbox endpoint, approve's 409, the test send response.
- `database-expertise.md`: the `senderEmail` row (line 149), plus `senderName`, `deliveryMode`, `outbox.*` and `organizations.sender.*`.
- `milestones.md` lines 20, 125 and 183.
- `api-docs/guides/concepts.md:24` and `tutorial-lead-to-outreach.md:116`.
- `README.md` lines 71, 147 and 216.
- `research.md`: an ADR note "delivery simulated for the diploma build; a studio mailbox (Gmail OAuth / SMTP) is future work".
- Then `npm run docs:index`.
- Linear: the Concept and Decision Log gets a row for 2026-11-25 (rescope), and BA US18's acceptance criteria get a note that delivery is simulated.
