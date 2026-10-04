import {
  MODERNIZE_FAILURES,
  REBUILD_UNAVAILABLE_REASONS,
  type IMvpRenderFailure,
  type ModernizeFailure,
  type RebuildUnavailableReason,
} from '@revamp/shared-types';
import type { IMvpProjectDetail } from '../api/client.js';

// The sentences for a render that needs a model and could not be made (REV-132): the rebuild with the vision
// model's failure or another reason, or the modernized look with the model's failure. Every word is an i18n
// template in all five locales.

export interface RenderFailureText {
  key: string;
  values?: Record<string, string | number>;
}

const isRebuildReason = (reason: string): reason is RebuildUnavailableReason =>
  (REBUILD_UNAVAILABLE_REASONS as readonly string[]).includes(reason);
const isModernizeFailure = (reason: string): reason is ModernizeFailure =>
  (MODERNIZE_FAILURES as readonly string[]).includes(reason);

/** The coverage percent in `coverage:<ratio>`, in the facts or a message */
const coveragePercent = (texts: string[]): number | undefined => {
  for (const text of texts) {
    const ratio = Number(text.match(/coverage:([0-9.]+)/)?.[1]);
    if (Number.isFinite(ratio)) return Math.round(ratio * 100);
  }
  return undefined;
};

/** Why the original site cannot be rebuilt, as the picker and the failure panel say it; undefined for an unknown reason */
export function rebuildRefusalText(
  reason: string,
  facts: string[] = [],
): RenderFailureText | undefined {
  if (!isRebuildReason(reason)) return undefined;
  if (reason.startsWith('grouping:'))
    return { key: `mvpLayout.rebuildRefused.grouping.${reason.slice('grouping:'.length)}` };
  const kind = reason.slice('rebuild:'.length);
  const percent = kind === 'low_coverage' ? coveragePercent(facts) : undefined;
  return {
    key: `mvpLayout.rebuildRefused.${kind}`,
    ...(percent !== undefined ? { values: { percent } } : {}),
  };
}

/** A render failure by its code and reason; undefined when the pair is not one the workers record */
export function renderFailureText(
  failure: Pick<IMvpRenderFailure, 'message'> & { code: string; reason: string },
): RenderFailureText | undefined {
  if (failure.code === 'MVP_MODERNIZE_UNAVAILABLE') {
    return isModernizeFailure(failure.reason)
      ? { key: `mvpLayout.level.unavailable.${failure.reason}` }
      : undefined;
  }
  if (failure.code === 'MVP_REBUILD_UNAVAILABLE')
    return rebuildRefusalText(failure.reason, failure.message ? [failure.message] : []);
  return undefined;
}

/**
 * Why the modernized look is not available for the MVP (REV-132): the last re-render's failure, else the model's
 * failure stored for the MVP's own audit. A design the model made, or a record from before REV-132, is not one.
 */
export function modernizeUnavailableReason(
  mvp: Pick<IMvpProjectDetail, 'auditId' | 'modernize' | 'renderFailure'> | null | undefined,
): ModernizeFailure | undefined {
  const failure = mvp?.renderFailure;
  if (failure?.code === 'MVP_MODERNIZE_UNAVAILABLE' && isModernizeFailure(failure.reason))
    return failure.reason;
  const stored = mvp?.modernize;
  if (
    stored?.source === 'failed' &&
    stored.error &&
    isModernizeFailure(stored.error) &&
    stored.auditId === mvp?.auditId
  )
    return stored.error;
  return undefined;
}
