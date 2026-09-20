import sharp from 'sharp';

export interface ImageOptimizationOptions {
  quality?: number;
  maxWidth?: number;
}

export class ImageService {
  /**
   * Compresses an image buffer into modern WebP format
   */
  static async compressToWebp(
    inputBuffer: Buffer,
    options: ImageOptimizationOptions = {},
  ): Promise<Buffer> {
    const quality = options.quality ?? 80;
    let pipeline = sharp(inputBuffer);

    if (options.maxWidth) {
      pipeline = pipeline.resize({
        width: options.maxWidth,
        withoutEnlargement: true,
        fit: 'inside',
      });
    }

    return pipeline
      .webp({
        quality,
        effort: 4,
      })
      .toBuffer();
  }
}
