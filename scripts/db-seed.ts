/**
 * REV-199: loads the fixed demo dataset into a local database, for demos and grading.
 *
 *   npm run db:seed                 # inserts the demo documents that are missing; keeps the rest as they are
 *   npm run db:seed -- --reset      # puts every demo document back to its seeded state
 *   ENV_FILE=/path/to/.env npm run db:seed
 *
 * Reads MONGODB_URI, NODE_ENV and S3_* from the environment, else from .env. Refuses a database that is not on this
 * machine and NODE_ENV=production. Uploads the demo MVP pages to the demos bucket first, then writes the documents
 * through the @revamp/db models in one transaction. Only the seed's own fixed ids are ever written or deleted, and
 * every demo address is a `.test` name, so nothing can be sent to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertLocalSeedTarget, buildDemoDataset, DEMO_OWNER_EMAIL, DEMO_OWNER_PASSWORD, DemoPage, redactMongoUri, seedDemoDataset } from '@revamp/db';
// @ts-expect-error plain .mjs helper without type declarations
import { parseEnv } from './lib/dev-stack.mjs';

const KEYS = ['MONGODB_URI', 'NODE_ENV', 'S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET_DEMOS', 'S3_FORCE_PATH_STYLE'];

/** The settings the seed needs: the process environment wins over the .env file */
function loadSettings(): Record<string, string | undefined> {
  const envFile = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
  const file: Record<string, string> = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  return Object.fromEntries(KEYS.map((key) => [key, process.env[key] || file[key] || undefined]));
}

async function uploadPages(pages: DemoPage[], settings: Record<string, string | undefined>, bucket: string): Promise<void> {
  const client = new S3Client({
    endpoint: settings['S3_ENDPOINT'],
    region: settings['S3_REGION'] ?? 'us-east-1',
    forcePathStyle: settings['S3_FORCE_PATH_STYLE'] !== 'false',
    credentials: { accessKeyId: settings['S3_ACCESS_KEY'] ?? '', secretAccessKey: settings['S3_SECRET_KEY'] ?? '' },
  });
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
    const put = (key: string, html: string) =>
      client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: html, ContentType: 'text/html; charset=utf-8', CacheControl: 'no-cache' }),
      );
    for (const page of pages) {
      await put(`v/${page.slug}/index.html`, page.indexHtml);
      await put(`v/${page.slug}/versions/1.html`, page.versionHtml);
    }
  } finally {
    client.destroy();
  }
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const settings = loadSettings();
  const uri = settings['MONGODB_URI'] ?? '';
  assertLocalSeedTarget(uri, settings['NODE_ENV']);
  if (!settings['S3_ENDPOINT']) throw new Error('S3_ENDPOINT is not set: the demo MVP pages need the local MinIO.');

  const bucket = settings['S3_BUCKET_DEMOS'] ?? 'revamp-demos';
  const ds = buildDemoDataset(new Date(), { s3Endpoint: settings['S3_ENDPOINT'], demosBucket: bucket });
  console.log(`[Seed] ${reset ? 'Resetting' : 'Seeding'} the demo dataset on ${redactMongoUri(uri)}`);

  // Pages first: when MinIO is down nothing reaches the database
  try {
    await uploadPages(ds.pages, settings, bucket);
  } catch (error) {
    throw new Error(`Could not upload the demo pages to ${settings['S3_ENDPOINT']} (is MinIO running? npm run docker:up): ${describeError(error)}`);
  }
  console.log(`[Seed] Uploaded ${ds.pages.length} demo MVP page(s) to ${settings['S3_ENDPOINT']}/${bucket}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const report = await seedDemoDataset(ds, { reset });
    for (const [collection, { inserted, kept }] of Object.entries(report)) {
      console.log(`[Seed] ${collection.padEnd(16)} inserted ${inserted}, kept ${kept}`);
    }
    // A local test account (REV-206); the seed never runs against a hosted database
    console.log(`[Seed] Sign in to the dashboard as ${DEMO_OWNER_EMAIL} with the password ${DEMO_OWNER_PASSWORD}`);
  } finally {
    await mongoose.disconnect();
  }
}

/** A readable reason: connection failures from the AWS SDK and the driver often carry no message, only a code */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = errorParts(error);
  return parts.length > 0 ? [...new Set(parts)].join('; ') : error.name;
}

function errorParts(error: Error): string[] {
  const code = (error as { code?: unknown }).code;
  const inner = error instanceof AggregateError ? error.errors.flatMap((e) => (e instanceof Error ? errorParts(e) : [String(e)])) : [];
  return [error.message, typeof code === 'string' ? code : '', ...inner].filter(Boolean);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`[Seed] Failed: ${describeError(error)}`);
    process.exit(1);
  });
}
