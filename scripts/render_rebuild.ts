/**
 * Rebuilds real home pages from their sections and writes the HTML to a local folder (REV-110).
 * Read-only: nothing is written to MongoDB or MinIO. Usage:
 *   npx tsx scripts/render_rebuild.ts <out-dir> https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 * With --llm (anywhere in the arguments) the sections come from the vision model's grouping with the rules
 * fallback, as the audit stores them (REV-113).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { EVALUATE_NAME_SHIM, FULL_PAGE_MAX_HEIGHT, browserService } from '../apps/workers/src/services/browser.service.js';
import { cookieConsentService } from '../apps/workers/src/services/cookie-consent.service.js';
import { ImageService } from '../apps/workers/src/services/image.service.js';
import { readPageSections } from '../apps/workers/src/services/site-grouping.service.js';
import { planRebuild } from '../apps/workers/src/services/rebuild-plan.service.js';
import { collectSiteLayoutInPage } from '../apps/workers/src/services/site-layout.service.js';
import { collectSiteSectionsInPage } from '../apps/workers/src/services/site-sections.page.js';
import { readSiteSections } from '../apps/workers/src/services/site-sections.service.js';
import { renderRebuild } from '../apps/workers/src/templates/rebuild/index.js';
import { RebuildPlanSchema, rebuildEligibility } from '../packages/validation/src/index.js';

const llm = process.argv.includes('--llm');
const [outDir, ...urls] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!outDir || urls.length === 0) {
  console.error('Usage: npx tsx scripts/render_rebuild.ts [--llm] <out-dir> <url> [url...]');
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
      let reading = readSiteSections(raw, layout.blocks);
      if (png) {
        const result = await readPageSections({ raw, layoutBlocks: layout.blocks, tiles: await ImageService.tilesForVision(png), url });
        reading = result.reading;
        console.log(`${host}: source ${reading.sections?.source ?? '-'}${result.measurementError ? ` (${result.measurementError.message})` : ''}`);
      }
      const eligible = rebuildEligibility({ siteSections: reading.sections, siteSectionsError: reading.error });
      if (!eligible.ok) {
        console.log(`${host}: FALLBACK ${eligible.reason} ${eligible.facts.join(' ')}`);
        continue;
      }
      // Contacts for this local check only: the page's own tel:/mailto: links (the audit uses the verified extractor)
      const links = reading.sections!.sections.flatMap((s) => [...s.intro.links, ...s.items.flatMap((i) => i.links)]);
      const phone = links.find((l) => l.kind === 'phone')?.label;
      const email = links.find((l) => l.kind === 'email')?.href.replace(/^mailto:/, '');
      const parsed = RebuildPlanSchema.safeParse(
        planRebuild({
          siteSections: reading.sections!,
          businessName: host,
          language: await page.evaluate(() => document.documentElement.lang),
          contacts: { phone, email },
          socialLinks: [],
          primary: '#2563eb',
          year: new Date().getFullYear(),
        }),
      );
      // As the deploy worker does: a plan that fails its schema falls back to Bento
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        console.log(`${host}: FALLBACK rebuild:invalid ${issue?.path.join('.')} ${issue?.message}`);
        continue;
      }
      const plan = parsed.data;
      mkdirSync(outDir, { recursive: true });
      writeFileSync(`${outDir}/${host}.html`, renderRebuild(plan));
      console.log(`${host}: ${plan.summary.sections} sections, omitted ${plan.summary.omitted.length}, tuning ${plan.summary.tuning.join(' ')}`);
      for (const o of plan.summary.omitted) console.log(`  omitted ${o.what} ${o.reason}: ${o.sample ?? ''}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
