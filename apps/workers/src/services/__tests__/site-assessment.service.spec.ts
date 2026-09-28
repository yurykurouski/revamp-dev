import { describe, it, expect, vi } from 'vitest';
import { IDiscoveryCandidate, ISiteAssessment } from '@revamp/shared-types';
import { SiteAssessmentSchema } from '@revamp/validation';
import {
  FetchFn,
  FetchedHomePage,
  HEAVY_HTML_BYTES,
  MAX_HTML_BYTES,
  SLOW_RESPONSE_MS,
  assessCandidates,
  assessSite,
  assessmentVerdict,
  detectBadSigns,
  detectComplexitySigns,
  fetchHomePage,
  findCopyrightYear,
  isBlockedHost,
  parseHomePage,
} from '../site-assessment.service.js';

const NOW = new Date('2026-09-28T10:00:00.000Z');
const options = (fetchFn: FetchFn, timeoutMs = 2000) => ({ fetchFn, timeoutMs, userAgent: 'RevampBot/test', now: () => NOW });

const html = (response: string, headers: Record<string, string> = {}, status = 200) =>
  new Response(response, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
const redirect = (location: string, status = 301) => new Response(null, { status, headers: { location } });

/** Answers each URL from a table; unknown URLs fail like a refused connection */
const fetchTable = (table: Record<string, () => Response | Promise<Response>>) =>
  vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const answer = table[url];
    if (!answer) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return answer();
  }) as unknown as FetchFn & ReturnType<typeof vi.fn>;

const OLD_SITE = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html><head><title>Dental Clinic</title>
<script src="/js/jquery-1.8.3.min.js"></script></head>
<body bgcolor="#ffffff"><center><table width="800"><tr><td bgcolor="#eeeeee">
<table><tr><td><font face="Arial">Welcome to our clinic</font></td></tr></table>
<a href="/about.html">About</a> <a href="/prices.html">Prices</a> <a href="tel:+37060000000">Call</a>
</td></tr></table>
<object data="/intro.swf" type="application/x-shockwave-flash"></object>
<p>Copyright &copy; 2009 - 2014 Dental Clinic</p></center></body></html>`;

const MODERN_SITE = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smile Studio</title><meta name="description" content="Family dentistry in Vilnius">
<script src="/assets/app-3f2a.js" type="module"></script></head>
<body><header><a href="/">Home</a><a href="#services">Services</a></header>
<section id="services"><h2>Services</h2></section>
<footer>© 2026 Smile Studio</footer></body></html>`;

const page = (overrides: Partial<FetchedHomePage> = {}): FetchedHomePage => ({
  finalUrl: 'https://clinic.lt/',
  httpStatus: 200,
  responseMs: 300,
  html: '',
  htmlBytes: 10_000,
  certificateFailed: false,
  ...overrides,
});

describe('isBlockedHost', () => {
  it('should block localhost, internal names, private IPv4 ranges and IPv6 literals', () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'db.internal', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '[::1]', '::ffff:7f00:1']) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it('should allow public hosts and public IPv4 addresses', () => {
    for (const host of ['clinic.lt', 'www.example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', 'local.lt']) {
      expect(isBlockedHost(host), host).toBe(false);
    }
  });
});

describe('findCopyrightYear', () => {
  it('should take the latest year of a range or several notices', () => {
    expect(findCopyrightYear('Copyright © 2009 - 2014 Clinic', NOW)).toBe(2014);
    expect(findCopyrightYear('© 2012 Clinic. (c) 2016 Other', NOW)).toBe(2016);
    expect(findCopyrightYear('copyright 2021–2025', NOW)).toBe(2025);
  });

  it('should ignore years outside a copyright notice and implausible years', () => {
    expect(findCopyrightYear('Founded in 1998, 25 years of care', NOW)).toBeUndefined();
    expect(findCopyrightYear('© 2099 Clinic', NOW)).toBeUndefined();
    expect(findCopyrightYear('© 1985 Clinic', NOW)).toBeUndefined();
    expect(findCopyrightYear('', NOW)).toBeUndefined();
  });

  it('should accept next year, which some sites already show', () => {
    expect(findCopyrightYear('© 2027', NOW)).toBe(2027);
  });
});

describe('parseHomePage', () => {
  it('should report the outdated markers of an old site', () => {
    const signals = parseHomePage(OLD_SITE, NOW);
    expect(signals).toMatchObject({
      hasViewport: false,
      hasTitle: true,
      hasMetaDescription: false,
      hasFrames: false,
      hasTableLayout: true,
      hasFlash: true,
      hasOldJquery: true,
      hasLegacyTags: true,
      copyrightYear: 2014,
      hasEcommerce: false,
      hasLogin: false,
      hasAppFramework: false,
    });
    expect(signals.links).toEqual(['/about.html', '/prices.html', 'tel:+37060000000']);
  });

  it('should report none of them for a modern site', () => {
    expect(parseHomePage(MODERN_SITE, NOW)).toMatchObject({
      hasViewport: true,
      hasTitle: true,
      hasMetaDescription: true,
      hasTableLayout: false,
      hasFlash: false,
      hasOldJquery: false,
      hasLegacyTags: false,
      copyrightYear: 2026,
    });
  });

  it('should detect frames, shops, accounts and client-side frameworks', () => {
    expect(parseHomePage('<frameset><frame src="a.html"></frameset>', NOW).hasFrames).toBe(true);
    expect(parseHomePage('<a href="/cart/">Cart</a>', NOW).hasEcommerce).toBe(true);
    expect(parseHomePage('<div class="woocommerce"></div>', NOW).hasEcommerce).toBe(true);
    expect(parseHomePage('<a href="/my-account">Account</a>', NOW).hasLogin).toBe(true);
    expect(parseHomePage('<input type="password">', NOW).hasLogin).toBe(true);
    // A WordPress admin link left in the footer is not a customer account
    expect(parseHomePage('<a href="/wp-login.php">Log in</a>', NOW).hasLogin).toBe(false);
    expect(parseHomePage('<div id="__next"></div>', NOW).hasAppFramework).toBe(true);
    expect(parseHomePage('<script src="/_nuxt/app.js"></script>', NOW).hasAppFramework).toBe(true);
  });

  it('should recognise old jQuery by file name or WordPress version parameter, but not jQuery 3', () => {
    const jq = (src: string) => parseHomePage(`<script src="${src}"></script>`, NOW).hasOldJquery;
    expect(jq('https://code.jquery.com/jquery-2.2.4.min.js')).toBe(true);
    expect(jq('/wp-includes/js/jquery/jquery.min.js?ver=1.12.4')).toBe(true);
    expect(jq('/js/jquery-3.7.1.min.js')).toBe(false);
    expect(jq('/wp-includes/js/jquery/jquery.min.js?ver=3.7.1')).toBe(false);
  });

  it('should not read a copyright year from scripts, and not run them', () => {
    const signals = parseHomePage(
      '<script>document.body.setAttribute("data-ran", "1"); var c = "© 2001";</script><p>Hello</p>',
      NOW,
    );
    expect(signals.copyrightYear).toBeUndefined();
  });

  it('should cope with empty or broken markup', () => {
    expect(parseHomePage('', NOW)).toMatchObject({ hasTitle: false, hasViewport: false, links: [] });
    expect(parseHomePage('<html><body><table><tr><td>unclosed', NOW).hasTitle).toBe(false);
  });
});

describe('detectBadSigns', () => {
  const clean = parseHomePage(MODERN_SITE, NOW);

  it('should find nothing on a fast, modern https site', () => {
    expect(detectBadSigns(page(), clean, NOW)).toEqual([]);
  });

  it('should list every sign of an old site in a fixed order', () => {
    const signals = parseHomePage(OLD_SITE, NOW);
    const signs = detectBadSigns(
      page({ finalUrl: 'http://clinic.lt/', certificateFailed: true, responseMs: SLOW_RESPONSE_MS + 1, htmlBytes: HEAVY_HTML_BYTES + 1 }),
      signals,
      NOW,
    );
    expect(signs).toEqual([
      'no_https',
      'invalid_certificate',
      'no_viewport',
      'table_layout',
      'flash',
      'old_jquery',
      'legacy_tags',
      'no_meta_description',
      'stale_copyright',
      'slow_response',
      'heavy_html',
    ]);
  });

  it('should apply the thresholds at their boundaries', () => {
    expect(detectBadSigns(page({ responseMs: SLOW_RESPONSE_MS, htmlBytes: HEAVY_HTML_BYTES }), clean, NOW)).toEqual([]);
    expect(detectBadSigns(page(), { ...clean, copyrightYear: 2024 }, NOW)).toEqual([]);
    expect(detectBadSigns(page(), { ...clean, copyrightYear: 2023 }, NOW)).toEqual(['stale_copyright']);
    // No year found: nothing is assumed
    expect(detectBadSigns(page(), { ...clean, copyrightYear: undefined }, NOW)).toEqual([]);
    expect(detectBadSigns(page(), { ...clean, hasTitle: false }, NOW)).toEqual(['no_title']);
    expect(detectBadSigns(page(), { ...clean, hasFrames: true }, NOW)).toEqual(['frames']);
  });
});

describe('detectComplexitySigns', () => {
  const clean = parseHomePage(MODERN_SITE, NOW);

  it('should call a site with up to 10 pages and no shop, accounts or app framework simple', () => {
    expect(detectComplexitySigns(clean, 10)).toEqual([]);
  });

  it('should list what makes it complex', () => {
    expect(detectComplexitySigns({ ...clean, hasEcommerce: true, hasLogin: true, hasAppFramework: true }, 11)).toEqual([
      'many_pages',
      'ecommerce',
      'login',
      'app_framework',
    ]);
  });
});

describe('assessmentVerdict', () => {
  it('should rate a simple site by the weight of its signs', () => {
    expect(assessmentVerdict(true, [])).toBe('poor');
    expect(assessmentVerdict(true, ['no_meta_description'])).toBe('maybe');
    expect(assessmentVerdict(true, ['no_meta_description', 'stale_copyright'])).toBe('good');
    // A strong sign alone is enough
    expect(assessmentVerdict(true, ['no_viewport'])).toBe('good');
  });

  it('should need more for a complex site and never call it good', () => {
    expect(assessmentVerdict(false, ['no_viewport'])).toBe('poor');
    expect(assessmentVerdict(false, ['no_viewport', 'stale_copyright'])).toBe('maybe');
    expect(assessmentVerdict(false, ['no_https', 'no_viewport', 'flash', 'table_layout'])).toBe('maybe');
  });
});

describe('fetchHomePage', () => {
  it('should follow redirects by hand and report the final URL', async () => {
    const fetchFn = fetchTable({
      'http://clinic.lt/': () => redirect('https://www.clinic.lt/'),
      'https://www.clinic.lt/': () => redirect('/lt/#top', 302),
      'https://www.clinic.lt/lt/': () => html('<title>Hi</title>'),
    });
    const result = await fetchHomePage('http://clinic.lt/', options(fetchFn));
    expect(result).toMatchObject({ finalUrl: 'https://www.clinic.lt/lt/', httpStatus: 200, html: '<title>Hi</title>', htmlBytes: 17, certificateFailed: false });
    expect(fetchFn).toHaveBeenCalledWith('http://clinic.lt/', expect.objectContaining({ redirect: 'manual', headers: expect.objectContaining({ 'User-Agent': 'RevampBot/test' }) }));
  });

  it('should refuse a redirect to a private address', async () => {
    const fetchFn = fetchTable({ 'https://clinic.lt/': () => redirect('http://169.254.169.254/latest/') });
    await expect(fetchHomePage('https://clinic.lt/', options(fetchFn))).rejects.toMatchObject({ failure: 'blocked_host' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('should give up after too many redirects', async () => {
    const fetchFn = fetchTable({ 'https://clinic.lt/': () => redirect('https://clinic.lt/') });
    await expect(fetchHomePage('https://clinic.lt/', options(fetchFn))).rejects.toMatchObject({ failure: 'unreachable' });
  });

  it('should retry over http when https has a certificate problem, and remember it', async () => {
    const fetchFn = fetchTable({ 'http://clinic.lt/': () => html('<p>old</p>') });
    fetchFn.mockImplementationOnce(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
    });
    const result = await fetchHomePage('https://clinic.lt/', options(fetchFn));
    expect(result).toMatchObject({ finalUrl: 'http://clinic.lt/', certificateFailed: true });
  });

  it('should report a bad certificate when http does not answer either', async () => {
    const fetchFn = fetchTable({});
    fetchFn.mockImplementationOnce(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
    });
    await expect(fetchHomePage('https://clinic.lt/', options(fetchFn))).rejects.toMatchObject({ failure: 'invalid_certificate' });
  });

  it('should retry over http when https refuses the connection, without calling it a certificate problem', async () => {
    const fetchFn = fetchTable({ 'http://clinic.lt/': () => html('<p>old</p>') });
    const result = await fetchHomePage('https://clinic.lt/', options(fetchFn));
    expect(result).toMatchObject({ finalUrl: 'http://clinic.lt/', certificateFailed: false });
  });

  it('should fail as unreachable when neither scheme answers, and not retry an http address', async () => {
    await expect(fetchHomePage('https://clinic.lt/', options(fetchTable({})))).rejects.toMatchObject({ failure: 'unreachable' });
    const httpOnly = fetchTable({});
    await expect(fetchHomePage('http://clinic.lt/', options(httpOnly))).rejects.toMatchObject({ failure: 'unreachable' });
    expect(httpOnly).toHaveBeenCalledTimes(1);
  });

  it('should time out a site that never answers', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))),
    ) as unknown as FetchFn;
    await expect(fetchHomePage('https://clinic.lt/', options(fetchFn, 30))).rejects.toMatchObject({ failure: 'timeout' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('should fail on error statuses with the status code, and on non-HTML responses', async () => {
    await expect(
      fetchHomePage('https://clinic.lt/', options(fetchTable({ 'https://clinic.lt/': () => html('nope', {}, 503) }))),
    ).rejects.toMatchObject({ failure: 'http_error', httpStatus: 503 });
    await expect(
      fetchHomePage('https://clinic.lt/', options(fetchTable({ 'https://clinic.lt/': () => html('%PDF', { 'content-type': 'application/pdf' }) }))),
    ).rejects.toMatchObject({ failure: 'not_html' });
  });

  it('should accept a response without a content type', async () => {
    // A byte body, unlike a string one, gets no default content type
    const body = new TextEncoder().encode('<p>hi</p>');
    const fetchFn = fetchTable({ 'https://clinic.lt/': () => new Response(body, { status: 200 }) });
    await expect(fetchHomePage('https://clinic.lt/', options(fetchFn))).resolves.toMatchObject({ html: '<p>hi</p>' });
  });

  it('should stop reading at the size cap', async () => {
    const big = 'a'.repeat(MAX_HTML_BYTES + 100_000);
    const result = await fetchHomePage('https://clinic.lt/', options(fetchTable({ 'https://clinic.lt/': () => html(big) })));
    expect(result.htmlBytes).toBe(MAX_HTML_BYTES);
    expect(result.html).toHaveLength(MAX_HTML_BYTES);
  });

  it('should decode the charset the server declares', async () => {
    // "©" is 0xA9 in windows-1251
    const body = new Uint8Array([0xa9, 0x20, 0x32, 0x30, 0x31, 0x30]);
    const fetchFn = fetchTable({
      'https://clinic.lt/': () => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=windows-1251' } }),
    });
    expect((await fetchHomePage('https://clinic.lt/', options(fetchFn))).html).toBe('© 2010');
  });
});

describe('assessSite', () => {
  it('should rate an old one-page site a good candidate, with a schema-valid result', async () => {
    const fetchFn = fetchTable({ 'http://clinic.lt/': () => html(OLD_SITE) });
    const result = await assessSite('https://clinic.lt/', options(fetchFn));

    expect(result).toMatchObject({
      outcome: 'assessed',
      verdict: 'good',
      simple: true,
      complexitySigns: [],
      internalPages: 2,
      finalUrl: 'http://clinic.lt/',
      httpStatus: 200,
      copyrightYear: 2014,
      assessedAt: NOW.toISOString(),
    });
    expect(result.outcome === 'assessed' && result.badSigns).toEqual(
      expect.arrayContaining(['no_https', 'no_viewport', 'table_layout', 'flash', 'stale_copyright']),
    );
    expect(SiteAssessmentSchema.safeParse(result).success).toBe(true);
  });

  it('should rate a modern site a poor candidate', async () => {
    const fetchFn = fetchTable({ 'https://clinic.lt/': () => html(MODERN_SITE) });
    await expect(assessSite('https://clinic.lt/', options(fetchFn))).resolves.toMatchObject({
      outcome: 'assessed',
      verdict: 'poor',
      badSigns: [],
    });
  });

  it('should return an explicit failure instead of a verdict when the site cannot be read', async () => {
    const result = await assessSite('https://clinic.lt/', options(fetchTable({ 'https://clinic.lt/': () => html('', {}, 403) })));
    expect(result).toEqual({ outcome: 'failed', failure: 'http_error', httpStatus: 403, assessedAt: NOW.toISOString() });
    expect(SiteAssessmentSchema.safeParse(result).success).toBe(true);
    expect('verdict' in result).toBe(false);
  });

  it('should refuse a private address up front', async () => {
    const fetchFn = fetchTable({});
    await expect(assessSite('http://192.168.0.10/', options(fetchFn))).resolves.toMatchObject({ outcome: 'failed', failure: 'blocked_host' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('should turn an unexpected error into a failed check rather than throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi.fn(() => {
      throw new Error('boom');
    }) as unknown as FetchFn;
    await expect(assessSite('not a url', options(fetchFn))).resolves.toMatchObject({ outcome: 'failed', failure: 'unreachable' });
    warn.mockRestore();
  });
});

describe('assessCandidates', () => {
  const candidate = (id: string, status: IDiscoveryCandidate['status'], website?: string): IDiscoveryCandidate => ({
    provider: 'osm',
    externalId: id,
    name: `Business ${id}`,
    status,
    website,
  });
  const failed: ISiteAssessment = { outcome: 'failed', failure: 'timeout', assessedAt: NOW.toISOString() };

  it('should assess only new candidates with a website, never more than `concurrency` at once', async () => {
    const candidates = [
      ...Array.from({ length: 7 }, (_, i) => candidate(`n${i}`, 'new', `https://n${i}.lt/`)),
      candidate('e', 'existing_lead', 'https://e.lt/'),
      candidate('x', 'no_website'),
    ];
    let running = 0;
    let peak = 0;
    const assess = vi.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return failed;
    });

    await assessCandidates(candidates, assess, 3);

    expect(assess).toHaveBeenCalledTimes(7);
    expect(peak).toBe(3);
    expect(candidates.filter((c) => c.assessment).map((c) => c.externalId)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  });

  it('should do nothing without new candidates', async () => {
    const assess = vi.fn();
    await assessCandidates([candidate('d', 'duplicate', 'https://d.lt/')], assess, 4);
    expect(assess).not.toHaveBeenCalled();
  });
});
