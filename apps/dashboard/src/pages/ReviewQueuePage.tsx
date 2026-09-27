import React, { useMemo } from 'react';
import { Box, Card, CircularProgress, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { leadPath, LeadLocationState, ROUTES } from '../routes/paths.js';
import { matchesBucket } from '../utils/leadStages.js';

/**
 * Review queue home (REV-76): the leads waiting for the operator. REV-79 turns it into the four-bucket
 * list with the lead next to it.
 */
export const ReviewQueuePage: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useLeadsQuery();
  const leads = useMemo(() => (data?.leads ?? []).filter((lead) => matchesBucket(lead.status, 'needs_you')), [data]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 720 }}>
      <Box>
        <Typography variant="h5" component="h1">
          {t('queue.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('queue.subtitle')}
        </Typography>
      </Box>

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Typography color="error.main">{t('leadsPage.loadFailed')}</Typography>
      ) : leads.length === 0 ? (
        <Card sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {t('queue.empty')}
          </Typography>
        </Card>
      ) : (
        <Card>
          <List disablePadding aria-label={t('buckets.needs_you')}>
            {leads.map((lead) => (
              <ListItemButton
                key={lead.id}
                component={RouterLink}
                to={leadPath(lead.id)}
                state={{ from: ROUTES.queue } satisfies LeadLocationState}
                divider
                sx={{ py: 1.5, px: 2.5, gap: 2, color: 'text.primary' }}
              >
                <ListItemText
                  primary={lead.businessName}
                  secondary={[lead.domain, lead.city].filter(Boolean).join(' · ')}
                  primaryTypographyProps={{ fontWeight: 600 }}
                />
                <Typography variant="caption" color={lead.status === 'AUDIT_FAILED' ? 'error.main' : 'warning.main'} sx={{ fontWeight: 600 }}>
                  {t(`statuses.${lead.status}`)}
                </Typography>
              </ListItemButton>
            ))}
          </List>
        </Card>
      )}
    </Box>
  );
};
