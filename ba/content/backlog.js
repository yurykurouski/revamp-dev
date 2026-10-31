// The one source of the product backlog. Section 2.5 and Appendix A are both
// rendered from it, so their IDs, statements, criteria and priorities cannot
// drift apart (REV-190).
//
// Shape:
//   {
//     id: 'E1', title: 'Multi-tenancy', priority: 'Must', goal: 'G4',
//     stories: [{
//       id: 'US1', priority: 'Must',
//       statement: 'As a studio owner, I want …, so that ….',
//       criteria: ['Given …, when …, then ….'],
//     }],
//   }
// Priority is one of Must, Should, Could, Won't. Every Must story needs criteria.
// Story IDs US1–US12 follow the Linear "Business Analysis" document; section 1.2
// cites US2–US10 by these IDs.

module.exports = [
  {
    id: 'E0',
    title: 'Core pipeline (implemented)',
    priority: 'Must',
    goals: ['G1', 'G3'],
    kpis: ['K1', 'K2', 'K3'],
    stories: [
      {
        id: 'US13',
        priority: 'Must',
        statement: 'As a studio operator, I want to review the audit, the prototype and the e-mail draft and approve the e-mail myself, so that no message is sent without a human decision.',
        criteria: [
          'Given a lead with a generated draft, when no operator has approved it, then no background job sends the e-mail.',
          'Given an approved e-mail, when it is scheduled, then the lead moves to Scheduled only through the lead state machine.',
        ],
      },
      {
        id: 'US14',
        priority: 'Must',
        statement: 'As a studio operator, I want every metric, contact detail and fact in the offer to come from deterministic code, so that I never send invented data.',
        criteria: [
          'Given an audit, when a measurement fails, then its value is left out and the failure is recorded, never replaced by a stand-in value.',
          'Given a generated page, when it fails the code checks twice, then nothing is published and the reason is shown.',
          'Given a published page, when contact details appear in it, then they come only from verified contacts.',
        ],
      },
    ],
  },
  {
    id: 'E1',
    title: 'Multi-tenancy',
    priority: 'Must',
    goals: ['G4'],
    kpis: ['K4'],
    stories: [
      {
        id: 'US1',
        priority: 'Must',
        statement: 'As a studio owner, I want to register my studio and invite colleagues with roles, so that my team works in one private workspace.',
        criteria: [
          'Given a new user, when they register a studio, then an organization is created with them as its owner.',
          'Given an invitation with a role, when the invitee accepts it, then they join the organization with that role.',
          'Given a user with the viewer role, when they try to approve or send an e-mail, then the request is rejected.',
        ],
      },
      {
        id: 'US2',
        priority: 'Must',
        statement: 'As a studio owner, I want other studios never to see my leads, drafts or prototypes, so that my work and clients stay confidential.',
        criteria: [
          'Given a record of studio B, when a user of studio A requests it, then the API answers "not found".',
          'Given a background job of studio A, when it runs, then it reads and writes only studio A’s records.',
        ],
      },
    ],
  },
  {
    id: 'E2',
    title: 'Contact registry and rights',
    priority: 'Must',
    goals: ['G2'],
    kpis: ['K4'],
    stories: [
      {
        id: 'US3',
        priority: 'Must',
        statement: 'As a studio operator, I want to send outreach only to businesses my studio holds an active contact right for, so that I do not break the market rules.',
        criteria: [
          'Given a lead without an active right, when an operator schedules the e-mail, then the transition is rejected with a clear error code.',
          'Given a scheduled e-mail, when the right expires before sending, then the send is cancelled.',
        ],
      },
      {
        id: 'US4',
        priority: 'Must',
        statement: 'As a business owner, I want not to be pitched by several studios in a short time, so that my inbox is not spammed.',
        criteria: [
          'Given a business whose right ended within the cooldown, when another studio tries to buy or use a right for it, then the attempt is rejected.',
          'Given a business that opted out, when any studio tries to contact it, then the contact is blocked and queued e-mails are cancelled.',
        ],
      },
    ],
  },
  {
    id: 'E3',
    title: 'Purchase and payments',
    priority: 'Must',
    goals: ['G2'],
    kpis: ['K4'],
    stories: [
      {
        id: 'US5',
        priority: 'Must',
        statement: 'As a studio operator, I want to buy the right to contact a business for a fixed period at a visible price, so that I secure exclusive access to the leads I value most.',
        criteria: [
          'Given a released lot, when a studio reserves it and its payment succeeds, then that studio gets the right and the lot closes for all others.',
          'Given two businesses with identical audit results, when their prices are calculated, then the prices are identical.',
          'Given a studio at its limit of simultaneous rights, when it tries to buy another lot, then the purchase is rejected.',
        ],
      },
      {
        id: 'US6',
        priority: 'Must',
        statement: 'As a studio operator, I want the right to be granted to me exactly once when my payment succeeds, so that I never pay for a lead another studio holds.',
        criteria: [
          'Given two simultaneous purchases of one lot, when both are paid, then only one succeeds.',
          'Given a payment job that retries, when it runs again, then no second right is created.',
          'Given an unpaid reservation, when its time runs out, then the lot is released and no charge is recorded.',
        ],
      },
      {
        id: 'US7',
        priority: 'Must',
        statement: 'As the platform operator, I want to simulate studios under different pricing rules, so that I can choose a rule with evidence.',
        criteria: [
          'Given the same seed and settings, when the simulation runs twice, then the results are identical.',
          'Given several pricing rules, when the simulation ends, then the report compares revenue, unsold share, buyer concentration and overpayment per rule.',
        ],
      },
      {
        id: 'US10',
        priority: 'Must',
        statement: 'As a studio operator, I want to filter open lots by niche, area and audit band, so that I can choose which businesses to buy without seeing who they are.',
        criteria: [
          'Given an open lot, when any studio requests the listing, then only masked fields are returned: niche, district, audit band, price and release time.',
          'Given a profile that fewer than k businesses share, when listings are published, then that listing is withheld.',
          'Given one studio’s listing requests, when they exceed the rate limit, then further requests are rejected.',
        ],
      },
      {
        id: 'US11',
        priority: 'Must',
        statement: 'As a studio operator, I want to save an interest in a niche and an area, so that I am notified about new lots there and the platform knows where studios want leads.',
        criteria: [
          'Given an interest saved by studio A, when studio B lists interests, then studio A’s interest is not shown.',
          'Given a saved interest, when matching lots are released, then the studio is notified and gets no priority over other studios.',
        ],
      },
      {
        id: 'US12',
        priority: 'Must',
        statement: 'As the platform operator, I want to scan an area when demand reaches a threshold and to release lots at published times, so that audit cost follows demand and every studio has the same chance.',
        criteria: [
          'Given demand below the threshold and no scheduled scan, when the scheduler runs, then no scan is queued.',
          'Given a lot with a published release time, when that time comes, then every studio can buy it.',
          'Given a business that is already audited, when its area is scanned again, then the existing audit is reused.',
        ],
      },
    ],
  },
  {
    id: 'E4',
    title: 'Inbound flow',
    priority: 'Should',
    goals: ['G4'],
    kpis: ['K4'],
    stories: [
      {
        id: 'US8',
        priority: 'Should',
        statement: 'As a business owner, I want to check my website and see a better version, so that I can decide whether to hire a studio.',
        criteria: [
          'Given an owner without an account, when they enter their site address, then they get the audit result.',
          'Given an audit result, when the owner gives explicit consent, then a lead is created and the consent is stored with its time and text.',
          'Given a consented lead, when the owner withdraws consent, then the right ends, queued e-mails are cancelled and the unused part of the payment is refunded.',
        ],
      },
    ],
  },
  {
    id: 'E5',
    title: 'Market map',
    priority: 'Could',
    goals: ['G2'],
    kpis: [],
    stories: [
      {
        id: 'US9',
        priority: 'Could',
        statement: 'As a studio operator, I want a map of prices and available businesses by area and niche, so that I can choose where to buy.',
        criteria: ['Given a map cell with too few purchases, when the map is shown, then the cell shows no price and never reveals a buyer.'],
      },
    ],
  },
  {
    id: 'F',
    title: 'Deferred (future work)',
    priority: "Won't",
    goals: [],
    kpis: [],
    stories: [
      {
        id: 'US15',
        priority: "Won't",
        statement: 'As a studio owner, I want to bid for the right to contact a business in an auction, so that the price reflects competition.',
        criteria: [],
      },
      {
        id: 'US16',
        priority: "Won't",
        statement: 'As a business owner, I want to publish a new site myself and let studios bid to redesign it, so that I choose the offer.',
        criteria: [],
      },
      {
        id: 'US17',
        priority: "Won't",
        statement: 'As a studio owner, I want the platform to send e-mails for me from a platform domain, so that I need no sender of my own.',
        criteria: [],
      },
    ],
  },
];
