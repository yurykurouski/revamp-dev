import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  // MVP copywriting provider; when unset it is picked from whichever API key is present
  MVP_LLM_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['anthropic', 'openai', 'gemini', 'claude-cli', 'mock']).optional(),
  ),
  // Local Claude Code CLI provider (REV-30); uses the account the CLI is logged into
  CLAUDE_CLI_PATH: z.string().default('claude'),
  CLAUDE_CLI_MODEL: z.string().default('sonnet'),
  CLAUDE_CLI_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  EMAIL_PROVIDER: z.enum(['mock', 'resend', 'sendgrid', 'smtp']).default('mock'),
  RESEND_API_KEY: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Revamp Team <outreach@revampdemo.com>'),
  PUBLIC_API_URL: z.string().default('http://localhost:4000/api/v1'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Local business discovery (REV-26)
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  OVERPASS_URL: z.string().url().default('https://overpass-api.de/api/interpreter'),
  NOMINATIM_URL: z.string().url().default('https://nominatim.openstreetmap.org/search'),
  // Nominatim and Overpass usage policies require an identifying User-Agent
  DISCOVERY_USER_AGENT: z.string().default('RevampBot/0.1 (+https://revampdemo.com)'),
});

export const env = EnvSchema.parse(process.env);
