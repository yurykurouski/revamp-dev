import { describe, expect, it } from 'vitest';
import { LEAD_CHILD_COLLECTIONS, planLeadChildDedupe, type DedupeDoc } from '../lead-children-migration.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';

// REV-201: the migration's pure parts; migrateLeadChildren and checkLeadChildIndexes run in real-mongo.spec.ts

const at = (iso: string) => new Date(iso);

describe('LEAD_CHILD_COLLECTIONS (REV-201)', () => {
  it('names the collections the models write to', () => {
    expect(LEAD_CHILD_COLLECTIONS).toEqual({
      mvp: MvpProject.collection.collectionName,
      campaign: EmailCampaign.collection.collectionName,
    });
  });
});

describe('planLeadChildDedupe (REV-201)', () => {
  const mvp = (id: string, slug: string, updatedAt: string): DedupeDoc => ({
    _id: id,
    previewSlug: slug,
    updatedAt: at(updatedAt),
  });
  const camp = (id: string, status: string, updatedAt: string): DedupeDoc => ({
    _id: id,
    status,
    updatedAt: at(updatedAt),
  });

  it("keeps the MVP whose slug the lead's previewUrl points at, even when it is older", () => {
    const plan = planLeadChildDedupe(
      'mvp',
      [mvp('a', 'old-slug', '2026-01-01'), mvp('b', 'new-slug', '2026-02-01')],
      'http://localhost:9000/revamp-demos/v/old-slug/index.html',
    );
    expect(plan).toEqual({ keep: 'a', remove: ['b'] });
  });

  it('keeps the newest MVP when previewUrl matches none', () => {
    const plan = planLeadChildDedupe('mvp', [
      mvp('a', 's1', '2026-01-01'),
      mvp('b', 's2', '2026-03-01'),
      mvp('c', 's3', '2026-02-01'),
    ]);
    expect(plan.keep).toBe('b');
    expect([...plan.remove].sort()).toEqual(['a', 'c']);
  });

  it('does not match a slug that is only a prefix of the one in previewUrl', () => {
    const plan = planLeadChildDedupe(
      'mvp',
      [mvp('a', 'shop', '2026-03-01'), mvp('b', 'shop-2', '2026-01-01')],
      'http://localhost:9000/revamp-demos/v/shop-2/index.html',
    );
    expect(plan.keep).toBe('b');
  });

  it('keeps an UNSUBSCRIBED campaign over a newer SCHEDULED one, so later opt-outs still find it', () => {
    const plan = planLeadChildDedupe('campaign', [
      camp('a', 'UNSUBSCRIBED', '2026-01-01'),
      camp('b', 'SCHEDULED', '2026-02-01'),
    ]);
    expect(plan).toEqual({ keep: 'a', remove: ['b'] });
  });

  it('keeps a DELIVERED campaign over a DRAFT, and the newest when statuses tie', () => {
    expect(
      planLeadChildDedupe('campaign', [
        camp('a', 'DRAFT', '2026-03-01'),
        camp('b', 'DELIVERED', '2026-01-01'),
      ]).keep,
    ).toBe('b');
    expect(
      planLeadChildDedupe('campaign', [
        camp('a', 'SCHEDULED', '2026-01-01'),
        camp('b', 'SCHEDULED', '2026-02-01'),
      ]).keep,
    ).toBe('b');
  });
});
