import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { loadFileSecrets } from '@revamp/db';
import { lotPriceSettingsFromEnv } from '@revamp/validation';
import { DEFAULT_CONTACT_COOLDOWN_DAYS, DEFAULT_CONTACT_RIGHT_DAYS } from '@revamp/shared-types';

// Load .env from root or local directory
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
// REV-220: JWT_SECRET_FILE, MONGODB_URI_FILE, S3_SECRET_KEY_FILE ... (Docker secrets) fill the variable they name
loadFileSecrets();

/** `PLATFORM_ADMIN_EMAILS`: comma separated, trimmed and lowercased like `User.email`; empty means nobody is an admin */
export const parsePlatformAdminEmails = (raw: string): ReadonlySet<string> =>
  new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Signs the sign-in tokens (REV-206); `npm run setup` generates one into .env
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  API_PREFIX: z.string().default('/api/v1'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/revamp'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_TLS: z.coerce.boolean().default(false),
  // REV-224: how long a studio holds the exclusive right to contact a business, and the cooldown after it (days)
  CONTACT_RIGHT_DAYS: z.coerce.number().int().positive().default(DEFAULT_CONTACT_RIGHT_DAYS),
  CONTACT_COOLDOWN_DAYS: z.coerce.number().int().positive().default(DEFAULT_CONTACT_COOLDOWN_DAYS),
  // REV-232: emails of the platform admins (platform audits, lots); empty = nobody
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET_ASSETS: z.string().default('revamp-assets'),
  S3_BUCKET_DEMOS: z.string().default('revamp-demos'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  PREVIEW_DOMAIN: z.string().default('preview.revampdemo.com'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000/api/v1'),
  // Reverse geocoding for discovery location auto-detect (REV-28)
  NOMINATIM_REVERSE_URL: z.string().url().default('https://nominatim.openstreetmap.org/reverse'),
  DISCOVERY_USER_AGENT: z.string().default('RevampBot/0.1 (+https://revampdemo.com)'),
});

export const env = EnvSchema.parse(process.env);
// REV-231: lot price floor, cap, currency and signal weights; a bad value stops startup
export const lotPriceSettings = lotPriceSettingsFromEnv(process.env);
// REV-232: the platform admins; a studio owner who is not listed gets 403 on `/admin/*`
export const platformAdminEmails: ReadonlySet<string> = parsePlatformAdminEmails(env.PLATFORM_ADMIN_EMAILS);
