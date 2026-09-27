import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { env } from './config/env.js';
import { createCorsOptionsDelegate } from './config/cors.js';

export const createApp = (): Express => {
  const app = express();

  // Global Security & Utility Middlewares
  app.use(helmet());
  app.use(cors(createCorsOptionsDelegate(env)));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // API Routes
  app.use(env.API_PREFIX, routes);

  // 404 Not Found Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
};
