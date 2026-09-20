import mongoose from 'mongoose';
import { env } from './config/env.js';
import { createAuditWorker } from './workers/audit.worker.js';
import { createAiWorker } from './workers/ai.worker.js';
import { createDeployWorker } from './workers/deploy.worker.js';
import { createEmailWorker } from './workers/email.worker.js';
import { redisConnection } from './queues/connection.js';
import { browserService } from './services/browser.service.js';

async function startWorkers(): Promise<void> {
  try {
    console.log(`[Workers] Connecting to MongoDB at ${env.MONGODB_URI}...`);
    await mongoose.connect(env.MONGODB_URI);
    console.log('[Workers] MongoDB connected successfully.');

    console.log('[Workers] Initializing BullMQ workers...');
    const auditWorker = createAuditWorker();
    const aiWorker = createAiWorker();
    const deployWorker = createDeployWorker();
    const emailWorker = createEmailWorker();

    console.log('[Workers] All background workers are active and listening.');

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`[Workers] Received ${signal}. Closing workers gracefully...`);
      await Promise.all([
        auditWorker.close(),
        aiWorker.close(),
        deployWorker.close(),
        emailWorker.close(),
      ]);
      await browserService.close();
      await redisConnection.quit();
      await mongoose.disconnect();
      console.log('[Workers] All workers closed and connections closed.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Workers] Fatal error starting workers:', error);
    process.exit(1);
  }
}

if (env.NODE_ENV !== 'test') {
  startWorkers();
}
