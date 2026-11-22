// Test double for `data/tenant-scope.ts` in specs that mock the models: every repository call goes straight to the
// (mocked) model static of the same name, so a spec keeps stating its expectations on `Lead.findById` and so on.
// What the real scope adds (the studio on every filter) is tested in `data/__tests__/tenant-scope.spec.ts` and on a
// real MongoDB in `routes/__tests__/tenant-isolation.spec.ts`.
import { Types } from 'mongoose';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { Lead } from '../models/Lead.model.js';
import { MvpProject } from '../models/MvpProject.model.js';

type Delegate = Record<string, (...args: unknown[]) => unknown>;

const repository = (model: () => Delegate) => ({
  findById: (...a: unknown[]) => model()['findById']!(...a),
  findOne: (...a: unknown[]) => model()['findOne']!(...a),
  find: (...a: unknown[]) => model()['find']!(...a),
  countDocuments: (...a: unknown[]) => model()['countDocuments']!(...a),
  exists: (...a: unknown[]) => model()['exists']!(...a),
  aggregate: (...a: unknown[]) => model()['aggregate']!(...a),
  updateOne: (...a: unknown[]) => model()['updateOne']!(...a),
  updateMany: (...a: unknown[]) => model()['updateMany']!(...a),
  findOneAndUpdate: (...a: unknown[]) => model()['findOneAndUpdate']!(...a),
  deleteOne: (...a: unknown[]) => model()['deleteOne']!(...a),
  create: (...a: unknown[]) => model()['create']!(...a),
});

export const tenantScopeMock = () => {
  return {
    TenantScopeError: class TenantScopeError extends Error {},
    scopeFor: (tenantId?: unknown) => ({
      tenantId: tenantId && /^[0-9a-f]{24}$/i.test(String(tenantId)) ? new Types.ObjectId(String(tenantId)) : undefined,
      leads: repository(() => Lead as unknown as Delegate),
      mvps: repository(() => MvpProject as unknown as Delegate),
      campaigns: repository(() => EmailCampaign as unknown as Delegate),
      events: repository(() => AnalyticsEvent as unknown as Delegate),
    }),
    bySecret: {
      campaignByToken: (token: string) => (EmailCampaign as unknown as Delegate)['findOne']!({ trackingToken: token }),
      mvpBySlug: (slug: string) => (MvpProject as unknown as Delegate)['findOne']!({ previewSlug: slug }),
      mvpById: (id: string) => (MvpProject as unknown as Delegate)['findById']!(id),
    },
  };
};
