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
import { ILeadItem, IAuditDetail } from '../api/client.js';

interface EmailDraftEditorProps {
  lead: ILeadItem;
  audit?: IAuditDetail | null;
  onApprove: (emailData: { subject: string; preheader: string; body: string }) => Promise<void>;
  onSendTest: (testEmail: string) => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  isActionLoading?: boolean;
}

const TEMPLATE_VARIABLES = [
  { tag: '{{businessName}}', label: 'Company' },
  { tag: '{{city}}', label: 'City' },
  { tag: '{{demoUrl}}', label: 'Demo link' },
  { tag: '{{score}}', label: 'Score' },
  { tag: '{{lcpSeconds}}', label: 'LCP speed' },
  { tag: '{{criticalFlaws}}', label: 'Issues' },
];

export const EmailDraftEditor: React.FC<EmailDraftEditorProps> = ({
  lead,
  audit,
  onApprove,
  onSendTest,
  onReject,
  isActionLoading = false,
}) => {
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
  const [rejectReason, setRejectReason] = useState('Off-target niche / site closed');
  const [successAlert, setSuccessAlert] = useState<string | null>(null);

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

  const handleApproveSubmit = async () => {
    await onApprove({ subject, preheader, body });
    setSuccessAlert('Lead approved and moved to SCHEDULED!');
  };

  const handleSendTestSubmit = async () => {
    await onSendTest(testEmail);
    setTestDialogOpen(false);
    setSuccessAlert(`Test email sent to ${testEmail}`);
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
  }, [subject, preheader, body]);

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
            Email editor (Outreach Personalizer)
          </Typography>

          <TextField
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            fullWidth
            size="small"
            required
            helperText="A short, catchy subject line that mentions the business"
          />

          <TextField
            label="Preheader (preview text)"
            value={preheader}
            onChange={(e) => setPreheader(e.target.value)}
            fullWidth
            size="small"
            helperText="Shown next to the subject in the inbox list"
          />

          {/* Template variable pills */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>
              Insert variable:
            </Typography>
            {TEMPLATE_VARIABLES.map((v) => (
              <Chip
                key={v.tag}
                label={v.label}
                size="small"
                onClick={() => handleInsertTag(v.tag)}
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
            label="Email body"
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
            Recipient inbox preview
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
                      To: {lead.phone || 'Business owner'} &lt;info@{lead.domain}&gt;
                    </Typography>
                  </Box>
                </Box>

                <Typography variant="caption" sx={{ color: '#94A3B8' }}>
                  Just now
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
                    📎 Attachment: Before / After comparison (1200x630)
                  </Typography>
                  <Box
                    component="img"
                    src={lead.comparisonBannerUrl}
                    alt="Comparison Collage"
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
                  View the interactive prototype
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
            label="Shortcut: Cmd + Enter"
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
            Reject lead
          </Button>

          <Button
            color="inherit"
            variant="outlined"
            startIcon={<MarkEmailReadIcon />}
            onClick={() => setTestDialogOpen(true)}
            disabled={isActionLoading}
            sx={{ fontWeight: 600 }}
          >
            Send a test to myself
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
            Approve & send (HITL)
          </Button>
        </Box>
      </Box>

      {/* Test Email Dialog */}
      <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700 }}>Send test email</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The email will be sent to your work address for a final layout check before the real send.
          </Typography>
          <TextField
            label="Recipient email"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            fullWidth
            required
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setTestDialogOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleSendTestSubmit} variant="contained" color="primary">
            Send test
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reject Lead Dialog */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 700, color: 'error.main' }}>Reject lead</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Give a reason. The lead will be archived as REJECTED and no outreach will be sent.
          </Typography>
          <TextField
            label="Rejection reason"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            fullWidth
            required
            autoFocus
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRejectDialogOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleRejectSubmit} variant="contained" color="error">
            Confirm rejection
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
