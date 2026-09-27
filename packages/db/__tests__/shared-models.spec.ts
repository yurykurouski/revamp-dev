import { describe, it, expect } from 'vitest';
import * as db from '../src/index.js';
import * as apiModels from '../../../apps/api/src/models/index.js';
import * as workerModels from '../../../apps/workers/src/models/index.js';
import { QUEUE_NAMES as apiQueueNames } from '../../../apps/api/src/queues/queue.constants.js';
import { QUEUE_NAMES as workerQueueNames } from '../../../apps/workers/src/queues/queue.constants.js';

// REV-48: the API and the workers used to keep separate copies of every schema, and the copies drifted
describe('@revamp/db shared by the API and the workers', () => {
  const modelNames = ['Lead', 'Audit', 'MvpProject', 'EmailCampaign', 'AnalyticsEvent'] as const;

  it.each(modelNames)('gives both apps the same %s model', (name) => {
    expect(apiModels[name]).toBe(db[name]);
    expect(workerModels[name]).toBe(db[name]);
  });

  it('keeps the audit fields only the workers used to declare (REV-33 cookie banner outcome)', () => {
    expect(apiModels.Audit.schema.path('cookieBannerHandled.desktop')).toBeDefined();
    expect(apiModels.Audit.schema.path('cookieBannerHandled.mobile')).toBeDefined();
  });

  it('gives producer and consumer the same queue names', () => {
    expect(apiQueueNames).toBe(workerQueueNames);
    expect(Object.values(apiQueueNames)).toEqual([
      'audit-queue',
      'ai-gen-queue',
      'deploy-queue',
      'email-queue',
      'email-test-queue',
      'discovery-queue',
    ]);
  });
});
