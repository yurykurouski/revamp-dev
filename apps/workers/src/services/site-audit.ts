import type { IAuditScores, IMeasurementError, NicheType } from '@revamp/shared-types';
import type { LlmUsage } from './llm-client.js';
import { browserService } from './browser.service.js';
import { ImageService } from './image.service.js';
import { storageService } from './storage.service.js';
import { designCritiqueService } from './design-critique.service.js';
import { ScoringService } from './scoring.service.js';
import { BrandExtractorService } from './brand-extractor.service.js';
import { classifySiteComplexity } from './site-complexity.service.js';
import { readSiteEra } from './site-era.service.js';

/** What `measureSite` needs; the lead audit and the platform audit (REV-232) call it with their own owner and label */
export interface MeasureSiteInput {
  url: string;
  niche: NicheType;
  businessName: string;
  /** Folder of the screenshots in object storage: the lead's id, or `business-<id>` for a platform audit */
  storageOwnerId: string;
  /** Names the owner in log lines, e.g. `lead 5f..` */
  logLabel: string;
  /** Records one model call's token usage; each caller writes its own event */
  recordTokens: (stage: string, model: string | undefined, usage: LlmUsage | undefined) => Promise<void>;
}

export interface MeasureSiteResult {
  /** The Mongo update of a COMPLETED audit: `$set` fields at top level plus `$unset` for what was not measured */
  update: Record<string, unknown>;
  /** The measured fields that stay absent (REV-100), also keys of the `$unset` */
  unmeasured: string[];
  scores: IAuditScores;
  siteComplexity: ReturnType<typeof classifySiteComplexity>;
  extractedContacts: ReturnType<typeof BrandExtractorService.processBrandData>['contacts'];
  measurementErrors: IMeasurementError[];
  /** The log text of a finished audit */
  summary: string;
  screenshotUrls: { desktop: string; mobile: string; desktopFull: string; mobileFull: string };
  a11yScore: number | undefined;
  lcpSeconds: number | undefined;
  designCritique: unknown;
  aiFallbackUsed: boolean;
  extractedBrandTokens: unknown;
  extractedServices: unknown;
}

/**
 * The deterministic site audit (crawl, accessibility, vitals, standards, brand, era, vision critique, scores),
 * shared by the lead audit and the platform audit. It writes no record: the caller applies `update` to its audit.
 * A measurement that failed is left out and listed in `measurementErrors` (REV-100).
 */
export async function measureSite(input: MeasureSiteInput): Promise<MeasureSiteResult> {
  const { url, niche, businessName, storageOwnerId, logLabel } = input;

  // 2. Ensure S3 / MinIO storage bucket exists
  await storageService.ensureBucket();

  // 3. Capture screenshots, perform Axe-core WCAG audit, collect Vitals, and extract raw Brand DNA
  console.log(`[AuditWorker] Running Playwright crawl, a11y audit, vitals, and brand extraction for ${url}...`);
  const {
    desktopBuffer,
    mobileBuffer,
    desktopFullBuffer,
    mobileFullBuffer,
    a11yResult,
    vitalsResult,
    rawBrandData,
    cookieConsent,
    complexitySignals,
    eraFacts,
    homeHtml,
  } = await browserService.captureFullAudit(url);

  // Deterministic complexity estimate: one-page brochure sites are the easiest to replace (REV-38)
  const siteComplexity = classifySiteComplexity(complexitySignals);

  // 4. Compress screenshots to modern WebP format (max 1024px longest dimension for Vision LLM input)
  console.log(`[AuditWorker] Compressing screenshots to WebP for ${logLabel}...`);
  const [desktopWebp, mobileWebp, desktopFullWebp, mobileFullWebp] = await Promise.all([
    ImageService.compressToWebp(desktopBuffer, { quality: 80, maxWidth: 1024, maxDimension: 1024 }),
    ImageService.compressToWebp(mobileBuffer, { quality: 80, maxWidth: 1024, maxDimension: 1024 }),
    // Full-page captures keep their native width so the operator preview stays legible
    ImageService.compressFullPageToWebp(desktopFullBuffer, { maxWidth: 1440 }),
    ImageService.compressFullPageToWebp(mobileFullBuffer, { maxWidth: 750 }),
  ]);

  // 5. Upload WebP images to S3 / MinIO
  console.log(`[AuditWorker] Uploading WebP screenshots to object storage for ${logLabel}...`);
  const [desktopScreenshotUrl, mobileScreenshotUrl, desktopFullScreenshotUrl, mobileFullScreenshotUrl] = await Promise.all([
    storageService.uploadScreenshot(storageOwnerId, 'desktop', desktopWebp),
    storageService.uploadScreenshot(storageOwnerId, 'mobile', mobileWebp),
    storageService.uploadScreenshot(storageOwnerId, 'desktop-full', desktopFullWebp),
    storageService.uploadScreenshot(storageOwnerId, 'mobile-full', mobileFullWebp),
  ]);

  // 6. Brand DNA Extraction (REV-10: K-Means palette, logo/monogram, factual contacts)
  console.log(`[AuditWorker] Extracting Brand DNA & clustering palette for ${logLabel}...`);
  const brandResult = BrandExtractorService.processBrandData(rawBrandData, businessName || 'Business');

  // 7. Vision LLM critique (DesignCritiqueAgent, REV-9)
  console.log(`[AuditWorker] Running Vision UX/UI analysis for ${logLabel}...`);
  const critiqueResult = await designCritiqueService.analyzeDesign({
    mobileScreenshotWebp: mobileWebp,
    desktopScreenshotWebp: desktopWebp,
    niche,
    a11yScore: a11yResult.a11yScore,
    lcpSeconds: vitalsResult.lcpSeconds,
    originalUrl: url,
  });

  if (eraFacts.error) console.warn(`[AuditWorker] Era facts not read for ${logLabel}: ${eraFacts.error}`);
  // Whether the original site looks dated (REV-114); deterministic, and never fails the audit
  let siteEra: ReturnType<typeof readSiteEra> | undefined;
  let siteEraError: string | undefined;
  if (homeHtml) {
    try {
      siteEra = readSiteEra({
        html: homeHtml,
        // Measured on the page; without them the verdict rests on the HTML signs (REV-141)
        contentWidth: eraFacts.raw?.contentWidth,
        fullBleedShare: eraFacts.raw?.fullBleedShare,
        bodyFont: eraFacts.raw?.bodyFont,
        now: new Date(),
      });
    } catch (eraErr) {
      siteEraError = (eraErr instanceof Error ? eraErr.message : String(eraErr)).slice(0, 300);
    }
  } else {
    siteEraError = 'home page HTML not read';
  }
  if (siteEraError) console.warn(`[AuditWorker] Site era not read for ${logLabel}: ${siteEraError}`);

  await input.recordTokens('audit_vision_critique', critiqueResult.modelUsed, critiqueResult.tokenUsage);

  // 8. Calculate Composite Scores (Formula: 0.35 Design + 0.25 Perf + 0.20 A11y + 0.20 Standards)
  // A templated fallback critique is not a measurement, so its ratings are not scored (REV-101)
  const designScore = critiqueResult.aiFallbackUsed ? undefined : ScoringService.calculateDesignScore(critiqueResult.critique);
  const scores = ScoringService.calculateCompositeScore({
    designScore,
    performanceScore: vitalsResult.performanceScore,
    accessibilityScore: a11yResult.a11yScore,
    standardsScore: vitalsResult.standardsScore,
  });

  // Measurements that failed on their own leave their values out and are listed instead (REV-100)
  const measurementErrors: IMeasurementError[] = [...vitalsResult.errors, ...a11yResult.errors];
  if (critiqueResult.aiFallbackUsed) {
    measurementErrors.push({
      measurement: 'design',
      message: critiqueResult.fallbackReason ?? 'The Vision model gave no critique; the critique shown is a template',
    });
  }
  for (const failure of measurementErrors) {
    console.warn(`[AuditWorker] ${failure.measurement} not measured for ${logLabel}: ${failure.message}`);
  }
  const measuredFields: Record<string, unknown> = {
    a11yScore: a11yResult.a11yScore,
    lcp: vitalsResult.lcpSeconds,
    a11ySummary: a11yResult.summary,
    axeViolations: a11yResult.violations,
    standardsChecks: vitalsResult.standards,
    // Exactly one of the two is set, so a re-audit never keeps the previous run's verdict (REV-114)
    siteEra,
    siteEraError,
  };
  // `scores` and `webVitals` are replaced whole; the fields below are unset when not measured
  const unmeasured = Object.keys(measuredFields).filter((key) => measuredFields[key] === undefined);

  // 9. The update of the COMPLETED audit with full metrics, critique and brand tokens
  const update: Record<string, unknown> = {
    ...(unmeasured.length > 0 ? { $unset: Object.fromEntries(unmeasured.map((key) => [key, ''])) } : {}),
    status: 'COMPLETED',
    completedAt: new Date(),
    desktopScreenshotUrl,
    mobileScreenshotUrl,
    screenshotUrls: {
      desktopOriginal: desktopScreenshotUrl,
      mobileOriginal: mobileScreenshotUrl,
      desktopFull: desktopFullScreenshotUrl,
      mobileFull: mobileFullScreenshotUrl,
    },
    ...Object.fromEntries(Object.entries(measuredFields).filter(([, value]) => value !== undefined)),
    scores,
    webVitals: vitalsResult.webVitals,
    measurementErrors,
    designCritique: critiqueResult.critique,
    aiFallbackUsed: critiqueResult.aiFallbackUsed,
    extractedBrandTokens: brandResult.tokens,
    extractedServices: brandResult.services,
    extractedContacts: brandResult.contacts,
    extractedContent: brandResult.siteContent,
    cookieBannerHandled: cookieConsent,
    siteComplexity,
  };

  const summary =
    `   - Total Score:    ${scores.total}/100\n` +
    `   - Design:         ${scores.design ?? 'not scored (template critique)'}/100\n` +
    `   - Primary Color:  ${brandResult.tokens.primaryColor} (Accent: ${brandResult.tokens.accentColor})\n` +
    `   - Logo / Brand:   ${brandResult.tokens.logoUrl ? 'Extracted' : 'Monogram'}\n` +
    `   - a11yScore:      ${scores.accessibility ?? 'not measured'}/100 (${a11yResult.summary?.violationsCount ?? '?'} violations)\n` +
    `   - Performance:    ${scores.performance ?? 'not measured'}/100 (LCP: ${vitalsResult.lcpSeconds ?? '?'}s)\n` +
    `   - Standards:      ${scores.standards ?? 'not measured'}/100 (HTTPS: ${vitalsResult.standards?.https ?? '?'})\n` +
    `   - Complexity:     ${siteComplexity.class} (${siteComplexity.reasons.join(', ')})\n` +
    `   - Desktop URL:    ${desktopScreenshotUrl}\n` +
    `   - Mobile URL:     ${mobileScreenshotUrl}\n` +
    `   - Full-page URLs: ${desktopFullScreenshotUrl}, ${mobileFullScreenshotUrl}`;

  return {
    update,
    unmeasured,
    scores,
    siteComplexity,
    extractedContacts: brandResult.contacts,
    measurementErrors,
    summary,
    screenshotUrls: {
      desktop: desktopScreenshotUrl,
      mobile: mobileScreenshotUrl,
      desktopFull: desktopFullScreenshotUrl,
      mobileFull: mobileFullScreenshotUrl,
    },
    a11yScore: a11yResult.a11yScore,
    lcpSeconds: vitalsResult.lcpSeconds,
    designCritique: critiqueResult.critique,
    aiFallbackUsed: critiqueResult.aiFallbackUsed,
    extractedBrandTokens: brandResult.tokens,
    extractedServices: brandResult.services,
  };
}
