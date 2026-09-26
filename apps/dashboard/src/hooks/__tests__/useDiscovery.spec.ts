import { describe, it, expect } from 'vitest';
import {
  DISCOVERY_POLL_INTERVAL_MS,
  discoveryRefetchInterval,
  discoveryStateBucket,
  isDiscoveryFinished,
  validateDiscoveryForm,
} from '../useDiscovery.js';

describe('discovery hook helpers (REV-27)', () => {
  it('isDiscoveryFinished should be true only for completed and failed jobs', () => {
    expect(isDiscoveryFinished({ state: 'completed' })).toBe(true);
    expect(isDiscoveryFinished({ state: 'failed' })).toBe(true);
    expect(isDiscoveryFinished({ state: 'active' })).toBe(false);
    expect(isDiscoveryFinished({ state: 'waiting' })).toBe(false);
    expect(isDiscoveryFinished(undefined)).toBe(false);
    expect(isDiscoveryFinished(null)).toBe(false);
  });

  it('discoveryRefetchInterval should poll until the job finishes', () => {
    expect(discoveryRefetchInterval(undefined)).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'delayed' })).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'active' })).toBe(DISCOVERY_POLL_INTERVAL_MS);
    expect(discoveryRefetchInterval({ state: 'completed' })).toBe(false);
    expect(discoveryRefetchInterval({ state: 'failed' })).toBe(false);
  });

  it('discoveryStateBucket should collapse BullMQ states', () => {
    expect(discoveryStateBucket('waiting')).toBe('queued');
    expect(discoveryStateBucket('delayed')).toBe('queued');
    expect(discoveryStateBucket('prioritized')).toBe('queued');
    expect(discoveryStateBucket('waiting-children')).toBe('queued');
    expect(discoveryStateBucket('unknown')).toBe('queued');
    expect(discoveryStateBucket('active')).toBe('running');
    expect(discoveryStateBucket('completed')).toBe('completed');
    expect(discoveryStateBucket('failed')).toBe('failed');
  });

  describe('validateDiscoveryForm', () => {
    it('should return parsed data with defaults on success', () => {
      expect(validateDiscoveryForm({ provider: 'google', niche: 'auto', location: ' Riga ', limit: 5 })).toEqual({
        success: true,
        data: { provider: 'google', niche: 'auto', location: 'Riga', limit: 5 },
      });
      const defaulted = validateDiscoveryForm({ niche: 'dental', location: 'Riga' });
      expect(defaulted.success && defaulted.data.limit).toBe(20);
    });

    it.each([
      [{ niche: 'dental' as const, location: 'R' }, 'discovery.errors.location'],
      [{ niche: 'other' as const, location: 'Riga' }, 'discovery.errors.keyword'],
      [{ niche: 'dental' as const, location: 'Riga', limit: 0 }, 'discovery.errors.limit'],
      [{ niche: 'dental' as const, location: 'Riga', limit: Number.NaN }, 'discovery.errors.limit'],
      [{ niche: 'dental' as const, location: 'Riga', provider: 'bing' as never }, 'discovery.errors.invalid'],
    ])('should map %j to %s', (input, errorKey) => {
      expect(validateDiscoveryForm(input)).toEqual({ success: false, errorKey });
    });
  });
});
