/**
 * Generates a model-designed MVP page for real sites (REV-137), read-only: no database, storage or queue.
 *
 *   npx tsx scripts/generate_mvp_page.ts [--record <dir>] [--provider <id>] [--model <id>] <out-dir> <url> [url...]
 *
 * Per URL it captures the page as the audit does (`captureFullAudit`), reads the brand, contacts, services and copy
 * (`processBrandData`), builds the brief, asks the model for the page with the desktop screenshot, and on success
 * writes `<host>.raw.html` (the model's page, placeholders unfilled) and `<host>.html` (finished with the verified
 * contacts, search tags and booking form). It prints the attempts, model, tokens, grounding flags and the finished
 * page's standards score; on failure the reason and the checks' problems.
 * `--record <dir>` saves `<host>.json` with the brief and the result for the recorded-answer tests.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { LLM_PROVIDER_IDS, type LlmProviderId } from '@revamp/shared-types';
import { browserService } from '../apps/workers/src/services/browser.service.js';
import { BrandExtractorService } from '../apps/workers/src/services/brand-extractor.service.js';
import { buildMvpSeo } from '../apps/workers/src/services/mvp-seo.js';
import { buildMvpSourceBrief, verifiedContacts } from '../apps/workers/src/services/mvp-source-brief.js';
import { MvpPageGenerator } from '../apps/workers/src/services/mvp-page-generator.js';
import { finishMvpPage } from '../apps/workers/src/services/mvp-page-finish.js';
import { checkMvpStandards } from '../apps/workers/src/services/mvp-standards.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const recordDir = option('--record');
const provider = option('--provider');
const model = option('--model');
const [outDir, ...urls] = args;
const usage = 'Usage: npx tsx scripts/generate_mvp_page.ts [--record <dir>] [--provider <id>] [--model <id>] <out-dir> <url> [url...]';
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

      const result = await generator.generate({ brief, screenshot: capture.desktopFullBuffer });
      const seconds = Math.round((Date.now() - started) / 1000);
      const tokens = result.usage ? `${result.usage.promptTokens}+${result.usage.completionTokens} tokens` : 'tokens not reported';
      if (recordDir) {
        mkdirSync(recordDir, { recursive: true });
        writeFileSync(`${recordDir}/${host}.json`, JSON.stringify({ url, brief, result }, null, 2) + '\n');
      }
      if (!result.ok) {
        console.log(`${host}: FAILED ${result.reason} after ${seconds}s (${result.modelUsed}, ${tokens}): ${result.message}`);
        continue;
      }

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
      const finished = finishMvpPage(result.page, {
        businessName: host,
        language: brief.language,
        services: brief.services,
        contacts,
        seo,
        logoUrl: brief.brand.logoUrl,
        theme: result.theme,
      });
      writeFileSync(`${outDir}/${host}.raw.html`, result.page);
      writeFileSync(`${outDir}/${host}.html`, finished);
      const standards = checkMvpStandards(finished);
      console.log(`${host}: OK in ${result.attempts} attempt(s), ${seconds}s (${result.modelUsed}, ${tokens}), ${Math.round(result.page.length / 1024)} KB, standards ${standards.score}`);
      for (const flag of result.grounding) console.log(`  flag ${flag.kind} "${flag.text}" in "${flag.context}"`);
    } catch (error) {
      console.log(`${host}: ERROR ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browserService.close();
}
