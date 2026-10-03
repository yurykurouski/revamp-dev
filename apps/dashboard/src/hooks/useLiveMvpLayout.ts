import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { MVP_LAYOUT_MODERNIZE_REASONS, MVP_LAYOUT_VARIANTS, MvpLayoutVariant, RebuildLevel } from '@revamp/shared-types';
import { canChangeMvpLayout } from '@revamp/validation';
import { ApiError, type ILeadItem, type IMvpProjectDetail } from '../api/client.js';
import { rebuildFallbackOf } from '../components/MvpLayoutChip.js';
import { UPDATE_MVP_LAYOUT_MUTATION_KEY, mvpRecordId, useUpdateMvpLayoutMutation } from './useLeads.js';

/** The rebuild level an MVP is rendered at (REV-114); an MVP from before levels is faithful */
const renderedLevelOf = (mvp: IMvpProjectDetail | null | undefined): RebuildLevel => mvp?.rebuild?.level ?? 'faithful';

/** The message the MVP page's own script handles to switch layouts in place (REV-84) */
export interface SetLayoutMessage {
  type: 'REVAMP_SET_LAYOUT';
  layout: MvpLayoutVariant;
  /** false: switch without the transition, e.g. to catch a freshly loaded page up */
  animate: boolean;
}

/** The layout an MVP is saved with; MVPs from before layouts were recorded are Bento (REV-54) */
export const savedMvpLayout = (mvp: IMvpProjectDetail | null | undefined): MvpLayoutVariant | undefined => {
  if (!mvp) return undefined;
  const variant = mvp.layout?.variant;
  return variant && MVP_LAYOUT_VARIANTS.includes(variant) ? variant : 'bento';
};

/**
 * A pick between the rebuilt original (REV-110) and a template changes the renderer: the published page
 * cannot switch in place, so the server re-renders it and the preview reloads
 */
const crossesRenderer = (a: MvpLayoutVariant | undefined, b: MvpLayoutVariant) => (a === 'original') !== (b === 'original');
/** How long the picker waits for a re-render across renderers before it stops polling */
const RERENDER_WAIT_MS = 90_000;
/** The workers' timeout for one model call (`EDIT_LLM_TIMEOUT_MS` in the workers' mvp-edit.service.ts) */
const MODEL_CALL_TIMEOUT_MS = 90_000;
/**
 * How long a level pick (REV-114) is waited for: a first switch to Modernized may ask the model twice (a
 * rejected answer is retried once) before the page renders, so two calls and a margin for the render
 */
export const LEVEL_RERENDER_WAIT_MS = 2 * MODEL_CALL_TIMEOUT_MS + 30_000;
/** How often the MVP is fetched while the page is re-rendered */
const RERENDER_POLL_MS = 2000;

/** The reasons the API gives for refusing a switch to the original site (`rebuildEligibility`) */
const REFUSAL_REASONS = ['rebuild:unread', 'rebuild:no_content', 'rebuild:low_coverage', 'rebuild:flat'] as const;
type RefusalReason = (typeof REFUSAL_REASONS)[number];
const isRefusalReason = (reason: string): reason is RefusalReason => (REFUSAL_REASONS as readonly string[]).includes(reason);
const refusalKind = (reason: RefusalReason) =>
  reason.slice('rebuild:'.length) as RefusalReason extends `rebuild:${infer Kind}` ? Kind : never;

/**
 * The message shown for a failed layout save. A refused switch to the original site says why it cannot
 * be rebuilt (REV-110), in the interface language; any other failure shows the server's message.
 */
function layoutSaveError(err: unknown, t: TFunction): string {
  if (err instanceof ApiError && err.code === 'MVP_REBUILD_UNAVAILABLE') {
    const details = (err.details ?? {}) as { reason?: unknown; facts?: unknown };
    const codes = [details.reason, ...(Array.isArray(details.facts) ? details.facts : [])].filter(
      (code): code is string => typeof code === 'string',
    );
    const fallback = rebuildFallbackOf(codes);
    if (fallback && isRefusalReason(fallback.reason)) {
      return t(`mvpLayout.rebuildRefused.${refusalKind(fallback.reason)}`, { percent: fallback.percent });
    }
  }
  return err instanceof Error ? err.message : String(err);
}

interface UseLiveMvpLayoutOptions {
  lead: Pick<ILeadItem, 'id' | 'status'>;
  mvp: IMvpProjectDetail | null | undefined;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/**
 * The operator's layout for the MVP in the Prototype step (REV-84). A pick shows in the sandboxed
 * preview at once, animated by the page itself, and is saved on the MVP record; a failed save puts the
 * saved layout back. The preview always follows the layout shown in the picker, including right after
 * the iframe (re)loads, while the server is still re-rendering the published page. A pick across
 * renderers (the rebuilt original and a template, REV-110) is not switched in place: the MVP is polled
 * until the re-published page arrives (`rerendering`), and the preview reloads with it.
 */
export function useLiveMvpLayout({ lead, mvp, iframeRef }: UseLiveMvpLayoutOptions) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useUpdateMvpLayoutMutation();
  // A pick belongs to one version of one MVP: another lead or a regeneration drops it
  const [pick, setPick] = useState<{ version: string; variant: MvpLayoutVariant } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mvpId = mvpRecordId(mvp);
  const version = `${mvpId}:${mvp?.generatedAt ?? ''}`;
  const saved = savedMvpLayout(mvp);
  // A re-render across renderers is waited for until the published renderer matches the saved layout
  // (a rebuild summary exactly when the layout is `original`) on an MVP that changed since the pick.
  // The save's own answer never matches, as the page is re-rendered after it; the worker's pass does,
  // whether the page switched (a new `editedAt`), the rebuild fell back to a template, or a later pick
  // made the switch unnecessary. The MVP from before the pick can still be shown for a render after the
  // save answers, so a settled MVP equal to it ends the wait only once the unsettled save echo was seen:
  // a repeated pick of the original can fall back to the very same template layout.
  const watched = `${version}:${mvp?.editedAt ?? ''}`;
  const shown = `${saved ?? ''}|${mvp?.layout?.reasons?.join(',') ?? ''}|${Boolean(mvp?.rebuild)}`;
  // A level pick (REV-114) is also waited for until the page is rendered at the picked level
  const [rerender, setRerender] = useState<{
    version: string;
    before: string;
    since: number;
    echoSeen: boolean;
    level?: RebuildLevel;
  } | null>(null);
  const settled =
    Boolean(mvp) &&
    Boolean(mvp?.rebuild) === (saved === 'original') &&
    (!rerender?.level || renderedLevelOf(mvp) === rerender.level);
  if (rerender && (rerender.version !== watched || (settled && (shown !== rerender.before || rerender.echoSeen)))) setRerender(null);
  else if (rerender && !rerender.echoSeen && mvp && !settled) setRerender({ ...rerender, echoSeen: true });
  const isSaving = useIsMutating({ mutationKey: UPDATE_MVP_LAYOUT_MUTATION_KEY }) > 0;
  const pending = pick?.version === version ? pick.variant : null;
  // The pick is shown until the MVP comes back saved with it; clearing it on the save's success
  // instead would show the old layout for a render and bounce the preview back and forth
  if (pick && (pick.version !== version || (!isSaving && pending === saved))) setPick(null);
  const layout = pending ?? saved;
  const savedLevel: RebuildLevel = mvp?.layout?.rebuildLevel ?? 'faithful';
  const [levelPick, setLevelPick] = useState<{ version: string; level: RebuildLevel } | null>(null);
  const pendingLevel = levelPick?.version === version ? levelPick.level : null;
  if (levelPick && (levelPick.version !== version || (!isSaving && pendingLevel === savedLevel))) setLevelPick(null);
  const level = pendingLevel ?? savedLevel;
  const reasons = mvp?.layout?.reasons ?? [];
  const levelReason = reasons.includes(MVP_LAYOUT_MODERNIZE_REASONS.fallback)
    ? ('defaultDesign' as const)
    : reasons.includes(MVP_LAYOUT_MODERNIZE_REASONS.dated)
      ? ('suggested' as const)
      : undefined;
  const canChange = Boolean(mvpId) && canChangeMvpLayout(lead.status);

  const post = useCallback(
    (message: SetLayoutMessage) => iframeRef.current?.contentWindow?.postMessage(message, '*'),
    [iframeRef],
  );

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // The page ignores a switch to the layout it already shows, so this is safe on every change; a pick
  // across renderers waits for the re-rendered page instead
  const inPlace = Boolean(layout) && !crossesRenderer(saved, layout!);
  useEffect(() => {
    if (layout && inPlace) post({ type: 'REVAMP_SET_LAYOUT', layout, animate: true });
  }, [layout, inPlace, post]);

  // Polls the MVP while its page is re-rendered, and gives up after a while
  const leadId = lead.id;
  useEffect(() => {
    if (!rerender) return;
    const waitMs = rerender.level ? LEVEL_RERENDER_WAIT_MS : RERENDER_WAIT_MS;
    const id = setInterval(() => {
      if (Date.now() - rerender.since > waitMs) setRerender(null);
      else void queryClient.invalidateQueries({ queryKey: ['mvp', leadId] });
    }, RERENDER_POLL_MS);
    return () => clearInterval(id);
  }, [rerender, queryClient, leadId]);

  /** Brings a freshly loaded preview to the shown layout, without the transition */
  const onFrameLoad = useCallback(() => {
    if (layoutRef.current) post({ type: 'REVAMP_SET_LAYOUT', layout: layoutRef.current, animate: false });
  }, [post]);

  const changeLayout = (variant: MvpLayoutVariant) => {
    if (!mvpId || !canChange || variant === layout) return;
    setPick({ version, variant });
    const crossing = crossesRenderer(layout, variant);
    const before = shown;
    mutation.mutate(
      { mvpId, leadId: lead.id, variant },
      {
        onSuccess: () => {
          if (crossing) setRerender({ version: watched, before, since: Date.now(), echoSeen: false });
        },
        // Only the latest pick reports back; its failure puts the saved layout back
        onError: (err) => {
          setPick(null);
          setError(layoutSaveError(err, t));
        },
      },
    );
  };

  /** Switches the rebuilt original between faithful and modernized (REV-114); the page is re-rendered */
  const changeLevel = (next: RebuildLevel) => {
    if (!mvpId || !canChange || layout !== 'original' || next === level) return;
    setLevelPick({ version, level: next });
    const before = shown;
    mutation.mutate(
      { mvpId, leadId: lead.id, variant: 'original', level: next },
      {
        onSuccess: () => setRerender({ version: watched, before, since: Date.now(), echoSeen: false, level: next }),
        onError: (err) => {
          setLevelPick(null);
          setError(layoutSaveError(err, t));
        },
      },
    );
  };

  return {
    layout,
    level,
    changeLevel,
    levelReason,
    canChange,
    changeLayout,
    onFrameLoad,
    rerendering: Boolean(rerender),
    error,
    clearError: () => setError(null),
  };
}
