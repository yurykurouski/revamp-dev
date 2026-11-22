import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { UnrecoverableError } from 'bullmq';
import { assertJobTenant, jobTenant, withTenant } from '../tenant.js';

const A = new Types.ObjectId();
const B = new Types.ObjectId();

describe('worker tenant checks (REV-210)', () => {
  it.each([undefined, null, '', 'not-an-id', 42, '5eed0000000000000000000'])('refuses a job whose tenantId is %j', (value) => {
    expect(() => jobTenant(value)).toThrow(UnrecoverableError);
  });

  it('accepts a valid id and returns it as an ObjectId', () => {
    expect(String(jobTenant(String(A)))).toBe(String(A));
  });

  it("passes when the lead's studio is the job's, whether the lead holds an ObjectId or a string", () => {
    expect(String(assertJobTenant(String(A), { tenantId: A }))).toBe(String(A));
    expect(String(assertJobTenant(String(A), { tenantId: String(A) }))).toBe(String(A));
  });

  it("refuses another studio's lead, and a lead that has no studio yet", () => {
    expect(() => assertJobTenant(String(A), { tenantId: B })).toThrow(/another studio/);
    expect(() => assertJobTenant(String(A), {})).toThrow(/migrate:tenants/);
    expect(() => assertJobTenant(String(A), { tenantId: null })).toThrow(UnrecoverableError);
  });

  it('refuses a missing job tenant before it looks at the lead', () => {
    expect(() => assertJobTenant(undefined, { tenantId: A })).toThrow(/no valid tenantId/);
  });

  it('adds the studio to a filter without changing the rest', () => {
    expect(withTenant(A, { _id: 'x', status: 'QUEUED' })).toEqual({ _id: 'x', status: 'QUEUED', tenantId: A });
  });
});
