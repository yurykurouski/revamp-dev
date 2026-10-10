import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
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

export type ScreenshotType = 'desktop' | 'mobile' | 'desktop-full' | 'mobile-full';

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
   * (`desktop-full` / `mobile-full` hold the full-page captures)
   */
  async uploadScreenshot(leadId: string, type: ScreenshotType, buffer: Buffer): Promise<string> {
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
        // Regeneration overwrites this object in place (REV-31); make browsers revalidate it
        CacheControl: 'no-cache',
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
   * Stores a published version of a model-designed page as the model wrote it (REV-138), next to the page:
   * `v/{slug}/versions/{n}.html` in the demos bucket. Returns the key, which the MVP's version list keeps.
   */
  async uploadPageVersion(slug: string, n: number, html: string): Promise<string> {
    const key = `v/${slug}/versions/${n}.html`;
    await this.ensureBucket(env.S3_BUCKET_DEMOS);
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET_DEMOS,
        Key: key,
        Body: Buffer.from(html, 'utf8'),
        ContentType: 'text/html; charset=utf-8',
      }),
    );
    return key;
  }

  /** A stored version of a model-designed page (REV-139), as text; a missing object rejects */
  async readPageVersion(key: string): Promise<string> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET_DEMOS, Key: key }));
    if (!res.Body) throw new Error(`The stored page ${key} has no content`);
    return res.Body.transformToString('utf-8');
  }

  /** Removes an object, by default from the demos bucket (a version that fell off the list, REV-138) */
  async deleteObject(key: string, bucket: string = env.S3_BUCKET_DEMOS): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
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
