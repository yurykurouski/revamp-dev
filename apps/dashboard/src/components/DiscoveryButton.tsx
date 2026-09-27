import React from 'react';
import { Badge, Box, Button, CircularProgress, Tooltip } from '@mui/material';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { useTranslation } from 'react-i18next';
import { DiscoveryIndicator } from '../hooks/useDiscovery.js';

interface DiscoveryButtonProps {
  indicator: DiscoveryIndicator;
  /** New businesses ready for review; shown on the badge when the search is done */
  newCount: number;
  onClick: () => void;
}

/** Header entry point for local business discovery (REV-27) that also reports a background search (REV-40) */
export const DiscoveryButton: React.FC<DiscoveryButtonProps> = ({ indicator, newCount, onClick }) => {
  const { t } = useTranslation();

  const label = {
    idle: t('header.findBusinesses'),
    running: t('header.discoveryRunning'),
    ready: t('header.discoveryReady', { count: newCount }),
    failed: t('header.discoveryFailed'),
  }[indicator];

  const icon =
    indicator === 'running' ? (
      <CircularProgress size={18} color="inherit" data-testid="discovery-progress" />
    ) : (
      <TravelExploreIcon sx={{ fontSize: 18 }} />
    );

  return (
    <Tooltip title={label}>
      <Button
        variant="outlined"
        color={indicator === 'failed' ? 'error' : indicator === 'ready' ? 'success' : 'primary'}
        onClick={onClick}
        aria-label={label}
        data-indicator={indicator}
        sx={{ px: 1.25, minWidth: 0, gap: 1, whiteSpace: 'nowrap' }}
      >
        {indicator === 'ready' || indicator === 'failed' ? (
          <Badge
            color={indicator === 'ready' ? 'success' : 'error'}
            // A search that found nothing new still gets a dot so the operator knows it finished
            variant={indicator === 'ready' && newCount > 0 ? 'standard' : 'dot'}
            badgeContent={indicator === 'ready' && newCount > 0 ? newCount : undefined}
            max={99}
          >
            {icon}
          </Badge>
        ) : (
          icon
        )}
        {/* Icon-only until there is room for the label next to the other header controls */}
        <Box component="span" sx={{ display: { xs: 'none', xl: 'inline' } }}>
          {t('header.findBusinesses')}
        </Box>
      </Button>
    </Tooltip>
  );
};
