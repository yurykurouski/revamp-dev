import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env from root or local directory
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  API_PREFIX: z.string().default('/api/v1'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/revamp'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_TLS: z.coerce.boolean().default(false),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET_ASSETS: z.string().default('revamp-assets'),
  S3_BUCKET_DEMOS: z.string().default('revamp-demos'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  PREVIEW_DOMAIN: z.string().default('preview.revampdemo.com'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000/api/v1'),
  EMAIL_PROVIDER: z.enum(['mock', 'resend', 'sendgrid', 'smtp']).default('mock'),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Revamp Team <outreach@revampdemo.com>'),
  // Reverse geocoding for discovery location auto-detect (REV-28)
  NOMINATIM_REVERSE_URL: z.string().url().default('https://nominatim.openstreetmap.org/reverse'),
  DISCOVERY_USER_AGENT: z.string().default('RevampBot/0.1 (+https://revampdemo.com)'),
});

export const env = EnvSchema.parse(process.env);
