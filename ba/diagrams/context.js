// Context diagram of the Revamp platform (section 2.4, REV-189): users on the
// left, external systems on the right. Writes context.svg; render.js makes the PNG.
const { svgDoc, box, actor, flows } = require('./svg');

const W = 1420;
const H = 720;
const CORE = { x: 710, y: 370, w: 300, h: 560 };
const left = CORE.x - CORE.w / 2;
const right = CORE.x + CORE.w / 2;

const users = [
  { y: 170, name: ['Studio staff', '(owner, operator)'], to: 'interests, purchases, approvals', from: 'masked listings, audits, prototypes' },
  { y: 380, name: ['Business owner'], to: 'own-site audit, consent, opt-out', from: 'public audit result' },
  { y: 590, name: ['Platform operator'], to: 'scans, release times, price settings', from: 'market and simulation reports' },
];

const systems = [
  { y: 120, name: ['Map data', '(OpenStreetMap, Google Places)'], to: 'area query', from: 'list of businesses' },
  { y: 220, name: ['Business websites'], to: 'page loads (Playwright)', from: 'pages, measured metrics' },
  { y: 320, name: ['LLM providers', '(vision models)'], to: 'source brief, screenshot', from: 'generated page' },
  { y: 420, name: ['Payment provider'], to: 'payment request', from: 'payment result' },
  { y: 520, name: ['Studio e-mail sender'], to: 'approved e-mail', from: 'delivery status' },
  { y: 620, name: ['Object storage', '(S3-compatible)'], to: 'screenshots, prototypes', from: 'stored files' },
];

const parts = [
  box(CORE.x, CORE.y, CORE.w, CORE.h, [
    'API gateway',
    'background workers',
    'operator dashboard',
    'public audit page',
    '',
    'shared business audits',
    'tenant data: leads, drafts',
    'contact registry',
    'contact rights',
    'payment ledger',
  ], { title: 'Revamp platform', fill: '#eef4fb', stroke: '#2f5d8a' }),
  ...users.flatMap((u) => [actor(110, u.y, u.name), flows(200, left, u.y, u.to, u.from)]),
  ...systems.flatMap((s) => [box(1250, s.y, 270, 64, s.name, { fill: '#f4f4f4', size: 15 }), flows(right, 1115, s.y, s.to, s.from)]),
];

require('fs').writeFileSync(require('path').join(__dirname, 'context.svg'), svgDoc(W, H, parts));
