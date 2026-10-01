import { escapeHtml } from '../html.js';

/**
 * Converts Hex color string (#RRGGBB or #RGB) to "R, G, B" triplet.
 */
export function hexToRgb(hex: string): string {
  let cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(cleanHex, 16);
  if (isNaN(num)) {
    return '92, 91, 237'; // Default brand fallback
  }
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `${r}, ${g}, ${b}`;
}

/**
 * Serialises a value for an inline <script>, so text cannot close the script element.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * Encodes an SVG document as a data URI, e.g. for an inline favicon.
 */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`;
}

/**
 * Resolves the telemetry URLs from the public API URL (REV-52). MVPs are served from the
 * storage host, so relative /api/v1/... paths would hit S3/MinIO instead of the API.
 * The tracker appends /api/v1/track/mvp-event to data-api, so data-api is the API origin.
 */
export function resolveTrackerUrls(
  publicApiUrl: string | undefined,
): { scriptSrc: string; apiOrigin: string; eventUrl: string } | null {
  if (!publicApiUrl) return null;
  let apiOrigin: string;
  try {
    apiOrigin = new URL(publicApiUrl).origin;
  } catch {
    return null;
  }
  const apiBase = publicApiUrl.replace(/\/+$/, '');
  return {
    scriptSrc: `${apiBase}/track/revamp-tracker.js`,
    apiOrigin,
    eventUrl: `${apiBase}/track/mvp-event`,
  };
}

/** Generated inline SVG monogram, used when the site has neither a logo nor a monogram */
export function monogramSvg(businessName: string, color: string): string {
  const initials =
    businessName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'R';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44" fill="none">
          <rect width="44" height="44" rx="10" fill="${color}" />
          <text x="22" y="28" fill="#ffffff" font-family="system-ui, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${escapeHtml(initials)}</text>
        </svg>`;
}

/** The engagement tracker, loaded from the API rather than the storage host (REV-52) */
export function trackerScriptTag(tracker: ReturnType<typeof resolveTrackerUrls>, trackingToken?: string): string {
  return tracker
    ? `<script src="${escapeHtml(tracker.scriptSrc)}" data-api="${escapeHtml(tracker.apiOrigin)}" data-token="${escapeHtml(trackingToken)}" async></script>`
    : '';
}
