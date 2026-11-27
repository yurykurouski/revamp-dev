# REV-223 Default Draft Signed by the Studio Implementation Plan

> **For agentic workers:** executed by the `implementer` agent (`.claude/agents/implementer.md`) in one run, TDD. Steps use checkbox (`- [ ]`) syntax. Report every deviation under `Plan deviations`.

**Goal:** The default outreach draft is signed by the studio (its sender name, else its organization name, else a plain "Best regards") and names no platform anywhere. A draft the operator has edited is never overwritten when the sender loads or changes.

**Architecture:** `defaultEmailDraft` takes the signer name and builds the sign-off from it. `useEmailDraft` takes the same name and, when it changes, replaces the body only while the body is still exactly the default it last wrote. `LeadReview` picks the name (`draftSignerName`) from the sender query it already runs and from the session's organization.

**Tech Stack:** React 18, React Query, Zustand (`useAuthStore`), Vitest + happy-dom.

**Spec:** Linear REV-223. Read root `AGENTS.md` and `apps/dashboard/AGENTS.md` first.

## Rulings

1. **Signer:** `sender.name` when `sender.configured`, else the session's `organization.name`, else none. The organization name is available at once (local session). The sender arrives when its query resolves, so the untouched default switches from the organization name to the sender name.
2. **Sign-off text** (English, like the rest of the draft; the draft does not follow the operator's UI language): `Best regards,\n<name>`, or `Best regards` with no name.
3. **Body wording:** `To show how your site could look, our platform generated a prototype of your updated website:` becomes `To show how your site could look, we built a prototype of your updated website:`. The studio speaks as "we", which matches the preheader ("We built an interactive prototype…"). `auditSummarySentence` ("According to our automated express audit") stays: "our" is the studio's audit.
4. **"Untouched" means equal:** the body counts as untouched when it equals, character for character, the last default `useEmailDraft` wrote. Any edit, even one later typed back, ends the automatic updates for that draft. The subject and preheader don't depend on the signer and never change after the first render.
5. **No change** to the seed (its campaign text has no signature), the API, the workers, or the tutorial examples in `../Revamp-docs` (their "Best regards" has no platform name).

## Global Constraints

- No string in a default draft may match `/revamp/i` or `/platform/i` (test-enforced).
- Tests are `.spec.ts` (createElement, happy-dom), run from the repo root: `npx vitest run apps/dashboard`.
- No new locale keys: the draft is copy for the business owner, not UI.

## Review Focus

1. **The operator edits the body before the sender query resolves**, then it resolves. The edit must survive. Test: `useEmailDraft.spec.ts › keeps an edited body when the signer arrives later` (Task 1).
2. **The owner renames the sender while a review is open.** An untouched draft follows the new name, an edited one doesn't. Test: `› follows a signer change while the body is untouched` (Task 1).
3. **A sender name with a newline or surrounding spaces** must not break the sign-off. `StudioSenderSchema` trims; the name is used as is, and newlines cannot reach it through the API. No extra test.
4. **Switching leads in the review queue** (`LeadReview` keeps state per lead): the draft must start from the new lead's default with the current signer. `LeadReview` is keyed by lead today; verify in Chrome (Task 2 step 3).
5. **The inbox preview and the approved email show the same sign-off** as the editor: they render from the same `body`. Checked in Chrome and in the recorded outbox (Task 2).

---

### Task 1: Draft builder and hook

**Files:**
- Modify: `apps/dashboard/src/hooks/useEmailDraft.ts`
- Test: `apps/dashboard/src/hooks/__tests__/useEmailDraft.spec.ts` (extend). The hook tests go in the same file with `createElement` + happy-dom, following `ReviewActionBarSender.spec.ts`'s mount helper.

**Interfaces (Produces):**
```ts
export function draftSignerName(sender: ISenderView | undefined, organizationName: string | undefined): string | undefined
  // sender.configured && sender.name → sender.name; else organizationName (trimmed, non-empty) → it; else undefined
export function draftSignOff(signerName?: string): string           // 'Best regards,\n<name>' | 'Best regards'
export function defaultEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null, signerName?: string): EmailDraftFields
export function useEmailDraft(lead: ILeadItem, audit?: IAuditDetail | null, signerName?: string): EmailDraft   // same EmailDraft shape
```
Hook rule: keep a ref to the last default body. In a `useEffect` on `signerName`, compute the new default body. If the current `body` equals the ref, call `setBody(newDefault)`. Update the ref to `newDefault` only when the body was replaced.

- [ ] **Step 1: Write failing tests**
  - `defaultEmailDraft` with `signerName: 'Studio Kraków'`: the body ends with `'Best regards,\nStudio Kraków'`.
  - Without a signer, the body ends with `'Best regards'`.
  - For both, the joined subject, preheader and body match neither `/revamp/i` nor `/platform/i`.
  - The body contains `we built a prototype of your updated website:`.
  - `draftSignerName({ configured: true, name: 'S', address: 'a@b.test' }, 'Org')` gives `'S'`. `({ configured: false }, 'Org')` gives `'Org'`. `(undefined, '  ')` and `(undefined, undefined)` give `undefined`.
  - Hook, `› signs with the signer it starts with`.
  - Hook, `› follows a signer change while the body is untouched`: rerender from `'Org'` to `'Studio Kraków'`; the body now ends with `Studio Kraków`.
  - Hook, `› keeps an edited body when the signer arrives later`: `setBody('custom')`, then a rerender with a new signer; the body is still `'custom'`.
  - Hook: the subject and preheader are unchanged after a signer change.
  - The existing REV-128 cases (`never names the internal template`, `describes the prototype neutrally`, …) still pass.
- [ ] **Step 2:** `npx vitest run apps/dashboard/src/hooks/__tests__/useEmailDraft.spec.ts`. Expected: the new cases fail.
- [ ] **Step 3:** Implement to the interfaces. Update the `defaultEmailDraft` doc comment: signed by the studio, never by the platform (REV-223).
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `fix(REV-223): the default draft is signed by the studio, never the platform`.

### Task 2: Wire the signer in the review, docs, gates, Chrome

**Files:**
- Modify: `apps/dashboard/src/components/leadReview/LeadReview.tsx` (call `useSenderQuery()` before `useEmailDraft`; `const organizationName = useAuthStore((s) => s.organization?.name)`; `useEmailDraft(lead, audit, draftSignerName(sender, organizationName))`)
- Modify: `apps/dashboard/AGENTS.md`: after "with the email draft held by the review (`useEmailDraft`)", add "and signed by the studio: the sender name, else the organization name, never the platform; the default follows the signer until the operator edits it (REV-223)".
- Test: `apps/dashboard/src/components/__tests__/EmailDraftEditor.spec.ts` or the `LeadReview` spec that mounts the email step (whichever already mounts `LeadReview` with a mocked `senderApi.get`; REV-221 added spies on it in three specs). Add `› the email step's draft and inbox preview end with the studio sender name`.

- [ ] **Step 1:** Write the failing test: mock `senderApi.get` to resolve `{ configured: true, name: 'Studio Kraków', address: 'hello@studio-krakow.test' }` and seed the auth store with organization name `'Org Name'`. After the query settles, the body textarea value ends with `Studio Kraków` and the inbox preview text contains `Studio Kraków`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the wiring and the AGENTS.md line.
- [ ] **Step 4:** Run the five gates from the worktree root: `npm run build:packages && npm run typecheck && npm run lint && npm test && npm run build`. Expected: all green, lint 0 errors and no new warnings.
- [ ] **Step 5: Chrome check on an isolated stack** (memory `email-e2e-isolated-stack`: in-memory replset on :27118, Redis spare DB, API :4100, workers, Vite :5174). Never touch the shared `revamp` database or Redis DB 0, and never kill the main checkout's `tsx watch` processes.
  1. Register a studio named "Org Name", then insert a `NEEDS_APPROVAL` lead.
  2. Before any sender is set, the email step's draft ends with `Best regards,\nOrg Name`.
  3. Set the sender `Studio Kraków` in Settings, then reopen the lead. The draft and the inbox preview end with `Studio Kraków`.
  4. Type into the body, then change the sender name in another tab and come back to the review without reloading: the edit is kept.
  5. Approve an untouched draft and let the worker run. The recorded outbox's text and html end with `Studio Kraków` and contain no "Revamp" or "platform".
  6. Switch to a second lead in the queue: its draft starts from the default with the current signer.
  7. No new console errors.

  Tear down by port and flush the spare Redis DB.
- [ ] **Step 6:** Commit `fix(REV-223): the review signs the draft with the studio sender`.

**Docs to update in `../Revamp-docs`** (orchestrator, after merge): `blueprint.md` §HITL / lead review, if it quotes the default draft. Check `grep -rn "Revamp SaaS team\|our platform" ../Revamp-docs`, which found nothing on 2026-11-27, so most likely no change is needed; say so in a ticket comment.
