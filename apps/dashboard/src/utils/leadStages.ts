import { LEAD_STATUSES, type LeadStatus } from '@revamp/shared-types';
import type { Stage } from '../theme/theme.js';

/**
 * The Kanban column every lead status belongs to (REV-62). Typed over the shared `LeadStatus`, so a
 * status added to or removed from `LEAD_STATUSES` fails to compile until it is placed here.
 */
export const LEAD_STATUS_STAGE: Readonly<Record<LeadStatus, Stage>> = {
  QUEUED: 'queued',
  AUDITING: 'queued',
  AUDIT_FAILED: 'queued',
  AUDITED: 'queued',
  GENERATING: 'queued',
  NEEDS_APPROVAL: 'needs_approval',
  SCHEDULED: 'scheduled',
  SENT: 'sent',
  OPENED: 'opened',
  CLICKED: 'clicked',
  ENGAGED: 'engaged',
  REJECTED: 'rejected',
  UNSUBSCRIBED: 'rejected',
};

/** The lead's Kanban column; undefined for a status the dashboard does not know */
export const leadStage = (status: string): Stage | undefined =>
  (LEAD_STATUSES as readonly string[]).includes(status) ? LEAD_STATUS_STAGE[status as LeadStatus] : undefined;

/** The review-queue buckets (REV-76): what the operator has to do next with a lead */
export const LEAD_BUCKETS = ['needs_you', 'in_progress', 'outreach', 'closed'] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];
export type BucketFilter = LeadBucket | 'ALL';

/**
 * The bucket every lead status belongs to. Like `LEAD_STATUS_STAGE`, it is typed over `LeadStatus`, so a
 * new status fails to compile until it is placed in a bucket.
 */
export const LEAD_STATUS_BUCKET: Readonly<Record<LeadStatus, LeadBucket>> = {
  NEEDS_APPROVAL: 'needs_you',
  AUDIT_FAILED: 'needs_you',
  QUEUED: 'in_progress',
  AUDITING: 'in_progress',
  AUDITED: 'in_progress',
  GENERATING: 'in_progress',
  SCHEDULED: 'outreach',
  SENT: 'outreach',
  OPENED: 'outreach',
  CLICKED: 'outreach',
  ENGAGED: 'closed',
  REJECTED: 'closed',
  UNSUBSCRIBED: 'closed',
};

/** The lead's bucket; undefined for a status the dashboard does not know */
export const leadBucket = (status: string): LeadBucket | undefined =>
  (LEAD_STATUSES as readonly string[]).includes(status) ? LEAD_STATUS_BUCKET[status as LeadStatus] : undefined;

/** Whether a lead with this status passes the bucket filter */
export const matchesBucket = (status: string, bucket: BucketFilter): boolean =>
  bucket === 'ALL' || leadBucket(status) === bucket;

export type BucketCounts = Record<BucketFilter, number>;

/** Leads per bucket, plus `ALL` for the total, from a list of leads */
export function countLeadsByBucket(leads: ReadonlyArray<{ status: string }>): BucketCounts {
  const counts: BucketCounts = { ALL: 0, needs_you: 0, in_progress: 0, outreach: 0, closed: 0 };
  for (const { status } of leads) {
    counts.ALL += 1;
    const bucket = leadBucket(status);
    if (bucket) counts[bucket] += 1;
  }
  return counts;
}

/** Leads per bucket from the pipeline-wide counts by status (`GET /leads/stats`) */
export function countStatsByBucket(byStatus: Partial<Record<string, number>>): BucketCounts {
  const counts: BucketCounts = { ALL: 0, needs_you: 0, in_progress: 0, outreach: 0, closed: 0 };
  for (const [status, count = 0] of Object.entries(byStatus)) {
    counts.ALL += count;
    const bucket = leadBucket(status);
    if (bucket) counts[bucket] += count;
  }
  return counts;
}
