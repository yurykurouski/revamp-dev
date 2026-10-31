// Low-fidelity wireframes of four key stories (section 2.5, REV-190), drawn as one
// 2 x 2 figure. Values are placeholders ("XX", "N"), not data.
const { svgDoc } = require('./svg');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const t = (x, y, s, { size = 15, bold = false, anchor = 'start', color = '#222', italic = false } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold ? 'bold' : 'normal'}" font-style="${italic ? 'italic' : 'normal'}" text-anchor="${anchor}" fill="${color}" dominant-baseline="middle">${esc(s)}</text>`;
const r = (x, y, w, h, { fill = '#fff', stroke = '#888', dash = '', rx = 4 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.3" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
const btn = (x, y, w, label, primary = false) =>
  r(x, y, w, 34, { fill: primary ? '#3a3a3a' : '#fff', stroke: '#3a3a3a', rx: 6 }) + t(x + w / 2, y + 17, label, { anchor: 'middle', color: primary ? '#fff' : '#222', size: 14, bold: primary });
const field = (x, y, w, label) => r(x, y, w, 32, { rx: 5 }) + t(x + 10, y + 16, label, { size: 14, color: '#555' });
const bars = (x, y, w, n, gap = 14) => Array.from({ length: n }, (_, i) => `<rect x="${x}" y="${y + i * gap}" width="${i === n - 1 ? w * 0.6 : w}" height="6" rx="3" fill="#d6d6d6"/>`).join('');
const note = (x, y, w, rows) => r(x, y, w, 18 + rows.length * 20, { fill: '#fff8db', stroke: '#c9a800', rx: 3 }) + rows.map((row, i) => t(x + 10, y + 19 + i * 20, row, { size: 13, italic: true })).join('');

function panel(x, y, w, h, label, title, body) {
  return `<g transform="translate(${x} ${y})">` +
    t(0, -18, label, { size: 17, bold: true }) +
    r(0, 0, w, h, { stroke: '#444', rx: 8 }) +
    `<rect x="0" y="0" width="${w}" height="40" rx="8" fill="#e9e9e9"/><rect x="0" y="30" width="${w}" height="10" fill="#e9e9e9"/>` +
    t(16, 20, title, { bold: true }) +
    body +
    '</g>';
}

const W = 740;
const H = 425;

const listing = panel(20, 40, W, H, '(a) Masked lot listing: US10, US5', 'Revamp · Open lots', [
  field(16, 56, 150, 'Niche ▾'), field(176, 56, 150, 'Area ▾'), field(336, 56, 170, 'Audit band ▾'), field(516, 56, 208, 'Next release: 10:00'),
  r(16, 104, 708, 34, { fill: '#f2f2f2', stroke: '#bbb', rx: 0 }),
  ...['Niche', 'District', 'Audit band', 'Price', 'Release', ''].map((h, i) => t(28 + i * 118, 121, h, { size: 14, bold: true })),
  ...[
    ['Dental clinic', 'District 3', 'C', '€ XX', 'today 10:00'],
    ['Restaurant', 'District 1', 'D', '€ XX', 'released'],
    ['Car repair', 'District 5', 'B', '€ XX', 'released'],
  ].map((row, j) => r(16, 138 + j * 46, 708, 46, { stroke: '#ddd', rx: 0 }) + row.map((c, i) => t(28 + i * 118, 161 + j * 46, c, { size: 14 })).join('') + btn(626, 144 + j * 46, 86, j > 0 ? 'Buy' : 'Not yet', j > 0)),
  note(16, 296, 708, ['Business name, domain, screenshots and contacts stay hidden until purchase.', 'A profile shared by fewer than k businesses is not listed; requests are rate limited.']),
  t(16, 400, 'Release times are fixed and published; every studio can buy any released lot.', { size: 14, color: '#555' }),
].join(''));

const purchase = panel(800, 40, W, H, '(b) Purchase with reservation: US5, US6', 'Buy contact right', [
  t(24, 70, 'Lot: Dental clinic · District 3 · audit band C', { size: 15 }),
  t(24, 104, 'Right period: N days, exclusive to your studio', { size: 15 }),
  t(24, 138, 'Price: € XX, calculated from the audit (same audit, same price)', { size: 15 }),
  r(24, 166, 692, 56, { fill: '#f2f2f2', stroke: '#999', rx: 6 }),
  t(40, 194, 'Lot reserved for you:  09:59', { size: 18, bold: true }),
  btn(24, 246, 280, 'Pay with payment provider', true), btn(318, 246, 120, 'Cancel'),
  t(24, 312, 'Card data is entered on the payment provider’s page only.', { size: 14, color: '#555' }),
  note(24, 342, 692, ['If payment is not completed, the reservation expires and the lot is released.', 'Of two simultaneous purchases only one succeeds; the right is created once.']),
].join(''));

const lead = panel(20, 530, W, H, '(c) Lead after purchase, with approval: US3, US13', 'Lead: <business name> · right expires in N days', [
  t(16, 64, 'Audit (measured)', { size: 14, bold: true }),
  ...['LCP', 'CLS', 'Accessibility violations', 'Standards score', 'Site era'].map((m, i) => t(16, 92 + i * 26, `${m}: value`, { size: 14 })),
  t(270, 64, 'Prototype', { size: 14, bold: true }),
  r(270, 80, 200, 160, { fill: '#f5f5f5', stroke: '#999', dash: '6 4' }), t(370, 160, 'preview frame', { anchor: 'middle', size: 13, color: '#777' }),
  t(490, 64, 'E-mail draft', { size: 14, bold: true }),
  r(490, 80, 234, 160, { stroke: '#999' }), bars(504, 98, 206, 7, 18),
  btn(16, 262, 200, 'Approve and schedule', true), btn(230, 262, 120, 'Edit draft'),
  note(16, 316, 708, ['Approve is disabled for the viewer role; nothing is sent without an operator’s approval.', 'Without an active right, or after it expires, scheduling is rejected and queued sends stop.']),
].join(''));

const owner = panel(800, 530, W, H, '(d) Owner’s own audit and consent: US8', 'Check your website', [
  field(24, 60, 520, 'https://your-site.example'), btn(560, 59, 156, 'Run audit', true),
  ...['Speed', 'Accessibility', 'Standards'].map((m, i) => r(24 + i * 172, 112, 160, 70, { fill: '#f5f5f5', stroke: '#999', rx: 6 }) + t(104 + i * 172, 136, m, { anchor: 'middle', size: 14, bold: true }) + t(104 + i * 172, 162, 'result', { anchor: 'middle', size: 14 })),
  r(540, 112, 176, 120, { fill: '#f5f5f5', stroke: '#999', dash: '6 4' }), t(628, 172, 'prototype', { anchor: 'middle', size: 13, color: '#777' }),
  r(24, 206, 16, 16, { rx: 2 }),
  t(50, 214, 'I agree that one web studio using Revamp may contact me', { size: 14 }),
  t(50, 236, 'about a redesign. I can withdraw this consent at any time.', { size: 14 }),
  btn(24, 262, 200, 'Request contact', true),
  note(24, 316, 692, ['No account needed. A lead is created only after explicit consent;', 'the time and the text shown are stored. Withdrawal counts as an opt-out.']),
].join(''));

require('fs').writeFileSync(require('path').join(__dirname, 'wireframes.svg'), svgDoc(1560, 975, [listing, purchase, lead, owner]));
