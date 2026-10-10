import React from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { IMvpGroundingFlag } from '@revamp/shared-types';

interface MvpGroundingFlagsProps {
  flags: IMvpGroundingFlag[];
  /** Scrolls the preview to the fact and outlines it */
  onShow: (text: string) => void;
}

/**
 * Facts on the page that the original site's copy does not contain (REV-140), found by code (`checkMvpGrounding`):
 * numbers and names the model may have made up. They are not rejected; the operator checks each in the preview.
 */
export const MvpGroundingFlags: React.FC<MvpGroundingFlagsProps> = ({ flags, onShow }) => {
  const { t } = useTranslation();
  if (flags.length === 0) return null;

  return (
    <Box sx={{ px: 2, pt: 1.5 }}>
      <Alert severity="warning" data-testid="mvp-grounding-flags" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
        <AlertTitle sx={{ fontWeight: 700 }}>{t('mvpPage.flags.title', { count: flags.length })}</AlertTitle>
        <Typography variant="caption" component="p" sx={{ mb: 1 }}>
          {t('mvpPage.flags.intro')}
        </Typography>
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {flags.map((flag, index) => (
            <Box component="li" key={`${flag.kind}-${flag.text}-${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip label={t(`mvpPage.flags.kinds.${flag.kind}`)} size="small" color="warning" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {flag.text}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {flag.context}
              </Typography>
              <Button size="small" variant="text" color="inherit" onClick={() => onShow(flag.text)}>
                {t('mvpPage.flags.show')}
              </Button>
            </Box>
          ))}
        </Box>
      </Alert>
    </Box>
  );
};
