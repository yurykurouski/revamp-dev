import mongoose from 'mongoose';
import { createApp } from './app.js';
import { env } from './config/env.js';

const app = createApp();

async function startServer(): Promise<void> {
  try {
    console.log(`[API] Connecting to MongoDB at ${env.MONGODB_URI}...`);
    await mongoose.connect(env.MONGODB_URI);
    console.log('[API] MongoDB connected successfully.');

    const server = app.listen(env.PORT, () => {
      console.log(`[API] Revamp API Gateway running on port ${env.PORT}`);
      console.log(`[API] Base URL: http://localhost:${env.PORT}${env.API_PREFIX}`);
    });

    // Graceful Shutdown
    const shutdown = async (signal: string) => {
      console.log(`[API] Received ${signal}. Closing server gracefully...`);
      server.close(async () => {
        await mongoose.disconnect();
        console.log('[API] Server closed and MongoDB disconnected.');
        process.exit(0);
      });
    };

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
