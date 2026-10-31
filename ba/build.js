// Builds ../BA_Kurouski_Yury.docx from content/*.js. Run: npm run build (in ba/).
const fs = require('fs');
const path = require('path');
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  SequentialIdentifier,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');

const sections = require('./content/sections');
const references = require('./content/references');
const backlog = require('./content/backlog');

const OUT = path.join(__dirname, '..', 'BA_Kurouski_Yury.docx');

const TITLE = {
  topic:
    'Automated Lead Generation SaaS-Platform for Web Developers Using Deterministic Website Audits and LLM-Generated MVP Prototypes',
  author: 'Yury Kurouski',
  supervisor: 'Liubov Ivanova',
  projectType: 'Individual',
  date: 'October 2026',
};

// A4 with 2.5 cm margins: 11906 - 2 * 1418 = 9070 DXA of text width.
const PAGE = { width: 11906, height: 16838, margin: 1418 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;
const FONT = 'Times New Roman';

const todos = [];

// ---- inline text: **bold**, *italic*, [@key] / [@a, @b] citations (IEEE [n]) ----

// IEEE numbers references in order of first citation, so number them by
// scanning the sections in document order. Every listed reference must be cited.
const citedKeys = [];
for (const [, group] of JSON.stringify(sections).matchAll(/\[(@[\w-]+(?:,\s*@[\w-]+)*)\]/g)) {
  for (const key of group.split(/,\s*/).map((k) => k.slice(1))) if (!citedKeys.includes(key)) citedKeys.push(key);
}
const refIndex = new Map(citedKeys.map((key, i) => [key, i + 1]));
const orderedReferences = citedKeys.map((key) => {
  const ref = references.find((r) => r.key === key);
  if (!ref) throw new Error(`Unknown reference key [@${key}]; add it to content/references.js first`);
  return ref;
});
const uncited = references.filter((r) => !refIndex.has(r.key)).map((r) => r.key);
if (uncited.length) throw new Error(`References never cited: ${uncited.join(', ')}`);

function cite(keys) {
  return keys
    .map((key) => {
      const n = refIndex.get(key);
      if (!n) throw new Error(`Unknown reference key [@${key}]; add it to content/references.js first`);
      return `[${n}]`;
    })
    .join(', ');
}

// Cross-references: a figure or table block with `label: 'x'` is cited in text
// as {fig:x} or {tab:x}. Numbers are assigned in document order, counting every
// caption the build emits, so they match the SEQ fields.
const labels = new Map();
{
  const count = { Figure: 0, Table: 0 };
  const take = (kind, label) => {
    count[kind] += 1;
    if (label) labels.set(`${kind === 'Figure' ? 'fig' : 'tab'}:${label}`, count[kind]);
  };
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.figure) take('Figure', b.figure.label);
      else if (b.figureSlot) take('Figure', b.figureSlot.label);
      else if (b.table) take('Table', b.table.label);
      else if (b.tableSlot) take('Table', b.tableSlot.label);
      else if (backlog.length && b.backlog === 'section') take('Table', 'backlog');
      else if (backlog.length && b.backlog === 'appendix') take('Table', 'backlogAppendix');
    }
  }
}

function resolveLabels(text) {
  return text.replace(/\{(fig|tab):([\w-]+)\}/g, (_, kind, label) => {
    const n = labels.get(`${kind}:${label}`);
    if (!n) throw new Error(`Unknown cross-reference {${kind}:${label}}`);
    return `${kind === 'fig' ? 'Fig.' : 'Table'} ${n}`;
  });
}

function runs(text, base = {}) {
  text = resolveLabels(text);
  const out = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\[@[\w-]+(?:,\s*@[\w-]+)*\])/g;
  for (const part of text.split(pattern)) {
    if (!part) continue;
    if (part.startsWith('**')) out.push(new TextRun({ ...base, text: part.slice(2, -2), bold: true }));
    else if (part.startsWith('[@')) out.push(new TextRun({ ...base, text: cite(part.slice(1, -1).split(/,\s*/).map((k) => k.slice(1))) }));
    else if (part.startsWith('*')) out.push(new TextRun({ ...base, text: part.slice(1, -1), italics: true }));
    else out.push(new TextRun({ ...base, text: part }));
  }
  return out;
}

const para = (text, opts = {}) => new Paragraph({ children: runs(text), ...opts });

function todo(text) {
  todos.push(text);
  return new Paragraph({
    children: [new TextRun({ text: `TODO (${text})`, highlight: 'yellow', italics: true })],
  });
}

// ---- captions: IEEE puts "Fig. n." below a figure and "Table n." above a table ----

function caption(kind, text) {
  const label = kind === 'Figure' ? 'Fig. ' : 'Table ';
  return new Paragraph({
    style: 'Caption',
    keepNext: kind === 'Table',
    children: [new TextRun(label), new SequentialIdentifier(kind), new TextRun(`. ${resolveLabels(text)}`)],
  });
}

// ---- tables ----

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '808080' };
const BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };

function cell(content, width, { header = false, span = 1, shade, size = 18 } = {}) {
  const lines = Array.isArray(content) ? content : [content];
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    borders: BORDERS,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
    shading: header || shade ? { type: ShadingType.CLEAR, color: 'auto', fill: header ? 'D9E2F3' : shade } : undefined,
    children: lines.map(
      (line) =>
        new Paragraph({
          spacing: { line: 228, after: 20 },
          alignment: AlignmentType.LEFT,
          children: runs(String(line), { size, bold: header || undefined }),
        }),
    ),
  });
}

function table(columns, rows, { size = 18 } = {}) {
  const widths = columns.map((c) => c.width);
  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum !== TEXT_WIDTH) throw new Error(`Table column widths sum to ${sum}, expected ${TEXT_WIDTH}`);
  return new Table({
    width: { size: TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c) => cell(c.header, c.width, { header: true, size })) }),
      ...rows.map((row) =>
        row.span
          ? new TableRow({ children: [cell(row.span, TEXT_WIDTH, { span: columns.length, shade: 'F2F2F2', size })] })
          : new TableRow({ children: row.map((value, i) => cell(value, widths[i], { size })) }),
      ),
    ],
  });
}

// ---- backlog: 2.5 and Appendix A render the same rows from content/backlog.js ----

const BACKLOG_COLUMNS = [
  { header: 'ID', width: 650 },
  { header: 'User story', width: 2950 },
  { header: 'Acceptance criteria (Given / When / Then)', width: 4470 },
  { header: 'MoSCoW', width: 1000 },
];

function checkBacklog() {
  const ids = new Set();
  for (const epic of backlog) {
    for (const story of epic.stories) {
      if (ids.has(story.id)) throw new Error(`Duplicate story id ${story.id}`);
      ids.add(story.id);
      if (!['Must', 'Should', 'Could', "Won't"].includes(story.priority)) throw new Error(`${story.id}: bad priority`);
      if (story.priority === 'Must' && !story.criteria?.length) throw new Error(`${story.id}: Must story without criteria`);
    }
  }
}

const storyRow = (s) => [s.id, s.statement, s.criteria?.length ? s.criteria : ['—'], s.priority];
const epicLabel = (e) => `${e.id}. ${e.title} (${e.priority})`;

function backlogBlocks(mode) {
  if (!backlog.length) return mode === 'appendix' ? [todo('REV-190: rendered from ba/content/backlog.js, identical to 2.5.')] : [];
  // Both places render the same rows; only the caption differs.
  const rows = backlog.flatMap((e) => [{ span: `**${epicLabel(e)}**` }, ...e.stories.map(storyRow)]);
  const title = mode === 'appendix' ? 'Product backlog (identical to {tab:backlog})' : 'Product backlog: epics and user stories';
  return [caption('Table', title), table(BACKLOG_COLUMNS, rows, { size: 18 }), new Paragraph({ text: '' })];
}

// ---- references ----

function referenceBlocks() {
  if (!references.length) return [todo('REV-186: 10+ verified references in IEEE style, in order of first citation.')];
  return orderedReferences.map(
    (r) => new Paragraph({ numbering: { reference: 'references', level: 0 }, alignment: AlignmentType.LEFT, children: runs(r.text) }),
  );
}

// ---- blocks ----

function block(b) {
  if (typeof b === 'string') return [para(b)];
  if (b.todo) return [todo(b.todo)];
  if (b.h3) return [new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(b.h3) })];
  if (b.bullets) return b.bullets.map((t) => para(t, { numbering: { reference: 'bullets', level: 0 } }));
  if (b.numbered) {
    const instance = Math.random().toString(36).slice(2);
    return b.numbered.map((t) => para(t, { numbering: { reference: 'numbered', level: 0, instance } }));
  }
  if (b.table) return [caption('Table', b.table.caption), table(b.table.columns, b.table.rows), new Paragraph({ text: '' })];
  if (b.tableSlot) return [caption('Table', b.tableSlot.caption), todo(b.tableSlot.todo)];
  if (b.figure) {
    const { file, width, height } = b.figure;
    return [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        keepNext: true,
        children: [new ImageRun({ type: path.extname(file).slice(1), data: fs.readFileSync(path.join(__dirname, file)), transformation: { width, height } })],
      }),
      caption('Figure', b.figure.caption),
    ];
  }
  if (b.figureSlot) return [todo(b.figureSlot.todo), caption('Figure', b.figureSlot.caption)];
  if (b.backlog) return backlogBlocks(b.backlog);
  if (b.references) return referenceBlocks();
  throw new Error(`Unknown block: ${JSON.stringify(b)}`);
}

function heading(s, startsDocxSection) {
  return new Paragraph({
    heading: s.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    // A new docx section already starts a page; a page break on top of it
    // would leave a blank page.
    pageBreakBefore: s.level === 1 && !startsDocxSection,
    children: [new TextRun(s.title)],
  });
}

// ---- title page ----

function titlePage() {
  const centered = (text, opts = {}, run = {}) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 276, ...opts.spacing }, children: [new TextRun({ text, ...run })] });
  const field = (label, value) =>
    new Paragraph({
      alignment: AlignmentType.LEFT,
      indent: { left: 4536 },
      spacing: { line: 276, after: 120 },
      children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(value)],
    });
  return [
    centered('Diploma Project', { spacing: { before: 1200 } }, { size: 28 }),
    centered('Business Analysis Block', { spacing: { after: 2400 } }, { size: 28 }),
    centered(TITLE.topic, { spacing: { after: 2400 } }, { size: 36, bold: true }),
    field('Author', TITLE.author),
    field('Supervisor', TITLE.supervisor),
    field('Project type', TITLE.projectType),
    centered(TITLE.date, { spacing: { before: 3600 } }),
  ];
}

// ---- document ----

checkBacklog();

// Consecutive sections with the same orientation share one docx section; a
// section with `landscape: true` (Appendix B diagrams) gets landscape pages.
const groups = [];
for (const s of sections) {
  const landscape = !!s.landscape;
  if (!groups.length || groups[groups.length - 1].landscape !== landscape) groups.push({ landscape, sections: [] });
  groups[groups.length - 1].sections.push(s);
}

const pageProps = (landscape) => ({
  page: {
    size: { width: PAGE.width, height: PAGE.height, orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
    margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
  },
});

const pageFooter = () => ({
  default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] }),
});

const bodySections = groups.map((g, i) => ({
  properties: pageProps(g.landscape),
  footers: pageFooter(),
  children: [
    ...(i === 0
      ? [
          new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 240 }, children: [new TextRun({ text: 'Contents', bold: true, size: 32 })] }),
          new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
        ]
      : []),
    ...g.sections.flatMap((s, j) => [heading(s, i > 0 && j === 0), ...s.blocks.flatMap(block)]),
  ],
}));

const doc = new Document({
  creator: TITLE.author,
  title: 'Business Analysis Block: Revamp',
  features: { updateFields: true },
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 24 },
        paragraph: { spacing: { line: 360, after: 120 }, alignment: AlignmentType.JUSTIFIED },
      },
    },
    paragraphStyles: [
      {
        id: 'Heading1',
        name: 'Heading 1',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, size: 32, bold: true },
        paragraph: { spacing: { before: 0, after: 240 }, keepNext: true, alignment: AlignmentType.LEFT, outlineLevel: 0 },
      },
      {
        id: 'Heading2',
        name: 'Heading 2',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, size: 28, bold: true },
        paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, alignment: AlignmentType.LEFT, outlineLevel: 1 },
      },
      {
        id: 'Heading3',
        name: 'Heading 3',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, size: 24, bold: true, italics: true },
        paragraph: { spacing: { before: 120, after: 60 }, keepNext: true, alignment: AlignmentType.LEFT, outlineLevel: 2 },
      },
      {
        id: 'Caption',
        name: 'caption',
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: { font: FONT, size: 20 },
        paragraph: { spacing: { before: 60, after: 120, line: 240 }, alignment: AlignmentType.CENTER },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      },
      {
        reference: 'numbered',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      },
      {
        reference: 'references',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '[%1]', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 720 } } } }],
      },
    ],
  },
  sections: [
    { properties: pageProps(false), children: titlePage() },
    ...bodySections,
  ],
});

// docx-js leaves SEQ fields without a result, so a viewer that does not update
// fields shows "Fig. ." Write each caption's number as the field's cached result;
// Word recomputes the same numbers when it updates fields.
async function withCaptionNumbers(buffer) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const counters = {};
  const filled = xml.replace(
    /<w:instrText xml:space="preserve">SEQ (\w+)<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:fldChar w:fldCharType="end"\/>/g,
    (_, kind) => {
      counters[kind] = (counters[kind] ?? 0) + 1;
      return `<w:instrText xml:space="preserve">SEQ ${kind} \\* ARABIC</w:instrText><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${counters[kind]}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>`;
    },
  );
  zip.file('word/document.xml', filled);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// The TOC's PAGEREF fields are also empty, so a viewer that does not update
// fields shows no page numbers. Lay the document out with LibreOffice, find the
// page of every heading in the PDF, and write those numbers as cached results.
// Page numbers run from the title page, so PDF page n is printed page n.
function pagesOfHeadings(docxPath) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ba-toc-'));
  try {
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', dir, docxPath], { stdio: 'ignore' });
    const pdf = path.join(dir, path.basename(docxPath, '.docx') + '.pdf');
    const pageTexts = execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8' }).split('\f');
    const lines = pageTexts.map((t) => t.split('\n').map((l) => l.trim()));
    const pages = new Map();
    let from = 0;
    for (const s of sections) {
      // A TOC line ends in dot leaders, so an exact match is the heading itself.
      const i = lines.findIndex((page, n) => n >= from && page.includes(s.title));
      if (i < 0) throw new Error(`Heading not found in the PDF: ${s.title}`);
      pages.set(s.title, i + 1);
      from = i;
    }
    return { pages, total: pageTexts.filter((t) => t.trim()).length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const unescapeXml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function withTocPages(buffer, pages) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  let filled = 0;
  const out = xml.replace(
    /(<w:hyperlink w:history="1" w:anchor="(_Toc\d+)"><w:r><w:t xml:space="preserve">([^<]*)<\/w:t><\/w:r>.*?<w:instrText xml:space="preserve">PAGEREF \2 \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/>)(<w:fldChar w:fldCharType="end"\/>)/g,
    (_, head, _anchor, title, end) => {
      const page = pages.get(unescapeXml(title));
      if (!page) throw new Error(`No page for TOC entry: ${title}`);
      filled += 1;
      return `${head}</w:r><w:r><w:t>${page}</w:t></w:r><w:r>${end}`;
    },
  );
  if (filled !== sections.length) throw new Error(`Filled ${filled} TOC page numbers, expected ${sections.length}`);
  zip.file('word/document.xml', out);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function hasCommand(cmd) {
  try {
    require('child_process').execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

Packer.toBuffer(doc).then(withCaptionNumbers).then(async (buffer) => {
  fs.writeFileSync(OUT, buffer);
  if (hasCommand('soffice') && hasCommand('pdftotext')) {
    const { pages, total } = pagesOfHeadings(OUT);
    fs.writeFileSync(OUT, await withTocPages(buffer, pages));
    const main = pages.get('References') - pages.get('Introduction');
    console.log(`${total} pages; main text (Introduction to References) ${main} pages`);
  } else {
    console.log('soffice or pdftotext not found: TOC page numbers left for Word to fill');
  }
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}`);
  console.log(`${references.length} references, ${backlog.reduce((n, e) => n + e.stories.length, 0)} stories, ${todos.length} TODOs left`);
  for (const t of todos) console.log(`  TODO ${t}`);
});
