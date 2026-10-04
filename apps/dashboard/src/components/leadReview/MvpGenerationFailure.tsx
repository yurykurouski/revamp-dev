import React from 'react';
import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useTranslation } from 'react-i18next';
import type { ILeadItem } from '../../api/client.js';
import { useGenerateMvpMutation, useIsMvpGenerationPending } from '../../hooks/useLeads.js';
import { renderFailureText } from '../../utils/renderFailure.js';

interface MvpGenerationFailureProps {
  lead: Pick<ILeadItem, 'id' | 'auditId' | 'status' | 'generationFailure'>;
}

/** Whether the lead's last generation failed because a rebuild model gave no answer, and none runs now (REV-132) */
export const hasGenerationFailure = (
  lead: Pick<ILeadItem, 'status' | 'generationFailure'>,
): boolean => Boolean(lead.generationFailure) && lead.status !== 'GENERATING';

/**
 * Why the MVP was not generated (REV-132): the rebuild or its modernized look had no answer from the AI model, so
 * nothing was published in its place. Said in the interface language, with the one way forward the operator has
 * without the model: a generation from the Bento template. An MVP published before stays as it was.
 */
export const MvpGenerationFailure: React.FC<MvpGenerationFailureProps> = ({ lead }) => {
  const { t } = useTranslation();
  const generate = useGenerateMvpMutation();
  const isPending = useIsMvpGenerationPending(lead.id);
  const failure = lead.generationFailure;
  if (!failure || !hasGenerationFailure(lead)) return null;
  const text = renderFailureText(failure);

  return (
    // The theme's tinted alert sits on paper; the preview viewport behind it is always white
    <Box sx={{ bgcolor: 'background.paper', borderRadius: 1, maxWidth: 640, width: '100%' }}>
      <Alert
        severity="warning"
        data-testid="mvp-generation-failure"
        sx={{ textAlign: 'left', alignItems: 'flex-start' }}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>{t('mvpFailure.title')}</AlertTitle>
        {text && (
          <Typography variant="body2">
            {String(t(text.key as never, text.values as never))}
          </Typography>
        )}
        <Box
          sx={{
            mt: 1.5,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 0.5,
          }}
        >
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<DashboardCustomizeIcon sx={{ fontSize: 16 }} />}
            disabled={isPending}
            onClick={() =>
              generate.mutate({
                auditId: lead.auditId || lead.id,
                leadId: lead.id,
                // A lead with an MVP regenerates over it; a first generation does not
                forceRegenerate: lead.status !== 'AUDITED',
                layout: 'bento',
              })
            }
            sx={{ fontWeight: 600 }}
          >
            {t('mvpFailure.useTemplate')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('mvpFailure.useTemplateHint')}
          </Typography>
        </Box>
      </Alert>
    </Box>
  );
};
