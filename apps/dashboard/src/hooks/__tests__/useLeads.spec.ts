import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from '../../api/client.js';
import { canRegenerateMvp, generateMvpRequest, mvpPreviewVersion, mvpRecordId, withPreviewVersion } from '../useLeads.js';

describe('MVP regeneration helpers (REV-31)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generateMvpRequest forwards forceRegenerate to the API client', async () => {
    const spy = vi.spyOn(apiClient, 'generateMvp').mockResolvedValue({ success: true, status: 'GENERATING' });

    await generateMvpRequest({ auditId: 'a1', leadId: 'l1', forceRegenerate: true });
    expect(spy).toHaveBeenCalledWith('a1', { forceRegenerate: true });

    await generateMvpRequest({ auditId: 'a2', leadId: 'l2' });
    expect(spy).toHaveBeenLastCalledWith('a2', { forceRegenerate: false });
  });

  it('generateMvpRequest forwards the provider and model, and never a model alone (REV-32)', async () => {
    const spy = vi.spyOn(apiClient, 'generateMvp').mockResolvedValue({ success: true, status: 'GENERATING' });

    await generateMvpRequest({ auditId: 'a1', leadId: 'l1', provider: 'gemini', model: 'gemini-1.5-flash' });
    expect(spy).toHaveBeenLastCalledWith('a1', {
      forceRegenerate: false,
      provider: 'gemini',
      model: 'gemini-1.5-flash',
    });

    await generateMvpRequest({ auditId: 'a1', leadId: 'l1', provider: 'claude-cli' });
    expect(spy).toHaveBeenLastCalledWith('a1', { forceRegenerate: false, provider: 'claude-cli' });

    await generateMvpRequest({ auditId: 'a1', leadId: 'l1', model: 'opus' });
    expect(spy).toHaveBeenLastCalledWith('a1', { forceRegenerate: false });
  });

  it('generateMvpRequest propagates API rejections to the mutation', async () => {
    vi.spyOn(apiClient, 'generateMvp').mockRejectedValue(new Error('conflict'));
    await expect(generateMvpRequest({ auditId: 'a1', forceRegenerate: true })).rejects.toThrow('conflict');
  });

  it('offers regeneration only for leads with an MVP that has not gone out', () => {
    for (const status of ['NEEDS_APPROVAL'] as const) {
      expect(canRegenerateMvp(status)).toBe(true);
    }
    for (const status of ['AUDITED', 'GENERATING', 'SCHEDULED', 'SENT', 'ENGAGED', 'REJECTED', 'UNSUBSCRIBED'] as const) {
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

describe('mvpPreviewVersion (REV-85)', () => {
  const generated = '2026-09-27T10:00:00.000Z';
  const edited = '2026-09-28T07:00:00.000Z';

  it('is the generation time until a free-text change re-publishes the page', () => {
    expect(mvpPreviewVersion({ mvpGeneratedAt: generated }, { generatedAt: generated })).toBe(generated);
    expect(mvpPreviewVersion({ mvpGeneratedAt: generated }, { generatedAt: generated, editedAt: edited })).toBe(edited);
  });

  it('goes back to the generation time when a regeneration follows the change', () => {
    const regenerated = '2026-09-28T09:00:00.000Z';
    expect(mvpPreviewVersion({ mvpGeneratedAt: regenerated }, { generatedAt: generated, editedAt: edited })).toBe(regenerated);
  });

  it('uses whichever time it has', () => {
    expect(mvpPreviewVersion({}, { generatedAt: generated })).toBe(generated);
    expect(mvpPreviewVersion({}, { editedAt: edited })).toBe(edited);
    expect(mvpPreviewVersion({}, null)).toBeUndefined();
  });
});

describe('mvpRecordId (REV-65)', () => {
  it('returns the MVP record id, preferring id over _id', () => {
    expect(mvpRecordId({ id: 'mvp-1', _id: 'mvp-raw' })).toBe('mvp-1');
    expect(mvpRecordId({ _id: 'mvp-raw' })).toBe('mvp-raw');
  });

  it('returns undefined when there is no MVP yet, so nothing is saved against the lead id', () => {
    expect(mvpRecordId(null)).toBeUndefined();
    expect(mvpRecordId(undefined)).toBeUndefined();
    expect(mvpRecordId({})).toBeUndefined();
  });
});
