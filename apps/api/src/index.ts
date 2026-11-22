import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { checkBusinessLinks, checkLeadChildIndexes, redactMongoUri } from '@revamp/db';
import { closeQueues, redisConnection } from './queues/index.js';
import { createShutdown } from './shutdown.js';

const app = createApp();

async function startServer(): Promise<void> {
  try {
    console.log(`[API] Connecting to MongoDB at ${redactMongoUri(env.MONGODB_URI)}...`);
    await mongoose.connect(env.MONGODB_URI);
    console.log('[API] MongoDB connected successfully.');
    // REV-201: leadId must be unique on mvpprojects and emailcampaigns; say so until the migration ran
    void checkLeadChildIndexes(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[API] ${warning}`)),
    );
    // REV-208: leads made before the shared business get one with the backfill; say so until it ran
    void checkBusinessLinks(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[API] ${warning}`)),
    );

    const server = app.listen(env.PORT, () => {
      console.log(`[API] Revamp API Gateway running on port ${env.PORT}`);
      console.log(`[API] Base URL: http://localhost:${env.PORT}${env.API_PREFIX}`);
    });

    const shutdown = createShutdown({
      server,
      closeQueues,
      closeRedis: () => redisConnection.quit(),
      disconnectMongo: () => mongoose.disconnect(),
      exit: (code) => process.exit(code),
    });

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[API] Failed to start server:', error);
    process.exit(1);
  }
}

// Start if not in test environment
if (env.NODE_ENV !== 'test') {
  startServer();
}

export default app;
