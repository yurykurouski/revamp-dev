import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { startMongoReplSet } from '../testing/mongo-memory.js';

describe('startMongoReplSet (REV-201)', () => {
  it('starts a MongoDB 7.0 replica set Mongoose can connect to', async () => {
    const mongo = await startMongoReplSet();
    const conn = await mongoose.createConnection(mongo.uri).asPromise();
    try {
      const hello = await conn.db!.admin().command({ hello: 1 });
      expect(hello['setName']).toBeTruthy();
      const info = await conn.db!.admin().command({ buildInfo: 1 });
      expect(String(info['version'])).toMatch(/^7\.0\./);
      expect(conn.db!.databaseName).toBe('revamp-test');
    } finally {
      await conn.close();
      await mongo.stop();
    }
  }, 180_000);
});
