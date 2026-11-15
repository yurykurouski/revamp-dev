/**
 * Real-MongoDB helper for tests only (REV-201). A single-node replica set, so tests can use
 * unique indexes and transactions. The binary version is pinned in the root package.json
 * (`config.mongodbMemoryServer.version`) and cached in CI. Never exported from `index.ts`.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const TEST_DB_NAME = 'revamp-test';

export async function startMongoReplSet(): Promise<{ uri: string; stop(): Promise<void> }> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await replSet.waitUntilRunning();
  return {
    uri: replSet.getUri(TEST_DB_NAME),
    stop: async () => {
      await replSet.stop();
    },
  };
}
