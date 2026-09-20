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
   * Constructs the accessible public URL for the object
   */
  getPublicUrl(bucket: string, key: string): string {
    const endpoint = env.S3_ENDPOINT.replace(/\/+$/, '');
    return `${endpoint}/${bucket}/${key}`;
  }
}

export const storageService = new StorageService();
