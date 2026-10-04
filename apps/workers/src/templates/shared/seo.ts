import type { IMvpSeo } from '@revamp/shared-types';
import { escapeHtml } from '../html.js';

/** `<` written as its JSON escape, so text in the JSON-LD can never close the script element */
const LT_ESCAPE = '\\' + 'u003c';

/** The Schema.org `LocalBusiness` JSON-LD (REV-118), from the verified contacts only */
export function localBusinessJsonLd(business: NonNullable<IMvpSeo['localBusiness']>): string {
  const { sameAs, ...fields } = business;
  const json = JSON.stringify({ '@context': 'https://schema.org', '@type': 'LocalBusiness', ...fields, ...(sameAs.length ? { sameAs } : {}) });
  return json.replace(/</g, LT_ESCAPE);
}

/**
 * The page's search and sharing tags (REV-118): the meta description, OpenGraph and the `LocalBusiness` JSON-LD.
 * `title` is the page's own `<title>`; a tag without a value is left out.
 */
export function seoHeadTags(seo: IMvpSeo, title: string, description = seo.description): string {
  const meta = (attr: 'name' | 'property', key: string, value?: string) =>
    value ? `\n  <meta ${attr}="${key}" content="${escapeHtml(value)}">` : '';
  return [
    meta('name', 'description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:image', seo.image),
    meta('property', 'og:locale', seo.locale),
    meta('property', 'og:site_name', seo.localBusiness?.name),
    seo.localBusiness ? `\n  <script type="application/ld+json">${localBusinessJsonLd(seo.localBusiness)}</script>` : '',
  ].join('');
}
