import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { comparisonBannerMetrics, comparisonBannerOverlay, ImageService, WEBP_MAX_DIMENSION } from '../image.service.js';

describe('ImageService', () => {
  it('should compress a raw image buffer into WebP format', async () => {
    // Generate a valid PNG buffer via sharp
    const pngBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 50, g: 100, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const webpBuffer = await ImageService.compressToWebp(pngBuffer, { quality: 80 });

    expect(webpBuffer).toBeInstanceOf(Buffer);
    expect(webpBuffer.length).toBeGreaterThan(0);

    const metadata = await sharp(webpBuffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });

  it('should resize image when maxWidth is specified', async () => {
    const largePngBuffer = await sharp({
      create: {
        width: 1440,
        height: 900,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const webpBuffer = await ImageService.compressToWebp(largePngBuffer, {
      quality: 75,
      maxWidth: 800,
    });

    const metadata = await sharp(webpBuffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(500);
  });

  it('should generate a 1200x630 Before/After comparison marketing banner in WebP', async () => {
    // Generate dummy mobile screens (375x812)
    const oldMobile = await sharp({
      create: {
        width: 375,
        height: 812,
        channels: 4,
        background: { r: 220, g: 38, b: 38, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const newMobile = await sharp({
      create: {
        width: 375,
        height: 812,
        channels: 4,
        background: { r: 34, g: 197, b: 94, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const bannerBuffer = await ImageService.createComparisonBanner({
      originalMobileBuffer: oldMobile,
      newMvpMobileBuffer: newMobile,
      businessName: 'Prestige Dental',
      oldLcpSeconds: 4.8,
      oldA11yViolationsCount: 16,
      oldStandardsScore: 50,
      newStandardsScore: 100,
    });

    expect(bannerBuffer).toBeInstanceOf(Buffer);
    expect(bannerBuffer.length).toBeGreaterThan(0);

    const metadata = await sharp(bannerBuffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);

    // Assert compressed banner size is lightweight (< 150 KB)
    expect(bannerBuffer.length).toBeLessThan(150 * 1024);
  });

  it('should restrict the longest side to 1024px when maxDimension is specified for tall images', async () => {
    // Generate a long vertical screenshot: 375px wide, 3000px high
    const tallScreenshot = await sharp({
      create: {
        width: 375,
        height: 3000,
        channels: 4,
        background: { r: 100, g: 150, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const webpBuffer = await ImageService.compressToWebp(tallScreenshot, {
      quality: 80,
      maxDimension: 1024,
    });

    const metadata = await sharp(webpBuffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.height).toBe(1024);
    expect(metadata.width).toBeLessThanOrEqual(1024);
    expect(metadata.width).toBe(128); // 375 * (1024 / 3000) = 128
  });

  describe('compressFullPageToWebp (REV-21)', () => {
    const makePng = (width: number, height: number) =>
      sharp({
        create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } },
      })
        .png()
        .toBuffer();

    it('should keep full height and only cap width for tall full-page captures', async () => {
      const png = await makePng(1440, 6000);

      const webp = await ImageService.compressFullPageToWebp(png, { maxWidth: 1440 });
      const meta = await sharp(webp).metadata();

      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(1440);
      expect(meta.height).toBe(6000);
    });

    it('should downscale wider captures proportionally', async () => {
      const png = await makePng(750, 3000);

      const webp = await ImageService.compressFullPageToWebp(png, { maxWidth: 375 });
      const meta = await sharp(webp).metadata();

      expect(meta.width).toBe(375);
      expect(meta.height).toBe(1500);
    });

    it('should crop heights above the WebP dimension limit instead of failing', async () => {
      const png = await makePng(200, WEBP_MAX_DIMENSION + 500);

      const webp = await ImageService.compressFullPageToWebp(png, { maxWidth: 200 });
      const meta = await sharp(webp).metadata();

      expect(meta.width).toBe(200);
      expect(meta.height).toBe(WEBP_MAX_DIMENSION);
    });
  });
});

describe('ImageService.tilesForVision (REV-113)', () => {
  it('cuts a full-page capture into page-ordered tiles at most maxTiles, scaled to the width', async () => {
    const png = await sharp({ create: { width: 1440, height: 4000, channels: 3, background: '#fff' } }).png().toBuffer();
    const tiles = await ImageService.tilesForVision(png, { tileHeight: 1800, maxTiles: 2, width: 1024 });
    expect(tiles.map((t) => [t.top, t.bottom])).toEqual([
      [0, 1800],
      [1800, 3600],
    ]);
    const meta = await sharp(tiles[0]!.data).metadata();
    expect([meta.format, meta.width]).toEqual(['webp', 1024]);
  });

  it('ends the last tile at the bottom of the page', async () => {
    const png = await sharp({ create: { width: 1440, height: 2000, channels: 3, background: '#fff' } }).png().toBuffer();
    const tiles = await ImageService.tilesForVision(png);
    expect(tiles.map((t) => [t.top, t.bottom])).toEqual([
      [0, 1800],
      [1800, 2000],
    ]);
  });
});


describe('ImageService comparison banner: measured values only (REV-126)', () => {
  const screen = (r: number, g: number, b: number) =>
    sharp({ create: { width: 375, height: 812, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
  const STAND_INS = ['95/100', 'Slow loading', 'Layout issues', 'LCP &lt;', 'Bento', 'preview.revamp.io', 'not available'];

  it('shows each measured value: the original\'s LCP, a11y issues and standards score, the MVP\'s standards score', () => {
    const input = { newMvpMobileBuffer: Buffer.from(''), businessName: 'Falco', oldLcpSeconds: 4.24, oldA11yViolationsCount: 12, oldStandardsScore: 50, newStandardsScore: 100 };
    expect(comparisonBannerMetrics(input)).toEqual({
      before: ['LCP 4.2s • 12 a11y issues', 'SEO & standards 50/100'],
      after: ['SEO & standards 100/100'],
    });
    const svg = comparisonBannerOverlay({ ...input, originalMobileBuffer: Buffer.from('') });
    expect(svg).toContain('SEO &amp; standards 100/100');
    expect(svg).toContain('AFTER: Prototype');
    for (const text of STAND_INS) expect(svg).not.toContain(text);
  });

  it('leaves out every value that was not measured, and shows nothing in its place', () => {
    const input = { newMvpMobileBuffer: Buffer.from(''), originalMobileBuffer: Buffer.from(''), businessName: 'Falco' };
    expect(comparisonBannerMetrics(input)).toEqual({ before: [], after: [] });
    const svg = comparisonBannerOverlay(input);
    for (const text of [...STAND_INS, 'LCP', 'a11y', 'standards', 'Score']) expect(svg).not.toContain(text);
  });

  it('keeps a measured zero and counts one issue in the singular', () => {
    expect(comparisonBannerMetrics({ newMvpMobileBuffer: Buffer.from(''), businessName: 'X', oldA11yViolationsCount: 0, oldStandardsScore: 0, newStandardsScore: 0 })).toEqual({
      before: ['0 a11y issues', 'SEO & standards 0/100'],
      after: ['SEO & standards 0/100'],
    });
    expect(comparisonBannerMetrics({ newMvpMobileBuffer: Buffer.from(''), businessName: 'X', oldA11yViolationsCount: 1 }).before).toEqual(['1 a11y issue']);
  });

  it('says the original screenshot is missing instead of showing the MVP as the original', async () => {
    const mvp = await screen(34, 197, 94);
    const banner = await ImageService.createComparisonBanner({ newMvpMobileBuffer: mvp, businessName: 'Falco', newStandardsScore: 100 });
    expect(comparisonBannerOverlay({ newMvpMobileBuffer: mvp, businessName: 'Falco' })).toContain('Original screenshot not available');

    const { data, info } = await sharp(banner).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1200, 630]);
    const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    // The left screen holds the placeholder's slate, never the MVP's green; the right screen holds the MVP
    const [lr, lg, lb] = pixel(140, 160);
    expect(lg!).toBeLessThan(80);
    expect(Math.abs(lr! - 30) + Math.abs(lb! - 59)).toBeLessThan(40);
    expect(pixel(720, 160)[1]!).toBeGreaterThan(150);
  });

  it("puts the original's screenshot on the left when there is one", async () => {
    const banner = await ImageService.createComparisonBanner({
      originalMobileBuffer: await screen(220, 38, 38),
      newMvpMobileBuffer: await screen(34, 197, 94),
      businessName: 'Falco',
    });
    const { data, info } = await sharp(banner).raw().toBuffer({ resolveWithObject: true });
    expect(data[(160 * info.width + 140) * info.channels]!).toBeGreaterThan(180);
  });
});
