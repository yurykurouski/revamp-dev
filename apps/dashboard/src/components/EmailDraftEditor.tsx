import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Chip,
  Card,
  CardContent,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import DoDisturbIcon from '@mui/icons-material/DoDisturb';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { CompletenessField } from '@revamp/shared-types';
import { ILeadItem, IAuditDetail } from '../api/client.js';
import { useTranslation } from 'react-i18next';
import type { Translation } from '../i18n/locales/en.js';

interface EmailDraftEditorProps {
  lead: ILeadItem;
  audit?: IAuditDetail | null;
  onApprove: (emailData: { subject: string; preheader: string; body: string }) => Promise<void>;
  onSendTest: (testEmail: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  isActionLoading?: boolean;
  /** Critical business data the MVP lost or changed; approving then needs an extra confirmation (REV-36) */
  criticalDataIssues?: CompletenessField[];
}

const TEMPLATE_VARIABLES: Array<keyof Translation['email']['variables']> = [
  'businessName',
  'city',
  'demoUrl',
  'score',
  'lcpSeconds',
  'criticalFlaws',
];

export const EmailDraftEditor: React.FC<EmailDraftEditorProps> = ({
  lead,
  audit,
  onApprove,
  onSendTest,
  onReject,
  isActionLoading = false,
  criticalDataIssues = [],
}) => {
  const { t } = useTranslation();
  // The draft itself is outreach copy for the business owner, so it is not tied to the operator's UI language
  const defaultSubject = `A new mobile website for ${lead.businessName} (higher conversion, faster LCP)`;
  const defaultPreheader = `We built an interactive prototype on a modern Bento stack${lead.city ? ` for ${lead.city}` : ''}`;
  const defaultBody = `Hello,

We took a look at your website ${lead.domain}. According to our automated express audit, the current mobile version loads in ${audit?.lcpSeconds ?? 3.4}s (LCP) and has a few mobile layout issues.

To show what a modern, high-converting site could look like, our platform automatically generated a responsive Bento prototype for you:
👉 {{demoUrl}}

Key improvements in the prototype:
1. Instant loading (LCP < 1.8s) and a 96/100 quality score
2. One-tap booking from any mobile device
3. A responsive services grid that keeps your brand identity

We would love to hear your feedback!
Best regards, the Revamp SaaS team`;

  const [subject, setSubject] = useState(defaultSubject);
  const [preheader, setPreheader] = useState(defaultPreheader);
  const [body, setBody] = useState(defaultBody);

  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('operator@revamp.io');
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(() => t('email.defaultRejectReason'));
  const [successAlert, setSuccessAlert] = useState<string | null>(null);
  const [dataConfirmOpen, setDataConfirmOpen] = useState(false);

  // Substitute variables for preview
  const demoUrl = lead.previewUrl || `http://localhost:9000/revamp-demos/v/${lead.domain}/index.html`;

  const renderSubstitutedText = (text: string): string => {
    return text
      .replace(/{{businessName}}/g, lead.businessName)
      .replace(/{{city}}/g, lead.city || 'your city')
      .replace(/{{demoUrl}}/g, demoUrl)
      .replace(/{{score}}/g, `${lead.totalScore ?? 42}/100`)
      .replace(/{{lcpSeconds}}/g, `${audit?.lcpSeconds ?? 3.4}s`)
      .replace(
        /{{criticalFlaws}}/g,
        audit?.criticalFlaws.map((f, i) => `${i + 1}. ${f.title}`).join('\n') ||
          '1. Slow LCP loading\n2. WCAG contrast errors',
      );
  };

  const handleInsertTag = (tag: string) => {
    setBody((prev) => `${prev} ${tag}`);
  };

  const approve = async () => {
    await onApprove({ subject, preheader, body });
    setSuccessAlert(t('email.approved'));
  };

  // Missing or changed critical business data needs an explicit extra confirmation (REV-36)
  const handleApproveSubmit = async () => {
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
    await onSendTest(testEmail);
    setTestDialogOpen(false);
    setSuccessAlert(t('email.testSent', { email: testEmail }));
  };

  const handleRejectSubmit = async () => {
    await onReject(rejectReason);
    setRejectDialogOpen(false);
  };

  // Keyboard shortcut: Cmd + Enter / Ctrl + Enter triggers manual approval
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleApproveSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [subject, preheader, body, criticalDataIssues]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {successAlert && (
        <Alert
          severity="success"
          onClose={() => setSuccessAlert(null)}
          sx={{ borderRadius: 2 }}
        >
          {successAlert}
        </Alert>
      )}

      {/* Split layout: Editor on Left, Recipient Preview on Right */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' },
          gap: 3,
          flexGrow: 1,
          overflowY: 'auto',
          p: 1,
        }}
      >
        {/* LEFT: Email Draft Inputs */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <MailOutlineIcon color="primary" />
            {t('email.editorTitle')}
          </Typography>

          <TextField
            label={t('email.subject')}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            fullWidth
            size="small"
            required
            helperText={t('email.subjectHelper')}
          />

          <TextField
            label={t('email.preheader')}
            value={preheader}
            onChange={(e) => setPreheader(e.target.value)}
            fullWidth
            size="small"
            helperText={t('email.preheaderHelper')}
          />

          {/* Template variable pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              {t('email.insertVariable')}
            </Typography>
            {TEMPLATE_VARIABLES.map((variable) => (
              <Chip
                key={variable}
                label={t(`email.variables.${variable}`)}
                size="small"
                onClick={() => handleInsertTag(`{{${variable}}}`)}
                clickable
                sx={{
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  backgroundColor: 'action.hover',
                }}
              />
            ))}
          </Box>

          <TextField
            label={t('email.body')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            multiline
            rows={12}
            fullWidth
            sx={{
              '& .MuiInputBase-root': {
                fontFamily: 'inherit',
                fontSize: '0.9rem',
                lineHeight: 1.6,
              },
            }}
          />
        </Box>

        {/* RIGHT: Live Recipient Email Client Mock */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <VisibilityIcon color="action" />
            {t('email.previewTitle')}
          </Typography>

          {/* Email client shell */}
          <Card
            sx={{
              borderRadius: 3,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
              overflow: 'hidden',
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
            }}
          >
            {/* Mail client header bar */}
            <Box
              sx={{
                p: 2,
                backgroundColor: '#F8FAFC',
                borderBottom: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0F172A' }}>
                {renderSubstitutedText(subject)}
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      backgroundColor: '#4F46E5',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    R
                  </Box>
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#0F172A', display: 'block' }}>
                      Revamp SaaS &lt;outreach@revampdemo.com&gt;
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#64748B' }}>
                      {t('email.to')} {lead.phone || t('email.businessOwner')} &lt;info@{lead.domain}&gt;
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                  {t('email.justNow')}
                </Typography>
              </Box>
            </Box>

            {/* Email message body */}
            <CardContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.7,
                  color: '#334155',
                  fontSize: '0.925rem',
                }}
              >
                {renderSubstitutedText(body)}
              </Typography>

              {/* Embedded Comparison Banner Collage Preview */}
              {lead.comparisonBannerUrl && (
                <Box sx={{ my: 1 }}>
                  <Typography variant="caption" sx={{ color: '#64748B', fontWeight: 600, mb: 0.5, display: 'block' }}>
                    {t('email.attachment')}
                  </Typography>
                  <Box
                    component="img"
                    src={lead.comparisonBannerUrl}
                    alt={t('email.comparisonAlt')}
                    sx={{
                      width: '100%',
                      maxHeight: 180,
                      objectFit: 'cover',
                      borderRadius: 2,
                      border: '1px solid #CBD5E1',
                    }}
                  />
                </Box>
              )}

              {/* Call to action button */}
              <Box sx={{ pt: 1 }}>
                <Button
                  variant="contained"
                  href={demoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                  sx={{
                    backgroundColor: '#4F46E5',
                    color: '#FFFFFF',
                    px: 3,
                    py: 1,
                    fontWeight: 700,
                    textTransform: 'none',
                    borderRadius: 2,
                    '&:hover': {
                      backgroundColor: '#4338CA',
                    },
                  }}
                >
                  {t('email.viewPrototype')}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* Action Toolbar */}
      <Box
        sx={{
          p: 2,
          backgroundColor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            icon={<CheckCircleOutlineIcon sx={{ fontSize: 16 }} />}
            label={t('email.shortcut')}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 600, color: 'text.secondary' }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            color="error"
            variant="outlined"
            startIcon={<DoDisturbIcon />}
            onClick={() => setRejectDialogOpen(true)}
            disabled={isActionLoading}
            sx={{ fontWeight: 600 }}
          >
            {t('email.reject')}
          </Button>

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

          <Button
            color="primary"
            variant="contained"
            startIcon={
              isActionLoading ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <SendIcon />
              )
            }
            onClick={handleApproveSubmit}
            disabled={isActionLoading}
            sx={{ px: 3, py: 1, fontWeight: 700 }}
          >
            {t('email.approve')}
          </Button>
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
          <Button onClick={handleSendTestSubmit} variant="contained" color="primary">
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
          <Button onClick={handleRejectSubmit} variant="contained" color="error">
            {t('email.confirmReject')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
