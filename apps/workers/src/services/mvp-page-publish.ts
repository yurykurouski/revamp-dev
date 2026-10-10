import { IAudit, ILead, IMvpCompletenessReport, IMvpPageVersion, IMvpPerformance, IMvpSourceBrief, IMvpStandards } from '@revamp/shared-types';
import { env } from '../config/env.js';
import { Audit } from '../models/Audit.model.js';
import { browserService } from './browser.service.js';
import { ImageService } from './image.service.js';
import { mvpCompletenessService } from './mvp-completeness.service.js';
import { MvpFinishContext } from './mvp-page-finish.js';
import { measureMvpPerformance } from './mvp-performance.js';
import { buildMvpSeo } from './mvp-seo.js';
import { buildMvpSourceBrief, verifiedContacts } from './mvp-source-brief.js';
import { checkMvpStandards, comparableStandardsScore } from './mvp-standards.js';
import { storageService } from './storage.service.js';

// The steps every publish of an MVP shares (REV-139): the generation deploy, and the operator's change, palette and
// fonts, and restore of a model-designed page.

type PublishAudit = Pick<IAudit, 'screenshotUrls' | 'webVitals' | 'a11ySummary' | 'standardsChecks'>;

/**
 * Uploads the MVP bundle to the S3/MinIO demo sandbox under the lead's slug, then captures its mobile
 * view and uploads the 1200x630 "Before / After" comparison banner next to it. The banner carries measured
 * values only (REV-126): the original's from its audit, the MVP's standards score read from this HTML, each left
 * out when it was not measured. The MVP's web vitals are not on it: they are measured on the demo host, not
 * the business's own hosting.
 */
export async function publishMvp(
  slug: string,
  html: string,
  lead: Pick<ILead, 'businessName'>,
  audit: PublishAudit,
  standards: IMvpStandards | undefined,
): Promise<{ fullPreviewUrl: string; storageHtmlPath: string; comparisonBannerUrl: string }> {
  const { url: fullPreviewUrl, key: storageHtmlPath } = await storageService.uploadHtml(slug, html, env.S3_BUCKET_DEMOS);
  console.log(`[DeployWorker] HTML deployed to ${fullPreviewUrl}`);

  const newMvpMobileBuffer = await browserService.captureHtmlScreenshot(html, {
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
  });

  // The original site's mobile screenshot; without it the banner says so and the MVP never stands in for it
  let originalMobileBuffer: Buffer | undefined;
  if (audit.screenshotUrls?.mobileOriginal) {
    try {
      const res = await fetch(audit.screenshotUrls.mobileOriginal);
      if (res.ok) originalMobileBuffer = Buffer.from(await res.arrayBuffer());
      else console.warn(`[DeployWorker] The original's mobile screenshot was not loaded (HTTP ${res.status})`);
    } catch (error) {
      console.warn('[DeployWorker] The original\'s mobile screenshot was not loaded:', error);
    }
  }

  const bannerBuffer = await ImageService.createComparisonBanner({
    originalMobileBuffer,
    newMvpMobileBuffer,
    businessName: lead.businessName,
    oldLcpSeconds: typeof audit.webVitals?.lcp === 'number' ? audit.webVitals.lcp / 1000 : undefined,
    oldA11yViolationsCount: audit.a11ySummary?.violationsCount,
    oldStandardsScore: comparableStandardsScore(audit.standardsChecks),
    newStandardsScore: standards?.score,
  });

  const comparisonBannerUrl = await storageService.uploadComparisonBanner(slug, bannerBuffer);
  console.log(`[DeployWorker] Comparison banner uploaded to ${comparisonBannerUrl}`);

  return { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl };
}

/**
 * The published page's standards checks (REV-118), by code with the audit's reader; advisory, so a page that cannot
 * be checked has none rather than failing the publish
 */
export function publishedStandards(html: string): IMvpStandards | undefined {
  try {
    return checkMvpStandards(html);
  } catch (error) {
    console.warn(`[DeployWorker] Standards of the published MVP not checked: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

/** What the model may read and what finishing needs, from the lead and its audit: the brief, verified contacts, search tags */
export function pageContext(lead: ILead, audit: IAudit): { brief: IMvpSourceBrief; finish: Omit<MvpFinishContext, 'theme' | 'controls'> } {
  const brief = buildMvpSourceBrief(audit, lead);
  const contacts = verifiedContacts(audit, lead);
  const { seo } = buildMvpSeo({
    businessName: lead.businessName,
    language: brief.language,
    ...(audit.extractedContent ? { site: audit.extractedContent } : {}),
    contacts,
    socialLinks: audit.extractedContacts?.socialLinks ?? [],
    ...(brief.images[0] ? { photo: brief.images[0] } : {}),
    ...(brief.brand.logoUrl ? { logoUrl: brief.brand.logoUrl } : {}),
    ...(/^https?:\/\//i.test(lead.originalUrl ?? '') ? { originalUrl: lead.originalUrl } : {}),
    ...(audit.standardsChecks ? { original: audit.standardsChecks } : {}),
  });
  return {
    brief,
    finish: {
      businessName: lead.businessName,
      language: brief.language,
      services: brief.services,
      contacts,
      seo,
      logoUrl: brief.brand.logoUrl,
      // The tracker as the other renderers load it: from the API, with no per-page token
      ...(/^https?:\/\//i.test(env.PUBLIC_API_URL) ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
    },
  };
}

export interface PublishedPage {
  fullPreviewUrl: string;
  storageHtmlPath: string;
  comparisonBannerUrl: string;
  completenessReport: IMvpCompletenessReport;
  standards?: IMvpStandards;
  performance: IMvpPerformance;
}

/**
 * Checks, uploads and measures a finished page: completeness (`assess` on a generation, the code-only `check` on a
 * re-publish), standards, the bundle and banner, the page's web vitals, and the banner on the audit
 */
export async function publishFinishedPage(input: {
  slug: string;
  html: string;
  lead: ILead;
  audit: IAudit;
  completeness: 'assess' | 'check';
}): Promise<PublishedPage> {
  const { slug, html, lead, audit } = input;
  const completenessReport =
    input.completeness === 'assess' ? await mvpCompletenessService.assess(html, lead, audit) : mvpCompletenessService.check(html, lead, audit);
  const standards = publishedStandards(html);
  const { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl } = await publishMvp(slug, html, lead, audit, standards);
  const performance = await measureMvpPerformance(fullPreviewUrl);
  await Audit.findByIdAndUpdate(audit._id, { 'screenshotUrls.comparisonBanner': comparisonBannerUrl }).exec();
  return { fullPreviewUrl, storageHtmlPath, comparisonBannerUrl, completenessReport, ...(standards ? { standards } : {}), performance };
}

/**
 * Deletes the files of versions that fell off the list, as Mongo kept it (another publish may have pushed
 * meanwhile); a file a kept version still names is never deleted. A failed delete leaves a stray file, never a
 * failed publish
 */
export async function dropUnlistedVersions(before: IMvpPageVersion[], kept: IMvpPageVersion[]): Promise<void> {
  const keptPaths = new Set(kept.map((v) => v.storagePath));
  for (const dropped of before.filter((v) => !keptPaths.has(v.storagePath))) {
    await storageService.deleteObject(dropped.storagePath).catch((error: unknown) => {
      console.warn(`[DeployWorker] Old version ${dropped.storagePath} was not deleted:`, error);
    });
  }
}
