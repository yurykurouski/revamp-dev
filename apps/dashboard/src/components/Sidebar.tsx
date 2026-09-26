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
  Chip,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AssessmentIcon from '@mui/icons-material/Assessment';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import BarChartIcon from '@mui/icons-material/BarChart';
import SettingsIcon from '@mui/icons-material/Settings';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

const DRAWER_WIDTH = 240;

const menuItems = [
  { text: 'Leads & Pipeline', icon: <DashboardIcon />, active: true },
  { text: 'Site Audits', icon: <AssessmentIcon /> },
  { text: 'Outreach (HITL)', icon: <MarkEmailReadIcon />, badge: '3' },
  { text: 'Analytics', icon: <BarChartIcon /> },
  { text: 'Settings', icon: <SettingsIcon /> },
];

export const Sidebar: React.FC = () => {
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
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              sx={{
                borderRadius: '8px',
                backgroundColor: item.active ? 'rgba(79, 70, 229, 0.2)' : 'transparent',
                color: item.active ? '#818CF8' : '#94A3B8',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#FFFFFF',
                },
              }}
            >
              <ListItemIcon
                sx={{
                  color: item.active ? '#818CF8' : '#94A3B8',
                  minWidth: 40,
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.text}
                primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: item.active ? 600 : 500 }}
              />
              {item.badge && (
                <Chip
                  label={item.badge}
                  size="small"
                  sx={{
                    height: 20,
                    fontSize: '0.75rem',
                    backgroundColor: '#F59E0B',
                    color: '#000000',
                    fontWeight: 700,
                  }}
                />
              )}
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Drawer>
  );
};
