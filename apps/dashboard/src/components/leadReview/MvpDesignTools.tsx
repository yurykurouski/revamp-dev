import React, { useState } from 'react';
import { Alert, Box, Divider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ApiError, type IAuditDetail, type ILeadItem, type IMvpProjectDetail } from '../../api/client.js';
import { MvpPageAction, mvpRecordId, useMvpPageMutation } from '../../hooks/useLeads.js';
import {
  brandColors,
  currentFontChoice,
  isModelDesigned,
  MVP_COLOR_ROLES,
  MvpText,
  pageResultText,
  seedColors,
  versionsNewestFirst,
} from '../../utils/mvpPage.js';
import { RegenerateMvpButton } from '../RegenerateMvpButton.js';
import { FloatingToolsPanel } from './FloatingToolsPanel.js';
import { MvpColorControls } from './MvpColorControls.js';
import { MvpEditPrompt } from './MvpEditPrompt.js';
import { MvpFontControl } from './MvpFontControl.js';
import { MvpVersionList } from './MvpVersionList.js';

interface UseMvpDesignToolsOptions {
  lead: Pick<ILeadItem, 'id' | 'status'>;
  audit?: IAuditDetail | null;
  mvp?: IMvpProjectDetail | null;
}

/** An action's answer or error, kept for the lead it was asked for */
interface Answer {
  leadId: string;
  outcome?: { text: MvpText; tone: 'success' | 'info' };
  error?: string;
  /** The API stopped waiting on a running job, which may still publish: its words are shown as they are */
  timedOut?: boolean;
}

/**
 * The operator's changes to a model-designed page (REV-140): a change in their words, colors and fonts, and a restore
 * of a version, one at a time. Each is answered once the page is re-published, or with why nothing was; the answer
 * and any error belong to the lead they were asked for, so switching leads never shows another lead's result. Shared
 * by the Prototype step and the full-window preview (REV-91).
 */
export function useMvpDesignTools({ lead, audit, mvp }: UseMvpDesignToolsOptions) {
  const mutation = useMvpPageMutation();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const mine = answer?.leadId === lead.id ? answer : null;
  const running = mutation.isPending && mutation.variables?.leadId === lead.id ? mutation.variables : undefined;

  /** Sends one action; `onApplied` runs once the page was re-published */
  const run = (action: MvpPageAction, onApplied?: () => void) => {
    const mvpId = mvpRecordId(mvp);
    if (!mvpId) return;
    const leadId = lead.id;
    setAnswer(null);
    mutation.mutate({ ...action, mvpId, leadId }, {
      onSuccess: (result) => {
        setAnswer({ leadId, outcome: { text: pageResultText(action.action, result), tone: result.applied ? 'success' : 'info' } });
        if (result.applied) onApplied?.();
      },
      onError: (err) =>
        setAnswer({ leadId, error: err instanceof Error ? err.message : String(err), timedOut: err instanceof ApiError && err.status === 504 }),
    });
  };

  return {
    hasMvp: Boolean(mvp),
    modelDesigned: isModelDesigned(mvp),
    /** The API changes the page only while the lead awaits review */
    canChange: lead.status === 'NEEDS_APPROVAL',
    colors: seedColors(mvp),
    colorsSaved: MVP_COLOR_ROLES.some((role) => Boolean(mvp?.controls?.[role])),
    brand: brandColors(audit),
    font: currentFontChoice(mvp),
    versions: versionsNewestFirst(mvp?.versions),
    run,
    pending: running?.action ?? null,
    pendingVersion: running?.action === 'restore' ? running.version : undefined,
    outcome: mine?.outcome ?? null,
    error: mine?.error ?? null,
    timedOut: Boolean(mine?.timedOut),
    clearAnswer: () => setAnswer(null),
  };
}

export type MvpDesignToolsState = ReturnType<typeof useMvpDesignTools>;

interface MvpDesignToolsProps {
  tools: MvpDesignToolsState;
  lead: Pick<ILeadItem, 'id' | 'auditId' | 'status' | 'businessName'>;
  /** No preview to change yet, or a regeneration owns it */
  locked: boolean;
}

/**
 * The Design tools panel floating over the preview (REV-88, REV-140): the change in the operator's words, colors,
 * fonts, versions and Regenerate. An MVP of the previous generator offers Regenerate only. Rendered inside the
 * positioned element that holds the sandboxed iframe, as its sibling.
 */
export const MvpDesignTools: React.FC<MvpDesignToolsProps> = ({ tools, lead, locked }) => {
  const { t } = useTranslation();
  if (!tools.hasMvp) return null;
  const busy = tools.pending !== null;
  const disabled = locked || !tools.canChange || busy;
  const disabledReason = busy ? t('mvpEdit.busy') : t('mvpEdit.locked');

  return (
    <FloatingToolsPanel>
      {tools.modelDesigned ? (
        <>
          <MvpEditPrompt
            edit={{ submit: (instruction, onApplied) => tools.run({ action: 'change', instruction }, onApplied), isPending: tools.pending === 'change' }}
            disabled={disabled}
            disabledReason={disabledReason}
          />
          {tools.colors && (
            <MvpColorControls
              seed={tools.colors}
              saved={tools.colorsSaved}
              brand={tools.brand}
              disabled={disabled}
              onApply={(colors) => tools.run({ action: 'controls', controls: { colors } })}
              onReset={() => tools.run({ action: 'controls', controls: { colors: null } })}
            />
          )}
          <MvpFontControl value={tools.font} disabled={disabled} onChange={(fonts) => tools.run({ action: 'controls', controls: { fonts } })} />
          {tools.outcome && (
            <Alert severity={tools.outcome.tone} onClose={tools.clearAnswer} data-testid="mvp-page-outcome" sx={{ py: 0 }}>
              {String(t(tools.outcome.text.key as never, tools.outcome.text.values as never))}
            </Alert>
          )}
          {tools.error && (
            <Alert severity={tools.timedOut ? 'warning' : 'error'} onClose={tools.clearAnswer} data-testid="mvp-page-error" sx={{ py: 0 }}>
              {tools.timedOut ? tools.error : t('mvpEdit.failed', { message: tools.error })}
            </Alert>
          )}
          <Divider flexItem />
          <MvpVersionList
            versions={tools.versions}
            disabled={disabled}
            pending={tools.pendingVersion}
            onRestore={(version) => tools.run({ action: 'restore', version })}
          />
        </>
      ) : (
        <Typography variant="caption" color="text.secondary" role="status" sx={{ maxWidth: 280 }}>
          {t('mvpPage.previousGenerator')}
        </Typography>
      )}
      <Box data-testid="mvp-regenerate">
        <RegenerateMvpButton lead={lead} variant="button" />
      </Box>
    </FloatingToolsPanel>
  );
};
