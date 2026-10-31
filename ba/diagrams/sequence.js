// System sequence diagram of UC1 "Studio buys a contact right" (section 2.6,
// REV-191). Writes sequence.svg; render.js makes the PNG.
const { svgDoc, arrow } = require('./svg');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (x, y, s, { size = 15, bold = false, anchor = 'middle', italic = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 'bold' : 'normal'}" font-style="${italic ? 'italic' : 'normal'}" text-anchor="${anchor}">${esc(s)}</text>`;

const W = 1300;
const H = 860;
const lines = { op: 200, sys: 650, pay: 1100 };
const TOP = 60;
const END = 820;

const head = (x, label) =>
  `<rect x="${x - 110}" y="${TOP - 30}" width="220" height="48" rx="4" fill="#eef4fb" stroke="#2f5d8a" stroke-width="1.5"/>` +
  t(x, TOP, label, { bold: true }) +
  `<line x1="${x}" y1="${TOP + 18}" x2="${x}" y2="${END}" stroke="#555" stroke-width="1.2" stroke-dasharray="7 5"/>`;

const dashedArrow = (x1, x2, y) =>
  `<path d="M ${x1} ${y} L ${x2} ${y}" fill="none" stroke="#222" stroke-width="1.4" stroke-dasharray="6 4" marker-end="url(#arrow)"/>`;

// [from, to, label, reply?]
const steps = [
  ['op', 'sys', '1. getListings(niche, area, band)'],
  ['sys', 'op', 'masked lots: niche, district, band, price, release time', true],
  ['op', 'sys', '2. buy(lot)'],
  ['sys', 'sys', 'check limit of rights; reserve lot for the studio'],
  ['sys', 'pay', '3. createPayment(price)'],
  ['pay', 'sys', 'payment page', true],
  ['sys', 'op', 'redirect to payment page; reservation timer', true],
  ['op', 'pay', '4. pay'],
  ['pay', 'sys', '5. paymentSucceeded(event)'],
  ['sys', 'sys', 'record charge in ledger; create right exactly once'],
  ['sys', 'sys', 're-check site; reveal business; queue prototype'],
  ['sys', 'op', 'right granted: business identity, audit, prototype pending', true],
];

const parts = [head(lines.op, 'Studio operator'), head(lines.sys, 'Revamp platform'), head(lines.pay, 'Payment provider')];
let y = 130;
for (const [from, to, label, reply] of steps) {
  const x1 = lines[from];
  const x2 = lines[to];
  if (from === to) {
    parts.push(`<path d="M ${x1} ${y} L ${x1 + 50} ${y} L ${x1 + 50} ${y + 22} L ${x1 + 4} ${y + 22}" fill="none" stroke="#222" stroke-width="1.4" marker-end="url(#arrow)"/>`);
    parts.push(t(x1 + 62, y + 15, label, { anchor: 'start', size: 14 }));
    y += 50;
    continue;
  }
  parts.push(reply ? dashedArrow(x1, x2, y) : arrow([[x1, y], [x2, y]]));
  // A message that crosses the platform's lifeline gets its label beside it, not on it.
  const crosses = Math.min(x1, x2) < lines.sys && Math.max(x1, x2) > lines.sys;
  parts.push(t(crosses ? (Math.min(x1, x2) + lines.sys) / 2 : (x1 + x2) / 2, y - 8, label, { size: 14 }));
  y += 46;
}

// alternative fragment: payment fails or the reservation expires
const fy = y + 4;
parts.push(`<rect x="90" y="${fy}" width="1120" height="110" fill="none" stroke="#444" stroke-width="1.3"/>`);
parts.push(`<path d="M 90 ${fy} L 170 ${fy} L 170 ${fy + 18} L 160 ${fy + 28} L 90 ${fy + 28} Z" fill="#f2f2f2" stroke="#444" stroke-width="1.3"/>`);
parts.push(t(128, fy + 19, 'alt', { bold: true, size: 14 }));
parts.push(t(190, fy + 19, '[payment fails or the reservation expires]', { anchor: 'start', size: 14, italic: true }));
parts.push(`<path d="M ${lines.sys} ${fy + 48} L ${lines.sys + 50} ${fy + 48} L ${lines.sys + 50} ${fy + 70} L ${lines.sys + 4} ${fy + 70}" fill="none" stroke="#222" stroke-width="1.4" marker-end="url(#arrow)"/>`);
parts.push(t(lines.sys + 62, fy + 63, 'release lot; no charge recorded', { anchor: 'start', size: 14 }));
parts.push(dashedArrow(lines.sys, lines.op, fy + 92));
parts.push(t((lines.sys + lines.op) / 2, fy + 84, 'lot no longer reserved', { size: 14 }));

require('fs').writeFileSync(require('path').join(__dirname, 'sequence.svg'), svgDoc(W, Math.max(H, fy + 130), parts));
