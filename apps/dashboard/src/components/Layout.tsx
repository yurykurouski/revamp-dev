import React, { useRef, useState } from 'react';
import { Box } from '@mui/material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { IconRail } from './IconRail.js';
import { TopBar } from './TopBar.js';
import { AddLeadModal } from './AddLeadModal.js';
import { DiscoveryDrawer } from './DiscoveryDrawer.js';
import { DiscoveryFinishWatcher } from './DiscoveryFinishWatcher.js';
import { ShortcutsDialog } from './ShortcutsDialog.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useDiscoveryIndicator } from '../hooks/useDiscovery.js';
import { useLeadStatsQuery } from '../hooks/useLeads.js';
import { usePermissions } from '../hooks/usePermissions.js';
import { useShortcuts } from '../hooks/useShortcuts.js';
import { activeRailPage, ROUTES } from '../routes/paths.js';
import { countStatsByBucket } from '../utils/leadStages.js';

/** The height a page gets to fill the main area: the viewport less the top bar and the main area's padding */
export const MAIN_FILL_HEIGHT = 'calc(100vh - 64px - 48px)';

/** App shell of the review-queue layout (REV-76): icon rail, top bar and the routed page */
export const Layout: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const { canWrite, canManageMembers } = usePermissions();
  const signOut = useAuthStore((s) => s.signOut);
  const openDiscovery = useDiscoveryStore((s) => s.open);
  const openAddModal = useLeadFilterStore((s) => s.openAddModal);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const discovery = useDiscoveryIndicator();
  const { data: stats } = useLeadStatsQuery();
  const needsYouCount = stats ? countStatsByBucket(stats.byStatus).needs_you : 0;

  // The app-wide shortcuts (REV-47); pages add their own through the same registry
  useShortcuts({
    goQueue: () => navigate(ROUTES.queue),
    goLeads: () => navigate(ROUTES.leads),
    goSettings: () => navigate(ROUTES.settings),
    // Adding leads and discovery are for roles that can write (REV-207)
    openDiscovery: canWrite ? openDiscovery : undefined,
    addLead: canWrite ? openAddModal : undefined,
    focusSearch: () => searchRef.current?.focus(),
    showHelp: () => setShortcutsOpen(true),
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <IconRail
        activePage={activeRailPage(pathname)}
        needsYouCount={needsYouCount}
        discovery={discovery.indicator}
        onOpenDiscovery={openDiscovery}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        account={session ? { name: session.user.name, email: session.user.email, organization: session.organization.name } : undefined}
        onSignOut={signOut}
        canWrite={canWrite}
        canManageMembers={canManageMembers}
      />
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <TopBar discovery={discovery.indicator} discoveryNewCount={discovery.newCount} searchRef={searchRef} />
        <Box component="main" sx={{ flexGrow: 1, px: { xs: 2, md: 3.5 }, py: 3, overflowX: 'auto' }}>
          <Outlet />
        </Box>
      </Box>

      {/* "Add lead" sits in the top bar, so its dialog is available on every page */}
      <AddLeadModal />
      {/* Business discovery (REV-27, a drawer since REV-78) lives here so a background search is picked up on every page (REV-41) */}
      <DiscoveryDrawer />
      <DiscoveryFinishWatcher />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </Box>
  );
};
