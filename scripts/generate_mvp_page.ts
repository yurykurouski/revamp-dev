/**
 * Generates a model-designed MVP page for real sites (REV-137), read-only: no database, storage or queue.
 *
 *   npx tsx scripts/generate_mvp_page.ts [--self-review] [--record <dir>] [--provider <id>] [--model <id>] <out-dir> <url> [url...]
 *
 * Per URL it captures the page as the audit does (`captureFullAudit`), reads the brand, contacts, services and copy
 * (`processBrandData`), builds the brief, asks the model for the page with the desktop screenshot, and on success
 * writes `<host>.raw.html` (the model's page, placeholders unfilled) and `<host>.html` (finished with the verified
 * contacts, search tags and booking form). It prints the attempts, model, tokens, grounding flags and the finished
 * page's standards score; on failure the reason and the checks' problems.
 * `--record <dir>` saves `<host>.json` `{ url, brief, answers, result }` (every raw answer) for the recorded-answer tests.
 * `--self-review` (REV-143) lets the model revise its accepted page once from its own captures, as MVP_PAGE_SELF_REVIEW
 * does, and writes `<host>.first.html` when it did. Each finished page is measured: standards score, axe violations and
 * horizontal scroll at 360 px, for the first page and the kept one, so one run compares the page with and without the pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IMvpTheme } from '@revamp/shared-types';
import { LLM_PROVIDER_IDS, type LlmProviderId } from '@revamp/shared-types';
import { axeService } from '../apps/workers/src/services/axe.service.js';
import { browserService } from '../apps/workers/src/services/browser.service.js';
import { BrandExtractorService } from '../apps/workers/src/services/brand-extractor.service.js';
import { buildMvpSeo } from '../apps/workers/src/services/mvp-seo.js';
import { buildMvpSourceBrief, verifiedContacts } from '../apps/workers/src/services/mvp-source-brief.js';
import { MvpPageGenerator } from '../apps/workers/src/services/mvp-page-generator.js';
import { finishMvpPage, type MvpFinishContext } from '../apps/workers/src/services/mvp-page-finish.js';
import { pageReviewRenderer } from '../apps/workers/src/services/mvp-page-review.js';
import { checkMvpPage } from '../apps/workers/src/services/mvp-page-check.js';
import { checkMvpStandards } from '../apps/workers/src/services/mvp-standards.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const flag = (name: string): boolean => {
  const i = args.indexOf(name);
  if (i !== -1) args.splice(i, 1);
  return i !== -1;
};
const selfReview = flag('--self-review');
const recordDir = option('--record');
const provider = option('--provider');
const model = option('--model');
const [outDir, ...urls] = args;
const usage = 'Usage: npx tsx scripts/generate_mvp_page.ts [--self-review] [--record <dir>] [--provider <id>] [--model <id>] <out-dir> <url> [url...]';
if (!outDir || outDir.startsWith('--') || urls.length === 0 || urls.some((u) => !/^https?:\/\//i.test(u))) {
  console.error(usage);
  process.exit(1);
}
if (provider && !(LLM_PROVIDER_IDS as readonly string[]).includes(provider)) {
  console.error(`Unknown provider "${provider}"; one of ${LLM_PROVIDER_IDS.join(', ')}`);
  process.exit(1);
}

const generator = new MvpPageGenerator({ provider: provider as LlmProviderId | undefined, model });
const unavailable = generator.unavailableReason();
if (unavailable) {
  console.error(unavailable);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

/** A finished page in Chromium: axe violations at 1440 px, and whether it scrolls sideways at 360 px */
async function measure(html: string): Promise<string> {
  const standards = checkMvpStandards(html).score;
  const browser = await browserService.getBrowser();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let axe = '?';
  try {
    const page = await desktop.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    const scan = await axeService.scanPage(page);
    axe = scan.summary ? String(scan.summary.violationsCount) : '?';
  } finally {
    await desktop.close();
  }
  const mobile = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true });
  let hscroll = '?';
  try {
    const page = await mobile.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    hscroll = (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) ? 'yes' : 'no';
  } finally {
    await mobile.close();
  }
  return `standards ${standards}, axe ${axe}, hscroll360 ${hscroll}`;
}

try {
  for (const url of urls) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const started = Date.now();
    try {
      const capture = await browserService.captureFullAudit(url);
      const brand = BrandExtractorService.processBrandData(capture.rawBrandData, host);
      const audit = {
        extractedContacts: brand.contacts,
        extractedServices: brand.services,
        extractedBrandTokens: brand.tokens,
        extractedContent: brand.siteContent,
      };
      const lead: { businessName: string; niche: 'other'; originalUrl: string; contactPhone?: string; contactEmail?: string } = { businessName: host, niche: 'other', originalUrl: url };
      const brief = buildMvpSourceBrief(audit, lead);
      console.log(`${host}: brief ${brief.services.length} services, ${brief.copy.paragraphs.length} paragraphs, ${brief.images.length} images, placeholders ${brief.placeholders.join(',')}`);

      const contacts = verifiedContacts(audit, lead);
      const { seo } = buildMvpSeo({
        businessName: host,
        language: brief.language,
        site: brand.siteContent,
        contacts,
        socialLinks: brand.contacts.socialLinks,
        ...(brief.images[0] ? { photo: brief.images[0] } : {}),
        ...(brief.brand.logoUrl ? { logoUrl: brief.brand.logoUrl } : {}),
        originalUrl: url,
      });
      const finish: Omit<MvpFinishContext, 'theme' | 'controls'> = {
        businessName: host,
        language: brief.language,
        services: brief.services,
        contacts,
        seo,
        logoUrl: brief.brand.logoUrl,
      };
      const finished = (page: string, theme: IMvpTheme) => finishMvpPage(page, { ...finish, theme });

      // The review starts when the accepted page is rendered, so its time is told apart from the generation's
      let reviewStarted: number | undefined;
      const render = pageReviewRenderer(finish);
      const result = await generator.generate({
        brief,
        screenshot: capture.desktopFullBuffer,
        ...(selfReview
          ? {
              review: (page: string, theme: IMvpTheme) => {
                reviewStarted = Date.now();
                return render(page, theme);
              },
            }
          : {}),
      });
      const seconds = Math.round((Date.now() - started) / 1000);
      const reviewSeconds = reviewStarted ? Math.round((Date.now() - reviewStarted) / 1000) : 0;
      const tokens = result.usage ? `${result.usage.promptTokens}+${result.usage.completionTokens} tokens` : 'tokens not reported';
      if (recordDir) {
        mkdirSync(recordDir, { recursive: true });
        // The shape the recorded-answer tests replay: every raw answer, in call order, with the result
        const { answers, ...rest } = result;
        writeFileSync(`${recordDir}/${host}.json`, JSON.stringify({ url, brief, answers, result: rest }, null, 2) + '\n');
      }
      if (!result.ok) {
        console.log(`${host}: FAILED ${result.reason} after ${seconds}s (${result.modelUsed}, ${tokens}): ${result.message}`);
        continue;
      }

      const kept = finished(result.page, result.theme);
      writeFileSync(`${outDir}/${host}.raw.html`, result.page);
      writeFileSync(`${outDir}/${host}.html`, kept);
      console.log(`${host}: OK in ${result.attempts} attempt(s), ${seconds}s (${result.modelUsed}, ${tokens}), ${Math.round(result.page.length / 1024)} KB`);
      if (result.review) {
        const review = result.review;
        const detail =
          review.outcome === 'rejected' ? `: ${review.problems.map((p) => p.code).join(', ')}` : review.outcome === 'failed' ? `: ${review.message}` : '';
        console.log(`  review ${review.outcome} in ${reviewSeconds}s${detail}`);
        if (review.outcome === 'revised') {
          // The first page's theme is read again by the checks: the revision may have changed it
          const first = checkMvpPage(review.firstPage, brief);
          if (first.theme) {
            const firstHtml = finished(review.firstPage, first.theme);
            writeFileSync(`${outDir}/${host}.first.html`, firstHtml);
            console.log(`  first: ${await measure(firstHtml)}`);
          }
        }
      }
      console.log(`  kept: ${await measure(kept)}`);
      for (const flag of result.grounding) console.log(`  flag ${flag.kind} "${flag.text}" in "${flag.context}"`);
    } catch (error) {
      console.log(`${host}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browserService.close();
}
