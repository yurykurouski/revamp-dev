import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import {
  TenantScopeError,
  scopedFilter,
  scopedPipeline,
  scopedUpdate,
  stampTenant,
} from '../tenant-scope.js';

const studioA = new Types.ObjectId();
const studioB = new Types.ObjectId();
const tenantMatch = (id: Types.ObjectId) => ({ tenantId: id });

describe('scopedFilter (REV-209)', () => {
  it("adds the studio to a filter without changing the filter's meaning", () => {
    const filter = { status: 'AUDITED', $or: [{ domain: 'a.example' }, { externalId: 'x' }] };
    expect(scopedFilter(studioA, filter)).toEqual({ $and: [tenantMatch(studioA), filter] });
  });

  it('is just the studio for an empty or missing filter', () => {
    expect(scopedFilter(studioA, {})).toEqual(tenantMatch(studioA));
    expect(scopedFilter(studioA, undefined)).toEqual(tenantMatch(studioA));
  });

  it('accepts the studio as an ObjectId or as its string', () => {
    expect(scopedFilter(String(studioA), { a: 1 })).toEqual({ $and: [tenantMatch(studioA), { a: 1 }] });
  });

  it('the legacy bucket (no studio) matches only records that have none', () => {
    expect(scopedFilter(undefined, { a: 1 })).toEqual({ $and: [{ tenantId: null }, { a: 1 }] });
    expect(scopedFilter(null, {})).toEqual({ tenantId: null });
  });

  it.each([
    ['a tenantId key', { tenantId: studioB }],
    ['a tenantId inside $or', { $or: [{ status: 'x' }, { tenantId: studioB }] }],
    ['a tenantId inside $and', { $and: [{ status: 'x' }, { tenantId: { $ne: studioA } }] }],
    ['a tenantId inside $nor', { $nor: [{ tenantId: studioA }] }],
    ['a deeply nested tenantId', { $or: [{ $and: [{ $or: [{ tenantId: null }] }] }] }],
  ])('refuses %s: a request value must never widen the scope', (_label, filter) => {
    expect(() => scopedFilter(studioA, filter)).toThrow(TenantScopeError);
  });

  it('does not mistake a field that only contains the name for the studio key', () => {
    expect(() => scopedFilter(studioA, { notTenantId: 1, 'meta.tenantIdHint': 2 })).not.toThrow();
  });

  it.each(['', '   ', 'not-an-object-id'])('refuses the studio %j', (bad) => {
    expect(() => scopedFilter(bad, {})).toThrow(TenantScopeError);
  });
});

describe('scopedUpdate (REV-209)', () => {
  it('passes an update that does not touch the studio through unchanged', () => {
    const update = { $set: { status: 'AUDITED' }, $unset: { auditError: '' }, $inc: { n: 1 } };
    expect(scopedUpdate(studioA, update)).toEqual(update);
  });

  it.each([
    ['$set', { $set: { tenantId: studioB } }],
    ['$setOnInsert', { $setOnInsert: { tenantId: studioB } }],
    ['$unset', { $unset: { tenantId: '' } }],
    ['$rename', { $rename: { tenantId: 'x' } }],
    ['a top-level field', { tenantId: studioB, status: 'x' }],
  ])('refuses a change of the studio through %s', (_label, update) => {
    expect(() => scopedUpdate(studioA, update)).toThrow(TenantScopeError);
  });

  it('stamps the studio on an upsert, so an inserted document belongs to it', () => {
    expect(scopedUpdate(studioA, { $set: { a: 1 } }, { upsert: true })).toEqual({
      $set: { a: 1 },
      $setOnInsert: { tenantId: studioA },
    });
    expect(scopedUpdate(studioA, { $setOnInsert: { b: 2 } }, { upsert: true })).toEqual({
      $setOnInsert: { b: 2, tenantId: studioA },
    });
  });

  it('stamps nothing on an upsert of the legacy bucket', () => {
    expect(scopedUpdate(undefined, { $set: { a: 1 } }, { upsert: true })).toEqual({ $set: { a: 1 } });
  });

  it('does not modify the update it was given', () => {
    const update = { $set: { a: 1 } };
    scopedUpdate(studioA, update, { upsert: true });
    expect(update).toEqual({ $set: { a: 1 } });
  });
});

describe('stampTenant (REV-209)', () => {
  it('adds the studio to a document that has none', () => {
    expect(stampTenant(studioA, { a: 1 })).toEqual({ a: 1, tenantId: studioA });
  });

  it('accepts a document that already carries the same studio, refuses another', () => {
    expect(stampTenant(studioA, { a: 1, tenantId: String(studioA) })).toMatchObject({ tenantId: studioA });
    expect(() => stampTenant(studioA, { tenantId: studioB })).toThrow(TenantScopeError);
  });

  it('leaves a document of the legacy bucket without a studio, and refuses one that names a studio', () => {
    expect(stampTenant(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(() => stampTenant(undefined, { tenantId: studioB })).toThrow(TenantScopeError);
  });
});

describe('scopedPipeline (REV-209)', () => {
  it('puts the studio match first', () => {
    const pipeline = [{ $group: { _id: '$status', count: { $sum: 1 } } }];
    expect(scopedPipeline(studioA, pipeline)).toEqual([{ $match: tenantMatch(studioA) }, ...pipeline]);
  });

  it.each(['$lookup', '$unionWith', '$merge', '$out', '$graphLookup'])('refuses %s, which can read or write outside the scope', (stage) => {
    expect(() => scopedPipeline(studioA, [{ [stage]: {} }])).toThrow(TenantScopeError);
  });

  it('refuses a $match on the studio', () => {
    expect(() => scopedPipeline(studioA, [{ $match: { tenantId: studioB } }])).toThrow(TenantScopeError);
  });
});
