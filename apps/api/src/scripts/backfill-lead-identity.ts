/**
 * REV-35 backfill: normalises `domain`, sets `phoneE164` and `source` on existing leads, and
 * recovers `externalId` for discovery imports whose search results are still in Redis.
 *
 *   npm run backfill:lead-identity --workspace=@revamp/api            # apply
 *   npm run backfill:lead-identity --workspace=@revamp/api -- --dry-run
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Lead } from '../models/Lead.model.js';
import { discoveryQueue } from '../queues/discovery.queue.js';
import { redisConnection } from '../queues/connection.js';
import { BackfillLead, indexDiscoveredIds, planLeadIdentityUpdate } from '../services/lead-identity-backfill.js';

const BATCH_SIZE = 500;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(env.MONGODB_URI);

  const jobs = await discoveryQueue.getJobs(['completed']);
  const discovered = indexDiscoveredIds(jobs.map((job) => job?.returnvalue));
  console.log(`[Backfill] ${jobs.length} finished discovery job(s), ${discovered.size} listing domain(s) indexed`);

  let scanned = 0;
  let updated = 0;
  let ops: Parameters<typeof Lead.bulkWrite>[0] = [];
  const flush = async () => {
    if (ops.length > 0 && !dryRun) await Lead.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  const cursor = Lead.find({}, { originalUrl: 1, domain: 1, contactPhone: 1, phoneE164: 1, source: 1, externalId: 1, tags: 1 })
    .lean()
    .cursor();
  for await (const lead of cursor) {
    scanned++;
    const set = planLeadIdentityUpdate(lead as unknown as BackfillLead, discovered);
    if (!set) continue;
    updated++;
    if (dryRun) console.log(`[Backfill] ${String(lead._id)}:`, set);
    ops.push({ updateOne: { filter: { _id: lead._id }, update: { $set: set } } });
    if (ops.length >= BATCH_SIZE) await flush();
  }
  await flush();

  // Mongoose builds indexes on first use of the model; make sure the new ones exist
  if (!dryRun) await Lead.syncIndexes();

  console.log(`[Backfill] Scanned ${scanned} lead(s), ${dryRun ? 'would update' : 'updated'} ${updated}`);
}

main()
  .catch((error: unknown) => {
    console.error('[Backfill] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await discoveryQueue.close();
    redisConnection.disconnect();
    await mongoose.disconnect();
  });
