import React from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client.js';
import { useOutboxQuery } from '../../hooks/useSender.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { formatDate } from '../../i18n/languages.js';
import { outboxSrcDoc } from '../../utils/outboxFrame.js';

interface OutboxDialogProps {
  leadId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * The email as the simulated delivery recorded it (REV-221): From the studio's sender, always labelled "Simulated – not
 * delivered". The body sits in a frame with an empty sandbox and a CSP that loads nothing, so opening it is never an
 * open or a click (the one email exception to the MVP iframe rule of the dashboard's AGENTS.md).
 */
export const OutboxDialog: React.FC<OutboxDialogProps> = ({ leadId, open, onClose }) => {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const { data, isLoading, error } = useOutboxQuery(leadId, open);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="outbox-title">
      <DialogTitle id="outbox-title" sx={{ fontWeight: 700 }}>
        {t('email.outbox.title')}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Box>
          <Chip color="warning" size="small" label={t('email.outbox.simulated')} data-testid="outbox-simulated-chip" />
        </Box>
        {isLoading && <CircularProgress size={24} />}
        {error &&
          (error instanceof ApiError && error.code === 'OUTBOX_NOT_FOUND' ? (
            <Alert severity="info" data-testid="outbox-missing">
              {t('email.outbox.missing')}
            </Alert>
          ) : (
            <Alert severity="error">{t('email.outbox.loadFailed', { error: error instanceof Error ? error.message : String(error) })}</Alert>
          ))}
        {data && (
          <>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5 }}>
              {(
                [
                  ['from', data.from],
                  ['to', data.to],
                  ['subject', data.subject],
                  ['sentAt', formatDate(data.sentAt, language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })],
                ] as const
              ).map(([key, value]) => (
                <React.Fragment key={key}>
                  <Typography component="dt" variant="body2" color="text.secondary">
                    {t(`email.outbox.${key}`)}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, wordBreak: 'break-word' }}>
                    {value}
                  </Typography>
                </React.Fragment>
              ))}
            </Box>
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', backgroundColor: 'common.white' }}>
              <iframe
                title={t('email.outbox.frame')}
                sandbox=""
                srcDoc={outboxSrcDoc(data.html)}
                style={{ width: '100%', height: 420, border: 'none', display: 'block' }}
              />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">
          {t('email.outbox.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
