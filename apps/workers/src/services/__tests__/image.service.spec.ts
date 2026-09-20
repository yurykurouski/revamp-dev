import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { ImageService } from '../image.service.js';

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
});
