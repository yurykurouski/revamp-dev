import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { MVP_LAYOUT_VARIANTS, MvpLayoutVariant } from '@revamp/shared-types';
import { canChangeMvpLayout } from '@revamp/validation';
import type { ILeadItem, IMvpProjectDetail } from '../api/client.js';
import { UPDATE_MVP_LAYOUT_MUTATION_KEY, mvpRecordId, useUpdateMvpLayoutMutation } from './useLeads.js';

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

interface UseLiveMvpLayoutOptions {
  lead: Pick<ILeadItem, 'id' | 'status'>;
  mvp: IMvpProjectDetail | null | undefined;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/**
 * The operator's layout for the MVP in the Prototype step (REV-84). A pick shows in the sandboxed
 * preview at once, animated by the page itself, and is saved on the MVP record; a failed save puts the
 * saved layout back. The preview always follows the layout shown in the picker, including right after
 * the iframe (re)loads, while the server is still re-rendering the published page.
 */
export function useLiveMvpLayout({ lead, mvp, iframeRef }: UseLiveMvpLayoutOptions) {
  const mutation = useUpdateMvpLayoutMutation();
  // A pick belongs to one version of one MVP: another lead or a regeneration drops it
  const [pick, setPick] = useState<{ version: string; variant: MvpLayoutVariant } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mvpId = mvpRecordId(mvp);
  const version = `${mvpId}:${mvp?.generatedAt ?? ''}`;
  const saved = savedMvpLayout(mvp);
  const isSaving = useIsMutating({ mutationKey: UPDATE_MVP_LAYOUT_MUTATION_KEY }) > 0;
  const pending = pick?.version === version ? pick.variant : null;
  // The pick is shown until the MVP comes back saved with it; clearing it on the save's success
  // instead would show the old layout for a render and bounce the preview back and forth
  if (pick && (pick.version !== version || (!isSaving && pending === saved))) setPick(null);
  const layout = pending ?? saved;
  const canChange = Boolean(mvpId) && canChangeMvpLayout(lead.status);

  const post = useCallback(
    (message: SetLayoutMessage) => iframeRef.current?.contentWindow?.postMessage(message, '*'),
    [iframeRef],
  );

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // The page ignores a switch to the layout it already shows, so this is safe on every change
  useEffect(() => {
    if (layout) post({ type: 'REVAMP_SET_LAYOUT', layout, animate: true });
  }, [layout, post]);

  /** Brings a freshly loaded preview to the shown layout, without the transition */
  const onFrameLoad = useCallback(() => {
    if (layoutRef.current) post({ type: 'REVAMP_SET_LAYOUT', layout: layoutRef.current, animate: false });
  }, [post]);

  const changeLayout = (variant: MvpLayoutVariant) => {
    if (!mvpId || !canChange || variant === layout) return;
    setPick({ version, variant });
    mutation.mutate(
      { mvpId, leadId: lead.id, variant },
      {
        // Only the latest pick reports back; its failure puts the saved layout back
        onError: (err) => {
          setPick(null);
          setError(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  return { layout, canChange, changeLayout, onFrameLoad, error, clearError: () => setError(null) };
}
