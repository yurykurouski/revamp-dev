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
  // A container that can't reach its database must fail the Docker HEALTHCHECK (REV-66)
  const healthy = mongoStatus === 'connected' && redisStatus === 'connected';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      api: 'healthy',
      mongodb: mongoStatus,
      redis: redisStatus,
    },
  });
});

export default router;
