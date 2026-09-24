import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redisConnection = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    })
  : new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      tls: env.REDIS_TLS ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

redisConnection.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Redis Connection Error]:', err.message);
  }
});
