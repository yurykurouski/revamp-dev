# REV-207: roles (owner, operator, viewer) and invitations (E1.2)

Ticket: https://linear.app/revamp-proect/issue/REV-207 (child of [REV-169](https://linear.app/revamp-proect/issue/REV-169), E1 US1)
Branch: `ymorpheus/rev-207-e12-roles-owner-operator-viewer-and` (worktree `../Revamp-dev-rev207`), cut from `main` after REV-206 (PR #133).

## Goal

After REV-206 every member of an organization can do everything and nobody can join an existing organization. After this ticket an owner invites colleagues with a role, routes check the role, and the dashboard hides what a role cannot do. Isolation of data between organizations (REV-209) and the Business/Lead split (REV-208) are **out of scope**.

## What each role may do

| Role | Reads (every `GET`) | Writes (add lead, discovery, audit retry, MVP generate/edit/restore/tokens, approve, reject, test email) | Members and invitations |
|---|---|---|---|
| `viewer` | yes | **no, 403** | no |
| `operator` | yes | yes | no |
| `owner` | yes | yes | yes |

Rule in code: any non-`GET` request on a guarded mount needs `owner` or `operator`; the member routes need `owner`. A table test walks every registered route (as `route-auth.spec.ts` does) and checks the role of each, so a new write route is a viewer 403 until someone allows it.

## Rulings (open for your veto)

1. **The role is read from the database on every request**, not from the token. `requireAuth` becomes async: it checks the token, loads the membership (`userId` + `organizationId`) and sets `req.auth.role` from it. A removed member gets 401 `UNAUTHENTICATED` at once and a changed role applies at once. This is the membership check REV-206 deferred. Cost: one indexed read per request (the unique `{ userId, organizationId }` index); the token's own `role` claim stays but is ignored.
2. **No invitation email.** The owner gets a one-time link (`<dashboard>/invite/<token>`) to copy and send. Sending mail from the platform is a separate decision (HITL, sender reputation). Cost if wrong: the owner pastes the link into their own chat or mail.
3. **Invitation token:** 32 random bytes (`base64url`), shown once in the create response, stored only as a SHA-256 hash (`tokenHash`, unique). Valid 7 days, single use. Creating a new invitation for the same organization and email revokes the older pending one.
4. **The invitee must use the invited email.** Joining as a new user is `POST /auth/register` with `invitationToken` (organization name is not needed; the user and the membership are created in one transaction and the invitation is marked accepted). Joining with an existing account is `POST /invitations/:token/accept` (signed in as the invited email). Both return a session for the invited organization. A mismatch is 403 `INVITATION_EMAIL_MISMATCH`.
5. **A user can belong to several organizations, but there is no switcher.** `login` picks the oldest membership; accepting an invitation signs the user into the new organization. Switching later is not in the E1 stories. Cost: a user in two studios signs into the older one until a switcher exists.
6. **The last owner cannot be removed or demoted** (409 `LAST_OWNER`), checked inside the same update so two owners demoting each other at once cannot leave none. Owners may invite owners.
7. **The stored role in the browser can be stale.** The dashboard refreshes the session from `GET /auth/me` on start and after a 403, so hiding is a convenience; the API is the gate.
8. **Demo data:** the seed gains an operator and a viewer in `Demo Studio` (same demo password) so the roles can be shown without inviting anyone.

## Design

`Invitation` (`packages/db`): `organizationId`, `email` (lowercase), `role`, `tokenHash` (unique), `invitedBy` (user id), `expiresAt`, `acceptedAt?`, `revokedAt?`. Index `{ organizationId: 1, createdAt: -1 }` for the member screen. Functions in `@revamp/db` (transactions, like `createOrganizationWithOwner`): `createInvitation`, `acceptInvitationAsMember`, `registerWithInvitation`, `changeMemberRole`, `removeMember` (the last-owner guard is part of the write, not a prior read).

API (all owner-only except the two public reads/accept):

| Method | Path | Notes |
|---|---|---|
| `GET` | `/organization/members` | members (user, role) and pending invitations |
| `POST` | `/organization/invitations` | `{ email, role }` → `201 { invitation, token }`; `409 ALREADY_MEMBER` if the email is a member |
| `DELETE` | `/organization/invitations/:id` | revoke |
| `PATCH` | `/organization/members/:userId` | `{ role }`; `409 LAST_OWNER` |
| `DELETE` | `/organization/members/:userId` | `409 LAST_OWNER`; an owner may remove themself only if another owner exists |
| `GET` | `/invitations/:token` | **public**: organization name, role, email, `valid`; `404 INVITATION_NOT_FOUND`, `410 INVITATION_EXPIRED` (also for used or revoked) |
| `POST` | `/invitations/:token/accept` | signed in; same email only |

New codes: `FORBIDDEN` (403), `ALREADY_MEMBER`, `LAST_OWNER`, `MEMBER_NOT_FOUND`, `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_EMAIL_MISMATCH`. `RegisterSchema` accepts `invitationToken` (then `organizationName` is ignored); `ORGANIZATION_ROLES` becomes `owner | operator | viewer`; helpers `canWrite(role)` and `canManageMembers(role)` live in `@revamp/shared-types`, used by the API and the dashboard.

Dashboard: `usePermissions()` (from the session role); `/team` page (owner only, linked from the rail) with the members, a role select, remove, the invite form and the one-time link with a copy button; `/invite/:token` public page (shows the studio and role, then register or sign in, then joins); write actions hidden or disabled for a viewer: Add lead, Find businesses, Generate/Regenerate MVP, design tools, retry audit, approve/reject/test email. Theme tokens only; five locales.

## Tasks (TDD: each starts with a failing test)

1. **Shared types and validation.** Roles, helpers, error codes; `CreateInvitationSchema`, `ChangeMemberRoleSchema`, `RegisterSchema` with `invitationToken`. Tests: schemas, helper truth table, code list.
2. **Invitation model and `@revamp/db` functions.** Real-MongoDB tests (one file): token hashed not stored, expired/used/revoked refused, one pending per email, accept creates one membership, `registerWithInvitation` atomic (failure leaves no user), 20 racing accepts leave one membership, last-owner guard under two concurrent demotions, removing a member keeps the user.
3. **`requireAuth` with the membership lookup and `requireRole`.** Tests: removed member 401, role change applies at once, role from DB not token, 403 body format. Existing route specs mock the lookup through the authed helper.
4. **Routes and services.** Organization and invitation routes, register with a token, accept. Tests per endpoint (200/201/400/401/403/404/409/410) and the **table test**: every write route answers 403 to a viewer and passes the guard for operator and owner; member routes 403 for operator and viewer.
5. **Dashboard.** `usePermissions`, session refresh, hiding/disabling actions, `/team`, `/invite/:token`, client methods, five locales. Store, component and route tests (`.spec.ts` with `createElement`).
6. **Seed and scripts.** Demo operator and viewer; `demo-dataset.spec.ts`; `e2e_live_scenarios.ts` unchanged (owner).
7. **Chrome and real stack check** on an isolated in-memory MongoDB: invite, join as new user and as existing user, viewer sees no write actions and gets 403 from the API, remove a member (their open tab is signed out on the next call), last-owner refusal.
8. **Docs.** spec, blueprint (schemas, ER, codes, endpoints), database-expertise (dictionary, indexes, keys, demo users), milestones, README, area `AGENTS.md` files, `npm run docs:index`, `npm run docs:check-dictionary`.

## Gates

`npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures, from the repo root), `npm run build`, then the Chrome check.

## Not in this ticket

Invitation email, organization switcher, password reset, transferring ownership as a separate action (promote another owner, then demote), per-role limits, data isolation (REV-209).
