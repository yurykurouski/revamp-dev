import React from 'react';
import { Avatar, Badge, Box, ButtonBase, CircularProgress, Tooltip } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import ViewListOutlinedIcon from '@mui/icons-material/ViewListOutlined';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import { useTranslation } from 'react-i18next';
import { ROUTES, RailPage } from '../routes/paths.js';
import type { DiscoveryIndicator } from '../hooks/useDiscovery.js';

export const RAIL_WIDTH = 64;

/** The rail's page entries, top to bottom; Settings sits at the bottom, above the operator */
export const RAIL_PAGES: ReadonlyArray<{ page: RailPage; to: string; icon: React.ReactNode }> = [
  { page: 'queue', to: ROUTES.queue, icon: <InboxOutlinedIcon /> },
  { page: 'leads', to: ROUTES.leads, icon: <ViewListOutlinedIcon /> },
  { page: 'settings', to: ROUTES.settings, icon: <TuneIcon /> },
];

interface IconRailProps {
  /** The rail entry for the current page, if any */
  activePage: RailPage | null;
  /** Leads waiting for the operator, shown on the Review queue entry */
  needsYouCount: number;
  discovery: DiscoveryIndicator;
  onOpenDiscovery: () => void;
  /** Opens the keyboard shortcuts overlay (REV-47) */
  onOpenShortcuts: () => void;
}

const itemSx = (active: boolean): SxProps<Theme> => ({
  width: 44,
  height: 44,
  borderRadius: 1,
  color: active ? 'primary.main' : 'text.secondary',
  backgroundColor: active ? 'primary.soft' : 'transparent',
  '&:hover': { color: active ? 'primary.main' : 'text.primary', backgroundColor: active ? 'primary.soft' : 'action.hover' },
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
  '& svg': { fontSize: 20 },
});

/** 64px navigation rail of the review-queue layout (REV-76); replaces the collapsible sidebar */
export const IconRail: React.FC<IconRailProps> = ({ activePage, needsYouCount, discovery, onOpenDiscovery, onOpenShortcuts }) => {
  const { t } = useTranslation();

  const pageItem = (page: RailPage) => {
    const item = RAIL_PAGES.find((p) => p.page === page)!;
    const active = page === activePage;
    const label = t(`rail.${page}`);
    const icon =
      page === 'queue' ? (
        <Badge color="warning" badgeContent={needsYouCount} max={99} data-testid="needs-you-badge">
          {item.icon}
        </Badge>
      ) : (
        item.icon
      );
    return (
      <Tooltip key={page} title={label} placement="right">
        <ButtonBase
          component={RouterLink}
          to={item.to}
          aria-label={page === 'queue' && needsYouCount > 0 ? t('rail.queueWithCount', { count: needsYouCount }) : label}
          aria-current={active ? 'page' : undefined}
          data-rail={page}
          sx={itemSx(active)}
        >
          {icon}
        </ButtonBase>
      </Tooltip>
    );
  };

  const discoveryLabel = {
    idle: t('rail.discovery'),
    running: t('header.discoveryRunning'),
    ready: t('rail.discoveryReady'),
    failed: t('header.discoveryFailed'),
  }[discovery];

  return (
    <Box
      component="nav"
      aria-label={t('rail.label')}
      sx={{
        width: RAIL_WIDTH,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.75,
        py: 1.25,
        backgroundColor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          mb: 1.75,
          borderRadius: 1,
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        role="img"
        aria-label="Revamp"
      >
        <AutoAwesomeIcon sx={{ fontSize: 16 }} />
      </Box>

      {pageItem('queue')}
      {pageItem('leads')}

      <Tooltip title={discoveryLabel} placement="right">
        <ButtonBase onClick={onOpenDiscovery} aria-label={discoveryLabel} data-rail="discovery" data-indicator={discovery} sx={itemSx(false)}>
          {discovery === 'running' ? (
            <CircularProgress size={18} color="inherit" />
          ) : (
            <Badge color={discovery === 'failed' ? 'error' : 'success'} variant="dot" invisible={discovery === 'idle'}>
              <TravelExploreIcon />
            </Badge>
          )}
        </ButtonBase>
      </Tooltip>

      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
        <Tooltip title={`${t('shortcuts.title')} (?)`} placement="right">
          <ButtonBase onClick={onOpenShortcuts} aria-label={t('shortcuts.title')} aria-keyshortcuts="?" data-rail="shortcuts" sx={itemSx(false)}>
            <KeyboardOutlinedIcon />
          </ButtonBase>
        </Tooltip>
        {pageItem('settings')}
        <Tooltip title={`${t('header.operator')} · ${t('header.operatorRole')}`} placement="right">
          <Avatar
            variant="rounded"
            sx={{ width: 32, height: 32, mt: 0.75, bgcolor: 'primary.soft', color: 'primary.main', fontSize: '0.75rem', fontWeight: 600 }}
          >
            {t('header.operatorInitials')}
          </Avatar>
        </Tooltip>
      </Box>
    </Box>
  );
};
