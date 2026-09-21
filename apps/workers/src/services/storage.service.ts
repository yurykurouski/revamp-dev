import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export interface UploadOptions {
  bucket?: string;
  key: string;
  buffer: Buffer;
  contentType: string;
}

export class StorageService {
  private client: S3Client;
  private defaultBucket: string;

  constructor(client?: S3Client, defaultBucket?: string) {
    this.defaultBucket = defaultBucket || env.S3_BUCKET_ASSETS;
    this.client =
      client ||
      new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: 'us-east-1',
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
        forcePathStyle: true, // Required for MinIO / local S3 compatibility
      });
  }

  /**
   * Ensures the bucket exists; creates it if not found (useful for local development/MinIO)
   */
  async ensureBucket(bucketName?: string): Promise<void> {
    const bucket = bucketName || this.defaultBucket;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (createErr) {
        // If it already exists or race condition, ignore
        console.warn(`[StorageService] Could not auto-create bucket ${bucket}:`, createErr);
      }
    }
  }

  /**
   * Uploads an arbitrary buffer to S3 / MinIO and returns the public URL
   */
  async uploadBuffer(options: UploadOptions): Promise<string> {
    const bucket = options.bucket || this.defaultBucket;

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: options.key,
        Body: options.buffer,
        ContentType: options.contentType,
      }),
    );

    return this.getPublicUrl(bucket, options.key);
  }

  /**
   * Uploads screenshot to the assets bucket under screenshots/{leadId}/{type}.webp
   */
  async uploadScreenshot(leadId: string, type: 'desktop' | 'mobile', buffer: Buffer): Promise<string> {
    const key = `screenshots/${leadId}/${type}.webp`;
    return this.uploadBuffer({
      bucket: this.defaultBucket,
      key,
      buffer,
      contentType: 'image/webp',
    });
  }

  /**
   * Uploads static HTML bundle to the demo sandbox bucket (revamp-demos) under v/{slug}/index.html
   * with proper security headers (Content-Type, CSP, X-Frame-Options metadata).
   */
  async uploadHtml(
    slug: string,
    html: string,
    bucketName: string = env.S3_BUCKET_DEMOS,
  ): Promise<{ url: string; key: string }> {
    const key = `v/${slug}/index.html`;
    const buffer = Buffer.from(html, 'utf8');

    await this.ensureBucket(bucketName);

    await this.client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: 'text/html; charset=utf-8',
        Metadata: {
          'x-frame-options': 'SAMEORIGIN',
          'content-security-policy': "default-src 'self' 'unsafe-inline' data: https:;",
        },
      }),
    );

    const url = this.getPublicUrl(bucketName, key);
    return { url, key };
  }

  /**
   * Uploads comparison collage banner (1200x630 WebP) to revamp-assets bucket
   */
  async uploadComparisonBanner(slug: string, buffer: Buffer): Promise<string> {
    const key = `banners/${slug}.webp`;
    return this.uploadBuffer({
      bucket: this.defaultBucket,
      key,
      buffer,
      contentType: 'image/webp',
    });
  }

  /**
   * Constructs the accessible public URL for the object
   */
  getPublicUrl(bucket: string, key: string): string {
    const endpoint = env.S3_ENDPOINT.replace(/\/+$/, '');
    return `${endpoint}/${bucket}/${key}`;
  }
}

export const storageService = new StorageService();
