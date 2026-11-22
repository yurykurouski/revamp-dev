# REV-206: organizations, users and email-and-password sign-in (E1.1)

Ticket: https://linear.app/revamp-proect/issue/REV-206 (child of [REV-169](https://linear.app/revamp-proect/issue/REV-169), E1 US1)
Branch: `ymorpheus/rev-206-e11-organizations-users-and-email-and` (worktree `../Revamp-dev-rev206`)

## Goal

The API has no accounts. After this ticket a studio owner registers an organization, signs in with email and password and gets a session token; the API knows the caller and organization of every request, and the dashboard asks for sign-in. Roles beyond `owner`, invitations (REV-207), the Business/Lead split (REV-208) and tenant filtering of data (REV-209) are **out of scope**: after this ticket all signed-in users still see the same data.

## Rulings (open for your veto)

1. **Which routes need a token.** Everything except: `GET /health`, `POST /auth/register`, `POST /auth/login`, the public tracking routes (`/track/*`, they carry a campaign token and are called by recipients and MVP pages) and `GET /mvp/preview/:slug` (loaded in an iframe, which cannot send a header). Cost if wrong: a route left open that should be closed; the test below lists every route and its expected status, so a new route fails the test until classified.
2. **Token.** Signed JWT (HS256, 7 days) in the `Authorization: Bearer` header, kept by the dashboard in `localStorage` through a persisted Zustand store. No session collection, no refresh token, no logout on the server (the token simply expires). Cost if wrong: a stolen token works until expiry; acceptable for the thesis, noted in the docs.
3. **Passwords.** `scrypt` from `node:crypto` with a random 16-byte salt and `timingSafeEqual`; no new dependency for hashing. Library for the JWT: `jsonwebtoken` (one new dependency in `apps/api`). Minimum password length 10.
4. **`JWT_SECRET`.** Required, at least 32 characters. `npm run setup` / `dev` generate it into `.env` the way they do `MONGO_*_PASSWORD` (`ensureMongoSecrets`); production checks it in `verify-production-env`. A worktree copies it from the main checkout's `.env`.
5. **Registration is open** (anyone can create an organization). Closing it behind an invite code is a later decision; the ticket says "an owner can create an organization".
6. **One user, many organizations** is modelled (`Membership`), but this ticket creates exactly one membership at registration and a login token carries the user's first membership. Choosing between organizations comes with invitations (REV-207).

## Design

Collections (schemas only in `packages/db`, REV-48):

| Collection | Fields | Indexes |
|---|---|---|
| `organizations` | `name` (required, trim, ≤ 100), timestamps | none beyond `_id` |
| `users` | `email` (required, lowercase, trim), `passwordHash` (`scrypt$<salt>$<hash>`), `name` (≤ 100), timestamps | unique `{ email: 1 }` |
| `memberships` | `userId`, `organizationId` (ObjectId refs), `role` (`owner`; the enum `ORGANIZATION_ROLES` in `@revamp/shared-types` gets `operator` and `viewer` in REV-207) | unique `{ userId: 1, organizationId: 1 }`, `{ organizationId: 1 }` |

`createOrganizationWithOwner` (`@revamp/db`, same style as `createLeadWithAudit`): one transaction inserts the organization, the user and the owner membership; a duplicate email surfaces as `EMAIL_TAKEN` (409) from the unique index, not from a read-then-write check.

API: `POST /auth/register` (201 `{ token, user, organization, role }`), `POST /auth/login` (200 same shape; unknown email and wrong password give the same `INVALID_CREDENTIALS` 401 after hashing a dummy value, so timing does not reveal accounts), `GET /auth/me` (current user, organization and role). `requireAuth` verifies the token, sets `req.auth = { userId, organizationId, role }` (it reads the token only; the membership lookup arrives with member removal in REV-207) and returns `UNAUTHENTICATED` (401) in the standard error format. New codes in `API_ERROR_CODES` and blueprint.md §5: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`.

Dashboard: `useAuthStore` (persisted: token, user, organization; `signIn`, `signOut`), an `authFetch` wrapper in `api/client.ts` that adds the header to every existing call and signs out on 401, `/login` and `/register` pages, and a route guard in `AppRoutes`. Theme tokens only, labels in all five languages.

## Tasks (TDD: each starts with a failing test)

1. **Shared types and validation.** `ORGANIZATION_ROLES`, `IAuthSession`, three error codes (and `API_ERROR_CODES` test). `RegisterSchema` (email format, password 10–128, organization name 1–100, name optional) and `LoginSchema` in `@revamp/validation`. Tests: valid, missing fields, short and over-long password, malformed email, trimming and lowercasing.
2. **Models and transaction.** The three models, exported from `packages/db/src/index.ts`; `createOrganizationWithOwner`. Tests in `real-mongo.spec.ts` (one server): all three written together; failure of the membership insert leaves no user and no organization; second registration with the same email in any letter case fails with E11000; 20 parallel registrations of one email leave one user.
3. **Auth services.** `password.ts` (hash, verify), `token.ts` (sign, verify, expiry, wrong secret, tampered payload), `auth.service.ts` (register, login, me). Tests: hash differs per call, verify rejects wrong password, constant-time path for unknown email, expired and tampered token rejected.
4. **Routes and middleware.** `auth.routes.ts`, `auth.controller.ts`, `requireAuth`, wiring in `routes/index.ts` per ruling 1, `JWT_SECRET` in `env.ts`. Tests (supertest, as the other route specs do): 201/400/409 on register, 200/400/401 on login, 200/401 on `/auth/me`, and **one table test that walks every registered route** and asserts 401 without a token; the public routes are listed by hand and each must not answer 401 without one.
5. **Setup and config.** `JWT_SECRET` generation in `scripts/lib/dev-stack.mjs` (+ `dev-stack.spec.ts`), `.env.example`, `.env.production.example`, `verify-production-env.ts` and its test.
6. **Dashboard.** `useAuthStore` (+ store tests: sign-in, sign-out, persisted rehydrate, 401 clears), `authFetch` and its use in every call of `client.ts` (test: header sent, 401 signs out), login and register pages, route guard, i18n keys in five languages. Component tests through `createElement` in `.spec.ts` files (`.spec.tsx` is skipped).
7. **Seed and e2e.** Demo dataset gets one demo organization and owner (`demo-owner@…test`, password in the seed file, not in the docs); `demo-dataset.spec.ts` checks it against the schemas. Existing scripts that call the API (`e2e_live_scenarios.ts`, the tracking checks) sign in first or use public routes; list them in the ledger.
8. **Verify in Chrome and on a real stack.** Register, sign in, reload (stays signed in), sign out, open a lead, expired token returns to `/login`, console clean. Run on a separate compose project, not the shared `revamp-mongo`.
9. **Docs.** `spec.md` (endpoints, DTOs, error codes), `blueprint.md` (§4 schemas and ER diagram, §5 codes), `database-expertise.md` (§3, §4 dictionary rows, §5, §6, §7, §8, §10; run `npm run docs:check-dictionary`), `milestones.md`, root and area `AGENTS.md` (API: every route needs `requireAuth` unless listed public; dashboard: `authFetch`), README (env var, sign-in), `.env.example`; `npm run docs:index` in `../Revamp-docs`.

## Gates

`npm run build:packages`, `npm run typecheck`, `npm run lint` (0 errors, no new warnings), `npm test` (0 failures, run from the repo root), `npm run build`, then the Chrome check above.

## Not in this ticket

Roles other than `owner`, invitations, password reset and email verification (not in the BA scope), tenant filtering of any query, per-tenant sender, rate limiting of the login route (REV-195 covers rate limiting; the ticket should list `/auth/login` when it is picked up).
