import React from 'react';
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useTranslation } from 'react-i18next';

export const DRAWER_WIDTH = 240;
export const COLLAPSED_DRAWER_WIDTH = 72;

/** Views the dashboard can show; add one here only once its page exists */
export type DashboardView = 'leads';

export const NAV_ITEMS: Array<{ view: DashboardView; icon: React.ReactNode }> = [
  { view: 'leads', icon: <DashboardIcon /> },
];

interface SidebarProps {
  activeView: DashboardView;
  /** Collapsed to an icon-only rail */
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, collapsed, onToggleCollapsed }) => {
  const { t } = useTranslation();
  const width = collapsed ? COLLAPSED_DRAWER_WIDTH : DRAWER_WIDTH;
  const toggleLabel = t(collapsed ? 'sidebar.expand' : 'sidebar.collapse');

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        transition: (theme) => theme.transitions.create('width'),
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: (theme) => theme.transitions.create('width'),
          backgroundColor: '#0F172A',
          color: '#F8FAFC',
          borderRight: 'none',
        },
      }}
    >
      <Box
        sx={{
          py: 3,
          px: collapsed ? 0 : 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AutoAwesomeIcon sx={{ color: '#FFFFFF', fontSize: 18 }} />
        </Box>
        {!collapsed && (
          <Typography variant="h6" noWrap sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Revamp SaaS
          </Typography>
        )}
      </Box>

      <List sx={{ px: 1.5 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.view === activeView;
          const label = t(`sidebar.${item.view}`);
          return (
            <ListItem key={item.view} disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={collapsed ? label : ''} placement="right">
                <ListItemButton
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? label : undefined}
                  sx={{
                    borderRadius: '8px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    backgroundColor: active ? 'rgba(79, 70, 229, 0.2)' : 'transparent',
                    color: active ? '#818CF8' : '#94A3B8',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.05)',
                      color: '#FFFFFF',
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      color: active ? '#818CF8' : '#94A3B8',
                      minWidth: collapsed ? 0 : 40,
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={label}
                      primaryTypographyProps={{
                        fontSize: '0.875rem',
                        fontWeight: active ? 600 : 500,
                        noWrap: true,
                      }}
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            </ListItem>
          );
        })}
      </List>

      <Box
        sx={{
          mt: 'auto',
          p: 1.5,
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <Tooltip title={toggleLabel} placement="right">
          <IconButton
            onClick={onToggleCollapsed}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            sx={{
              color: '#94A3B8',
              '&:hover': { color: '#FFFFFF', backgroundColor: 'rgba(255, 255, 255, 0.05)' },
            }}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Drawer>
  );
};
