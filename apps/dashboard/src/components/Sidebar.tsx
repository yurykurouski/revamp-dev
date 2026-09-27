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

export const DRAWER_WIDTH = 224;
export const COLLAPSED_DRAWER_WIDTH = 64;

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
        },
      }}
    >
      <Box
        sx={{
          height: 56,
          px: collapsed ? 0 : 2.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: 1,
            backgroundColor: 'primary.main',
            color: 'primary.contrastText',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AutoAwesomeIcon sx={{ fontSize: 16 }} />
        </Box>
        {!collapsed && (
          <Typography variant="subtitle1" noWrap sx={{ color: 'text.primary', letterSpacing: '-0.01em' }}>
            Revamp SaaS
          </Typography>
        )}
      </Box>

      <List sx={{ px: 1, py: 1.5 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.view === activeView;
          const label = t(`sidebar.${item.view}`);
          return (
            <ListItem key={item.view} disablePadding sx={{ mb: 0.5 }}>
              <Tooltip title={collapsed ? label : ''} placement="right">
                <ListItemButton
                  selected={active}
                  aria-current={active ? 'page' : undefined}
                  aria-label={collapsed ? label : undefined}
                  sx={{ py: 0.75, justifyContent: collapsed ? 'center' : 'flex-start' }}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 34, '& svg': { fontSize: 20 } }}>
                    {item.icon}
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={label}
                      primaryTypographyProps={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
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
          p: 1,
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <Tooltip title={toggleLabel} placement="right">
          <IconButton
            onClick={onToggleCollapsed}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            size="small"
            sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
          >
            {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
          </IconButton>
        </Tooltip>
      </Box>
    </Drawer>
  );
};
