// Text of the BA block, in document order. Each section is a heading plus blocks.
// Headings mirror the "BA Block: Requirements and Submission Plan" document; do
// not rename or reorder them without updating that document.
//
// Blocks:
//   'Plain paragraph with **bold**, *italic* and a citation [@key].'
//   { todo: 'REV-185: what is missing' }        one-line TODO, counted by the build
//   { h3: 'Run-in subheading' }                  not listed in the TOC
//   { bullets: ['…', '…'] }  { numbered: ['…'] }
//   { table: { caption, columns: [{ header, width }], rows: [['…', '…']] } }
//                                               widths in DXA, summing to 9070
//   { figure: { label, file: 'figures/x.png', width, height, caption } }   px at 96 dpi
//   label (optional) on figure/table/slot blocks; cite as {fig:label} / {tab:label}
//   { figureSlot: { caption, todo } }           planned figure, caption already numbered
//   { tableSlot: { caption, todo } }            planned table, caption already numbered
//   { backlog: 'section' | 'appendix' }         rendered from backlog.js
//   { references: true }                        rendered from references.js

module.exports = [
  {
    level: 1,
    title: 'Introduction',
    blocks: [
      { h3: 'Relevance and problem' },
      'Small local businesses such as clinics, restaurants, repair shops and beauty salons rely on their websites to be found and contacted, yet many of these sites are slow, hard to use and visibly dated. Web-wide measurements show how common such defects are: in 2026 automated tests detected WCAG 2 accessibility failures on 95.9% of the one million most popular home pages, with an average of 56.1 errors per page [@webaim2026], and in 2024 only 43% of websites had good Core Web Vitals on mobile devices [@almanac2024perf]. These figures describe popular sites in general, not local businesses specifically.',
      'For web development studios and freelancers (called *studios* below) these businesses are natural clients, but reaching them takes manual work. A convincing first contact requires researching the business, assessing its website and preparing a personalised proposal, ideally with a visual example of a better site, and this work is lost when the business does not reply. Studios also draw on the same public sources, such as map services and business directories, so the pool of prospects in a city is finite and shared: one business can receive several competing pitches.',
      'The question is timely because multimodal large language models (LLMs) can now turn a screenshot of a web page into front-end code; a NAACL 2025 benchmark of 484 real web pages found that their main weaknesses are missing visual elements and incorrect layouts [@design2code]. A draft prototype can therefore be generated automatically for each prospect, provided that the output is checked. The same technology sets the limit of automation: language models produce fluent content that their input does not support [@ji2023hallucination], so metrics, contact details and facts in an offer cannot be left to a model, and sending generated e-mails without human review adds legal and reputational risk.',
      'The problem is therefore twofold: the first contact with a local business takes manual work that is repeated for every prospect, and the shared pool of businesses is contested without rules, while full automation with LLMs alone is unreliable. The project addresses it with a multi-tenant SaaS platform, called Revamp below, that audits each business website once with deterministic tools and publishes masked listings. A studio buys the exclusive right to contact a business for a fixed period at a price derived from the audit, receives an LLM-generated MVP prototype of the improved site, and sends the offer from its own address after its operator approves every message.',
      { h3: 'Goal and objectives' },
      'The **goal** of the project is to reduce a web studio’s effort in acquiring qualified clients from among local businesses by developing a multi-tenant SaaS platform that provides deterministic website audits, LLM-generated MVP prototypes and exclusive contact rights. Its **objectives** are:',
      {
        numbered: [
          'Analyse how web studios find clients today, review the literature and existing tools, and identify the gaps (Chapter 1).',
          'Define the vision, measurable KPIs, stakeholders, scope and solution concept of the platform (sections 2.1–2.4).',
          'Specify the functional requirements as epics E1–E5 and prioritised user stories with Given/When/Then acceptance criteria traced to the KPIs (sections 2.5–2.6).',
          'Specify the non-functional and legal requirements (GDPR, ePrivacy, WCAG 2.1 AA) and the project risks (sections 2.7–2.9).',
          'Define how the result is verified against the KPIs: automated tests and a market simulation of the pricing rule (section 2.10).',
        ],
      },
      { h3: 'Object and subject' },
      'The **object** of the project is the process by which web development studios and freelancers acquire new clients among small local businesses. The **subject** is the part of this process that can be automated: finding businesses, auditing their websites, allocating the right to contact a business between studios, preparing a personalised prototype and offer, and sending outreach that a human has approved.',
      { h3: 'Methods' },
      'The requirements were gathered with **document analysis** of legal texts and standards (GDPR, ePrivacy rules, WCAG 2.1) and of the project’s concept and decision log; a **literature review** (section 1.2); a **comparative analysis** of existing lead generation and website audit tools (section 1.3); an **analysis of the existing prototype**, a working single-operator Revamp pipeline (discovery, audit, MVP generation, review and e-mail) on which the KPI baselines K2 and K3 will be measured; and **modelling** with UML diagrams and a planned market simulation of pricing rules. No interviews or surveys with studios or business owners were conducted: the personas in section 2.2 are constructed, and statements about studio behaviour without a source are marked as assumptions.',
    ],
  },

  { level: 1, title: 'Chapter 1. Analysis of the Subject Area', blocks: [] },
  {
    level: 2,
    title: '1.1 Current State of the Process',
    blocks: [
      'Studios and freelancers win clients through referrals, through directories where businesses search for them, such as Clutch (section 1.3), and through their own outbound search. This section describes the outbound path, the one Revamp automates. The description is the author\u2019s model, built from the project concept, the analogs in section 1.3 and the existing Revamp prototype. It was not validated with studios, because no interviews were held, so the duration and frequency of each step are assumptions to be measured in a pilot.',
      'Three parties take part ({fig:asis}). A person at the studio (the owner of a small studio or a freelancer) chooses a niche and an area, finds local businesses in map services and directories, opens each website and judges its quality, looks for contact details, checks the studio\u2019s own records to avoid a second pitch, prepares a proposal with a mock-up and sends a personal e-mail. The business owner receives the e-mail and either replies or ignores it and asks to stop. The tools involved are public map services and directories, website audit tools, the studio\u2019s spreadsheet or CRM, a design tool and an e-mail client.',
      {
        figure: {
          label: 'asis',
          file: 'figures/as-is.png',
          width: 604,
          height: 191,
          caption: 'AS-IS process of a web studio acquiring a client, UML activity diagram (full size in Appendix B)',
        },
      },
      'Time and data are lost at four points, marked L1–L4 in {fig:asis}:',
      {
        bullets: [
          '**L1, quality assessment.** The site is judged by eye or with a tool whose lab scores can change between runs [@psiAbout], and a fast page can still look dated (section 1.3). The result is neither repeatable nor reusable, and it cannot justify a price.',
          '**L2, contact history.** Each studio checks only its own records. No studio knows whether another one has already pitched the business, and an opt-out reaches only the studio that received it.',
          '**L3, proposal and mock-up.** The work is done by hand for each prospect before the studio knows whether the business is interested, and it is lost if there is no reply.',
          '**L4, repeated pitches.** Because studios search the same public sources, one business can receive pitches from several studios and has no single way to stop them.',
        ],
      },
      'Every step up to the e-mail is manual and is repeated for each business, including those that never reply, so the studio\u2019s time grows with the number of businesses it checks rather than with the clients it wins. How long a lead takes was not measured (assumption A3). For context only: sales professionals in general report spending 70% of their time on tasks other than selling [@salesforceSales2024]; the survey does not cover web studios.',
      '**TO-BE.** With Revamp the platform searches an area and audits each website once with deterministic tools, so the evidence is repeatable and shared (L1). Studios browse masked listings and buy the exclusive right to contact a business for a fixed period at a price derived from the audit; a contact registry across all studios blocks repeated pitches and applies every opt-out (L2, L4). The prototype is generated only for the buyer, and the studio\u2019s operator reviews it and approves the e-mail, which is sent from the studio\u2019s own address (L3). A business owner can also audit their own site on a public page and consent to be contacted.',
    ],
  },
  {
    level: 2,
    title: '1.2 Review of Sources',
    blocks: [
      'The sources were chosen to answer four questions that shape the requirements: how good the websites of potential clients are and how this can be measured; how far LLMs can be trusted to prepare an offer; what the law requires from B2B outreach; and how a market for leads should be priced. They include standards and legal texts, peer-reviewed papers and industry reports. Industry reports are used for context only, never as the basis of a KPI.',
      { h3: 'Website quality and its measurement' },
      'Industry measurements show that accessibility and performance defects are common on the web [@webaim2026], [@almanac2024perf], and Google’s case studies report business gains after Core Web Vitals were improved, for example 8% more sales after a 31% improvement of Largest Contentful Paint at Vodafone Italy [@cwvBusinessImpact]. These case studies are published by the author of the metric and describe large companies, so Revamp may use them to explain an offer but never to promise a result. WCAG 2.1 [@wcag21] gives a shared vocabulary for accessibility defects and three conformance levels (A, AA and AAA). Automated checking of it has clear limits: Vigo et al. [@vigo2013] found that six automated tools covered at most 50% of the WCAG 2.0 success criteria and caught 14% to 38% of the violations, and the more complete tools produced more false positives. Two requirements follow. The audit reports violations detected by automated rules and never states that a site does or does not conform to WCAG. And because the audit result sets the price, it must be repeatable rather than complete: the same site must give the same result (KPI in section 2.1, determinism requirement in section 2.7).',
      { h3: 'Reliability of LLM-generated content' },
      'Si et al. [@design2code] show that multimodal models can produce a web page from a screenshot, but that they miss visual elements and get layouts wrong. Ji et al. [@ji2023hallucination] describe hallucination, content that is not supported by the source, as a general problem of neural text generation. For Revamp this means that a model may design and write the prototype, but code must check the page before anyone sees it and must keep every fact: metrics, contact details, prices and names come only from deterministic extraction. The operator reviews the prototype and approves every e-mail (US3; the grounding and human-in-the-loop requirements in section 2.7; the share of generated pages that pass the code checks as a KPI in section 2.1).',
      { h3: 'Legal rules for B2B outreach' },
      'The GDPR [@gdpr] applies whenever a business contact identifies a natural person, for example the e-mail address of a sole trader. Recital 47 states that processing for direct marketing may be regarded as carried out for a legitimate interest, so Article 6(1)(f) can be the legal basis for outbound contact after a balancing test. Article 21(2)–(3) gives the person the right to object at any time, after which the data may no longer be processed for marketing; Article 5(1)(c) requires data minimisation and Article 25 data protection by design. The ePrivacy Directive [@eprivacy] requires prior consent for marketing e-mail to natural persons (Article 13(1)), apart from similar products offered to existing customers, leaves the protection of legal persons to national law (Article 13(5)), and prohibits marketing e-mail that conceals the sender or has no valid address for opting out (Article 13(4)). The platform therefore stores only business contacts published by the business, applies every opt-out across all studios (US4), shows the sending studio’s identity in each message, needs a legal review for each target country, and offers a consent-based inbound flow (US8) as the lawful channel where prior consent is required (section 2.8).',
      { h3: 'Pricing a market for leads' },
      'Rochet and Tirole [@rochet2003] model platforms that must attract both sides of a market and analyse what determines how prices are allocated between the sides. Revamp has two such sides: studios pay for contact rights, while business owners pay nothing and are protected by the contact registry and offered a free public audit (US4, US8). Einav et al. [@einav2018] explain why eBay sellers moved from auctions to posted prices as a trade-off between competitive price discovery and convenience, driven mainly by falling demand for auctions. This supports selling contact rights at a fixed, published price derived from the audit (US5) and deferring the auction until the platform has enough studios (section 2.4).',
      'Overall, the sources confirm the need for the product and set three limits on it: automated audits are partial, LLM output must be checked, and outreach must respect objections and, in some countries, prior consent. {tab:sources} links each source to the requirements it informs.',
      {
        table: {
          label: 'sources',
          caption: 'Sources and the requirements they inform',
          columns: [
            { header: 'Source', width: 1100 },
            { header: 'Finding used', width: 4170 },
            { header: 'Requirement in Chapter 2', width: 3800 },
          ],
          rows: [
            ['[@webaim2026]', 'WCAG 2 failures detected on 95.9% of the top one million home pages', 'Accessibility check in the audit; audit signal in the price (US5)'],
            ['[@almanac2024perf]', '43% of websites have good Core Web Vitals on mobile', 'LCP and CLS measured in the audit; audit signal in the price (US5)'],
            ['[@cwvBusinessImpact]', 'Vendor case studies link Core Web Vitals gains with business results', 'Context for the offer only; no KPI is based on it'],
            ['[@wcag21]', 'Defines accessibility success criteria and levels A, AA and AAA', 'Dashboard and public audit page meet WCAG 2.1 AA (2.7, 2.8)'],
            ['[@vigo2013]', 'Automated tools cover at most 50% of criteria and catch 14–38% of violations', 'Audit reports detected violations, never conformance; audit repeatability KPI (2.1)'],
            ['[@design2code]', 'Screenshot-to-code models miss elements and get layouts wrong', 'Code checks of every generated page; first-attempt pass rate KPI (2.1)'],
            ['[@ji2023hallucination]', 'Language models generate content not supported by their input', 'Metrics and contacts only from deterministic code; human approval (US3, 2.7)'],
            ['[@gdpr]', 'Legitimate interest for direct marketing; right to object; minimisation; protection by design', 'Opt-out across all studios (US4); business contacts only; masking and tenant isolation (US2, US10)'],
            ['[@eprivacy]', 'Prior consent for natural persons; national rules for legal persons; sender identity and opt-out address', 'Legal review per country; studio sender identity; consent-based inbound flow (US8, 2.8)'],
            ['[@salesforceSales2024]', 'Sales professionals report spending 70% of their time on tasks other than selling', 'Context for G1 only; the K1 baseline is measured, not taken from it (A3)'],
            ['[@rochet2003]', 'Platforms must attract both sides; prices are allocated between the sides', 'Studios pay, business owners use the platform free of charge (US8)'],
            ['[@einav2018]', 'Online sellers moved from auctions to posted prices for convenience', 'Fixed-price purchase (US5); auction deferred (2.4)'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '1.3 Analysis of Analogs',
    blocks: [
      'Three existing solutions were compared, one from each group that covers part of the studio’s task: a commercial B2B contact database with outreach automation (Apollo.io), an open-source website audit tool (Lighthouse with its hosted front end PageSpeed Insights), and a commercial marketplace where businesses look for web development companies (Clutch). Each fact in the comparison comes from the vendor’s own pages or from the author’s hands-on trials in October 2026, and a property the sources do not state is marked "not stated". A fourth candidate, the SEOptimer embeddable audit widget for agencies, was dropped because its website blocked automated access with a bot check, so its features could not be verified. {tab:analogs} summarises the comparison.',
      { h3: 'Apollo.io (commercial, tried)' },
      'Apollo.io presents itself as a single platform for B2B data, AI agents and outreach and advertises a database of more than 240 million contacts and 30 million companies [@apolloHome]. It offers Free, Basic, Professional and Custom plans with credits shared by the team; the pricing page lists no amounts, shows a "GDPR Compliant" label and says nothing about exclusive contacts [@apolloPricing]. Outreach runs as sequences whose steps can be automatic or manual e-mails [@apolloSequences], so messages can be sent without a person approving each one. The author tried Apollo with a personal account. It offers a very broad set of functions for finding leads, but none of them is focused on the quality of a prospect’s website. The website data it does offer is visitor tracking: the Apollo Script is installed on the customer’s own websites and shows which companies visit them [@apolloVisitors], so it describes the studio’s own site, not the sites of its prospects. Apollo is therefore a source of contacts rather than an alternative to an offer built on a website audit.',
      { h3: 'Lighthouse and PageSpeed Insights (open source, tried)' },
      'Lighthouse is an open-source tool under the Apache-2.0 license that audits a page for performance, accessibility, best practices and SEO and can run from Chrome DevTools, the command line or a Node module [@lighthouseRepo]; PageSpeed Insights runs it in a simulated environment [@psiAbout]. It was tried on the W3C "Before and After" demonstration page, a site built to be inaccessible: the mobile report gave Performance 100, Accessibility 50, Best Practices 88 and SEO 75 ({fig:psi} in Appendix B). Two observations matter for Revamp. First, a visibly dated page scored 100 for performance, so speed alone does not show that a site needs a redesign. Second, Google states that lab scores can change between runs even when the page has not changed [@psiAbout], so a single run is a weak basis for a price. Lighthouse finds no leads and sends nothing.',
      { h3: 'Clutch (commercial, tried without an account)' },
      'Clutch is a directory where business buyers look for service providers; its web development category listed 99,797 companies, sorted by "Sponsored" by default, with the note "We may earn a fee for some placements" [@clutchWebDev] ({fig:clutch} in Appendix B). The directory was browsed without an account. It works in the opposite direction to outbound lead generation: the business owner must already know that the site needs work and must start the search, and studios pay for visibility to all buyers, not for access to a particular business.',
      {
        table: {
          label: 'analogs',
          caption: 'Comparison of analogs with the proposed solution',
          columns: [
            { header: 'Criterion', width: 1710 },
            { header: 'Apollo.io', width: 1840 },
            { header: 'Lighthouse / PSI', width: 1840 },
            { header: 'Clutch', width: 1840 },
            { header: 'Revamp (proposed)', width: 1840 },
          ],
          rows: [
            ['Type; tried', 'Commercial SaaS; tried', 'Open source, Apache-2.0; tried', 'Commercial marketplace; browsed', 'Diploma project'],
            ['Lead source', 'Own database: 240M+ contacts, 30M+ companies [@apolloHome]', 'None: audits a URL the user enters', 'Business buyers search a directory [@clutchWebDev]', 'Public map data, each site audited once'],
            ['Evidence for the offer', 'Contact and company data; visitors tracked only on the customer’s own site [@apolloVisitors]; no site audit', 'Audit report in four categories, no offer', 'Provider reviews; no audit of the buyer’s site', 'Deterministic audit and an LLM-generated prototype'],
            ['Repeatability of results', 'Not applicable', 'Lab scores can vary between runs [@psiAbout]', 'Not applicable', 'Same site gives the same audit result (KPI)'],
            ['Exclusive access to a lead', 'Not stated [@apolloPricing]', 'Not applicable', 'No; studios buy placements [@clutchWebDev]', 'Exclusive right for a fixed period'],
            ['Human approval before sending', 'Optional: automatic or manual e-mail steps [@apolloSequences]', 'Not applicable (no outreach)', 'Not applicable (buyer contacts studio)', 'Required for every e-mail'],
            ['Consent and opt-out', '"GDPR Compliant" label; details not stated [@apolloPricing]', 'Not applicable', 'Not applicable', 'Opt-out across all studios; consent-based inbound flow'],
            ['Pricing model', 'Plans with credits; amounts not listed [@apolloPricing]', 'Free', 'Free for buyers; paid placements for providers', 'Fixed price per contact right, derived from the audit'],
            ['Several studios on one platform', 'Team seats share credits [@apolloPricing]', 'No accounts', 'One profile per provider', 'Organizations with roles and isolated data'],
          ],
        },
      },
      { h3: 'What is missing' },
      'None of the compared solutions links the three parts of the studio’s task. Apollo supplies contacts and automates sending, but gives no evidence about the business’s website, no exclusivity and no mandatory human approval. Lighthouse gives such evidence, but only for a URL the user already has, with no lead, no offer and results that can vary between runs. Clutch connects businesses with studios, but only when the business starts the search, and it sells visibility rather than access to a specific business. Revamp is meant to fill this gap with four properties, which are the input to section 1.4: a repeatable deterministic audit as the evidence for each lead, an LLM-generated prototype of the improved site, an exclusive right to contact the business at a price derived from the audit, and human approval of every message with an opt-out that applies to all studios.',
    ],
  },
  {
    level: 2,
    title: '1.4 Conclusions to Chapter 1',
    blocks: [
      'The analysis of the process (section 1.1), the sources (section 1.2) and the analogs (section 1.3) leads to five problems. {tab:problems} links each problem to the epic that addresses it and, where one exists, to the KPI that measures the result; epics E1–E5 and the existing core pipeline E0 are specified in section 2.5, and KPIs K1–K4 in section 2.1.',
      {
        table: {
          label: 'problems',
          caption: 'Problems, epics and KPIs',
          columns: [
            { header: 'ID', width: 600 },
            { header: 'Problem', width: 5070 },
            { header: 'Epic', width: 1500 },
            { header: 'KPI', width: 1900 },
          ],
          rows: [
            ['P1', 'The first contact takes manual work: research, assessment and a mock-up are made by hand for every prospect and are lost without a reply (L1, L3).', 'E0, E3', 'K1 operator time per reviewed lead'],
            ['P2', 'Website quality is judged by eye or by tools whose results vary between runs, so it cannot serve as evidence or as the basis of a price (L1) [@psiAbout], [@vigo2013].', 'E0, E3', 'K2 audit repeatability'],
            ['P3', 'Automation with LLMs alone is unreliable: models miss layout details and produce unsupported content, and unreviewed e-mail creates legal risk [@design2code], [@ji2023hallucination].', 'E0, E2', 'K3 generated pages passing code checks on the first attempt'],
            ['P4', 'The pool of businesses is shared and finite: one business gets several pitches, opt-outs are not shared, and no studio can secure exclusive access at a known price (L2, L4).', 'E2, E3, E5', 'K4 businesses contacted by two studios within the cooldown'],
            ['P5', 'Studios keep their histories in separate tools, and a shared platform must keep each studio\u2019s leads private while sharing audits and opt-outs; a business owner can get an offer only by searching for studios (section 1.3).', 'E1, E4', 'No KPI; isolation checked by NFR3'],
          ],
        },
      },
      'The new solution must therefore audit each business once and repeatably, generate a checked prototype only for the studio that holds the contact right, sell that right exclusively at a deterministic price, keep a human approval before every message, apply opt-outs across all studios, and isolate each studio\u2019s data while sharing the audit.',
    ],
  },

  { level: 1, title: 'Chapter 2. Requirements for the Revamp Platform', blocks: [] },
  {
    level: 2,
    title: '2.1 Vision and Business Goals',
    blocks: [
      '**Vision.** Revamp gives web studios ready, evidence-backed leads. It audits the websites of local businesses once with deterministic tools, builds an LLM-generated prototype of a better site from the business’s own content, and sells each studio the exclusive right to contact a business at a fixed price, with a human approving every message.',
      'The business goals follow from the problems in section 1.4:',
      {
        bullets: [
          '**G1.** Cut the time a studio spends on each reviewed lead, while keeping a human approval before every message (P1).',
          '**G2.** Replace the contested pool of businesses with a fair market: one studio at a time holds the right to contact a business, at a transparent price (P4).',
          '**G3.** Keep every metric and contact detail deterministic and verifiable, and check every generated page by code (P2, P3).',
          '**G4.** Serve many studios on one platform with strict data isolation, and let business owners audit their own site and consent to be contacted (P5).',
        ],
      },
      '{tab:kpis} defines the KPIs that measure these goals. The targets are proposals to be confirmed in a pilot. A baseline marked "not yet measured" is measured before epics E1–E3 are built (section 2.10); none is estimated without data.',
      {
        table: {
          label: 'kpis',
          caption: 'Key performance indicators: baseline, target and measurement',
          columns: [
            { header: 'ID', width: 550 },
            { header: 'KPI', width: 1800 },
            { header: 'Baseline', width: 2250 },
            { header: 'Target', width: 1650 },
            { header: 'Measurement', width: 2170 },
            { header: 'Goal', width: 650 },
          ],
          rows: [
            ['K1', 'Operator time per reviewed lead', 'Manual process: not measured (A3); timed on the manual process before the pilot', 'At most 15 minutes', 'Median time from purchase of the right to approval of the e-mail, from dashboard timestamps', 'G1'],
            ['K2', 'Audit repeatability', 'Manual or Lighthouse assessment: lab scores vary between runs [@psiAbout]; Revamp audit: not yet measured', 'At least 95% of sampled sites get the same audit band and price on two runs', 'Audit at least 20 public sites twice, one day apart, and compare the price inputs', 'G3'],
            ['K3', 'Generated pages that pass the code checks on the first attempt', 'Current generator: not yet measured', 'At least 80%', 'Results of the page checks over at least 30 generations', 'G3'],
            ['K4', 'Businesses contacted by two studios within the cooldown', 'Not controlled today: no shared contact history (section 1.1, L2)', '0', 'Query of the contact registry after the pilot and in the market simulation', 'G2'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.2 Stakeholders and Users',
    blocks: [
      '{tab:stakeholders} lists the stakeholders with their interest in the project and their influence on it (H, M or L).',
      {
        table: {
          label: 'stakeholders',
          caption: 'Stakeholders: role, interest and influence',
          columns: [
            { header: 'Stakeholder', width: 2300 },
            { header: 'Interest', width: 4170 },
            { header: 'Influence', width: 1100 },
            { header: 'User of the system', width: 1500 },
          ],
          rows: [
            ['Web studio owner or freelancer', 'Qualified leads, exclusive access, control of outgoing e-mail, predictable cost', 'H', 'Yes (owner role)'],
            ['Studio operator', 'Fast review of prototypes and drafts; no message sent without approval', 'M', 'Yes (operator role)'],
            ['Business owner', 'An honest audit, a relevant offer, no repeated pitches, control over own data', 'M', 'Yes (public page, opt-out)'],
            ['Platform operator', 'Revenue from contact rights, a healthy market, low LLM and hosting cost', 'H', 'Yes (administration)'],
            ['Data protection authority', 'Lawful B2B contact, consent where required, working opt-out', 'H', 'No'],
            ['Payment provider', 'Payments within its terms; card data stays with the provider', 'M', 'External system'],
            ['LLM and e-mail providers', 'Use within their terms and rate limits', 'M', 'External system'],
            ['Supervisor and committee', 'Clear scope, verifiable results, honest evidence', 'H', 'No'],
          ],
        },
      },
      'The system has four kinds of users: studio owners, who manage the organization, its members and its budget; studio operators, who browse listings, buy rights, review prototypes and approve e-mails (a viewer role can read but not approve or send); business owners, who use the public audit page and the opt-out; and the platform operator, who schedules scans, sets release times and prices and runs the market simulation. Two **constructed personas** summarise the studio side. They are derived from the problem analysis in Chapter 1, not from interviews with real people.',
      '**Persona A, the solo freelancer.** Builds sites for local businesses in one city and does outreach alone after client work. Needs a few qualified leads a week with evidence to show the owner, cannot afford unanswered mock-ups, and fears complaints that would hurt their own domain. Key stories: buy a contact right (US5), browse masked listings (US10), contact only businesses they hold the right for (US3).',
      '**Persona B, the small studio owner.** Runs a few developers and one person who handles outreach. Needs a shared workspace with roles, control of spending on leads, and certainty that two members never pitch the same business. Key stories: create a studio organization (US1), keep the studio’s data isolated (US2), save interests in a niche and an area (US11).',
    ],
  },
  {
    level: 2,
    title: '2.3 Scope',
    blocks: [
      '**In scope.** The existing core pipeline E0 (discovery, audit, MVP generation with code checks, review, e-mail and tracking) and its extension with epics E1–E5 as prioritised in section 2.5: E1 multi-tenancy, E2 contact registry and rights and E3 purchase and payments (Must), E4 inbound flow (Should) and E5 market map (Could).',
      '**Out of scope.** Sending e-mail from a platform domain on behalf of studios; building or hosting full multi-page production websites; collecting data about private individuals (only business contacts published by the business); native mobile applications; payouts between studios. Auctions of contact rights or of whole areas, and self-serve publishing for business owners with a reverse auction of studios, are deferred as possible future work.',
      {
        table: {
          label: 'assumptions',
          caption: 'Assumptions and constraints',
          columns: [
            { header: 'ID', width: 600 },
            { header: 'Type', width: 1300 },
            { header: 'Statement', width: 4170 },
            { header: 'Effect if it does not hold', width: 3000 },
          ],
          rows: [
            ['A1', 'Assumption', 'Public map data and business websites stay available within their usage policies.', 'Discovery or audits stop for the affected source; the failure is shown, never filled with made-up data.'],
            ['A2', 'Assumption', 'At least one LLM provider with vision support is available, through the platform or the studio’s own key.', 'Prototypes cannot be generated; the run ends in a visible failure with no stand-in page.'],
            ['A3', 'Assumption', 'The manual process takes enough of a studio\u2019s time per lead that cutting it to minutes matters; its duration was not measured.', 'G1 and K1 lose their value; the K1 baseline is timed on the manual process before the pilot.'],
            ['C1', 'Constraint', 'One developer and the diploma timeline; the BA block is due on 30 October 2026.', 'E1–E3 are mandatory; E4 and E5 are built only if time allows.'],
            ['C2', 'Constraint', 'GDPR and ePrivacy rules: lawful basis, identifiable sender, opt-out, consent where national law requires it [@gdpr], [@eprivacy].', 'Outreach is limited to markets after a legal review; the inbound flow is the consent-based channel.'],
            ['C3', 'Constraint', 'Node.js and TypeScript monorepo, MongoDB, Redis with BullMQ, S3-compatible storage; no mock data in runtime code.', 'Alternatives such as PostgreSQL or Temporal are out of scope for this project.'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.4 Solution Concept',
    blocks: [
      'Revamp is a multi-tenant SaaS platform; each studio is a tenant. A studio saves private **interests** (a niche and an area). An interest is only a demand signal: it gives no right and no priority, and other studios never see it. When there is enough demand, or when the platform operator schedules it, the platform scans the area, audits each matching website once and publishes **masked listings** at published release times. A listing shows the niche, the district, the audit result and the price, but not the business name, domain, screenshots or contacts; a listing that fewer than k similar businesses share is withheld so that a profile cannot single out a company.',
      'A studio **buys** the exclusive right to contact a business for a fixed period. The price is derived deterministically from the audit, never by an LLM. The first studio to buy a lot holds it in a short reservation while it pays; if the payment fails or the reservation expires, the lot is released. Only then are the identity of the business revealed and the LLM prototype generated. The studio’s operator reviews the prototype and approves the e-mail, which is sent from the studio’s own address. A contact registry across all studios blocks other pitches during the right and a cooldown after it, and applies every opt-out to all studios. Business owners can also audit their own site on a public page and consent to be contacted, which creates an inbound lead.',
      'The data model separates a shared **Business** (the company, its site and its audit, computed once) from a tenant-owned **Lead** (one studio’s pursuit of that business). {fig:context} shows the platform with its users and external systems.',
      {
        figure: {
          label: 'context',
          file: 'figures/context.png',
          width: 604,
          height: 306,
          caption: 'Context diagram of the Revamp platform (full size in Appendix B)',
        },
      },
      '{tab:alternatives} compares the main design decisions with the alternatives that were considered.',
      {
        table: {
          label: 'alternatives',
          caption: 'Solution alternatives and rationale',
          columns: [
            { header: 'Decision', width: 1600 },
            { header: 'Alternative', width: 2100 },
            { header: 'Chosen', width: 2100 },
            { header: 'Rationale', width: 3270 },
          ],
          rows: [
            ['How a business is allocated to a studio', 'Auction of the contact right (sealed bid)', 'Fixed-price purchase; the first studio to reserve and pay gets the right', 'An auction needs enough bidders, which a young market lacks; posted prices trade some price discovery for convenience [@einav2018]. The auction stays as future work.'],
            ['Where leads come from', 'Each studio searches and audits on its own', 'Shared pool: the platform scans on demand, audits each business once and releases lots at published times', 'Separate searches repeat the audit cost and cannot prevent repeated pitches (L2, L4); a shared audit is computed once and the registry enforces exclusivity.'],
            ['Who sends the e-mail', 'The platform sends on behalf of studios (white label)', 'Each studio sends from its own address after approval', 'Keeps sender reputation and legal responsibility with the studio and meets the sender identity rule [@eprivacy].'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.5 Functional Requirements',
    blocks: [
      'The functional requirements are organised into epics E1–E5, which extend the existing core pipeline E0. Each user story follows the form "As a … I want … so that …" and has a MoSCoW priority; every Must story has acceptance criteria in Given/When/Then form. Story IDs US1–US12 come from the project\u2019s business analysis, US13–US14 describe the implemented core that the new epics rely on, and US15–US17 record the deferred ideas as Won\u2019t. {tab:backlog} lists the backlog; Appendix A repeats it unchanged, because both tables are generated from one source.',
      { backlog: 'section' },
      '{tab:trace} traces the business goals and KPIs from section 2.1 to the epics and stories. Wireframes of four key stories (masked listing, purchase with reservation, lead review with approval, and the owner\u2019s audit with consent) are shown in {fig:wireframes} in Appendix B.',
      {
        table: {
          label: 'trace',
          caption: 'Traceability: goal and KPI → epic → user story',
          columns: [
            { header: 'Goal', width: 900 },
            { header: 'KPI', width: 1100 },
            { header: 'Epic', width: 1600 },
            { header: 'User stories', width: 5470 },
          ],
          rows: [
            ['G1', 'K1', 'E0, E3', 'US13 review and approve, US5 buy a right, US10 masked listing, US11 interests'],
            ['G2', 'K4', 'E2, E3, E5', 'US3 contact only with a right, US4 no repeated pitches, US5, US6 right granted once, US7 pricing simulation, US12 scans and releases, US9 market map'],
            ['G3', 'K2, K3', 'E0, E3', 'US14 deterministic facts and checked pages, US5 identical audit gives identical price, US7'],
            ['G4', 'NFR3 (no KPI)', 'E1, E4', 'US1 studio organization, US2 data isolation, US8 owner audit and consent'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.6 Use Cases',
    blocks: [
      'Two use cases describe the key flows of the outbound and the inbound channel. {fig:sequence} in Appendix B shows the system sequence diagram of UC1.',
      {
        table: {
          label: 'uc1',
          caption: 'UC1: a studio buys a contact right (US5, US6, US10)',
          columns: [{ header: 'Element', width: 1700 }, { header: 'Description', width: 7370 }],
          rows: [
            ['Actor', 'Studio operator; secondary actor: payment provider'],
            ['Precondition', 'The operator is signed in, the lot is released, and the studio is below its limit of simultaneous rights.'],
            ['Main flow', [
              '1. The operator filters open lots by niche, area and audit band; the system shows masked lots with price and release time.',
              '2. The operator buys a lot; the system reserves it for the studio for a short time and requests a payment.',
              '3. The operator pays on the payment provider’s page; the provider reports success.',
              '4. The system records the charge in the ledger and creates the contact right exactly once.',
              '5. The system re-checks the site, reveals the business and starts generating the prototype.',
            ]],
            ['Alternative flows', [
              '2a. The lot is already reserved or sold: the purchase is rejected and the lot is shown as unavailable.',
              '3a. The payment fails or the reservation expires: the lot is released and no charge is recorded.',
              '5a. The re-check finds the business invalid (closed, unreachable, already redesigned): the right is cancelled and the price refunded.',
            ]],
            ['Postcondition', 'The studio holds the right for the fixed period; the registry blocks other studios.'],
          ],
        },
      },
      {
        table: {
          label: 'uc2',
          caption: 'UC2: a business owner requests an audit and consents to contact (US8)',
          columns: [{ header: 'Element', width: 1700 }, { header: 'Description', width: 7370 }],
          rows: [
            ['Actor', 'Business owner, without an account'],
            ['Precondition', 'The owner’s site is publicly reachable.'],
            ['Main flow', [
              '1. The owner enters the site address; the system checks the rate limit and the captcha.',
              '2. The system audits the site, or reuses a recent audit, and shows the result and a prototype.',
              '3. The owner gives explicit consent; the system stores it with time, text and source and creates an inbound lead offered at a fixed price.',
            ]],
            ['Alternative flows', [
              '2a. The site cannot be loaded: the failure is shown and no result is made up.',
              '3a. The owner leaves without consent: no lead is created. Later withdrawal ends any right, cancels queued e-mails and refunds the unused part.',
            ]],
            ['Postcondition', 'A consented lead is on the market, or nothing is stored beyond the audit.'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.7 Non-Functional Requirements',
    blocks: [
      '{tab:nfr} lists the non-functional requirements. Each has a measurable target and is linked to a KPI or a story; the targets are proposals to be confirmed together with the KPIs.',
      {
        table: {
          label: 'nfr',
          caption: 'Non-functional requirements',
          columns: [
            { header: 'ID', width: 750 },
            { header: 'Area', width: 1500 },
            { header: 'Requirement and measurable target', width: 5320 },
            { header: 'Link', width: 1500 },
          ],
          rows: [
            ['NFR1', 'Performance', 'The listing page with 100 open lots loads within 2 s (95th percentile).', 'US10, K1'],
            ['NFR2', 'Performance', 'Loading a site for the audit is bounded by the existing 25 s navigation timeout; a site that does not load gets a failed audit with a readable reason.', 'US14, K2'],
            ['NFR3', 'Security', 'Zero cross-tenant reads or writes in an isolation test suite that covers 100% of tenant-scoped endpoints and jobs.', 'US2'],
            ['NFR4', 'Integrity', 'Exactly one right per successful payment: 0 duplicate rights under 100 concurrent purchase attempts on one lot.', 'US6, K4'],
            ['NFR5', 'Availability', 'An unpaid reservation is released within 1 minute of its expiry, also after a worker restart.', 'US6'],
            ['NFR6', 'Determinism', 'Metrics and contacts come only from deterministic code; a failed measurement is left out (0 stand-in values in audits).', 'US14, K2'],
            ['NFR7', 'Human in the loop', '0 e-mails sent without the approval of a user with the operator role, checked against the send log.', 'US13, US3'],
            ['NFR8', 'Usability', 'The dashboard and the public audit page meet WCAG 2.1 AA, with 0 axe-core violations at levels A and AA on key screens; the dashboard is available in 5 languages.', 'US8, US10'],
            ['NFR9', 'Anti-scraping', 'Listing requests are rate limited per studio (proposed: 60 per minute); identity fields are never serialized before purchase.', 'US10'],
            ['NFR10', 'Testability', 'Automated test coverage of at least 70%, with dedicated suites for purchases and tenant isolation.', 'US2, US6'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.8 Legal and Ethical Requirements',
    blocks: [
      '**Personal data.** The platform processes business contact details that the business itself publishes (e-mail address, phone number, address), which identify a natural person in the case of a sole trader; the account data of studio users; and consent records of the inbound flow. It processes no data about private individuals. The legal basis for outbound B2B contact is legitimate interest under Article 6(1)(f) GDPR, supported by Recital 47 and a balancing test, with the right to object under Article 21 applied across all studios [@gdpr]. The inbound flow relies on consent, which is stored with its time and text and can be withdrawn; studio accounts and payments rely on the contract. Because Article 13 of the ePrivacy Directive leaves the rules for legal persons to national law [@eprivacy], each target country needs a legal review before outreach starts there. The roles of the platform and the studios as controllers, retention periods and the handling of access and deletion requests will be fixed in a Privacy Notice and a Data Processing Agreement (task REV-176).',
      '**Participants.** No interviews or surveys were carried out, so no participant consent was needed; Lighthouse and Clutch were tried on public pages without accounts, and Apollo with the author’s own account.',
      '**Licenses.** The main dependencies are open source: Playwright (Apache-2.0), axe-core (MPL-2.0), Express, Mongoose, BullMQ, React and Material UI (MIT). OpenStreetMap data is available under the Open Database License and requires attribution [@osmCopyright]; Google Places data is used under Google’s terms.',
      '**Standards and ethics.** The dashboard and the public audit page must meet WCAG 2.1 AA [@wcag21] (NFR8). Audit reports must never claim that a site conforms to WCAG, because automated checks cover only part of it [@vigo2013]. Every e-mail must name the sending studio and carry an opt-out, and the k threshold of masked listings prevents profiling of a single business.',
    ],
  },
  {
    level: 2,
    title: '2.9 Risks',
    blocks: [
      '{tab:risks} lists the main risks with their probability (P) and impact (I), rated H, M or L by the author.',
      {
        table: {
          label: 'risks',
          caption: 'Risk register',
          columns: [
            { header: 'ID', width: 550 },
            { header: 'Risk', width: 2400 },
            { header: 'P', width: 450 },
            { header: 'I', width: 450 },
            { header: 'Mitigation', width: 3520 },
            { header: 'Dependency', width: 1700 },
          ],
          rows: [
            ['R1', 'Thin market: too few studios per area, lots stay unsold', 'H', 'H', 'Start with large cities; calibrate prices in the simulation; consider a price that falls while a lot stays unsold', 'E3, US7'],
            ['R2', 'Scope too large for the timeline', 'H', 'H', 'MoSCoW: E1–E3 first, E4 and E5 only if time allows', 'C1'],
            ['R3', 'Marketing e-mail rules differ by country', 'M', 'H', 'Legal review per market; opt-out across studios; consent-based inbound flow', 'E2, E4, REV-176'],
            ['R4', 'Cross-tenant data leak', 'L', 'H', 'One data-access layer; isolation tests on every endpoint (NFR3)', 'E1'],
            ['R5', 'A masked profile identifies a business and the purchase is bypassed', 'M', 'M', 'Coarse areas, banded scores, k threshold, rate limits (NFR9)', 'E3, US10'],
            ['R6', 'LLM cost rises or the provider fails', 'M', 'M', 'Audit once per business; per-studio quotas; several providers; visible failure state', 'E0, A2'],
            ['R7', 'Overpayment for a business bought on a masked profile', 'M', 'M', 'Re-check before the right is granted; refund for invalid businesses', 'E3, US5'],
          ],
        },
      },
    ],
  },
  {
    level: 2,
    title: '2.10 Conclusions to Chapter 2',
    blocks: [
      'The specification fixes the vision, four business goals and KPIs K1–K4 with their baselines and targets, the scope with its assumptions and constraints, the solution concept with the rejected alternatives, 17 user stories (14 in six epics and 3 deferred; all 12 Must stories have Given/When/Then criteria), two use cases, ten non-functional requirements, the legal basis of processing and seven risks. The result will be verified as follows:',
      {
        bullets: [
          '**K1:** the median operator time per reviewed lead is at most 15 minutes in a pilot, compared with a baseline measured on the manual process first.',
          '**K2:** at least 95% of at least 20 audited sites get the same band and price on two runs a day apart.',
          '**K3:** at least 80% of at least 30 generated pages pass the code checks on the first attempt.',
          '**K4:** the contact registry shows no business contacted by two studios within the cooldown, in the pilot and in the simulation.',
          '**Stories and NFRs:** every Given/When/Then criterion becomes an automated acceptance test, and NFR1–NFR10 are checked by load, isolation and accessibility tests. The market simulation (US7) compares revenue, unsold share, buyer concentration and overpayment for each pricing rule.',
        ],
      },
    ],
  },

  {
    level: 1,
    title: 'References',
    blocks: [{ references: true }],
  },
  {
    level: 1,
    title: 'Appendix A. Product Backlog',
    blocks: [{ backlog: 'appendix' }],
  },
  {
    level: 1,
    title: 'Appendix B. Diagrams',
    landscape: true,
    blocks: [
      {
        figure: {
          label: 'asisFull',
          file: 'figures/as-is.png',
          width: 920,
          height: 291,
          caption: 'AS-IS process of a web studio acquiring a client, UML activity diagram (full size of {fig:asis})',
        },
      },
      {
        figure: {
          label: 'contextFull',
          file: 'figures/context.png',
          width: 900,
          height: 456,
          caption: 'Context diagram of the Revamp platform (full size of {fig:context})',
        },
      },
      {
        figure: {
          label: 'wireframes',
          file: 'figures/wireframes.png',
          width: 820,
          height: 512,
          caption: 'Wireframes of key user stories: (a) masked lot listing, (b) purchase with reservation, (c) lead review with approval, (d) owner audit with consent',
        },
      },
      {
        figure: {
          label: 'psi',
          file: 'figures/analog-psi.png',
          width: 704,
          height: 440,
          caption: 'PageSpeed Insights (Lighthouse) report for the W3C "Before and After" demonstration page, mobile, 26 October 2026',
        },
      },
      {
        figure: {
          label: 'clutch',
          file: 'figures/analog-clutch.png',
          width: 704,
          height: 440,
          caption: 'Clutch directory of web development companies, 26 October 2026',
        },
      },
      {
        figure: {
          label: 'sequence',
          file: 'figures/sequence.png',
          width: 760,
          height: 503,
          caption: 'System sequence diagram of UC1: a studio buys a contact right',
        },
      },
    ],
  },
  {
    level: 1,
    title: 'Statements',
    blocks: [
      '**Use of artificial intelligence.** This document was prepared with the help of Claude (Anthropic), model Claude Opus 5.5, used through Claude Code. It was used to structure the document; to draft and edit the English text from the author\u2019s project materials; to search for sources and check their bibliographic data against the publishers\u2019 pages; to write the code that draws the diagrams and wireframes and builds this DOCX file; and to check the text against the requirements of the Business Analysis block. Every source was opened and checked. The goal, the objectives and the design decisions are the author\u2019s, and the author reviewed the final text and is responsible for its content.',
      '**Consent of an organization.** Not applicable: the project uses no internal data of any organization. No interviews or surveys were carried out, so no participant consent was required.',
    ],
  },
];
