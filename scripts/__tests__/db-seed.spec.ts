import { describe, expect, it } from 'vitest';
import { describeError } from '../db-seed.js';

describe('describeError (REV-199)', () => {
  it('keeps a plain message', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('reads the code and inner errors of a message-less AggregateError', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9000'), { code: 'ECONNREFUSED' });
    const error = Object.assign(new AggregateError([refused], ''), { code: 'ECONNREFUSED' });
    expect(describeError(error)).toBe('ECONNREFUSED; connect ECONNREFUSED 127.0.0.1:9000');
  });

  it('falls back to the error name and to String for non-errors', () => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
    expect(describeError('plain')).toBe('plain');
  });
});
