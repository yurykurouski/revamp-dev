import React from 'react';
import { Box } from '@mui/material';
import { Sidebar, type DashboardView } from './Sidebar.js';
import { Header } from './Header.js';
import { DiscoveryModal } from './DiscoveryModal.js';
import { DiscoveryFinishWatcher } from './DiscoveryFinishWatcher.js';
import { useSidebarStore } from '../store/useSidebarStore.js';

interface LayoutProps {
  activeView: DashboardView;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ activeView, children }) => {
  const { collapsed, toggleCollapsed } = useSidebarStore();

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <Sidebar activeView={activeView} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header />
        <Box component="main" sx={{ flexGrow: 1, p: 3, overflowX: 'auto' }}>
          {children}
        </Box>
      </Box>

      {/* Business discovery (REV-27) lives here so a background search is picked up on every page (REV-41) */}
      <DiscoveryModal />
      <DiscoveryFinishWatcher />
    </Box>
  );
};
