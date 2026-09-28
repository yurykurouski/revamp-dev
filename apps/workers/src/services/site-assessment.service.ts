/**
 * Pre-assessment of discovered sites (REV-98).
 *
 * Before the operator imports a discovered business, one plain HTTP request fetches its home page
 * and code parses the HTML (scripts never run) for two things: whether the site is simple enough
 * for a one-page MVP, and deterministic signs that it needs a redesign. No Playwright, no LLM.
 * A site that cannot be fetched gets a `failed` assessment with the reason, never a verdict.
 */
import { isIP } from 'node:net';
import { Window } from 'happy-dom';
import {
  IDiscoveryCandidate,
  ISiteAssessment,
  SiteAssessmentFailure,
  SiteAssessmentVerdict,
  SiteBadSign,
  SiteComplexitySign,
  SiteVerdictReason,
} from '@revamp/shared-types';
import { SiteAssessmentSchema } from '@revamp/validation';
import { collectInternalPages, SMALL_SITE_MAX_PAGES } from './site-complexity.service.js';

export type FetchFn = typeof fetch;

export interface SiteAssessmentOptions {
  fetchFn?: FetchFn;
  /** Budget for the whole check, redirects and the http:// retry included */
  timeoutMs: number;
  userAgent: string;
  /** Clock for the copyright check and the timestamp; injectable for tests */
  now?: () => Date;
}

/** Responses slower than this (to the final page's headers) count as a sign */
export const SLOW_RESPONSE_MS = 3000;
/** Home page HTML larger than this counts as a sign */
export const HEAVY_HTML_BYTES = 500_000;
/** Reading stops here; a page this big is already heavy */
export const MAX_HTML_BYTES = 2_000_000;
/** A copyright year this many years old or more counts as stale */
export const STALE_COPYRIGHT_YEARS = 3;
const MAX_REDIRECTS = 5;

/** Signs that on their own show an outdated site; they weigh double in the verdict */
const STRONG_SIGNS: ReadonlySet<SiteBadSign> = new Set([
  'no_https',
  'invalid_certificate',
  'no_viewport',
  'table_layout',
  'frames',
  'flash',
]);

/** What the home page's DOM contains, as parsed by `parseHomePage` */
export interface HomePageSignals {
  hasViewport: boolean;
  hasTitle: boolean;
  hasMetaDescription: boolean;
  hasFrames: boolean;
  hasTableLayout: boolean;
  hasFlash: boolean;
  hasOldJquery: boolean;
  hasLegacyTags: boolean;
  copyrightYear?: number;
  hasEcommerce: boolean;
  hasLogin: boolean;
  hasAppFramework: boolean;
  /** Raw hrefs of the page's links */
  links: string[];
}

export interface FetchedHomePage {
  finalUrl: string;
  httpStatus: number;
  responseMs: number;
  html: string;
  htmlBytes: number;
  /** The https:// request failed on its certificate and the page came over http:// instead */
  certificateFailed: boolean;
}

class AssessmentFailure extends Error {
  constructor(
    public readonly failure: SiteAssessmentFailure,
    public readonly httpStatus?: number,
  ) {
    super(failure);
  }
}

const PRIVATE_IPV4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

/**
 * Hosts a discovery check must not reach: localhost and internal names, private IPv4 ranges and
 * any IPv6 literal. Maps listings are third-party data, so their URLs are not trusted.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const ipVersion = isIP(host);
  if (ipVersion === 6) return true;
  if (ipVersion === 4) return PRIVATE_IPV4.some((range) => range.test(host));
  return false;
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** undici reports TLS problems as `fetch failed` with the OpenSSL code on its cause */
const isCertificateError = (error: unknown): boolean => {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const text = `${String(cause?.code ?? '')} ${String(cause?.message ?? '')}`;
  return /CERT|SSL|TLS|self[- ]signed/i.test(text);
};

/** Reads at most MAX_HTML_BYTES of the body */
async function readCapped(res: Response): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_HTML_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(size, MAX_HTML_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Follows redirects by hand so every hop's host is checked before it is requested */
async function fetchFollowing(
  url: string,
  fetchFn: FetchFn,
  signal: AbortSignal,
  userAgent: string,
): Promise<{ res: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isBlockedHost(new URL(current).hostname)) throw new AssessmentFailure('blocked_host');
    const res = await fetchFn(current, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      const next = new URL(location, current);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new AssessmentFailure('unreachable');
      next.hash = '';
      current = next.toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new AssessmentFailure('unreachable');
}

/**
 * Fetches a site's home page. An https:// address that fails to connect is retried over http://,
 * since maps listings often carry a guessed scheme; a certificate failure is remembered as a sign.
 */
export async function fetchHomePage(url: string, options: SiteAssessmentOptions): Promise<FetchedHomePage> {
  const fetchFn = options.fetchFn ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs);
  const started = performance.now();

  let certificateFailed = false;
  let attempt: { res: Response; finalUrl: string };
  try {
    attempt = await fetchFollowing(url, fetchFn, signal, options.userAgent);
  } catch (error) {
    if (error instanceof AssessmentFailure) throw error;
    if (isTimeout(error) || !url.startsWith('https://')) {
      throw new AssessmentFailure(isTimeout(error) ? 'timeout' : 'unreachable');
    }
    certificateFailed = isCertificateError(error);
    try {
      attempt = await fetchFollowing(url.replace(/^https:/, 'http:'), fetchFn, signal, options.userAgent);
    } catch (retryError) {
      if (retryError instanceof AssessmentFailure) throw retryError;
      if (isTimeout(retryError)) throw new AssessmentFailure('timeout');
      // The site only answers over https with a bad certificate: that is the reason, not "unreachable"
      throw new AssessmentFailure(certificateFailed ? 'invalid_certificate' : 'unreachable');
    }
  }
  const responseMs = Math.round(performance.now() - started);

  const { res, finalUrl } = attempt;
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => undefined);
    throw new AssessmentFailure('http_error', res.status);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    await res.body?.cancel().catch(() => undefined);
    throw new AssessmentFailure('not_html');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readCapped(res);
  } catch (error) {
    throw new AssessmentFailure(isTimeout(error) ? 'timeout' : 'unreachable');
  }
  return {
    finalUrl,
    httpStatus: res.status,
    responseMs,
    html: decode(bytes, contentType),
    htmlBytes: bytes.byteLength,
    certificateFailed,
  };
}

const COPYRIGHT_YEAR =
  /(?:©|\(c\)|copyright)(?:\s|©|\(c\)|&copy;)*((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;

/** The latest plausible year in the page's copyright notices, if any */
export function findCopyrightYear(text: string, now: Date): number | undefined {
  const maxYear = now.getUTCFullYear() + 1;
  let latest: number | undefined;
  for (const match of text.matchAll(COPYRIGHT_YEAR)) {
    for (const group of [match[1], match[2]]) {
      const year = Number(group);
      if (group && year >= 1990 && year <= maxYear && (latest === undefined || year > latest)) latest = year;
    }
  }
  return latest;
}

const ECOMMERCE_HREF = /(^|[/?=_-])(cart|checkout|basket|koszyk|korzina|warenkorb)([/?#._-]|$)/;
const LOGIN_HREF = /(^|[/?=_-])(login|log-in|signin|sign-in|my-account|account|logowanie)([/?#._-]|$)/;
const OLD_JQUERY = [/jquery[.-]?([12])\.\d+(\.\d+)?(\.min)?\.js/i, /jquery(\.min)?\.js\?ver=([12])\./i];

/** Parses the home page without running its scripts and reports the raw DOM facts */
export function parseHomePage(html: string, now: Date): HomePageSignals {
  const window = new Window({
    settings: {
      // Script evaluation is off by default; nothing on the page is loaded or run
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
    },
  });
  try {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const all = (selector: string) => Array.from(doc.querySelectorAll(selector));
    const has = (selector: string) => doc.querySelector(selector) !== null;
    const attr = (el: { getAttribute(name: string): string | null }, name: string) =>
      (el.getAttribute(name) ?? '').trim().toLowerCase();

    const metas = all('meta');
    const metaNamed = (name: string) => metas.find((m) => attr(m, 'name') === name);
    const description = metaNamed('description');

    const links = all('a[href]').map((a) => (a.getAttribute('href') ?? '').trim());
    const lowerLinks = links.map((href) => href.toLowerCase());
    const scriptSources = all('script[src]').map((s) => attr(s, 'src'));

    const flashRefs = [
      ...all('object').flatMap((el) => [attr(el, 'data'), attr(el, 'type'), attr(el, 'classid')]),
      ...all('embed').flatMap((el) => [attr(el, 'src'), attr(el, 'type')]),
      ...all('param').map((el) => attr(el, 'value')),
    ];

    // Text only, so a year inside a script or style never counts
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
    const text = `${doc.body?.textContent ?? ''}`.replace(/\s+/g, ' ');

    return {
      hasViewport: Boolean(metaNamed('viewport')),
      hasTitle: doc.title.trim().length > 0,
      hasMetaDescription: attr(description ?? { getAttribute: () => null }, 'content').length > 0,
      hasFrames: has('frameset, frame'),
      hasTableLayout: has('table table, table[background], td[background], table[bgcolor], td[bgcolor]'),
      hasFlash: flashRefs.some((ref) => ref.endsWith('.swf') || ref.includes('shockwave') || ref.includes('d27cdb6e-ae6d-11cf-96b8-444553540000')),
      hasOldJquery: scriptSources.some((src) => OLD_JQUERY.some((pattern) => pattern.test(src))),
      hasLegacyTags: has('font, center, marquee, blink'),
      copyrightYear: findCopyrightYear(text, now),
      hasEcommerce:
        lowerLinks.some((href) => ECOMMERCE_HREF.test(href)) ||
        has('.woocommerce, [data-shopify], .shopify-section, .add_to_cart_button, form[action*="/cart"]'),
      hasLogin:
        has('input[type="password"]') ||
        lowerLinks.some((href) => !/wp-(login|admin)/.test(href) && LOGIN_HREF.test(href)),
      hasAppFramework:
        has('#__next, #__nuxt, [ng-version], [data-reactroot], script#__NEXT_DATA__') ||
        scriptSources.some((src) => src.includes('/_next/') || src.includes('/_nuxt/')),
      links,
    };
  } finally {
    void window.happyDOM.close();
  }
}

export function detectBadSigns(page: FetchedHomePage, signals: HomePageSignals, now: Date): SiteBadSign[] {
  const signs: SiteBadSign[] = [];
  if (page.finalUrl.startsWith('http://')) signs.push('no_https');
  if (page.certificateFailed) signs.push('invalid_certificate');
  if (!signals.hasViewport) signs.push('no_viewport');
  if (signals.hasTableLayout) signs.push('table_layout');
  if (signals.hasFrames) signs.push('frames');
  if (signals.hasFlash) signs.push('flash');
  if (signals.hasOldJquery) signs.push('old_jquery');
  if (signals.hasLegacyTags) signs.push('legacy_tags');
  if (!signals.hasTitle) signs.push('no_title');
  if (!signals.hasMetaDescription) signs.push('no_meta_description');
  if (signals.copyrightYear !== undefined && now.getUTCFullYear() - signals.copyrightYear >= STALE_COPYRIGHT_YEARS) {
    signs.push('stale_copyright');
  }
  if (page.responseMs > SLOW_RESPONSE_MS) signs.push('slow_response');
  if (page.htmlBytes > HEAVY_HTML_BYTES) signs.push('heavy_html');
  return signs;
}

export function detectComplexitySigns(signals: HomePageSignals, internalPages: number): SiteComplexitySign[] {
  const signs: SiteComplexitySign[] = [];
  if (internalPages > SMALL_SITE_MAX_PAGES) signs.push('many_pages');
  if (signals.hasEcommerce) signs.push('ecommerce');
  if (signals.hasLogin) signs.push('login');
  if (signals.hasAppFramework) signs.push('app_framework');
  return signs;
}

/** Sign score a simple site needs to be a good candidate */
export const SIMPLE_GOOD_SCORE = 2;
/** Sign score a complex site needs to be a maybe; it is never a good candidate */
export const COMPLEX_MAYBE_SCORE = 3;

export interface VerdictExplanation {
  verdict: SiteAssessmentVerdict;
  reason: SiteVerdictReason;
  /** Strong signs (no HTTPS, bad certificate, not mobile-friendly, table or frame layout, Flash) score 2, the rest 1 */
  score: number;
  /** Score needed for the next better verdict; absent for a good candidate */
  scoreNeeded?: number;
}

/**
 * The verdict from the signs, with the argument for it:
 * - simple site: score 2+ is a good candidate, 1 is maybe, 0 (an up-to-date site) is poor
 * - complex site: score 3+ is maybe, otherwise poor, since a one-page MVP is a hard sell
 */
export function explainVerdict(simple: boolean, badSigns: SiteBadSign[]): VerdictExplanation {
  const score = badSigns.reduce((sum, sign) => sum + (STRONG_SIGNS.has(sign) ? 2 : 1), 0);
  if (simple) {
    if (score >= SIMPLE_GOOD_SCORE) return { verdict: 'good', reason: 'simple_with_signs', score };
    return score > 0
      ? { verdict: 'maybe', reason: 'simple_few_signs', score, scoreNeeded: SIMPLE_GOOD_SCORE }
      : { verdict: 'poor', reason: 'simple_no_signs', score, scoreNeeded: SIMPLE_GOOD_SCORE };
  }
  return score >= COMPLEX_MAYBE_SCORE
    ? { verdict: 'maybe', reason: 'complex_with_signs', score }
    : { verdict: 'poor', reason: 'complex_few_signs', score, scoreNeeded: COMPLEX_MAYBE_SCORE };
}

export const assessmentVerdict = (simple: boolean, badSigns: SiteBadSign[]): SiteAssessmentVerdict =>
  explainVerdict(simple, badSigns).verdict;

/** Assesses one site; never throws, a failed check is returned as such */
export async function assessSite(url: string, options: SiteAssessmentOptions): Promise<ISiteAssessment> {
  const now = options.now?.() ?? new Date();
  const assessedAt = now.toISOString();
  let page: FetchedHomePage;
  try {
    page = await fetchHomePage(url, options);
  } catch (error) {
    if (error instanceof AssessmentFailure) {
      return { outcome: 'failed', failure: error.failure, httpStatus: error.httpStatus, assessedAt };
    }
    console.warn(`[SiteAssessment] ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return { outcome: 'failed', failure: 'unreachable', assessedAt };
  }

  const signals = parseHomePage(page.html, now);
  const internalPages = collectInternalPages(page.finalUrl, signals.links).length;
  const badSigns = detectBadSigns(page, signals, now);
  const complexitySigns = detectComplexitySigns(signals, internalPages);
  const simple = complexitySigns.length === 0;
  const explanation = explainVerdict(simple, badSigns);

  return SiteAssessmentSchema.parse({
    outcome: 'assessed',
    verdict: explanation.verdict,
    verdictReason: explanation.reason,
    signScore: explanation.score,
    signScoreNeeded: explanation.scoreNeeded,
    simple,
    badSigns,
    complexitySigns,
    internalPages,
    finalUrl: page.finalUrl,
    httpStatus: page.httpStatus,
    responseMs: page.responseMs,
    htmlBytes: page.htmlBytes,
    copyrightYear: signals.copyrightYear,
    assessedAt,
  }) as ISiteAssessment;
}

/**
 * Assesses the site of every `new` candidate, at most `concurrency` at a time, and stores the
 * result on the candidate. Skipped listings are left alone: the operator can't import them anyway.
 */
export async function assessCandidates(
  candidates: IDiscoveryCandidate[],
  assess: (url: string) => Promise<ISiteAssessment>,
  concurrency: number,
): Promise<void> {
  const queue = candidates.filter((c) => c.status === 'new' && c.website);
  let next = 0;
  const run = async () => {
    for (let candidate = queue[next++]; candidate; candidate = queue[next++]) {
      candidate.assessment = await assess(candidate.website as string);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, run));
}
