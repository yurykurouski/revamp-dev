import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Chip, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckIcon from '@mui/icons-material/Check';
import { useTranslation } from 'react-i18next';
import type { IEmailDraft, ILeadItem } from '../../api/client.js';
import {
  useApproveOutreachMutation,
  useAuditQuery,
  useMvpQuery,
  useRejectLeadMutation,
  useSendTestEmailMutation,
} from '../../hooks/useLeads.js';
import { useEmailDraft } from '../../hooks/useEmailDraft.js';
import { criticalIssueFields } from '../../utils/completeness.js';
import { isDashboardNiche } from '../../i18n/niches.js';
import { EmailDraftEditor } from '../EmailDraftEditor.js';
import { AuditStep, NOT_MEASURED } from './AuditStep.js';
import { PrototypeStep } from './PrototypeStep.js';
import { ReviewActionBar } from './ReviewActionBar.js';
import { nextStep, previousStep, REVIEW_STEPS, ReviewStep } from './steps.js';

interface LeadReviewProps {
  lead: ILeadItem;
  /** Leaves the review; also called after the lead is rejected */
  onClose?: () => void;
  /** Called once outreach is approved or the lead rejected, e.g. so the review queue can confirm it (REV-79) */
  onDecision?: (decision: ReviewDecision) => void;
  /** The lead name's heading level; `h2` when the review sits under a page heading (REV-79) */
  headingComponent?: 'h1' | 'h2';
  /** Controls shown at the end of the header, e.g. the review queue's open-full-screen button (REV-89) */
  headerActions?: React.ReactNode;
}

export type ReviewDecision = 'approved' | 'rejected';

const tabId = (step: ReviewStep) => `lead-review-tab-${step}`;
const panelId = (step: ReviewStep) => `lead-review-panel-${step}`;

/**
 * One lead's review as three steps, one on screen at a time (REV-77): 1 Audit, 2 Prototype, 3 Email.
 * All steps stay mounted, so the prototype keeps its state and the email its unsaved edits while the
 * operator moves between them; approving outreach is offered on the email step only (HITL).
 * Key it by the lead id so another lead starts on the first step with a fresh draft.
 */
export const LeadReview: React.FC<LeadReviewProps> = ({ lead, onClose, onDecision, headingComponent = 'h1', headerActions }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<ReviewStep>('audit');

  const { data: audit, isLoading: isAuditLoading, error: auditError } = useAuditQuery(lead.auditId || lead.id);
  const { data: mvp } = useMvpQuery(lead.id);
  // A generation that publishes the lead's MVP is fetched at once, also the first one, which the query had
  // answered with none (REV-132)
  const queryClient = useQueryClient();
  const generated = useRef({ id: lead.id, at: lead.mvpGeneratedAt });
  useEffect(() => {
    const previous = generated.current;
    generated.current = { id: lead.id, at: lead.mvpGeneratedAt };
    if (previous.id === lead.id && previous.at !== lead.mvpGeneratedAt) {
      void queryClient.invalidateQueries({ queryKey: ['mvp', lead.id] });
    }
  }, [lead.id, lead.mvpGeneratedAt, queryClient]);
  const draft = useEmailDraft(lead, audit);

  const approveMutation = useApproveOutreachMutation();
  const sendTestMutation = useSendTestEmailMutation();
  const rejectMutation = useRejectLeadMutation();

  const handleApprove = async (emailData: IEmailDraft) => {
    await approveMutation.mutateAsync({ leadId: lead.id, emailData });
    onDecision?.('approved');
  };

  const handleSendTest = async (testEmail: string, emailDraft: IEmailDraft) => {
    await sendTestMutation.mutateAsync({ leadId: lead.id, testEmail, draft: emailDraft });
  };

  const handleReject = async (reason: string) => {
    await rejectMutation.mutateAsync({ leadId: lead.id, reason });
    onDecision?.('rejected');
    onClose?.();
  };

  const goTo = (target: ReviewStep | null) => {
    if (target) setStep(target);
  };

  const stepIndex = REVIEW_STEPS.indexOf(step);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%', minHeight: 0 }}>
      {/* Lead header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          {onClose && (
            <Tooltip title={t('review.close')}>
              <IconButton onClick={onClose} aria-label={t('review.close')} size="small">
                <ArrowBackIcon />
              </IconButton>
            </Tooltip>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="h5" component={headingComponent} sx={{ fontWeight: 700 }}>
                {lead.businessName}
              </Typography>
              {lead.niche && (
                <Chip
                  label={isDashboardNiche(lead.niche) ? t(`niches.${lead.niche}`) : lead.niche}
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />
              )}
              {lead.city && (
                <Typography variant="body2" color="text.secondary">
                  {lead.city}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('inspector.original', { url: lead.originalUrl || lead.domain })}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {/* The original site's audit score; no MVP score is measured, so none is shown */}
          <Chip label={t('inspector.originalScore', { score: lead.totalScore ?? NOT_MEASURED })} size="small" color="error" />
          {headerActions}
        </Box>
      </Box>

      {/* Steps */}
      <Tabs
        value={step}
        onChange={(_e, value: ReviewStep) => setStep(value)}
        aria-label={t('review.stepsLabel')}
        sx={{ borderBottom: '1px solid', borderColor: 'divider', minHeight: 40 }}
      >
        {REVIEW_STEPS.map((s, idx) => (
          <Tab
            key={s}
            value={s}
            id={tabId(s)}
            aria-controls={panelId(s)}
            iconPosition="start"
            icon={
              idx < stepIndex ? (
                <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} />
              ) : (
                <Box component="span" aria-hidden sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {idx + 1}
                </Box>
              )
            }
            label={t(`review.steps.${s}`)}
            sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700, gap: 0.5 }}
          />
        ))}
      </Tabs>

      {/* The current step; the others stay mounted but hidden */}
      <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        {REVIEW_STEPS.map((s) => (
          <Box
            key={s}
            role="tabpanel"
            id={panelId(s)}
            aria-labelledby={tabId(s)}
            hidden={step !== s}
            sx={{ height: s === 'email' ? undefined : { lg: '100%' } }}
          >
            {s === 'audit' && <AuditStep audit={audit} mvp={mvp} isLoading={isAuditLoading} error={auditError} />}
            {s === 'prototype' && <PrototypeStep lead={lead} audit={audit} mvp={mvp} />}
            {s === 'email' && <EmailDraftEditor lead={lead} draft={draft} />}
          </Box>
        ))}
      </Box>

      <ReviewActionBar
        lead={lead}
        step={step}
        onBack={() => goTo(previousStep(step))}
        onNext={() => goTo(nextStep(step))}
        getDraft={draft.rendered}
        onApprove={handleApprove}
        onSendTest={handleSendTest}
        onReject={handleReject}
        isActionLoading={approveMutation.isPending || sendTestMutation.isPending || rejectMutation.isPending}
        criticalDataIssues={criticalIssueFields(mvp?.completenessReport, lead.completeness)}
      />
    </Box>
  );
};
