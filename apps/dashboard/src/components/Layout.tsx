import React from 'react';
import { Box } from '@mui/material';
import { Outlet, useLocation } from 'react-router-dom';
import { IconRail } from './IconRail.js';
import { TopBar } from './TopBar.js';
import { AddLeadModal } from './AddLeadModal.js';
import { DiscoveryDrawer } from './DiscoveryDrawer.js';
import { DiscoveryFinishWatcher } from './DiscoveryFinishWatcher.js';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import { useDiscoveryIndicator } from '../hooks/useDiscovery.js';
import { useLeadStatsQuery } from '../hooks/useLeads.js';
import { activeRailPage } from '../routes/paths.js';
import { countStatsByBucket } from '../utils/leadStages.js';

/** The height a page gets to fill the main area: the viewport less the top bar and the main area's padding */
export const MAIN_FILL_HEIGHT = 'calc(100vh - 64px - 48px)';

/** App shell of the review-queue layout (REV-76): icon rail, top bar and the routed page */
export const Layout: React.FC = () => {
  const { pathname } = useLocation();
  const openDiscovery = useDiscoveryStore((s) => s.open);
  const discovery = useDiscoveryIndicator();
  const { data: stats } = useLeadStatsQuery();
  const needsYouCount = stats ? countStatsByBucket(stats.byStatus).needs_you : 0;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <IconRail
        activePage={activeRailPage(pathname)}
        needsYouCount={needsYouCount}
        discovery={discovery.indicator}
        onOpenDiscovery={openDiscovery}
      />
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar discovery={discovery.indicator} discoveryNewCount={discovery.newCount} />
        <Box component="main" sx={{ flexGrow: 1, px: { xs: 2, md: 3.5 }, py: 3, overflowX: 'auto' }}>
          <Outlet />
        </Box>
      </Box>

      {/* "Add lead" sits in the top bar, so its dialog is available on every page */}
      <AddLeadModal />
      {/* Business discovery (REV-27, a drawer since REV-78) lives here so a background search is picked up on every page (REV-41) */}
      <DiscoveryDrawer />
      <DiscoveryFinishWatcher />
    </Box>
  );
};
