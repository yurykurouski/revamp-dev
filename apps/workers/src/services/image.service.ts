import sharp from 'sharp';

export interface ImageOptimizationOptions {
  quality?: number;
  maxWidth?: number;
  maxDimension?: number;
}

/**
 * The Before / After banner's inputs (REV-126). Every number is a measurement and is left out when it was not
 * measured; nothing stands in for it.
 */
export interface ComparisonBannerInput {
  /** The original site's mobile screenshot; absent when the audit has none, shown as not available */
  originalMobileBuffer?: Buffer;
  newMvpMobileBuffer: Buffer;
  businessName: string;
  /** The original's measured LCP */
  oldLcpSeconds?: number;
  /** The original's axe violations */
  oldA11yViolationsCount?: number;
  /** The original's standards score, only when every check was read */
  oldStandardsScore?: number;
  /** The published MVP's standards score, read by code from its HTML (REV-118) */
  newStandardsScore?: number;
}

/** The banner's canvas and the screens on it */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 630;
const SCREEN_WIDTH = 360;
const SCREEN_HEIGHT = 460;

/** The measured values each side of the banner shows, at most two lines a side; a side with nothing measured is empty */
export function comparisonBannerMetrics(input: ComparisonBannerInput): { before: string[]; after: string[] } {
  const measured = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
  const performance = [
    measured(input.oldLcpSeconds) ? `LCP ${input.oldLcpSeconds.toFixed(1)}s` : undefined,
    measured(input.oldA11yViolationsCount)
      ? `${input.oldA11yViolationsCount} a11y ${input.oldA11yViolationsCount === 1 ? 'issue' : 'issues'}`
      : undefined,
  ].filter((text): text is string => Boolean(text));
  const standards = (score: number | undefined) => (measured(score) ? `SEO & standards ${score}/100` : undefined);
  return {
    before: [performance.join(' • '), standards(input.oldStandardsScore)].filter((line): line is string => Boolean(line)),
    after: [standards(input.newStandardsScore)].filter((line): line is string => Boolean(line)),
  };
}

/** Up to two right-aligned lines in a card's header bar, centred on it */
function metricLines(lines: string[], x: number, fill: string): string {
  const ys = lines.length > 1 ? [103, 122] : [115];
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${ys[i]}" fill="${fill}" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="end">${escapeXml(line)}</text>`,
    )
    .join('\n        ');
}

/** The banner's text, frames and badges over the two screens (REV-126: measured values only) */
export function comparisonBannerOverlay(input: ComparisonBannerInput): string {
  const { before, after } = comparisonBannerMetrics(input);
  const missingOriginal = input.originalMobileBuffer
    ? ''
    : `<rect x="120" y="135" width="${SCREEN_WIDTH}" height="${SCREEN_HEIGHT}" fill="#1e293b" />
        <text x="300" y="365" fill="#94a3b8" font-family="sans-serif" font-size="15" font-weight="600" text-anchor="middle">Original screenshot not available</text>`;
  return `
      <svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" viewBox="0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <!-- Header Title -->
        <text x="600" y="52" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="800" text-anchor="middle" letter-spacing="-0.5">
          ${escapeXml(input.businessName)}: mobile version comparison
        </text>

        ${missingOriginal}

        <!-- Left "BEFORE" Card Frame & Header Bar -->
        <rect x="110" y="80" width="${SCREEN_WIDTH + 20}" height="${SCREEN_HEIGHT + 70}" rx="16" fill="none" stroke="#334155" stroke-width="2" />
        <path d="M 110 96 A 16 16 0 0 1 126 80 L 474 80 A 16 16 0 0 1 490 96 L 490 135 L 110 135 Z" fill="#1e293b" />
        <!-- Left Badge (Red / Warning) -->
        <rect x="130" y="96" width="130" height="28" rx="14" fill="#ef4444" />
        <text x="195" y="115" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">
          BEFORE: Original
        </text>
        ${metricLines(before, 470, '#94a3b8')}

        <!-- Right "AFTER" Card Frame & Header Bar -->
        <rect x="690" y="80" width="${SCREEN_WIDTH + 20}" height="${SCREEN_HEIGHT + 70}" rx="16" fill="none" stroke="#4f46e5" stroke-width="2" />
        <path d="M 690 96 A 16 16 0 0 1 706 80 L 1054 80 A 16 16 0 0 1 1070 96 L 1070 135 L 690 135 Z" fill="#1e293b" />
        <!-- Right Badge (Green / Success) -->
        <rect x="710" y="96" width="150" height="28" rx="14" fill="#22c55e" />
        <text x="785" y="115" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">
          AFTER: Prototype
        </text>
        ${metricLines(after, 1050, '#a5b4fc')}

        <!-- Center Divider & VS Badge -->
        <line x1="600" y1="120" x2="600" y2="580" stroke="#334155" stroke-width="2" stroke-dasharray="6,6" />
        <circle cx="600" cy="340" r="28" fill="#4f46e5" stroke="#ffffff" stroke-width="3" />
        <text x="600" y="347" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="900" text-anchor="middle">
          VS
        </text>

        <!-- Footer Caption -->
        <text x="600" y="612" fill="#64748b" font-family="sans-serif" font-size="12" text-anchor="middle">
          Prototype generated automatically by Revamp
        </text>
      </svg>
    `;
}

/** Maximum width/height supported by the WebP format */
export const WEBP_MAX_DIMENSION = 16383;

export class ImageService {
  /**
   * Compresses an image buffer into modern WebP format with optional maxDimension cap (e.g. 1024px)
   */
  static async compressToWebp(
    inputBuffer: Buffer,
    options: ImageOptimizationOptions = {},
  ): Promise<Buffer> {
    const quality = options.quality ?? 80;
    let pipeline = sharp(inputBuffer);

    const maxDim = options.maxDimension ?? options.maxWidth;
    if (maxDim) {
      pipeline = pipeline.resize({
        width: maxDim,
        height: maxDim,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    return pipeline
      .webp({
        quality,
        effort: 4,
      })
      .toBuffer();
  }

  /**
   * Compresses a tall full-page screenshot to WebP, keeping it readable:
   * only the width is capped, and the height is clamped to the WebP maximum (16383px)
   * by cropping from the top, so the page is never squashed.
   */
  static async compressFullPageToWebp(
    inputBuffer: Buffer,
    options: { quality?: number; maxWidth?: number } = {},
  ): Promise<Buffer> {
    const quality = options.quality ?? 75;
    const maxWidth = options.maxWidth ?? 1440;

    const resized = await sharp(inputBuffer, { limitInputPixels: false })
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });

    let pipeline = sharp(resized.data, { limitInputPixels: false });
    if (resized.info.height > WEBP_MAX_DIMENSION) {
      pipeline = pipeline.extract({
        left: 0,
        top: 0,
        width: resized.info.width,
        height: WEBP_MAX_DIMENSION,
      });
    }

    return pipeline.webp({ quality, effort: 4 }).toBuffer();
  }

  /** A full-page capture cut into page slices for a vision model (REV-113), top first */
  static async tilesForVision(
    png: Buffer,
    options: { tileHeight?: number; maxTiles?: number; width?: number } = {},
  ): Promise<{ data: Buffer; top: number; bottom: number }[]> {
    const tileHeight = options.tileHeight ?? 1800;
    const maxTiles = options.maxTiles ?? 6;
    const { width = 0, height = 0 } = await sharp(png, { limitInputPixels: false }).metadata();
    const tiles: { data: Buffer; top: number; bottom: number }[] = [];
    for (let top = 0; top < height && tiles.length < maxTiles; top += tileHeight) {
      const bottom = Math.min(height, top + tileHeight);
      const data = await sharp(png, { limitInputPixels: false })
        .extract({ left: 0, top, width, height: bottom - top })
        .resize({ width: options.width ?? 1024, withoutEnlargement: true })
        .webp({ quality: 70, effort: 4 })
        .toBuffer();
      tiles.push({ data, top, bottom });
    }
    return tiles;
  }

  /**
   * Creates a professional 1200x630 "Before / After" marketing comparison collage
   * for cold email outreach and operator dashboard side-by-side inspection.
   */
  static async createComparisonBanner(input: ComparisonBannerInput): Promise<Buffer> {
    const screen = (buffer: Buffer) =>
      sharp(buffer).resize({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT, fit: 'cover', position: 'top' }).toBuffer();
    // The original's screen is left empty when it has no screenshot: the MVP never stands in for it
    const leftScreen = input.originalMobileBuffer ? await screen(input.originalMobileBuffer) : undefined;
    const rightScreen = await screen(input.newMvpMobileBuffer);

    return sharp({
      create: {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite([
        ...(leftScreen ? [{ input: leftScreen, top: 135, left: 120 }] : []),
        { input: rightScreen, top: 135, left: 700 },
        { input: Buffer.from(comparisonBannerOverlay(input)), top: 0, left: 0 },
      ])
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
  }
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
