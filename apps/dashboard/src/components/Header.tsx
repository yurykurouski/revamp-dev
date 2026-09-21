import React from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  Box,
  Avatar,
  Chip,
  Button,
  IconButton,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BoltIcon from '@mui/icons-material/Bolt';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useThemeStore } from '../store/useThemeStore.js';
import { useLeadFilterStore, ViewMode } from '../store/useLeadFilterStore.js';

export const Header: React.FC = () => {
  const { mode, toggleTheme } = useThemeStore();
  const { viewMode, setViewMode, openAddModal } = useLeadFilterStore();

  const handleViewModeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newMode: ViewMode | null,
  ) => {
    if (newMode) {
      setViewMode(newMode);
    }
  };

  return (
    <AppBar
      position="static"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
      }}
    >
      <Toolbar sx={{ justifyContent: 'space-between', px: 3, minHeight: 68 }}>
        {/* Left branding / title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
            Воронка лидов
          </Typography>
          <Chip
            icon={<BoltIcon sx={{ fontSize: 16 }} />}
            label="Single-Tenant Mode"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ fontWeight: 600 }}
          />
        </Box>

        {/* Center / Right actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* View Switcher: Kanban vs Table */}
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={handleViewModeChange}
            size="small"
            sx={{
              backgroundColor: 'background.default',
              borderRadius: 2,
              '& .MuiToggleButton-root': {
                px: 1.5,
                py: 0.5,
                border: 'none',
                color: 'text.secondary',
                '&.Mui-selected': {
                  backgroundColor: 'background.paper',
                  color: 'primary.main',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                  fontWeight: 700,
                },
              },
            }}
          >
            <ToggleButton value="kanban" aria-label="Kanban-доска">
              <Tooltip title="Канбан-доска">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ViewKanbanIcon sx={{ fontSize: 18 }} />
                  <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    Канбан
                  </Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="table" aria-label="Таблица лидов">
              <Tooltip title="Таблица лидов (DataGrid)">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TableRowsIcon sx={{ fontSize: 18 }} />
                  <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    Таблица
                  </Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          {/* Quick Add Lead Button */}
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={openAddModal}
            sx={{ px: 2, py: 0.9, fontWeight: 600 }}
          >
            Новый сайт на аудит
          </Button>

          {/* Dark / Light Mode Toggle */}
          <Tooltip title={mode === 'dark' ? 'Переключить на светлую тему' : 'Переключить на темную тему'}>
            <IconButton onClick={toggleTheme} color="inherit" sx={{ p: 1 }}>
              {mode === 'dark' ? (
                <LightModeIcon sx={{ color: '#F59E0B', fontSize: 22 }} />
              ) : (
                <DarkModeIcon sx={{ color: '#64748B', fontSize: 22 }} />
              )}
            </IconButton>
          </Tooltip>

          {/* Operator Profile */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              pl: 2,
              borderLeft: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: '0.875rem', fontWeight: 700 }}>
              OP
            </Avatar>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
                Оператор
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                HITL Reviewer
              </Typography>
            </Box>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
