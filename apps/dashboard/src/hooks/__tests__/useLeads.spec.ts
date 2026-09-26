import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from '../../api/client.js';
import { canRegenerateMvp, generateMvpRequest, withPreviewVersion } from '../useLeads.js';

describe('MVP regeneration helpers (REV-31)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateMvpRequest forwards forceRegenerate to the API client', async () => {
    const spy = vi.spyOn(apiClient, 'generateMvp').mockResolvedValue({ success: true, status: 'GENERATING' });

    await generateMvpRequest({ auditId: 'a1', leadId: 'l1', forceRegenerate: true });
    expect(spy).toHaveBeenCalledWith('a1', 'l1', { forceRegenerate: true });

    await generateMvpRequest({ auditId: 'a2', leadId: 'l2' });
    expect(spy).toHaveBeenLastCalledWith('a2', 'l2', { forceRegenerate: false });
  });

  it('generateMvpRequest propagates API rejections to the mutation', async () => {
    vi.spyOn(apiClient, 'generateMvp').mockRejectedValue(new Error('conflict'));
    await expect(generateMvpRequest({ auditId: 'a1', forceRegenerate: true })).rejects.toThrow('conflict');
  });

  it('offers regeneration only for leads with an MVP that has not gone out', () => {
    for (const status of ['NEEDS_APPROVAL', 'MVP_READY', 'AWAITING_APPROVAL', 'APPROVED'] as const) {
      expect(canRegenerateMvp(status)).toBe(true);
    }
    for (const status of ['AUDITED', 'GENERATING', 'SCHEDULED', 'SENT', 'DISPATCHED', 'REPLIED', 'REJECTED'] as const) {
      expect(canRegenerateMvp(status)).toBe(false);
    }
    expect(canRegenerateMvp(undefined)).toBe(false);
  });

  it('withPreviewVersion cache-busts the preview URL with the generation time', () => {
    const url = 'http://localhost:9000/revamp-demos/v/smile-123456/index.html';
    const at = '2026-09-26T18:00:00.000Z';

    expect(withPreviewVersion(url, at)).toBe(`${url}?v=${Date.parse(at)}`);
    // Replaces an existing version instead of stacking them
    expect(withPreviewVersion(`${url}?v=1`, at)).toBe(`${url}?v=${Date.parse(at)}`);
    expect(withPreviewVersion(url, undefined)).toBe(url);
    expect(withPreviewVersion(url, 'not-a-date')).toBe(url);
    expect(withPreviewVersion(undefined, at)).toBe('');
    expect(withPreviewVersion('/relative/index.html', at)).toBe(`/relative/index.html?v=${Date.parse(at)}`);
  });
});
