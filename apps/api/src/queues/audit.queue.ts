import { Queue } from 'bullmq';
import { AUDIT_JOB_NAMES, IAuditJobData, IPlatformAuditJobData } from '@revamp/shared-types';
import { redisConnection } from './connection.js';
import { QUEUE_NAMES } from './queue.constants.js';

export const auditQueue = new Queue<IAuditJobData | IPlatformAuditJobData>(QUEUE_NAMES.AUDIT, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: {
      count: 100,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export const addAuditJob = async (data: IAuditJobData) => {
  return await auditQueue.add(AUDIT_JOB_NAMES.LEAD, data);
};

/** The platform audit of a business no studio owns yet (REV-232): its own job name on the same queue, no `tenantId`; one job id per audit, so a repeated add is deduplicated */
export const addPlatformAuditJob = async (data: IPlatformAuditJobData) => {
  return await auditQueue.add(AUDIT_JOB_NAMES.PLATFORM, data, { jobId: `platform-audit-${data.auditId}` });
};
