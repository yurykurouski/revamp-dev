/**
 * MVP completeness check (REV-36).
 *
 * Compares the rendered MVP HTML with the business data extracted from the original site during
 * the audit (contacts, services, testimonials, ...). Deterministic DOM parsing only: no LLM, no
 * new crawl. The report is advisory; it never approves, blocks or dispatches anything.
 */
import { Window } from 'happy-dom';
import {
  CompletenessField,
  CompletenessStatus,
  CompletenessTier,
  IAudit,
  ICompletenessCheck,
  ILead,
  IMvpCompletenessReport,
  ISiteContent,
  ISocialLink,
} from '@revamp/shared-types';
import { MvpCompletenessReportSchema, criticalCompletenessIssues } from '@revamp/validation';

/** The original site's data the MVP is checked against */
export interface CompletenessSource {
  businessName?: string;
  phones: string[];
  emails: string[];
  address?: string;
  workingHours?: string;
  services: string[];
  socialLinks: ISocialLink[];
  logoUrl?: string;
  images: string[];
  testimonials: string[];
  rating?: ISiteContent['rating'];
  foundingYear?: number;
  /**
   * All text extracted from the original site. Contact data found anywhere in it (e.g. a mobile
   * number inside the address block) counts as sourced.
   */
  sourceText: string;
}

/** What the DOM of the generated MVP contains */
export interface ParsedMvp {
  text: string;
  headings: string[];
  telLinks: string[];
  mailtoLinks: string[];
  links: string[];
  imageSources: string[];
  /** Text of elements that present an address (<address>, map links) */
  addressBlocks: string[];
}

/** A check and the credit (0..1) it earns towards the score */
interface CheckResult {
  check: ICompletenessCheck;
  credit: number;
}

const TIER_WEIGHT: Record<CompletenessTier, number> = { critical: 3, important: 2, informational: 1 };
const MAX_VALUE_LENGTH = 500;
/** Share of a source text's words that must appear for a fuzzy match */
const TOKEN_MATCH_THRESHOLD = 0.75;
/** Dice similarity of character bigrams for fuzzy service-title matches */
const BIGRAM_MATCH_THRESHOLD = 0.7;
/** Service titles checked at most; the MVP shows a curated subset of long lists */
const MAX_SERVICES_CHECKED = 10;

// Street-type words and abbreviations that vary between spellings of the same address
const ADDRESS_STOPWORDS = new Set([
  'ul', 'ulica', 'ulitsa', 'street', 'st', 'str', 'strasse', 'straße', 'road', 'rd', 'avenue', 'ave',
  'al', 'aleja', 'aleje', 'pl', 'plac', 'square', 'sq', 'prospekt', 'pr', 'prosp', 'vul', 'vulica',
  'g', 'gatve', 'gatvė', 'd', 'dom', 'bldg', 'building', 'office', 'lok', 'lokal', 'm',
  'ул', 'улица', 'д', 'дом', 'пр', 'просп', 'проспект', 'пл', 'площадь', 'вул', 'вуліца', 'г', 'гор',
  'кв', 'оф', 'офис', 'пер', 'переулок', 'стр', 'корп', 'к',
]);

const PHONE_IN_TEXT = /(?:\+|\b)\d[\d\s().\u2010-\u2015-]{5,}\d/g;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const TIME_IN_TEXT = /\b(\d{1,2})[:.](\d{2})\b/g;

const clip = (value: string | undefined): string | undefined =>
  value ? (value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 1)}…` : value) : undefined;

/** Lower-case, drop accents and punctuation, collapse whitespace */
export function normalizeText(value: string | undefined | null): string {
  return (value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const tokenize = (value: string, stopwords?: Set<string>): string[] =>
  normalizeText(value)
    .split(' ')
    .filter((t) => t && (t.length > 1 || /\d/.test(t)) && !stopwords?.has(t));

/**
 * Normalizes a phone number to E.164 when it carries a country code ("+375 29 ..." or
 * "00375 ..." → "+37529..."); numbers without one keep their national digits.
 */
export function normalizePhone(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.replace(/^tel:/i, '').trim();
  let digits = value.replace(/\D/g, '');
  let international = value.startsWith('+');
  if (!international && digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }
  if (digits.length < 7 || digits.length > 15) return undefined;
  return international ? `+${digits}` : digits;
}

/**
 * Same number, allowing for a missing country code or a national trunk prefix
 * ("8 029 ..." vs "+375 29 ..."): the last nine digits (the subscriber part) must agree.
 */
export function phonesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = na.replace(/\D/g, '');
  const db = nb.replace(/\D/g, '');
  if (da.length < 9 || db.length < 9) return da === db;
  return da.slice(-9) === db.slice(-9);
}

export function normalizeEmail(raw: string | undefined | null): string | undefined {
  const value = (raw || '').replace(/^mailto:/i, '').split('?')[0]?.trim().toLowerCase();
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

/** Query parameters that track the visit rather than identify the page */
const TRACKING_PARAM = /^(utm_\w+|ref|ref_src|fbclid|gclid|igshid|si|hl|locale)$/i;

/**
 * host + path + identifying query, without scheme, "www.", hash, trailing slash or tracking
 * parameters. The query stays: "facebook.com/profile.php?id=…" names the profile.
 */
export function normalizeUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    const query = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAM.test(key))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&');
    return `${host}${url.pathname.replace(/\/+$/, '').toLowerCase()}${query ? `?${query}` : ''}`;
  } catch {
    return undefined;
  }
}

/**
 * Same word, allowing a different ending ("implants" / "implant", "Marszałkowska" /
 * "Marszałkowskiej"): a shared stem of at least five letters, with only the last few letters different.
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  if (shorter < 5 || /\d/.test(a) || /\d/.test(b)) return false;
  let prefix = 0;
  while (prefix < shorter && a[prefix] === b[prefix]) prefix++;
  return prefix >= 5 && prefix >= shorter - 2 && Math.max(a.length, b.length) - prefix <= 3;
}

/** Share of `source` tokens found in `target` tokens */
export function tokenCoverage(source: string, target: string, stopwords?: Set<string>): number {
  const sourceTokens = tokenize(source, stopwords);
  if (sourceTokens.length === 0) return 0;
  const targetTokens = new Set(tokenize(target, stopwords));
  const found = sourceTokens.filter(
    (t) => targetTokens.has(t) || [...targetTokens].some((candidate) => wordsMatch(t, candidate)),
  );
  return found.length / sourceTokens.length;
}

/** Sørensen–Dice similarity of character bigrams, 0..1 */
export function bigramSimilarity(a: string, b: string): number {
  const x = normalizeText(a).replace(/ /g, '');
  const y = normalizeText(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const bg = x.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const bg = y.slice(i, i + 2);
    const count = bigrams.get(bg) || 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      overlap++;
    }
  }
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

const normalizeTime = (h: string, m: string): string => `${Number(h)}:${m}`;

function extractTimes(text: string): string[] {
  return [...text.matchAll(TIME_IN_TEXT)].map((m) => normalizeTime(m[1] || '', m[2] || ''));
}

/**
 * Where a known number appears in free text, with any separators between its digits
 * ("8200-175", "(22) 555-12-34"). Looks for the subscriber part: the last nine digits at most.
 */
export function findPhoneInText(phone: string, text: string): string | undefined {
  const digits = normalizePhone(phone)?.replace(/\D/g, '');
  if (!digits) return undefined;
  const pattern = digits.slice(-9).split('').join('[^\\p{L}\\p{N}]{0,3}');
  return new RegExp(`${pattern}(?!\\p{N})`, 'u').exec(text)?.[0];
}

function extractPhones(text: string): string[] {
  return (text.match(PHONE_IN_TEXT) || []).filter((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    // Nine digits keeps date ranges and prices out; real numbers with an area code are longer
    return digits.length >= 9 && digits.length <= 15 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(candidate.trim());
  });
}

/** Adds each value whose key isn't in the list yet */
function uniqueBy<T>(values: T[], key: (v: T) => string | undefined): T[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = key(v);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class MvpCompletenessService {
  /**
   * Parses the generated HTML into the parts the checks look at. Scripts are never run.
   */
  parseHtml(html: string): ParsedMvp {
    const window = new Window({
      settings: {
        disableJavaScriptFileLoading: true,
        disableCSSFileLoading: true,
        disableComputedStyleRendering: true,
        navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
      },
    });
    try {
      const doc = new window.DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());

      const hrefs = Array.from(doc.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
      const cleanText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
      // Text nodes joined with spaces: textContent would glue "Dental" and "info@x.pl" in adjacent
      // elements into one word (and one bogus email)
      const textOf = (root: Parameters<typeof doc.createTreeWalker>[0] | null | undefined): string => {
        if (!root) return '';
        const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
        const parts: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent || '');
        return cleanText(parts.join(' '));
      };

      const addressBlocks = [
        ...Array.from(doc.querySelectorAll('address')),
        ...Array.from(doc.querySelectorAll('a[href*="maps"]')),
      ]
        .map(textOf)
        .filter(Boolean);

      return {
        text: cleanText(`${doc.title} ${textOf(doc.body)}`),
        headings: Array.from(doc.querySelectorAll('h1, h2, h3, h4'))
          .map(textOf)
          .filter(Boolean),
        telLinks: hrefs.filter((h) => /^tel:/i.test(h)),
        mailtoLinks: hrefs.filter((h) => /^mailto:/i.test(h)),
        links: hrefs.filter((h) => /^https?:\/\//i.test(h)),
        imageSources: Array.from(doc.querySelectorAll('img[src]')).map((img) => img.getAttribute('src') || ''),
        addressBlocks: [...new Set(addressBlocks)],
      };
    } finally {
      void window.happyDOM.close();
    }
  }

  /**
   * Collects the source data from the lead and its audit. The lead's own contact fields count as
   * sourced: the template falls back to them, and they come from the operator or the maps provider.
   */
  buildSource(lead: Partial<ILead>, audit?: Partial<IAudit> | null): CompletenessSource {
    const contacts = audit?.extractedContacts;
    const site = audit?.extractedContent;
    const isHttpUrl = (url?: string): url is string => Boolean(url && /^https?:\/\//i.test(url));

    const services = uniqueBy(
      [...(site?.serviceItems || []).map((s) => s.title), ...(audit?.extractedServices || [])]
        .map((t) => (t || '').trim())
        .filter(Boolean),
      (t) => normalizeText(t),
    );

    return {
      businessName: lead.businessName?.trim() || undefined,
      phones: uniqueBy(
        [contacts?.phone, lead.contactPhone].filter((p): p is string => Boolean(normalizePhone(p))),
        (p) => normalizePhone(p),
      ),
      emails: uniqueBy(
        [contacts?.email, lead.contactEmail].filter((e): e is string => Boolean(normalizeEmail(e))),
        (e) => normalizeEmail(e),
      ),
      address: contacts?.address?.trim() || undefined,
      workingHours: contacts?.workingHours?.trim() || undefined,
      services: services.slice(0, MAX_SERVICES_CHECKED),
      socialLinks: (contacts?.socialLinks || []).filter((l) => isHttpUrl(l.url)),
      logoUrl: isHttpUrl(audit?.extractedBrandTokens?.logoUrl) ? audit?.extractedBrandTokens?.logoUrl : undefined,
      images: (site?.images || []).filter(isHttpUrl),
      testimonials: (site?.testimonials || []).map((t) => t.text).filter((t) => t && t.length >= 5),
      rating: site?.rating?.value ? site.rating : undefined,
      foundingYear: site?.foundingYear || undefined,
      sourceText: [
        contacts?.address,
        contacts?.workingHours,
        site?.title,
        site?.metaDescription,
        site?.h1,
        ...(site?.headings || []),
        ...(site?.paragraphs || []),
        ...(site?.serviceItems || []).flatMap((item) => [item.title, item.description]),
        ...(site?.testimonials || []).map((t) => t.text),
      ]
        .filter(Boolean)
        .join(' \n '),
    };
  }

  /**
   * Compares the MVP with the source data and scores the result.
   */
  compare(html: string, source: CompletenessSource, checkedAt: Date = new Date()): IMvpCompletenessReport {
    const mvp = this.parseHtml(html);
    const results: CheckResult[] = [
      this.checkBusinessName(mvp, source),
      this.checkPhone(mvp, source),
      this.checkEmail(mvp, source),
      this.checkAddress(mvp, source),
      this.checkWorkingHours(mvp, source),
      this.checkServices(mvp, source),
      this.checkSocialLinks(mvp, source),
      this.checkLogo(mvp, source),
      this.checkImages(mvp, source),
      this.checkTestimonials(mvp, source),
      this.checkRating(mvp, source),
      this.checkFoundingYear(mvp, source),
      ...this.findUnsourced(mvp, source),
    ];

    let weight = 0;
    let earned = 0;
    for (const { check, credit } of results) {
      if (check.status === 'not_in_source') continue;
      weight += TIER_WEIGHT[check.tier];
      earned += TIER_WEIGHT[check.tier] * credit;
    }

    // Unset values are left out rather than saved as null in the Mixed field
    const checks = results.map(({ check }) => {
      const clipped: ICompletenessCheck = { field: check.field, tier: check.tier, status: check.status };
      const originalValue = clip(check.originalValue);
      const mvpValue = clip(check.mvpValue);
      const note = clip(check.note);
      if (originalValue) clipped.originalValue = originalValue;
      if (mvpValue) clipped.mvpValue = mvpValue;
      if (note) clipped.note = note;
      return clipped;
    });

    return {
      status: 'verified',
      score: weight === 0 ? 100 : Math.round((earned / weight) * 100),
      hasCriticalIssues: criticalCompletenessIssues(checks).length > 0,
      checks,
      checkedAt,
    };
  }

  /**
   * The step the deploy worker runs: never throws. A failure in the comparison is logged and
   * reported as `unverified`, so it can't fail the generation job.
   */
  check(html: string, lead: Partial<ILead>, audit?: Partial<IAudit> | null): IMvpCompletenessReport {
    const checkedAt = new Date();
    try {
      const report = this.compare(html, this.buildSource(lead, audit), checkedAt);
      return MvpCompletenessReportSchema.parse(report) as IMvpCompletenessReport;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MvpCompleteness] Check failed for lead ${lead._id ?? '?'}: ${message}`);
      return {
        status: 'unverified',
        hasCriticalIssues: false,
        checks: [],
        checkedAt,
        error: message.slice(0, MAX_VALUE_LENGTH),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Field checks
  // ---------------------------------------------------------------------------

  private result(
    field: CompletenessField,
    tier: CompletenessTier,
    status: CompletenessStatus,
    values: { originalValue?: string; mvpValue?: string; note?: string } = {},
    credit?: number,
  ): CheckResult {
    const defaultCredit = status === 'present' ? 1 : status === 'altered' ? 0.5 : 0;
    return { check: { field, tier, status, ...values }, credit: credit ?? defaultCredit };
  }

  private notInSource(field: CompletenessField, tier: CompletenessTier): CheckResult {
    return this.result(field, tier, 'not_in_source');
  }

  private checkBusinessName(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.businessName) return this.notInSource('businessName', 'critical');
    const name = normalizeText(source.businessName);
    const found = normalizeText(mvp.text).includes(name) || tokenCoverage(source.businessName, mvp.text) === 1;
    return this.result('businessName', 'critical', found ? 'present' : 'missing', {
      originalValue: source.businessName,
      mvpValue: found ? source.businessName : undefined,
    });
  }

  private checkPhone(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.phones.length === 0) return this.notInSource('phone', 'critical');
    const original = source.phones.join(', ');
    const inText = extractPhones(mvp.text);
    const linked = mvp.telLinks.map((h) => h.replace(/^tel:/i, ''));
    const all = [...linked, ...inText];

    const matchesSource = (p: string) => source.phones.some((s) => phonesMatch(s, p));
    const linkedMatch = linked.find(matchesSource);
    const textMatch = source.phones.map((p) => findPhoneInText(p, mvp.text)).find(Boolean);

    if (linkedMatch && textMatch) {
      return this.result('phone', 'critical', 'present', { originalValue: original, mvpValue: textMatch });
    }
    if (linkedMatch || textMatch) {
      return this.result('phone', 'critical', 'altered', {
        originalValue: original,
        mvpValue: textMatch || linkedMatch,
        note: linkedMatch ? 'Only in a tel: link, not shown as text' : 'Shown as text but not as a tel: link',
      });
    }
    if (all.length > 0) {
      return this.result('phone', 'critical', 'altered', { originalValue: original, mvpValue: all[0] });
    }
    return this.result('phone', 'critical', 'missing', { originalValue: original });
  }

  private checkEmail(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.emails.length === 0) return this.notInSource('email', 'critical');
    const original = source.emails.join(', ');
    const sourceSet = new Set(source.emails.map((e) => normalizeEmail(e)));
    const linked = mvp.mailtoLinks.map(normalizeEmail).filter((e): e is string => Boolean(e));
    const inText = (mvp.text.match(EMAIL_IN_TEXT) || []).map(normalizeEmail).filter((e): e is string => Boolean(e));

    const linkedMatch = linked.find((e) => sourceSet.has(e));
    const textMatch = inText.find((e) => sourceSet.has(e));

    if (linkedMatch && textMatch) {
      return this.result('email', 'critical', 'present', { originalValue: original, mvpValue: textMatch });
    }
    if (linkedMatch || textMatch) {
      return this.result('email', 'critical', 'altered', {
        originalValue: original,
        mvpValue: textMatch || linkedMatch,
        note: linkedMatch ? 'Only in a mailto: link, not shown as text' : 'Shown as text but not as a mailto: link',
      });
    }
    const other = linked[0] || inText[0];
    if (other) return this.result('email', 'critical', 'altered', { originalValue: original, mvpValue: other });
    return this.result('email', 'critical', 'missing', { originalValue: original });
  }

  private checkAddress(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.address) return this.notInSource('address', 'critical');
    const original = source.address;
    const coverage = (target: string) => tokenCoverage(original, target, ADDRESS_STOPWORDS);

    const best = mvp.addressBlocks
      .map((block) => ({ block, coverage: coverage(block) }))
      .sort((a, b) => b.coverage - a.coverage)[0];

    if (best && best.coverage >= TOKEN_MATCH_THRESHOLD) {
      return this.result('address', 'critical', 'present', { originalValue: original, mvpValue: best.block });
    }
    if (normalizeText(mvp.text).includes(normalizeText(original)) || coverage(mvp.text) === 1) {
      return this.result('address', 'critical', 'present', { originalValue: original, mvpValue: original });
    }
    if (best) {
      return this.result('address', 'critical', 'altered', { originalValue: original, mvpValue: best.block });
    }
    return this.result('address', 'critical', 'missing', { originalValue: original });
  }

  private checkWorkingHours(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.workingHours) return this.notInSource('workingHours', 'important');
    const original = source.workingHours;
    if (normalizeText(mvp.text).includes(normalizeText(original))) {
      return this.result('workingHours', 'important', 'present', { originalValue: original, mvpValue: original });
    }

    const sourceTimes = [...new Set(extractTimes(original))];
    if (sourceTimes.length > 0) {
      const mvpTimes = new Set(extractTimes(mvp.text));
      const found = sourceTimes.filter((t) => mvpTimes.has(t));
      if (found.length === sourceTimes.length) {
        return this.result('workingHours', 'important', 'present', { originalValue: original, mvpValue: found.join(', ') });
      }
      if (found.length > 0) {
        return this.result('workingHours', 'important', 'altered', {
          originalValue: original,
          mvpValue: found.join(', '),
          note: `Missing times: ${sourceTimes.filter((t) => !mvpTimes.has(t)).join(', ')}`,
        });
      }
      return this.result('workingHours', 'important', 'missing', { originalValue: original });
    }

    const found = tokenCoverage(original, mvp.text) >= TOKEN_MATCH_THRESHOLD;
    return this.result('workingHours', 'important', found ? 'present' : 'missing', {
      originalValue: original,
      mvpValue: found ? original : undefined,
    });
  }

  /** A service title is found by normalized substring, by words, or by a close heading */
  serviceFound(title: string, mvp: ParsedMvp): boolean {
    const normalized = normalizeText(title);
    if (!normalized) return false;
    if (normalizeText(mvp.text).includes(normalized)) return true;
    if (tokenize(title).length >= 2 && tokenCoverage(title, mvp.text) >= TOKEN_MATCH_THRESHOLD) return true;
    return mvp.headings.some((h) => bigramSimilarity(title, h) >= BIGRAM_MATCH_THRESHOLD);
  }

  private checkServices(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.services.length === 0) return this.notInSource('services', 'important');
    const missing = source.services.filter((title) => !this.serviceFound(title, mvp));
    const foundCount = source.services.length - missing.length;
    const values = {
      originalValue: source.services.join(', '),
      mvpValue: `${foundCount}/${source.services.length}`,
      note: missing.length ? `Missing: ${missing.join(', ')}` : undefined,
    };
    const status = missing.length === 0 ? 'present' : 'missing';
    return this.result('services', 'important', status, values, foundCount / source.services.length);
  }

  private checkSocialLinks(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.socialLinks.length === 0) return this.notInSource('socialLinks', 'important');
    const mvpLinks = new Set(mvp.links.map(normalizeUrl));
    const missing = source.socialLinks.filter((l) => !mvpLinks.has(normalizeUrl(l.url)));
    const foundCount = source.socialLinks.length - missing.length;
    return this.result(
      'socialLinks',
      'important',
      missing.length === 0 ? 'present' : 'missing',
      {
        originalValue: source.socialLinks.map((l) => l.url).join(', '),
        mvpValue: `${foundCount}/${source.socialLinks.length}`,
        note: missing.length ? `Missing: ${missing.map((l) => l.platform || l.url).join(', ')}` : undefined,
      },
      foundCount / source.socialLinks.length,
    );
  }

  private checkLogo(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.logoUrl) return this.notInSource('logo', 'informational');
    const logo = normalizeUrl(source.logoUrl);
    const found = mvp.imageSources.some((src) => normalizeUrl(src) === logo);
    return this.result('logo', 'informational', found ? 'present' : 'missing', {
      originalValue: source.logoUrl,
      mvpValue: found ? source.logoUrl : undefined,
    });
  }

  private checkImages(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.images.length === 0) return this.notInSource('images', 'informational');
    const mvpImages = new Set(mvp.imageSources.map(normalizeUrl));
    const reused = source.images.filter((src) => mvpImages.has(normalizeUrl(src))).length;
    return this.result('images', 'informational', reused > 0 ? 'present' : 'missing', {
      originalValue: `${source.images.length}`,
      mvpValue: `${reused}/${source.images.length}`,
    });
  }

  private checkTestimonials(mvp: ParsedMvp, source: CompletenessSource) {
    if (source.testimonials.length === 0) return this.notInSource('testimonials', 'informational');
    const text = normalizeText(mvp.text);
    // The template shortens long reviews, so the opening words are what must survive
    const shown = source.testimonials.filter((t) => text.includes(normalizeText(t).slice(0, 40).trim())).length;
    return this.result('testimonials', 'informational', shown > 0 ? 'present' : 'missing', {
      originalValue: `${source.testimonials.length}`,
      mvpValue: `${shown}/${source.testimonials.length}`,
    });
  }

  private checkRating(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.rating) return this.notInSource('rating', 'informational');
    const value = String(source.rating.value);
    // "4.8" and "4,8" are the same rating
    const hasValue = new RegExp(`(^|[^\\d.,])${value.replace('.', '[.,]')}($|[^\\d])`).test(mvp.text);
    const hasCount = source.rating.count !== undefined && new RegExp(`\\b${source.rating.count}\\b`).test(mvp.text);
    const original = source.rating.count !== undefined ? `${value} (${source.rating.count})` : value;
    return this.result('rating', 'informational', hasValue || hasCount ? 'present' : 'missing', {
      originalValue: original,
      mvpValue: hasValue || hasCount ? original : undefined,
    });
  }

  private checkFoundingYear(mvp: ParsedMvp, source: CompletenessSource) {
    if (!source.foundingYear) return this.notInSource('foundingYear', 'informational');
    const year = String(source.foundingYear);
    const found = new RegExp(`\\b${year}\\b`).test(mvp.text);
    return this.result('foundingYear', 'informational', found ? 'present' : 'missing', {
      originalValue: year,
      mvpValue: found ? year : undefined,
    });
  }

  /**
   * Contact data in the MVP that the original site doesn't have (possibly made up).
   */
  private findUnsourced(mvp: ParsedMvp, source: CompletenessSource): CheckResult[] {
    const results: CheckResult[] = [];

    const phones = uniqueBy(
      [...mvp.telLinks.map((h) => h.replace(/^tel:/i, '')), ...extractPhones(mvp.text)],
      (p) => normalizePhone(p)?.replace(/\D/g, '').slice(-9),
    );
    const sourcedPhone = (phone: string) =>
      source.phones.some((s) => phonesMatch(s, phone)) || Boolean(findPhoneInText(phone, source.sourceText));
    for (const phone of phones) {
      if (!sourcedPhone(phone)) {
        results.push(this.result('phone', 'critical', 'unsourced', { mvpValue: phone, note: 'Not on the original site' }));
      }
    }

    const sourceEmails = new Set(
      [...source.emails, ...(source.sourceText.match(EMAIL_IN_TEXT) || [])].map((e) => normalizeEmail(e)),
    );
    const emails = uniqueBy(
      [...mvp.mailtoLinks, ...(mvp.text.match(EMAIL_IN_TEXT) || [])].map(normalizeEmail).filter((e): e is string => Boolean(e)),
      (e) => e,
    );
    for (const email of emails) {
      if (!sourceEmails.has(email)) {
        results.push(this.result('email', 'critical', 'unsourced', { mvpValue: email, note: 'Not on the original site' }));
      }
    }

    for (const block of mvp.addressBlocks) {
      const sourced =
        (source.address && tokenCoverage(source.address, block, ADDRESS_STOPWORDS) >= 0.5) ||
        tokenCoverage(block, source.sourceText, ADDRESS_STOPWORDS) >= TOKEN_MATCH_THRESHOLD;
      if (!sourced && /\d/.test(block)) {
        results.push(this.result('address', 'critical', 'unsourced', { mvpValue: block, note: 'Not on the original site' }));
      }
    }

    return results;
  }
}

export const mvpCompletenessService = new MvpCompletenessService();
