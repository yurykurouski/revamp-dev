import mongoose from 'mongoose';
import { env } from './config/env.js';
import { checkBusinessLinks, checkContactRights, checkTenantLinks, checkLeadChildIndexes, configureLogging, redactMongoUri } from '@revamp/db';
import { createAuditWorker } from './workers/audit.worker.js';
import { createAiWorker } from './workers/ai.worker.js';
import { createDeployWorker } from './workers/deploy.worker.js';
import { createEmailWorker } from './workers/email.worker.js';
import { createEmailTestWorker } from './workers/email-test.worker.js';
import { createDiscoveryWorker } from './workers/discovery.worker.js';
import { createMvpPageWorker } from './workers/mvp-page.worker.js';
import { redisConnection } from './queues/connection.js';
import { browserService } from './services/browser.service.js';
import { recoverStalledAuditedLeads } from './services/stalled-lead-recovery.js';
import { startLlmCapabilitiesReporter } from './services/llm-capabilities.js';
import { providerConfigWarnings } from './services/provider-config.js';
import { startHeartbeat } from './services/heartbeat.js';
import { createWorkerMetrics, startMetricsServer } from './services/metrics.js';

// REV-220: every console call of this process becomes one JSON line in production (LOG_FORMAT=json|text)
configureLogging('workers');

async function startWorkers(): Promise<void> {
  try {
    console.log(`[Workers] Connecting to MongoDB at ${redactMongoUri(env.MONGODB_URI)}...`);
    await mongoose.connect(env.MONGODB_URI);
    console.log('[Workers] MongoDB connected successfully.');
    // REV-201: leadId must be unique on mvpprojects and emailcampaigns; say so until the migration ran
    void checkLeadChildIndexes(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[Workers] ${warning}`)),
    );
    // REV-208: leads made before the shared business get one with the backfill; say so until it ran
    void checkBusinessLinks(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[Workers] ${warning}`)),
    );
    // REV-209: records made before the studios have none; no studio sees them until the migration ran
    void checkTenantLinks(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[Workers] ${warning}`)),
    );
    // REV-224: leads made before the contact registry have no right; nothing stops two studios until the migration ran
    void checkContactRights(mongoose.connection).then((warnings) =>
      warnings.forEach((warning) => console.warn(`[Workers] ${warning}`)),
    );

    console.log('[Workers] Initializing BullMQ workers...');
    const auditWorker = createAuditWorker();
    const aiWorker = createAiWorker();
    const deployWorker = createDeployWorker();
    const emailWorker = createEmailWorker();
    const emailTestWorker = createEmailTestWorker();
    const discoveryWorker = createDiscoveryWorker();
    const mvpPageWorker = createMvpPageWorker();

    // REV-220: job counters and durations for Prometheus, on their own port
    const { registry, track } = createWorkerMetrics();
    for (const worker of [auditWorker, aiWorker, deployWorker, emailWorker, emailTestWorker, discoveryWorker, mvpPageWorker]) track(worker);
    const metricsServer = await startMetricsServer(registry, env.METRICS_PORT);

    console.log('[Workers] All background workers are active and listening.');
    for (const warning of providerConfigWarnings()) console.warn(`[Workers] ${warning}`);

    // Tell the API which LLM providers this host can run (REV-32)
    const stopLlmCapabilitiesReporter = startLlmCapabilitiesReporter(redisConnection);

    // Auto-advance any leads that completed audit before auto-chaining was active
    await recoverStalledAuditedLeads();

    // REV-217: the container HEALTHCHECK reads this file; it goes stale when MongoDB or Redis is lost
    const stopHeartbeat = startHeartbeat({
      isHealthy: () => mongoose.connection.readyState === 1 && redisConnection.status === 'ready',
    });

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`[Workers] Received ${signal}. Closing workers gracefully...`);
      stopHeartbeat();
      metricsServer?.close();
      stopLlmCapabilitiesReporter();
      await Promise.all([
        auditWorker.close(),
        aiWorker.close(),
        deployWorker.close(),
        emailWorker.close(),
        emailTestWorker.close(),
        discoveryWorker.close(),
        mvpPageWorker.close(),
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
