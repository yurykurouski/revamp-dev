// Small SVG helpers for UML activity diagrams with swimlanes.
const FONT = 'Arial, Helvetica, sans-serif';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lines(x, y, rows, { size = 16, anchor = 'middle', weight = 'normal' } = {}) {
  const lh = size * 1.25;
  const top = y - ((rows.length - 1) * lh) / 2;
  return rows
    .map((r, i) => `<text x="${x}" y="${top + i * lh}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="middle">${esc(r)}</text>`)
    .join('');
}

const LOSS = 'fill="#fde2e1" stroke="#c0392b"';
const PLAIN = 'fill="#ffffff" stroke="#333333"';

function lane(title, y, h, w) {
  return `<rect x="10" y="${y}" width="${w - 20}" height="${h}" fill="none" stroke="#555" stroke-width="1.2"/>` +
    `<line x1="110" y1="${y}" x2="110" y2="${y + h}" stroke="#555" stroke-width="1.2"/>` +
    `<g transform="translate(60 ${y + h / 2}) rotate(-90)">${lines(0, 0, title.split(' and ').length > 1 ? [title.split(' and ')[0] + ' and', title.split(' and ')[1]] : [title], { size: 15, weight: 'bold' })}</g>`;
}

function action(_id, x, y, rows, { loss = false, w = 150, h = 68 } = {}) {
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="14" ${loss ? LOSS : PLAIN} stroke-width="1.4"/>` + lines(x, y, rows);
}

function decision(_id, x, y, rows, { loss = false, w = 120, h = 80 } = {}) {
  const p = [[x, y - h / 2], [x + w / 2, y], [x, y + h / 2], [x - w / 2, y]].map((q) => q.join(',')).join(' ');
  return `<polygon points="${p}" ${loss ? LOSS : PLAIN} stroke-width="1.4"/>` + lines(x, y, rows, { size: 15 });
}

const initial = (x, y) => `<circle cx="${x}" cy="${y}" r="10" fill="#000"/>`;
const final = (x, y) => `<circle cx="${x}" cy="${y}" r="12" fill="#fff" stroke="#000" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="7" fill="#000"/>`;

function tool(x, y, rows, w = 170, h = 52) {
  const s = 12;
  const p = [[x - w / 2 + s, y - h / 2], [x + w / 2 + s, y - h / 2], [x + w / 2 - s, y + h / 2], [x - w / 2 - s, y + h / 2]].map((q) => q.join(',')).join(' ');
  return `<polygon points="${p}" fill="#eef2f7" stroke="#6b7a90" stroke-width="1.2"/>` + lines(x, y, rows, { size: 15 });
}

const path = (pts) => 'M ' + pts.map((p) => p.join(' ')).join(' L ');

function arrow(pts, label, at) {
  const [lx, ly] = at || [(pts[0][0] + pts[1][0]) / 2, pts[0][1] - 9];
  return `<path d="${path(pts)}" fill="none" stroke="#222" stroke-width="1.4" marker-end="url(#arrow)"/>` +
    (label ? `<text x="${lx}" y="${ly}" font-size="14" text-anchor="middle">${esc(label)}</text>` : '');
}

const dashed = (pts) => `<path d="${path(pts)}" fill="none" stroke="#6b7a90" stroke-width="1.2" stroke-dasharray="5 4" marker-end="url(#open)"/>`;

function note(x, y, rows) {
  return rows.map((r, i) => `<text x="${x}" y="${y + i * 22}" font-size="16" font-weight="${i ? 'normal' : 'bold'}">${esc(r)}</text>`).join('');
}

// Context diagrams: a plain box, a UML actor, and a pair of opposite flows with labels.
function box(x, y, w, h, rows, { title, fill = '#ffffff', stroke = '#333333', size = 15 } = {}) {
  const head = title ? `<text x="${x}" y="${y - h / 2 + 26}" font-size="18" font-weight="bold" text-anchor="middle">${esc(title)}</text>` : '';
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>` + head + lines(x, title ? y + 12 : y, rows, { size });
}

function actor(x, y, rows) {
  return `<g stroke="#222" stroke-width="2" fill="none"><circle cx="${x}" cy="${y - 34}" r="10"/><line x1="${x}" y1="${y - 24}" x2="${x}" y2="${y + 4}"/><line x1="${x - 16}" y1="${y - 14}" x2="${x + 16}" y2="${y - 14}"/><line x1="${x}" y1="${y + 4}" x2="${x - 12}" y2="${y + 24}"/><line x1="${x}" y1="${y + 4}" x2="${x + 12}" y2="${y + 24}"/></g>` +
    lines(x, y + 46, rows, { size: 15, weight: 'bold' });
}

// Two arrows between x1 and x2 at height y: the upper one points right, the lower one left.
function flows(x1, x2, y, right, left) {
  const mid = (x1 + x2) / 2;
  return arrow([[x1, y - 7], [x2, y - 7]]) + arrow([[x2, y + 7], [x1, y + 7]]) +
    `<text x="${mid}" y="${y - 15}" font-size="14" text-anchor="middle">${esc(right)}</text>` +
    `<text x="${mid}" y="${y + 27}" font-size="14" text-anchor="middle">${esc(left)}</text>`;
}

function svgDoc(w, h, parts) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" fill="#111">
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#222"/></marker>
<marker id="open" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#6b7a90" stroke-width="1.5"/></marker>
</defs>
<rect width="100%" height="100%" fill="#fff"/>
${parts.join('\n')}
</svg>`;
}

module.exports = { svgDoc, lane, action, decision, initial, final, tool, arrow, dashed, note, box, actor, flows };
