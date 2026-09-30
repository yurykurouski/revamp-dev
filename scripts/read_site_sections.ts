/**
 * Reads real home pages section by section and prints what the audit would store (REV-109).
 * Read-only: it writes nothing to MongoDB or MinIO. Usage:
 *   npx tsx scripts/read_site_sections.ts https://falcodent.pl/ https://www.dentalux.pl/ https://www.elefant.med.pl/
 */
import { chromium } from 'playwright';
import { EVALUATE_NAME_SHIM } from '../apps/workers/src/services/browser.service.js';
import { cookieConsentService } from '../apps/workers/src/services/cookie-consent.service.js';
import { collectSiteLayoutInPage } from '../apps/workers/src/services/site-layout.service.js';
import { collectSiteSectionsInPage } from '../apps/workers/src/services/site-sections.page.js';
import { readSiteSections } from '../apps/workers/src/services/site-sections.service.js';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: npx tsx scripts/read_site_sections.ts <url> [url...]');
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
      const layout = await page.evaluate(collectSiteLayoutInPage);
      const reading = readSiteSections(await page.evaluate(collectSiteSectionsInPage), layout.blocks);
      console.log(`\n=== ${url}`);
      if (reading.error) {
        console.log(`ERROR: ${reading.error}`);
        continue;
      }
      const { sections, skipped, coverage } = reading.sections;
      for (const s of sections) {
        console.log(
          `#${s.index} ${s.role}/${s.kind}/${s.arrangement}${s.columns ? `x${s.columns}` : ''} "${s.intro.heading ?? ''}" items=${s.items.length}` +
            (s.items.length ? ` [${s.items.slice(0, 6).map((i) => i.title ?? i.text[0]?.slice(0, 30)).join(' | ')}]` : '') +
            (s.truncated ? ' TRUNCATED' : ''),
        );
      }
      for (const k of skipped) console.log(`  skipped #${k.index} ${k.reason}: ${k.sample}`);
      console.log(`coverage ${coverage.capturedChars}/${coverage.pageChars} = ${coverage.ratio}`);
      for (const u of coverage.uncaptured) console.log(`  uncaptured: ${u}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
