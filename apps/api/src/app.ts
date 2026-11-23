import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { env } from './config/env.js';
import { createCorsOptionsDelegate } from './config/cors.js';
import { createObservability, metricsHandler } from './middlewares/observability.js';

export const createApp = (): Express => {
  const app = express();
  const { registry, requestLogger } = createObservability();
  // index.ts adds the queue gauges to this registry (they need the real queues, which route tests mock)
  app.locals.metricsRegistry = registry;

  // REV-220: request id, one log line per request, Prometheus counters
  app.use(requestLogger);

  // Global Security & Utility Middlewares
  app.use(helmet());
  app.use(cors(createCorsOptionsDelegate(env)));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // REV-220: Prometheus scrape endpoint, outside the API prefix
  app.get('/metrics', metricsHandler(registry));

  // API Routes
  app.use(env.API_PREFIX, routes);

  // 404 Not Found Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
};
