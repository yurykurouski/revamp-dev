import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import DoDisturbIcon from '@mui/icons-material/DoDisturb';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import KeyboardIcon from '@mui/icons-material/Keyboard';
import type { CompletenessField } from '@revamp/shared-types';
import { canApproveOutreach, canRejectLead } from '@revamp/validation';
import { useTranslation } from 'react-i18next';
import type { IEmailDraft, ILeadItem } from '../../api/client.js';
import { REVIEW_STEPS, ReviewStep } from './steps.js';

/**
 * Approve sits where Next was, so it is armed only a moment after the email step opens: a double click
 * or a held Enter on Next never sends the email.
 */
export const APPROVE_ARM_DELAY_MS = 500;

interface ReviewActionBarProps {
  lead: ILeadItem;
  step: ReviewStep;
  onBack: () => void;
  onNext: () => void;
  /** The draft as the inbox preview shows it, with its variables substituted (REV-72) */
  getDraft: () => IEmailDraft;
  onApprove: (draft: IEmailDraft) => Promise<void>;
  /** Sends the draft to the operator's address (REV-60) */
  onSendTest: (testEmail: string, draft: IEmailDraft) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  isActionLoading?: boolean;
  /** Critical business data the MVP lost or changed; approving then needs an extra confirmation (REV-36) */
  criticalDataIssues?: CompletenessField[];
}

/**
 * The lead review's bottom bar (REV-77): one primary action per step (Next, Next, Approve & send), Reject on
 * every step, and the human-in-the-loop notice next to the approve button. Approve exists only on the email
 * step, so nothing is sent without the operator having seen the email.
 */
export const ReviewActionBar: React.FC<ReviewActionBarProps> = ({
  lead,
  step,
  onBack,
  onNext,
  getDraft,
  onApprove,
  onSendTest,
  onReject,
  isActionLoading = false,
  criticalDataIssues = [],
}) => {
  const { t } = useTranslation();
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('operator@revamp.io');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(() => t('email.defaultRejectReason'));
  const [successAlert, setSuccessAlert] = useState<string | null>(null);
  const [errorAlert, setErrorAlert] = useState<string | null>(null);
  const [dataConfirmOpen, setDataConfirmOpen] = useState(false);
  const [approveArmed, setApproveArmed] = useState(false);

  const isEmailStep = step === 'email';
  const stepNumber = REVIEW_STEPS.indexOf(step) + 1;
  // The API refuses approve/reject outside these statuses (REV-59), so neither is offered there
  const canApprove = canApproveOutreach(lead.status);
  const canReject = canRejectLead(lead.status);

  /** Runs an action and shows its failure instead of reporting a success that did not happen (REV-45) */
  const runAction = async (action: () => Promise<void>): Promise<boolean> => {
    setErrorAlert(null);
    try {
      await action();
      return true;
    } catch (err) {
      setSuccessAlert(null);
      setErrorAlert(t('email.actionFailed', { error: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  };

  useEffect(() => {
    setApproveArmed(false);
    if (!isEmailStep) return;
    const timer = setTimeout(() => setApproveArmed(true), APPROVE_ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isEmailStep]);

  const approve = async () => {
    if (await runAction(() => onApprove(getDraft()))) setSuccessAlert(t('email.approved'));
  };

  // Missing or changed critical business data needs an explicit extra confirmation (REV-36)
  const handleApproveSubmit = async () => {
    if (!isEmailStep || !approveArmed || !canApprove || isActionLoading) return;
    if (criticalDataIssues.length > 0) {
      setDataConfirmOpen(true);
      return;
    }
    await approve();
  };

  const handleDataConfirm = async () => {
    setDataConfirmOpen(false);
    await approve();
  };

  const handleSendTestSubmit = async () => {
    const draft = getDraft();
    // Close first: the outcome shows as an alert, and the opener stays disabled while the send runs
    setTestDialogOpen(false);
    const sent = await runAction(() => onSendTest(testEmail, draft));
    if (sent) setSuccessAlert(t('email.testSent', { email: testEmail }));
  };

  const handleRejectSubmit = async () => {
    await runAction(() => onReject(rejectReason));
    setRejectDialogOpen(false);
  };

  // Cmd + Enter / Ctrl + Enter approves, on the email step only
  useEffect(() => {
    if (!isEmailStep) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleApproveSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Box sx={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {successAlert && (
        <Alert severity="success" onClose={() => setSuccessAlert(null)}>
          {successAlert}
        </Alert>
      )}
      {errorAlert && (
        <Alert severity="error" onClose={() => setErrorAlert(null)}>
          {errorAlert}
        </Alert>
      )}
      {isEmailStep && !canApprove && !successAlert && (
        <Alert severity="info" data-testid="outreach-status-notice">
          {t(canReject ? 'email.approveUnavailable' : 'email.outreachClosed', { status: lead.status })}
        </Alert>
      )}

      <Box
        data-testid="review-action-bar"
        sx={{
          px: 2.5,
          py: 1.5,
          backgroundColor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {t('review.stepOf', { step: stepNumber, total: REVIEW_STEPS.length })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isEmailStep ? t('inspector.hitlNotice') : t(`review.hints.${step}`)}
          </Typography>
          {isEmailStep && canApprove && (
            <Chip
              icon={<KeyboardIcon sx={{ fontSize: 16 }} />}
              label={t('email.shortcut')}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 600, color: 'text.secondary' }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {step !== 'audit' && (
            <Button color="inherit" startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ fontWeight: 600 }}>
              {t('review.back')}
            </Button>
          )}

          {isEmailStep && (
            <Button
              color="inherit"
              variant="outlined"
              startIcon={<MarkEmailReadIcon />}
              onClick={() => setTestDialogOpen(true)}
              disabled={isActionLoading}
              sx={{ fontWeight: 600 }}
            >
              {t('email.sendTestToMe')}
            </Button>
          )}

          <Button
            color="error"
            variant="outlined"
            startIcon={<DoDisturbIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={isActionLoading || !canReject}
            sx={{ fontWeight: 600 }}
          >
            {t('email.reject')}
          </Button>

          {/* Keyed by step, so the button remounts and focus never carries from Next to Approve */}
          {isEmailStep ? (
            <Button
              key="approve"
              color="primary"
              variant="contained"
              startIcon={isActionLoading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />}
              onClick={handleApproveSubmit}
              disabled={isActionLoading || !canApprove || !approveArmed}
              sx={{ px: 2 }}
            >
              {t('email.approve')}
            </Button>
          ) : (
            <Button
              key={`next-${step}`}
              color="primary"
              variant="contained"
              endIcon={<ArrowForwardIcon />}
              onClick={onNext}
              sx={{ px: 2 }}
            >
              {t(`review.next.${step}`)}
            </Button>
          )}
        </Box>
      </Box>

      {/* Test Email Dialog */}
      <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('email.testDialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('email.testDialogBody')}
          </Typography>
          <TextField
            label={t('email.recipient')}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            fullWidth
            required
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTestDialogOpen(false)} color="inherit">
            {t('email.cancel')}
          </Button>
          <Button
            onClick={handleSendTestSubmit}
            variant="contained"
            color="primary"
            disabled={isActionLoading || !testEmail.trim()}
            data-testid="send-test-submit"
          >
            {t('email.sendTest')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Approve despite missing business data (REV-36) */}
      <Dialog open={dataConfirmOpen} onClose={() => setDataConfirmOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, color: 'warning.main' }}>{t('completeness.confirmTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('completeness.confirmBody', {
              fields: criticalDataIssues.map((field) => t(`completeness.fields.${field}`)).join(', '),
            })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDataConfirmOpen(false)} color="inherit" autoFocus>
            {t('completeness.cancel')}
          </Button>
          <Button onClick={handleDataConfirm} variant="contained" color="warning">
            {t('completeness.confirmApprove')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Lead Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main' }}>{t('email.rejectDialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('email.rejectDialogBody')}
          </Typography>
          <TextField
            label={t('email.rejectReason')}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            required
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRejectDialogOpen(false)} color="inherit">
            {t('email.cancel')}
          </Button>
          <Button onClick={handleRejectSubmit} variant="contained" color="error" data-testid="reject-submit">
            {t('email.confirmReject')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
