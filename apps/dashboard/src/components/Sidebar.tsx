import React from 'react';
import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import type { Translation } from '../i18n/locales/en.js';

const DRAWER_WIDTH = 240;

/** Views the dashboard can show; add one here only once its page exists */
export type DashboardView = keyof Translation['sidebar'];

export const NAV_ITEMS: Array<{ view: DashboardView; icon: React.ReactNode }> = [
  { view: 'leads', icon: <DashboardIcon /> },
];

interface SidebarProps {
  activeView: DashboardView;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView }) => {
  const { t } = useTranslation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          backgroundColor: '#0F172A',
          color: '#F8FAFC',
          borderRight: 'none',
        },
      }}
    >
      <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #4F46E5 0%, #06B6D4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <AutoAwesomeIcon sx={{ color: '#FFFFFF', fontSize: 18 }} />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          Revamp SaaS
        </Typography>
      </Box>

      <List sx={{ px: 1.5 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.view === activeView;
          return (
            <ListItem key={item.view} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                aria-current={active ? 'page' : undefined}
                sx={{
                  borderRadius: '8px',
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
                    minWidth: 40,
                  }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={t(`sidebar.${item.view}`)}
                  primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: active ? 600 : 500 }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </Drawer>
  );
};
