import React, { RefObject, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import { mvpRecordId, useUpdateMvpTokensMutation } from '../../hooks/useLeads.js';
import { useLiveMvpLayout } from '../../hooks/useLiveMvpLayout.js';
import { ColorPickerToolbar } from '../ColorPickerToolbar.js';
import { MvpLayoutPicker } from '../MvpLayoutPicker.js';
import { FloatingToolsPanel } from './FloatingToolsPanel.js';

/** Used when neither the MVP nor the audit has a brand color */
const DEFAULT_PRIMARY = '#5c5bed';

interface UseMvpDesignToolsOptions {
  lead: Pick<ILeadItem, 'id' | 'status'>;
  audit?: IAuditDetail | null;
  mvp?: IMvpProjectDetail | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
}

/**
 * The live palette (REV-16, REV-90) and layout (REV-84) of an MVP shown in a sandboxed iframe. A pick is
 * posted to the preview at once and saved on the MVP record, which re-publishes the page. Shared by the
 * Prototype step and the full-window preview (REV-91).
 */
export function useMvpDesignTools({ lead, audit, mvp, iframeRef }: UseMvpDesignToolsOptions) {
  const updateTokensMutation = useUpdateMvpTokensMutation();
  const liveLayout = useLiveMvpLayout({ lead, mvp, iframeRef });
  const [currentColor, setCurrentColor] = useState<string>(DEFAULT_PRIMARY);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const originalPrimary = audit?.colorPalette?.primary;

  // The palette saved on the MVP (REV-90), else the audit's brand color. Taken again only when another
  // MVP version or audit arrives, so a late save response never pulls back a newer pick.
  const savedPrimary = mvp?.colorPalette?.primary || originalPrimary;
  const paletteSource = `${mvpRecordId(mvp) ?? ''}|${mvp?.generatedAt ?? ''}|${originalPrimary ?? ''}`;
  const [syncedPaletteSource, setSyncedPaletteSource] = useState<string | null>(null);
  if (syncedPaletteSource !== paletteSource) {
    setSyncedPaletteSource(paletteSource);
    if (savedPrimary) setCurrentColor(savedPrimary);
  }

  const changeColor = (newColor: string) => {
    setCurrentColor(newColor);
    // Real-time live update inside iframe without reload
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'REVAMP_UPDATE_THEME', palette: { primary: newColor, accent: newColor } },
      '*',
    );
    // Saved against the MVP record, not the lead; a failed save is shown instead of passing silently (REV-65)
    const mvpId = mvpRecordId(mvp);
    if (!mvpId) return;
    updateTokensMutation.mutate(
      { mvpId, leadId: lead.id, tokens: { primaryColor: newColor, accentColor: newColor } },
      { onError: (err) => setTokensError(err instanceof Error ? err.message : String(err)) },
    );
  };

  return {
    hasMvp: Boolean(mvp),
    currentColor,
    originalPrimary,
    changeColor,
    resetColor: () => changeColor(originalPrimary || DEFAULT_PRIMARY),
    tokensError,
    clearTokensError: () => setTokensError(null),
    liveLayout,
  };
}

export type MvpDesignToolsState = ReturnType<typeof useMvpDesignTools>;

interface MvpDesignToolsProps {
  tools: MvpDesignToolsState;
  /** No preview to change yet, or a regeneration owns it */
  locked: boolean;
}

/**
 * The Design tools panel floating over the preview (REV-88) with both pickers, and their save-error
 * notices. Rendered inside the positioned element that holds the sandboxed iframe, as its sibling.
 */
export const MvpDesignTools: React.FC<MvpDesignToolsProps> = ({ tools, locked }) => {
  const { t } = useTranslation();
  const { liveLayout } = tools;
  // A palette change re-publishes the MVP, so it follows the layout picker's lock (REV-90)
  const disabled = !liveLayout.canChange || locked;

  return (
    <>
      <FloatingToolsPanel>
        <ColorPickerToolbar
          currentPrimary={tools.currentColor}
          originalPrimary={tools.originalPrimary}
          onColorChange={tools.changeColor}
          onReset={tools.resetColor}
          disabled={disabled}
          disabledReason={t('colorPicker.locked')}
        />
        {tools.hasMvp && (
          <MvpLayoutPicker
            value={liveLayout.layout}
            onChange={liveLayout.changeLayout}
            disabled={disabled}
            disabledReason={t('mvpLayout.locked')}
          />
        )}
      </FloatingToolsPanel>

      <Snackbar
        open={Boolean(tools.tokensError)}
        autoHideDuration={6000}
        onClose={tools.clearTokensError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={tools.clearTokensError}>
          {t('colorPicker.saveFailed', { message: tools.tokensError ?? '' })}
        </Alert>
      </Snackbar>
      <Snackbar
        open={Boolean(liveLayout.error)}
        autoHideDuration={6000}
        onClose={liveLayout.clearError}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={liveLayout.clearError}>
          {t('mvpLayout.saveFailed', { message: liveLayout.error ?? '' })}
        </Alert>
      </Snackbar>
    </>
  );
};
