import React from 'react';
import { Box, Typography, TextField, Button, Chip, Card, CardContent } from '@mui/material';
import { alpha } from '@mui/material/styles';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { ILeadItem } from '../api/client.js';
import { useTranslation } from 'react-i18next';
import type { Translation } from '../i18n/locales/en.js';
import type { EmailDraft } from '../hooks/useEmailDraft.js';
import { RADIUS, TOKENS } from '../theme/theme.js';

/** The recipient preview mimics a light inbox in both dashboard modes, colored by the light tokens */
const INBOX = TOKENS.light;

interface EmailDraftEditorProps {
  lead: ILeadItem;
  /** The draft, owned by the lead review so it survives moving between steps (REV-77) */
  draft: EmailDraft;
}

const TEMPLATE_VARIABLES: Array<keyof Translation['email']['variables']> = [
  'businessName',
  'city',
  'demoUrl',
  'score',
  'lcpSeconds',
  'criticalFlaws',
];

/** The outreach email editor with a live inbox preview; approving and rejecting live in the review's action bar */
export const EmailDraftEditor: React.FC<EmailDraftEditorProps> = ({ lead, draft }) => {
  const { t } = useTranslation();
  const { subject, preheader, body, setSubject, setPreheader, setBody, insertTag, renderText } = draft;
  const demoUrl = lead.previewUrl;

  return (
    // Split layout: editor on the left, recipient preview on the right
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 3 }}>
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
              onClick={() => insertTag(`{{${variable}}}`)}
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

      {/* RIGHT: Live preview of the email as the recipient sees it */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <VisibilityIcon color="action" />
          {t('email.previewTitle')}
        </Typography>

        {/* Email client shell */}
        <Card
          sx={{
            overflow: 'hidden',
            backgroundColor: INBOX.background.paper,
            color: INBOX.text.primary,
          }}
        >
          {/* Mail client header bar */}
          <Box
            sx={{
              p: 2,
              backgroundColor: INBOX.surface.raised,
              borderBottom: `1px solid ${INBOX.border.subtle}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: INBOX.text.primary }}>
              {renderText(subject)}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: INBOX.tones.primary,
                    color: INBOX.onTone.primary,
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
                  <Typography variant="caption" sx={{ fontWeight: 700, color: INBOX.text.primary, display: 'block' }}>
                    Revamp SaaS &lt;outreach@revampdemo.com&gt;
                  </Typography>
                  <Typography variant="caption" sx={{ color: INBOX.text.secondary }}>
                    {t('email.to')} {lead.phone || t('email.businessOwner')} &lt;info@{lead.domain}&gt;
                  </Typography>
                </Box>
              </Box>

              <Typography variant="caption" sx={{ color: INBOX.text.secondary }}>
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
                color: INBOX.text.primary,
                fontSize: '0.925rem',
              }}
            >
              {renderText(body)}
            </Typography>

            {/* Embedded Comparison Banner Collage Preview */}
            {lead.comparisonBannerUrl && (
              <Box sx={{ my: 1 }}>
                <Typography variant="caption" sx={{ color: INBOX.text.secondary, fontWeight: 600, mb: 0.5, display: 'block' }}>
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
                    borderRadius: `${RADIUS.md}px`,
                    border: `1px solid ${INBOX.border.strong}`,
                  }}
                />
              </Box>
            )}

            {/* Call to action button */}
            <Box sx={{ pt: 1 }}>
              <Button
                variant="contained"
                href={demoUrl ?? ''}
                disabled={!demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                sx={{
                  backgroundColor: INBOX.tones.primary,
                  color: INBOX.onTone.primary,
                  px: 3,
                  py: 1,
                  '&:hover': {
                    backgroundColor: alpha(INBOX.tones.primary, 0.88),
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
  );
};
