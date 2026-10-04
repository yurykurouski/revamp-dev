import { describe, it, expect } from 'vitest';
import i18n from 'i18next';
import { MODERNIZE_FAILURES, REBUILD_UNAVAILABLE_REASONS } from '@revamp/shared-types';
import '../../i18n/index.js';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages.js';
import { modernizeUnavailableReason, rebuildRefusalText, renderFailureText } from '../renderFailure.js';

describe('render failure texts (REV-132)', () => {
  it('names every reason the rebuild cannot be made, with the coverage when it is known', () => {
    expect(rebuildRefusalText('grouping:not_configured')).toEqual({ key: 'mvpLayout.rebuildRefused.grouping.not_configured' });
    expect(rebuildRefusalText('grouping:rules_reading')).toEqual({ key: 'mvpLayout.rebuildRefused.grouping.rules_reading' });
    expect(rebuildRefusalText('rebuild:too_large')).toEqual({ key: 'mvpLayout.rebuildRefused.too_large' });
    expect(rebuildRefusalText('rebuild:low_coverage', ['coverage:0.72'])).toEqual({ key: 'mvpLayout.rebuildRefused.low_coverage', values: { percent: 72 } });
    expect(rebuildRefusalText('rebuild:other')).toBeUndefined();
  });

  it('names a failure by its code and reason, and reads the coverage from its message', () => {
    expect(renderFailureText({ code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'call_failed' })).toEqual({ key: 'mvpLayout.level.unavailable.call_failed' });
    expect(renderFailureText({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'grouping:ineligible' })).toEqual({ key: 'mvpLayout.rebuildRefused.grouping.ineligible' });
    expect(
      renderFailureText({ code: 'MVP_REBUILD_UNAVAILABLE', reason: 'rebuild:low_coverage', message: 'Rebuild unavailable: rebuild:low_coverage (coverage:0.6)' }),
    ).toEqual({ key: 'mvpLayout.rebuildRefused.low_coverage', values: { percent: 60 } });
    expect(renderFailureText({ code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'grouping:ineligible' })).toBeUndefined();
    expect(renderFailureText({ code: 'MVP_NOT_FOUND', reason: 'call_failed' })).toBeUndefined();
  });

  it.each([...SUPPORTED_LANGUAGES])('has a sentence for every reason in %s', (language) => {
    const texts = [
      ...REBUILD_UNAVAILABLE_REASONS.map((reason) => renderFailureText({ code: 'MVP_REBUILD_UNAVAILABLE', reason, message: 'coverage:0.5' })),
      ...MODERNIZE_FAILURES.map((reason) => renderFailureText({ code: 'MVP_MODERNIZE_UNAVAILABLE', reason })),
    ];
    for (const text of texts) {
      expect(text).toBeDefined();
      expect(i18n.exists(text!.key, { lng: language, fallbackLng: false })).toBe(true);
      expect(String(i18n.t(text!.key as never, { lng: language, ...text!.values } as never))).not.toMatch(/{{/);
    }
    for (const key of ['mvpFailure.title', 'mvpFailure.useTemplate', 'mvpFailure.useTemplateHint', 'mvpLayout.level.unavailableTitle']) {
      expect(i18n.exists(key, { lng: language, fallbackLng: false })).toBe(true);
    }
  });

  describe('modernizeUnavailableReason', () => {
    const auditId = 'a'.repeat(24);
    it("reads the model's failure stored for the MVP's own audit", () => {
      expect(modernizeUnavailableReason({ auditId, modernize: { auditId, source: 'failed', error: 'not_configured' } })).toBe('not_configured');
    });
    it('prefers the last re-render failure, which is newer', () => {
      expect(
        modernizeUnavailableReason({
          auditId,
          modernize: { auditId, source: 'failed', error: 'not_configured' },
          renderFailure: { code: 'MVP_MODERNIZE_UNAVAILABLE', reason: 'call_failed', at: '2026-10-04T12:00:00Z' },
        }),
      ).toBe('call_failed');
    });
    it('is undefined for a model-made design, a failure for another audit, or a record from before REV-132', () => {
      expect(modernizeUnavailableReason({ auditId, modernize: { auditId, source: 'llm', design: {} } })).toBeUndefined();
      expect(modernizeUnavailableReason({ auditId, modernize: { auditId: 'b'.repeat(24), source: 'failed', error: 'call_failed' } })).toBeUndefined();
      expect(modernizeUnavailableReason({ auditId, modernize: { auditId, source: 'default', design: {}, error: 'not_configured' } as never })).toBeUndefined();
      expect(modernizeUnavailableReason(null)).toBeUndefined();
    });
  });
});
