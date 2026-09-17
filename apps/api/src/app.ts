import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { env } from './config/env.js';

export const createApp = (): Express => {
  const app = express();

  // Global Security & Utility Middlewares
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use(env.API_PREFIX, routes);

  // Global Error Handler
  app.use(errorHandler);

  return app;
};
