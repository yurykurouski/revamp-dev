# Revamp — Business Analysis

Oct 19, 2026 · @Yury

## 1. Introduction

This document defines the business case, scope and requirements of Revamp, a multi-tenant platform where web studios compete for the right to contact local businesses with outdated websites, and where business owners can request a redesign themselves.

**Purpose.** To agree on the project scope, give every party a shared understanding of the problem and the solution, and serve as the basis for the Business Analysis defense before the committee.

**Audience.** The diploma committee and supervisor; later, the developers and testers who turn the epics into specifications.

## 2. Vision

### Vision statement

**Revamp lets a web studio win a client in minutes of its own time instead of hours: the platform audits a local business's website, builds a prototype of the better site from the business's own content, and gives the studio an exclusive, evidence-backed first contact that a human approves.**

### Problem statement

Small local businesses often run slow, inaccessible and outdated websites, and the studios that could fix them struggle to reach them.

- **Expensive first contact.** A studio spends 4 to 6 hours per lead on research, a Figma mock-up and a personal email, so one person handles 2 to 3 leads a day.
- **Shared, finite pool.** Every studio draws from the same public sources, so a city is quickly exhausted and one business can receive several competing pitches.
- **Unreliable automation.** Language models alone invent metrics and contact details, and automatic cold email creates a spam and legal risk.
- **No voice for the business owner.** Owners rarely get a way to see what a better site would look like and ask for it.

### Business goals and objectives

1. Cut a studio's time per reviewed lead from hours to minutes while keeping a human approval before every send.
2. Replace the contested pool with a fair market: studios bid for the exclusive right to contact each business.
3. Let business owners check their own site and request a redesign, producing consent-based leads.
4. Serve many studios at once on a shared platform with strict data isolation.
5. Keep every metric and contact detail deterministic and verifiable.

### Stakeholders

| Stakeholder | Role | What they need |
| --- | --- | --- |
| Web studio or freelancer | Paying user | Qualified leads, fast prototypes, exclusivity, control of outgoing email |
| Business owner | Recipient and, in the inbound flow, a requester | Honest audit, a relevant offer, no spam, control over their data |
| Platform operator | Owner of Revamp | Revenue from auctions, a healthy market, low LLM and hosting cost |
| Data protection authority | Regulator | Lawful B2B contact, consent and opt-out |
| LLM and email providers | External dependencies | Fair use within their terms and rate limits |

The influence and interest of each group are shown below.

&#91;embedded content: stakeholder matrix · influence and interest\]

### Success criteria

These targets are proposed for validation during the project.

| Criterion | Target | How it is measured |
| --- | --- | --- |
| Operator time per reviewed lead | At most 15 minutes, against a 4 to 6 hour manual baseline | Timestamps from lead creation to approval |
| Audit repeatability | Same site gives the same metrics on repeated runs | Repeat audits on a sample of real sites |
| Generated pages passing code checks | At least 80% on the first attempt | Check logs of the page generator |
| Duplicate contact | 0 businesses contacted by two studios inside the cooldown | Contact registry audit |
| Auction health | At least 60% of slots with two or more bids in simulation | Auction simulation |
| Owner conversion | At least 5% of owner audits become a consented lead | Inbound funnel metrics |

## 3. Scope

### In scope

- **Existing core (done):** discovery, website audit, MVP page generation with code checks, operator review, email with a Before / After banner, open and click tracking.
- **P1 Multi-tenancy:** organizations, users and roles, tenant-scoped data, per-tenant sender identity and quotas.
- **P2 Contact registry and rights:** who may contact which business and for how long, a cooldown afterwards, enforcement in the lead state machine.
- **P3 Auction and payments:** sealed-bid second-price auction for the right to contact a business, reserve prices from the audit, a payment ledger, and a simulation of bidders to compare formats.
- **P4 Inbound flow:** a public audit page for owners, consent capture, and sale of consented leads.
- **P5 Market map:** a price and inventory heat map by area and niche.

### Out of scope

- Sending email on behalf of studios from a platform domain; each studio sends from its own sender.
- Building full multi-page replacement websites or hosting production sites.
- Collecting or selling personal data of private individuals; only business contacts published by the business.
- Native mobile applications.
- Automated payouts between studios; the platform sells its own service only.

### Assumptions

- Business websites and public map data (OpenStreetMap, Google Places) stay available within their usage policies.
- Enough studios operate in a city for auctions to attract at least two bidders in the pilot niches.
- At least one LLM provider with vision support is available to every tenant, through the platform or the tenant's own key.
- A studio's operator reviews every email before it is sent.
- **[ADDED]** Business owners discover the public audit page (E4) through organic search, local business communities, or a self-check link in outbound emails and opt-out pages.

### Constraints

- **Legal:** B2B email must comply with GDPR and ePrivacy; every message needs an identifiable sender and an opt-out.
- **Technology:** Node.js and TypeScript monorepo, MongoDB, Redis with BullMQ, S3-compatible storage; no mock data in runtime code.
- **Resources:** a single developer and the diploma timeline.
- **Cost:** LLM and hosting cost per lead must stay below what a studio is willing to pay for a lead. **[ADDED: With a shared Business audit computed once (~$0.05 for Playwright and vision critique) and a prototype generated only for the right holder (~$0.13), total platform cost stays around $0.18 per pursued lead against a $50–$100 manual agency baseline, setting a clear floor for the auction reserve price.]**

## 4. Solution overview

### Proposed solution

Revamp becomes a two-sided, multi-tenant platform. The platform scans an area and audits each business site once; studios (tenants) bid for the exclusive right to contact a business for a fixed period; business owners can also request an audit of their own site and consent to be contacted. The winning studio sends the email from its own sender, and its operator approves every message.

A key data-model change is the split between a shared **Business** (the company, its site and its audit, computed once) and a tenant-owned **Lead** (one studio's pursuit of that business). The shared audit lowers cost, and the contact right decides which tenant may move a lead toward sending.

**[ADDED: To prevent studios from bypassing the auction by contacting a listed business off-platform, open auctions display a masked business profile (city, niche, deterministic audit scores, site-era signs and reserve price) while hiding the business name, domain, screenshots and contacts until a studio wins the contact right; full MVP prototype generation is likewise unlocked only for the right holder.]**

### High-level architecture

&#91;embedded content: high-level architecture · platform and integrations\]

Both kinds of users enter through one gateway that scopes every request to a tenant. The audit is stored once as shared Business data, while leads, prototypes and drafts stay in each studio's tenant data, and the registry decides which studio may contact which business.

### Alternatives considered

| Alternative | Why it was not chosen as the core |
| --- | --- |
| Auction on a territory (city area) | Does not fix the shared-pool problem for one business and rewards the richest studio with a whole district; kept as an optional premium and for the price map |
| Fixed-price subscription per studio | No price discovery and no answer to two studios wanting the same business |
| Platform sends the email (white-label) | Puts sender reputation and legal responsibility on the platform; the chosen model keeps them with the studio |
| Sale of warm leads only | Changes the operator role to platform staff and removes the point of buying the contact right |
| Matching studios to leads by profile | Fairer to small studios but gives no market price; useful as a comparison in experiments |
| Single studio tool (no multi-tenancy) | Simplest, but limits the market to one customer per city and hides the research value of the market design |

**Chosen:** the contact-right auction for outbound leads combined with the consented inbound flow, with the territory price map as a view on top.

## 5. Epics and priorities

Five epics extend the working core; the first three are mandatory because they carry the new business model and the research part of the thesis.

| Epic | What it delivers | Priority |
| --- | --- | --- |
| E0 Core pipeline (done) | Discovery, audit, MVP generation, review, email, tracking | Must |
| E1 Multi-tenancy | Organizations, users, roles, tenant-scoped data, shared Business and tenant Lead, per-tenant sender and quotas | Must |
| E2 Contact registry and rights | Contact right per business and tenant, time window, cooldown, enforcement in the lead state machine | Must |
| E3 Auction and payments | Sealed-bid second-price auction, reserve price from the audit, ledger, payment provider, auction simulation | Must |
| E4 Inbound flow | Public owner audit, consent capture, sale of consented leads | Should |
| E5 Market map | Heat map of prices and inventory by area and niche | Could |
| Platform-sent email, native apps | Excluded from this project | Won't |

## 6. User stories

Stories are grouped by epic. Each has a statement, context, scope, acceptance criteria, assumptions and risks or dependencies; mockups are drawn when each epic is designed.

### E1 Multi-tenancy

**US1. Create a studio organization** (Must)

- **Statement:** As a studio owner, I want to register my studio and invite colleagues, so that my team works in one private workspace.
- **Context:** Today the system has a single operator and no accounts.
- **Scope:** Registration, organization record, invitations, roles (owner, operator, viewer).
- **Acceptance criteria:** An owner can create an organization; an invited user joins with the assigned role; a viewer cannot approve or send an email.
- **Assumptions:** Email-and-password sign-in is enough for the thesis.
- **Risks and dependencies:** Every existing record needs a tenant; requires a data migration.

**US2. Keep each studio's data isolated** (Must)

- **Statement:** As a studio owner, I want other studios never to see my leads, drafts or prototypes, so that my work and clients stay confidential.
- **Context:** Audits and Business records are shared, but leads, prototypes, drafts and campaigns belong to a tenant.
- **Scope:** A tenant identifier on every tenant-owned record; every query and job filtered by it.
- **Acceptance criteria:** A request from tenant A for a tenant B record returns not found; background jobs read and write only their own tenant's records; tests cover cross-tenant access on every endpoint.
- **Assumptions:** One shared database with row-level separation.
- **Risks and dependencies:** A missed filter leaks data; mitigated by a single data-access layer and tests.

### E2 Contact registry and rights

**US3. Contact only businesses I hold the right for** (Must)

- **Statement:** As a studio operator, I want to send outreach only to businesses where my studio holds an active contact right, so that I do not break the market rules.
- **Context:** The lead state machine already controls every status change.
- **Scope:** An active right is a condition for moving a lead to the scheduled and sent statuses.
- **Acceptance criteria:** Without an active right the transition is rejected with a clear error code; an expired right stops queued sends; human approval is still required.
- **Assumptions:** One tenant holds the right for one business at a time.
- **Risks and dependencies:** Depends on E1 and on the auction in E3 granting rights.

**US4. Protect a business from repeated pitches** (Must)

- **Statement:** As a business owner, I want not to be pitched by several studios in a short time, so that my inbox is not spammed.
- **Context:** Today two users could contact the same business.
- **Scope:** A registry of contacts across all tenants and a cooldown after a right expires.
- **Acceptance criteria:** Within the cooldown no other tenant can obtain or use a right for that business; an opt-out by the business blocks every tenant.
- **Assumptions:** The cooldown length is a platform setting.
- **Risks and dependencies:** Opt-outs must be applied immediately to queued emails.

### E3 Auction and payments

**US5. Bid for the right to contact a business** (Must)

- **Statement:** As a studio operator, I want to place a sealed bid for the right to contact a business for a fixed period, so that I can secure exclusive access to the leads I value most.
- **Context:** Each business has an audit, so a reserve price can reflect how outdated its site is. **[ADDED: The reserve price is calculated deterministically from platform cost plus weighted audit signals (dated site-era score, accessibility violations, missing web standards and slow LCP), never by an LLM.]**
- **Scope:** Open auctions listing **[ADDED: (masked business identity before award: niche, area, audit metrics and reserve price only)]**, sealed bid with a maximum, reserve price, per-tenant limit of simultaneous rights.
- **Acceptance criteria:** A bid below the reserve is rejected; a tenant cannot see other bids **[ADDED: or the unmasked business domain/contacts before winning]**; a tenant cannot exceed its limit; the bid is covered by a payment authorization.
- **Assumptions:** The payment provider supports authorization holds in test and live mode.
- **Risks and dependencies:** Depends on E1 and E2; thin markets may produce auctions with a single bidder.

**US6. Award the right at the second price** (Must)

- **Statement:** As a studio operator, I want the highest bidder to win but pay the second-highest bid, so that I can bid my true valuation.
- **Context:** Closing must be exact and repeatable.
- **Scope:** Closing through delayed background jobs, award, charge, creation of the contact right, refunds of losing holds.
- **Acceptance criteria:** The winner pays the second-highest bid (or the reserve when there is one bidder); a right is created exactly once even if the closing job retries; every charge appears in the ledger.
- **Assumptions:** Ties are broken by the earliest bid.
- **Risks and dependencies:** Payment failure at closing; mitigated by authorization holds and a retry with a fallback to the next bidder.

**US7. Compare auction formats by simulation** (Must)

- **Statement:** As the platform operator, I want to simulate bidders under different auction formats, so that I can choose a format with evidence.
- **Context:** A real market is too small for the thesis; simulation gives the research evaluation.
- **Scope:** A simulator with bidders of different valuations, formats (second price, first price, fixed price), metrics for revenue and unsold slots.
- **Acceptance criteria:** The same seed gives the same result; the report compares revenue, share of unsold slots and winner concentration per format.
- **Assumptions:** Valuation distributions are stated and varied in sensitivity runs.
- **Risks and dependencies:** Results depend on assumed valuations; this is stated in the thesis.

### E4 Inbound flow

**US8. Request an audit and a redesign of my own site** (Should)

- **Statement:** As a business owner, I want to check my website and see a better version, so that I can decide whether to hire a studio.
- **Context:** Owners today have no way to see a prototype without contacting a studio.
- **Scope:** A public page for a site address, the audit result, a prototype, and an explicit consent to be contacted by a studio **[ADDED: that enters the market as a verified, high-priority inbound auction or instant-buy right]**.
- **Acceptance criteria:** An owner gets the audit without registering; a lead is created only after an explicit consent; the consent is stored with time and text; the owner can withdraw it **[ADDED: which immediately revokes any active contact right]**.
- **Assumptions:** The cost of one public audit is covered by the platform.
- **Risks and dependencies:** Abuse of the public form; mitigated by rate limits and a captcha.

### E5 Market map

**US9. See where leads are valuable** (Could)

- **Statement:** As a studio operator, I want a map of auction prices and available businesses by area and niche, so that I can choose where to bid.
- **Context:** Prices of closed auctions give a market signal.
- **Scope:** Map cells coloured by average closing price, with inventory and next auction time on hover.
- **Acceptance criteria:** A cell shows only aggregated data and never reveals a bidder; cells with too few auctions show no price.
- **Assumptions:** Enough closed auctions exist to show a price.
- **Risks and dependencies:** Depends on E3; low volume makes the map sparse.

## 7. Use case diagram

&#91;embedded content: use cases · 5 actors, 9 use cases\]

Studio staff cover the outbound work, business owners use the public audit and can opt out, and the platform operator runs and closes auctions together with the payment provider.

## 8. Non-functional and regulatory requirements

### Non-functional requirements

| Area | Requirement |
| --- | --- |
| Security and isolation | Tenant identifier enforced in one data-access layer; no cross-tenant read or write; secrets per tenant stored encrypted; role-based access control |
| Integrity of auctions | A contact right is created exactly once per closed auction; closing jobs are idempotent; every payment event is recorded in an append-only ledger |
| Determinism and grounding | Metrics, standards checks and contact data come only from deterministic code; a failed measurement is left out, never replaced by a stand-in value |
| Human in the loop | No background job sends email; every send needs an approval by a user with the operator role |
| Performance | An audit finishes within the existing timeout; the auction page loads within 2 seconds for 100 open auctions |
| Scalability | Workers scale horizontally; queues per job type; per-tenant concurrency limits so one studio cannot starve others |
| Availability and recovery | Stalled or failed jobs move leads to an explicit failed status with a readable reason; auctions close correctly after a restart |
| Cost control | Per-tenant LLM quotas; the shared audit is computed once per business and reused |
| Testability | Automated tests for validation, services, API, workers and stores; auction closing and tenant isolation covered by dedicated suites |
| Localization | Dashboard in English, Russian, Belarusian, Polish and Lithuanian |

### Regulatory and compliance needs

| Topic | Need |
| --- | --- |
| GDPR | Lawful basis recorded for processing business contact data; data minimization (business contacts only); retention limits; deletion and access on request |
| ePrivacy and national rules | Rules on marketing email differ by country and some require prior consent even for business recipients; each target market needs a legal review. The inbound flow (E4) produces explicit consent and reduces this risk |
| Opt-out | Every email carries an unsubscribe link; an opt-out is applied across all tenants and blocks future contact rights |
| Sender identity | Each email shows the sending studio's identity and address |
| Consent record | Inbound consent stored with time, text shown and source, and withdrawable |
| Payments | Card data handled only by the payment provider; the platform never stores it |
| Provider terms | Respect the usage policies of OpenStreetMap, Google Places, LLM and email providers |

## 9. Risks and dependencies

### Risks and mitigation

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Thin market: fewer than two bidders per business | Auctions clear at the reserve price and show no price discovery | Reserve and fixed-price fallback; start with niches in large cities; validate by simulation |
| Collusion or one rich studio dominating | Unfair prices, small studios leave | Limit of simultaneous rights per tenant; sealed bids; anonymous results |
| Cross-tenant data leak | Loss of trust, legal exposure | Single data-access layer, tenant filters tested on every endpoint |
| Marketing email rules differ by country | Studios or the platform face complaints or fines | Legal review per market, opt-out across tenants, consent-based inbound flow |
| Studio does not use a right it paid for | Business unreached, wasted inventory | Partial refund and a use-it-or-lose-it rule for unused rights |
| **[ADDED]** Studios bypass the auction and contact listed businesses directly | Platform loses auction revenue and cannot enforce the contact cooldown | Mask business name, domain and contacts in open auction listings until the right is awarded; unlock MVP prototype generation only for the right holder |
| LLM cost or provider outage | Margin loss, stalled audits and prototypes | Shared audits, per-tenant quotas, several providers, explicit failed state |
| Payment failure at auction close | Right not awarded | Authorization holds before closing, retry, fallback to the next bidder |
| Sender reputation of a studio's domain | Emails land in spam | Per-tenant sender verification, sending limits, bounce handling |
| Scope too large for the diploma timeline | Unfinished epics | Priorities: E1 to E3 are mandatory; E4 and E5 only if time allows |
| Abuse of the public audit form | Cost spikes | Rate limits, captcha, per-address quotas |

### Dependencies

- **External services:** OpenStreetMap and Google Places, LLM providers with vision, email providers, a payment provider, S3-compatible storage.
- **Internal order of work:** E2 needs E1 (tenants), E3 needs E2 (rights), E4 needs E1 and E2, E5 needs E3 (prices).
- **Legal input:** a review of marketing email rules for each country where the platform is used.
