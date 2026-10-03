/**
 * Reads real home pages section by section and prints what the audit would store (REV-109).
 * Read-only: it writes nothing to MongoDB or MinIO. Usage:
 *   npx tsx scripts/read_site_sections.ts https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 * With --llm the vision model also groups the page (REV-113): both readings are printed with their rebuild
 * gate verdict, and which one the audit would store. With --record <dir> (implies --llm) the outline and the
 * model's ids-only answer are saved as <dir>/<hostname>.json for the recorded-answer tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import type { ISiteSections } from '../packages/shared-types/src/index.js';
import { rebuildEligibility } from '../packages/validation/src/index.js';
import { EVALUATE_NAME_SHIM, FULL_PAGE_MAX_HEIGHT, browserService } from '../apps/workers/src/services/browser.service.js';
import { cookieConsentService } from '../apps/workers/src/services/cookie-consent.service.js';
import { ImageService } from '../apps/workers/src/services/image.service.js';
import { readPageSections } from '../apps/workers/src/services/site-grouping.service.js';
import { collectSiteLayoutInPage } from '../apps/workers/src/services/site-layout.service.js';
import { collectSiteSectionsInPage } from '../apps/workers/src/services/site-sections.page.js';
import { readSiteSections, type SiteSectionsReading } from '../apps/workers/src/services/site-sections.service.js';

const args = process.argv.slice(2);
const recordAt = args.indexOf('--record');
const recordDir = recordAt >= 0 ? args[recordAt + 1] : undefined;
const llm = args.includes('--llm') || recordDir !== undefined;
const urls = args.filter((arg, i) => !arg.startsWith('--') && i !== recordAt + 1);
if (urls.length === 0 || (recordAt >= 0 && !recordDir)) {
  console.error('Usage: npx tsx scripts/read_site_sections.ts [--llm] [--record <dir>] <url> [url...]');
  process.exit(1);
}

const gate = (read: ISiteSections | undefined) => {
  const verdict = rebuildEligibility({ siteSections: read });
  return verdict.ok ? 'gate ok' : `gate FAILS ${verdict.reason} ${verdict.facts.join(' ')}`;
};

function print(title: string, reading: SiteSectionsReading) {
  console.log(`--- ${title}`);
  if (reading.error) {
    console.log(`ERROR: ${reading.error}`);
    return;
  }
  const { sections, skipped, coverage } = reading.sections;
  for (const s of sections) {
    console.log(
      `#${s.index} ${s.role}/${s.kind}/${s.arrangement}${s.columns ? `x${s.columns}` : ''} "${s.intro.heading ?? ''}" text=${s.intro.text.length} items=${s.items.length} images=${s.images.length}` +
        (s.intro.links.length ? ` links=${s.intro.links.length}` : '') +
        (s.items.length ? ` [${s.items.slice(0, 6).map((i) => i.title ?? i.text[0]?.slice(0, 30)).join(' | ')}]` : '') +
        (s.truncated ? ' TRUNCATED' : ''),
    );
  }
  for (const k of skipped) console.log(`  skipped #${k.index} ${k.reason}: ${k.sample}`);
  console.log(`coverage ${coverage.capturedChars}/${coverage.pageChars} = ${coverage.ratio}`);
  for (const u of coverage.uncaptured) console.log(`  uncaptured: ${u}`);
  const body = sections.filter((s) => s.role === 'hero' || s.role === 'content');
  console.log(`source ${reading.sections.source ?? '-'}, ${body.filter((s) => s.intro.heading).length}/${body.length} body sections headed, ${gate(reading.sections)}`);
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
      console.log(`\n=== ${url}`);
      if (raw.outline) console.log(`outline: ${raw.outline.pieces.length} pieces${raw.outline.truncated ? ' (truncated)' : ''}, body ${raw.outline.bodySize}px`);
      print('rules', readSiteSections(raw, layout.blocks));
      if (!png) continue;

      const tiles = await ImageService.tilesForVision(png);
      const started = Date.now();
      const result = await readPageSections({ raw, layoutBlocks: layout.blocks, tiles, url });
      print(`stored by the audit (${result.modelUsed ?? 'no model'}, ${Math.round((Date.now() - started) / 1000)}s)`, result.reading);
      if (result.measurementError) console.log(`measurement error: ${result.measurementError.message}`);
      if (result.usage) console.log(`tokens: ${result.usage.promptTokens} in, ${result.usage.completionTokens} out, ${result.usage.totalTokens} total`);

      if (recordDir) {
        if (!result.answer || !raw.outline) {
          console.log('not recorded: the model gave no valid answer');
          continue;
        }
        // The raw reading without the rules reader's blocks: what readGroupedSections needs
        const { viewportWidth, viewportHeight, typography, pageChars, outline } = raw;
        mkdirSync(recordDir, { recursive: true });
        const file = `${recordDir}/${new URL(url).hostname.replace(/^www\./, '').replace(/\.[a-z]+$/, '')}.json`;
        writeFileSync(file, JSON.stringify({ url, recordedAt: new Date().toISOString(), model: result.modelUsed, viewportWidth, viewportHeight, pageChars, typography, outline, answer: result.answer }, null, 1));
        console.log(`recorded ${file}`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
