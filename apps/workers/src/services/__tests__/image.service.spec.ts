import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageService, WEBP_MAX_DIMENSION } from '../image.service.js';

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
      newScore: 96,
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
