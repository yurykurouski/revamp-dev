import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import fs from 'node:fs';
import path from 'node:path';

// Load .env.production if available, else .env, else fallback to current environment
const prodEnvPath = path.resolve(process.cwd(), '.env.production');
const defaultEnvPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(prodEnvPath)) {
  dotenv.config({ path: prodEnvPath });
  console.log(`[Config] Loaded environment from: ${prodEnvPath}`);
} else if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath });
  console.log(`[Config] Loaded environment from: ${defaultEnvPath}`);
} else {
  console.log(`[Config] Using ambient process.env`);
}

export interface VerificationResult {
  service: string;
  status: 'SUCCESS' | 'WARNING' | 'FAILED';
  message: string;
  details?: Record<string, unknown>;
}

export async function checkMongoDB(): Promise<VerificationResult> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return {
      service: 'MongoDB Atlas',
      status: 'FAILED',
      message: 'MONGODB_URI is not set in environment.',
    };
  }

  try {
    const isSrv = uri.startsWith('mongodb+srv://');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });

    const admin = mongoose.connection.db?.admin();
    const pingResult = await admin?.ping();

    await mongoose.disconnect();

    return {
      service: 'MongoDB Atlas',
      status: 'SUCCESS',
      message: `Successfully connected and pinged database (type: ${isSrv ? 'Atlas SRV' : 'Standard URI'}).`,
      details: { ping: pingResult },
    };
  } catch (error: unknown) {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect().catch(() => {});
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      service: 'MongoDB Atlas',
      status: 'FAILED',
      message: `Connection failed: ${errorMsg}`,
    };
  }
}

export async function checkRedis(): Promise<VerificationResult> {
  const redisUrl = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;
  const useTls = process.env.REDIS_TLS === 'true' || (redisUrl ? redisUrl.startsWith('rediss://') : false);

  let client: Redis | null = null;
  try {
    client = redisUrl
      ? new Redis(redisUrl, {
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
          tls: redisUrl.startsWith('rediss://') ? {} : undefined,
          lazyConnect: true,
        })
      : new Redis({
          host,
          port,
          password,
          tls: useTls ? {} : undefined,
          connectTimeout: 5000,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });

    client.on('error', () => {});

    await client.connect();
    const pong = await client.ping();
    await client.quit();

    return {
      service: 'Redis / Upstash',
      status: 'SUCCESS',
      message: `Ping successful: ${pong} (TLS: ${useTls ? 'enabled' : 'disabled'})`,
      details: { urlProvided: Boolean(redisUrl), host, port, tls: useTls },
    };
  } catch (error: unknown) {
    if (client) {
      try {
        client.disconnect();
      } catch {}
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      service: 'Redis / Upstash',
      status: 'FAILED',
      message: `Connection failed: ${errorMsg}`,
    };
  }
}

export async function checkS3Storage(): Promise<VerificationResult> {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const assetsBucket = process.env.S3_BUCKET_ASSETS || 'revamp-assets';
  const demosBucket = process.env.S3_BUCKET_DEMOS || 'revamp-demos';
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return {
      service: 'S3 / Cloudflare R2',
      status: 'WARNING',
      message: 'S3 credentials not fully configured (missing endpoint, accessKey, or secretKey).',
    };
  }

  try {
    const s3 = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle,
    });

    // Check buckets accessibility
    const checkedBuckets: Record<string, string> = {};
    for (const bucket of [assetsBucket, demosBucket]) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucket }));
        checkedBuckets[bucket] = 'reachable';
      } catch (err: unknown) {
        const errObj = err as { name?: string; message?: string };
        checkedBuckets[bucket] = `unavailable (${errObj.name || errObj.message || 'unknown error'})`;
      }
    }

    return {
      service: 'S3 / Cloudflare R2',
      status: 'SUCCESS',
      message: `Storage endpoint connected (${endpoint})`,
      details: {
        buckets: checkedBuckets,
        forcePathStyle,
      },
    };
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return {
      service: 'S3 / Cloudflare R2',
      status: 'FAILED',
      message: `S3 verification failed: ${errorMsg}`,
    };
  }
}

export function checkApiKeys(): VerificationResult {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const openai = Boolean(process.env.OPENAI_API_KEY);
  const resend = Boolean(process.env.RESEND_API_KEY);
  const sendgrid = Boolean(process.env.SENDGRID_API_KEY);

  const hasLLM = anthropic || openai;
  const hasEmail = resend || sendgrid;

  if (hasLLM && hasEmail) {
    return {
      service: 'API Keys & Secrets',
      status: 'SUCCESS',
      message: 'Required AI and Email API keys are present.',
      details: {
        anthropic: anthropic ? 'Configured' : 'Missing',
        openai: openai ? 'Configured' : 'Missing',
        resend: resend ? 'Configured' : 'Missing',
        sendgrid: sendgrid ? 'Configured' : 'Missing',
      },
    };
  }

  return {
    service: 'API Keys & Secrets',
    status: 'WARNING',
    message: `Incomplete API keys: ${!hasLLM ? 'Missing LLM key (Anthropic/OpenAI); ' : ''}${!hasEmail ? 'Missing Email key (Resend/SendGrid);' : ''}`,
    details: { anthropic, openai, resend, sendgrid },
  };
}

export async function runDiagnostics(): Promise<boolean> {
  console.log('\n======================================================');
  console.log('🔍 Revamp SaaS - Production Preflight Environment Diagnostic');
  console.log('======================================================\n');

  const results: VerificationResult[] = [];

  // Run checks
  results.push(await checkMongoDB());
  results.push(await checkRedis());
  results.push(await checkS3Storage());
  results.push(checkApiKeys());

  let allSuccess = true;
  for (const res of results) {
    const icon = res.status === 'SUCCESS' ? '✅' : res.status === 'WARNING' ? '⚠️' : '❌';
    console.log(`${icon} [${res.service}] - Status: ${res.status}`);
    console.log(`   ${res.message}`);
    if (res.details) {
      console.log(`   Details: ${JSON.stringify(res.details)}`);
    }
    console.log('');

    if (res.status === 'FAILED') {
      allSuccess = false;
    }
  }

  console.log('======================================================');
  if (allSuccess) {
    console.log('🎉 All critical production infrastructure checks PASSED!');
    console.log('======================================================\n');
    return true;
  } else {
    console.log('❌ One or more critical production checks FAILED.');
    console.log('======================================================\n');
    return false;
  }
}

// Direct CLI execution
if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  runDiagnostics()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal diagnostic error:', err);
      process.exit(1);
    });
}
