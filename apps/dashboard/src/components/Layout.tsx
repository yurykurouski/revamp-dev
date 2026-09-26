import React from 'react';
import { Box } from '@mui/material';
import { Sidebar, type DashboardView } from './Sidebar.js';
import { Header } from './Header.js';

interface LayoutProps {
  activeView: DashboardView;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ activeView, children }) => {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: 'background.default' }}>
      <Sidebar activeView={activeView} />
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header />
        <Box component="main" sx={{ flexGrow: 1, p: 3, overflowX: 'auto' }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};
