import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { redisConnection } from '../queues/connection.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const mongoState = mongoose.connection.readyState;
  const mongoStatus =
    mongoState === 1 ? 'connected' : mongoState === 2 ? 'connecting' : 'disconnected';
  const redisStatus =
    redisConnection.status === 'ready' || redisConnection.status === 'connect'
      ? 'connected'
      : redisConnection.status;

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      api: 'healthy',
      mongodb: mongoStatus,
      redis: redisStatus,
    },
  });
});

export default router;
