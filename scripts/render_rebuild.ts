/**
 * Rebuilds real home pages from their sections and writes the HTML to a local folder (REV-110).
 * Read-only: nothing is written to MongoDB or MinIO. Usage:
 *   npx tsx scripts/render_rebuild.ts <out-dir> https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 * The rebuild is made only from the AI models (REV-132): --llm reads the sections with the vision model's grouping, as
 * the audit stores them (REV-113), and a page the model cannot group is reported with the reason, not rebuilt.
 * --rules-debug instead rebuilds the rules reading, a debug view the runtime never uses; one of the two is required.
 * --level faithful|modern|auto (default auto) picks the rebuild level (REV-114): auto reads the site's era from the
 * page's HTML and its content width, as the audit does, and is modern for a dated site. At modern the look comes
 * from the modernize model call only (--llm); a failed call is reported and no modern page is written. With it,
 * <host>.modern.html is written next to the faithful <host>.html. --record <dir> (needs --llm) writes
 * { siteSections, answer } per host for the recorded-answer tests (the modern design is chosen for it whatever the level).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { EVALUATE_NAME_SHIM, FULL_PAGE_MAX_HEIGHT, browserService } from '../apps/workers/src/services/browser.service.js';
import { cookieConsentService } from '../apps/workers/src/services/cookie-consent.service.js';
import { ImageService } from '../apps/workers/src/services/image.service.js';
import { readPageSections } from '../apps/workers/src/services/site-grouping.service.js';
import { rebuildModernizeService } from '../apps/workers/src/services/rebuild-modernize.service.js';
import { readSiteEra } from '../apps/workers/src/services/site-era.service.js';
import { planRebuild } from '../apps/workers/src/services/rebuild-plan.service.js';
import { collectSiteLayoutInPage } from '../apps/workers/src/services/site-layout.service.js';
import { collectSiteSectionsInPage } from '../apps/workers/src/services/site-sections.page.js';
import { readSiteSections, toTypography } from '../apps/workers/src/services/site-sections.service.js';
import { renderRebuild } from '../apps/workers/src/templates/rebuild/index.js';
import { checkMvpStandards } from '../apps/workers/src/services/mvp-standards.js';
import { readStandardsInDocument } from '../apps/workers/src/services/standards.page.js';
import { VitalsService } from '../apps/workers/src/services/vitals.service.js';
import { RebuildPlanSchema, rebuildEligibility } from '../packages/validation/src/index.js';

const args = process.argv.slice(2);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const levelArg = valueOf('--level') ?? 'auto';
const recordDir = valueOf('--record');
const llm = args.includes('--llm');
const rulesDebug = args.includes('--rules-debug');
const [outDir, ...urls] = args.filter((arg) => !arg.startsWith('--'));
if (!outDir || urls.length === 0 || !['faithful', 'modern', 'auto'].includes(levelArg) || args.includes('--record') || args.includes('--level')) {
  console.error('Usage: npx tsx scripts/render_rebuild.ts --llm|--rules-debug [--level faithful|modern|auto] [--record <dir>] <out-dir> <url> [url...]');
  process.exit(1);
}
if (!llm && !rulesDebug) {
  console.error('The rebuild needs the vision model: pass --llm (or --rules-debug for a rules-only reading the runtime never uses).');
  process.exit(1);
}
if (levelArg === 'modern' && !llm) {
  console.error('The modern level needs the model: pass --llm. No default look stands in for its answer (REV-132).');
  process.exit(1);
}
// A recorded answer stands for the model's
if (recordDir && !llm) {
  console.error('--record needs --llm: the recorded-answer tests replay the model\'s answers.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const url of urls) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript({ content: EVALUATE_NAME_SHIM });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.waitForLoadState('load'));
      await cookieConsentService.dismiss(page);
      // The era is read from the page's HTML as served and rendered, before the scroll changes it
      const html = await page.content();
      // Scroll through the page so lazy content loads, as the audit's full-page capture does
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        window.scrollTo(0, 0);
      });
      // The audit takes the full-page capture before it reads the page; so does this
      const png = llm ? await browserService.captureFullPageScreenshot(page, FULL_PAGE_MAX_HEIGHT.desktop) : undefined;
      const layout = await page.evaluate(collectSiteLayoutInPage);
      const raw = await page.evaluate(collectSiteSectionsInPage);
      const host = new URL(url).hostname;
      // The rules reading only in the debug mode; it is tagged as the model's so the rest of the gate is checked
      let reading = readSiteSections(raw, layout.blocks);
      if (reading.sections) reading = { sections: { ...reading.sections, source: 'llm' } };
      if (png) {
        const result = await readPageSections({ raw, layoutBlocks: layout.blocks, tiles: await ImageService.tilesForVision(png), url });
        reading = result.reading;
        console.log(`${host}: source ${reading.sections?.source ?? '-'}${result.measurementError ? ` (${result.reason ?? 'unread'}: ${result.measurementError.message})` : ''}`);
        if (result.reason) {
          console.log(`${host}: NOT REBUILT grouping:${result.reason}`);
          continue;
        }
      }
      const era = readSiteEra({ html, contentWidth: raw.contentWidth, fullBleedShare: raw.fullBleedShare, typography: toTypography(raw.typography), now: new Date() });
      const level = levelArg === 'auto' ? (era.dated ? 'modern' : 'faithful') : levelArg;
      console.log(`${host}: era score=${era.score} signs=${era.signs.join(',') || '-'} contentWidth=${era.contentWidth ?? '-'} fullBleedShare=${raw.fullBleedShare?.toFixed(2) ?? '-'} dated=${era.dated}`);
      const eligible = rebuildEligibility({ siteSections: reading.sections, siteSectionsError: reading.error });
      if (!eligible.ok) {
        console.log(`${host}: NOT REBUILT ${eligible.reason} ${eligible.facts.join(' ')}`);
        continue;
      }
      const read = reading.sections!;
      const button = read.typography?.button?.background;
      const brandColors = button && /^#[0-9a-f]{6}$/i.test(button) ? [button.toLowerCase()] : [];
      const modern = level === 'modern' || recordDir;
      if (modern && !llm) console.log(`${host}: the modern level needs the model (--llm); only the faithful page is written`);
      const choice = modern && llm ? await rebuildModernizeService.choose({ siteSections: read, brandColors }) : undefined;
      console.log(`${host}: level=${level} source=${choice?.source ?? '-'}${choice?.error ? ` (${choice.error}: ${choice.message ?? ''})` : ''}`);
      if (recordDir && choice?.design) {
        mkdirSync(recordDir, { recursive: true });
        writeFileSync(`${recordDir}/${host.replace(/^www\./, '').replace(/\.[a-z]+$/, '')}.json`, JSON.stringify({ url, source: choice.source, siteSections: read, answer: choice.design }, null, 2) + '\n');
      }
      // Contacts for this local check only: the page's own tel:/mailto: links (the audit uses the verified extractor)
      const links = read.sections.flatMap((s) => [...s.intro.links, ...s.items.flatMap((i) => i.links)]);
      const phone = links.find((l) => l.kind === 'phone')?.label;
      const email = links.find((l) => l.kind === 'email')?.href.replace(/^mailto:/, '');
      // The language as the audit reads it: <html lang>, the content-language meta, then the text (REV-116)
      const site = await browserService.extractSiteContent(page);
      const language = site?.language;
      // The original's standards as the audit reads them (REV-118), so the tags it lacked are recorded and compared
      const { faviconLink, ...dom } = await page.evaluate(readStandardsInDocument, undefined);
      const originalStandards = {
        https: /^https:\/\//i.test(page.url() || url),
        ...dom,
        favicon: faviconLink || (await VitalsService.probeFaviconIco(page, page.url() || url)),
      };
      const renders = [{ suffix: '', modernize: undefined }, ...(choice?.design ? [{ suffix: '.modern', modernize: choice.design }] : [])];
      for (const render of renders) {
        const parsed = RebuildPlanSchema.safeParse(
          planRebuild({
            siteSections: read,
            businessName: host,
            language,
            contacts: { phone, email },
            socialLinks: [],
            primary: '#2563eb',
            year: new Date().getFullYear(),
            ...(render.modernize ? { modernize: render.modernize } : {}),
            ...(site ? { site } : {}),
            originalUrl: url,
            originalStandards,
          }),
        );
        const name = `${host}${render.suffix}`;
        // As the deploy worker does: a plan that fails its schema is not rendered
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          console.log(`${name}: NOT REBUILT rebuild:invalid ${issue?.path.join('.')} ${issue?.message}`);
          continue;
        }
        const plan = parsed.data;
        mkdirSync(outDir, { recursive: true });
        const html = renderRebuild(plan);
        writeFileSync(`${outDir}/${name}.html`, html);
        console.log(`${name}: ${plan.summary.sections} sections, omitted ${plan.summary.omitted.length}, tuning ${plan.summary.tuning.join(' ')}`);
        // The MVP's standards by the audit's checks; its https is HTTPS-readiness (REV-118)
        const mvp = checkMvpStandards(html);
        const failing = (checks: Record<string, boolean | undefined>) => Object.keys(checks).filter((k) => !checks[k]).join(',') || 'none';
        console.log(`  standards: original ${VitalsService.calculateStandardsScore(originalStandards)} (failing ${failing(originalStandards)}) -> MVP ${mvp.score} (failing ${failing(mvp.checks)})`);
        for (const o of plan.summary.omitted) console.log(`  omitted ${o.what} ${o.reason}: ${o.sample ?? ''}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
