// AS-IS: how a web studio acquires a client today, as a UML activity diagram with
// swimlanes (section 1.1, REV-188). Writes as-is.svg; render.js turns it into a PNG.
// L1–L4 mark where time or data are lost; the text of section 1.1 explains them.
const { svgDoc, lane, action, decision, initial, final, tool, arrow, dashed, note } = require('./svg');

const W = 1960;
const lanes = [
  { title: 'Web studio', y: 20, h: 250 },
  { title: 'Tools and public sources', y: 270, h: 130 },
  { title: 'Business owner', y: 400, h: 210 },
];
const ROW = 110; // studio main row

const parts = [
  ...lanes.map((l) => lane(l.title, l.y, l.h, W)),

  initial(170, ROW),
  action('a1', 290, ROW, ['Choose a niche', 'and an area']),
  action('a2', 460, ROW, ['Search for local', 'businesses']),
  action('a3', 640, ROW, ['Open the website', 'and judge its', 'quality [L1]'], { loss: true }),
  decision('d1', 810, ROW, ['Worth a', 'pitch?']),
  action('a4', 970, ROW, ['Find contact', 'details on the site']),
  decision('d2', 1140, ROW, ['Already', 'contacted?', '[L2]'], { loss: true }),
  action('a5', 1310, ROW, ['Prepare a', 'proposal and a', 'mock-up [L3]'], { loss: true }),
  action('a6', 1490, ROW, ['Write and send', 'a personal', 'e-mail']),
  action('a7', 1830, ROW, ['Discuss the', 'project']),
  final(1935, ROW),

  tool(460, 335, ['Map services', 'and directories']),
  tool(640, 335, ['Audit tools, e.g.', 'PageSpeed Insights'], 180),
  tool(1140, 335, ['Spreadsheet or CRM', 'of one studio only'], 180),
  tool(1345, 335, ['Design tool and', 'e-mail client'], 150),

  action('b1', 1490, 470, ['Receive the pitch,', 'possibly also from', 'other studios [L4]'], { loss: true, w: 170 }),
  decision('d3', 1660, 470, ['Interested?']),
  action('b2', 1660, 565, ['Ignore or', 'ask to stop'], { h: 44 }),
  final(1790, 565),
  action('b3', 1830, 470, ['Reply and ask', 'for details']),

  // control flow
  arrow([[182, ROW], [215, ROW]]),
  arrow([[365, ROW], [385, ROW]]),
  arrow([[535, ROW], [565, ROW]]),
  arrow([[715, ROW], [750, ROW]]),
  arrow([[870, ROW], [895, ROW]], 'yes'),
  arrow([[810, ROW + 40], [810, 200], [450, 200], [450, ROW + 34]], 'no', [630, 195]),
  arrow([[1045, ROW], [1080, ROW]]),
  arrow([[1140, ROW + 40], [1140, 235], [470, 235], [470, ROW + 34]], 'yes', [800, 230]),
  arrow([[1200, ROW], [1235, ROW]], 'no'),
  arrow([[1385, ROW], [1415, ROW]]),
  arrow([[1490, ROW + 34], [1490, 470 - 34]]),
  arrow([[1575, 470], [1600, 470]]),
  arrow([[1720, 470], [1755, 470]], 'yes'),
  arrow([[1660, 510], [1660, 565 - 22]], 'no', [1675, 528]),
  arrow([[1735, 565], [1778, 565]]),
  arrow([[1830, 470 - 34], [1830, ROW + 34]]),
  arrow([[1905, ROW], [1923, ROW]]),

  // use of tools (object flow)
  dashed([[460, ROW + 34], [460, 335 - 24]]),
  dashed([[640, ROW + 34], [640, 335 - 24]]),
  dashed([[1140, ROW + 40], [1140, 335 - 24]]),
  dashed([[1345, ROW + 34], [1345, 335 - 24]]),

  note(170, 460, [
    'Shaded actions [L1]–[L4] are where time or data are lost:',
    'L1  quality judged by eye or with tools whose results vary;',
    'L2  each studio sees only its own contact history;',
    'L3  proposal and mock-up made by hand, lost if no reply;',
    'L4  one business can get pitches from several studios.',
  ]),
];

require('fs').writeFileSync(require('path').join(__dirname, 'as-is.svg'), svgDoc(W, 620, parts));
