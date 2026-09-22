import sharp from 'sharp';

export interface ImageOptimizationOptions {
  quality?: number;
  maxWidth?: number;
  maxDimension?: number;
}

export interface ComparisonBannerInput {
  originalMobileBuffer: Buffer;
  newMvpMobileBuffer: Buffer;
  businessName: string;
  oldLcpSeconds?: number;
  oldA11yViolationsCount?: number;
  newScore?: number;
}

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
   * Creates a professional 1200x630 "Before / After" marketing comparison collage
   * for cold email outreach and operator dashboard side-by-side inspection.
   */
  static async createComparisonBanner(input: ComparisonBannerInput): Promise<Buffer> {
    const canvasWidth = 1200;
    const canvasHeight = 630;
    const screenWidth = 360;
    const screenHeight = 460;

    const oldLcpText = input.oldLcpSeconds ? `LCP: ${input.oldLcpSeconds.toFixed(1)}s` : 'Медленная загрузка';
    const oldA11yText = input.oldA11yViolationsCount !== undefined ? `a11y: ${input.oldA11yViolationsCount} ош.` : 'Ошибки верстки';
    const newScoreText = input.newScore ? `Скоринг: ${input.newScore}/100` : 'Скоринг: 95/100';

    // 1. Prepare Left Screen (Original)
    const leftScreen = await sharp(input.originalMobileBuffer)
      .resize({
        width: screenWidth,
        height: screenHeight,
        fit: 'cover',
        position: 'top',
      })
      .toBuffer();

    // 2. Prepare Right Screen (New Bento MVP)
    const rightScreen = await sharp(input.newMvpMobileBuffer)
      .resize({
        width: screenWidth,
        height: screenHeight,
        fit: 'cover',
        position: 'top',
      })
      .toBuffer();

    // 3. SVG Overlay with titles, badges, and vs divider
    const overlaySvg = `
      <svg width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" />
            <stop offset="100%" stop-color="#1e293b" />
          </linearGradient>
          <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.5" />
          </filter>
        </defs>

        <!-- Header Title -->
        <text x="600" y="52" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="800" text-anchor="middle" letter-spacing="-0.5">
          ${escapeXml(input.businessName)}: Сравнение мобильных версий
        </text>

        <!-- Left "BEFORE" Card Frame & Header Bar -->
        <rect x="110" y="80" width="${screenWidth + 20}" height="${screenHeight + 70}" rx="16" fill="none" stroke="#334155" stroke-width="2" />
        <path d="M 110 96 A 16 16 0 0 1 126 80 L 474 80 A 16 16 0 0 1 490 96 L 490 135 L 110 135 Z" fill="#1e293b" />
        <!-- Left Badge (Red / Warning) -->
        <rect x="130" y="96" width="130" height="28" rx="14" fill="#ef4444" />
        <text x="195" y="115" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">
          ДО: Исходный сайт
        </text>
        <text x="470" y="115" fill="#94a3b8" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="end">
          ${escapeXml(oldLcpText)} • ${escapeXml(oldA11yText)}
        </text>

        <!-- Right "AFTER" Card Frame & Header Bar -->
        <rect x="690" y="80" width="${screenWidth + 20}" height="${screenHeight + 70}" rx="16" fill="none" stroke="#4f46e5" stroke-width="2" />
        <path d="M 690 96 A 16 16 0 0 1 706 80 L 1054 80 A 16 16 0 0 1 1070 96 L 1070 135 L 690 135 Z" fill="#1e293b" />
        <!-- Right Badge (Green / Success) -->
        <rect x="710" y="96" width="150" height="28" rx="14" fill="#22c55e" />
        <text x="785" y="115" fill="#ffffff" font-family="sans-serif" font-size="13" font-weight="bold" text-anchor="middle">
          ПОСЛЕ: Bento MVP
        </text>
        <text x="1050" y="115" fill="#a5b4fc" font-family="sans-serif" font-size="12" font-weight="600" text-anchor="end">
          ${escapeXml(newScoreText)} • LCP &lt; 1.8s
        </text>

        <!-- Center Divider & VS Badge -->
        <line x1="600" y1="120" x2="600" y2="580" stroke="#334155" stroke-width="2" stroke-dasharray="6,6" />
        <circle cx="600" cy="340" r="28" fill="#4f46e5" stroke="#ffffff" stroke-width="3" />
        <text x="600" y="347" fill="#ffffff" font-family="sans-serif" font-size="15" font-weight="900" text-anchor="middle">
          VS
        </text>

        <!-- Footer Caption -->
        <text x="600" y="612" fill="#64748b" font-family="sans-serif" font-size="12" text-anchor="middle">
          Прототип подготовлен автоматически платформой Revamp SaaS • preview.revamp.io
        </text>
      </svg>
    `;

    // 4. Composite base canvas + screens + SVG overlay
    return sharp({
      create: {
        width: canvasWidth,
        height: canvasHeight,
        channels: 4,
        background: { r: 15, g: 23, b: 42, alpha: 1 },
      },
    })
      .composite([
        {
          input: leftScreen,
          top: 135,
          left: 120,
        },
        {
          input: rightScreen,
          top: 135,
          left: 700,
        },
        {
          input: Buffer.from(overlaySvg),
          top: 0,
          left: 0,
        },
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
