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
  Select,
  MenuItem,
} from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import { useTranslation } from 'react-i18next';
import AddIcon from '@mui/icons-material/Add';
import BoltIcon from '@mui/icons-material/Bolt';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import TableRowsIcon from '@mui/icons-material/TableRows';
import { useThemeStore } from '../store/useThemeStore.js';
import { useLeadFilterStore, ViewMode } from '../store/useLeadFilterStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { AppLanguage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/languages.js';

export const Header: React.FC = () => {
  const { mode, toggleTheme } = useThemeStore();
  const { viewMode, setViewMode, openAddModal } = useLeadFilterStore();
  const { language, setLanguage } = useLanguageStore();
  const { t } = useTranslation();

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
            {t('header.title')}
          </Typography>
          <Chip
            icon={<BoltIcon sx={{ fontSize: 16 }} />}
            label={t('header.singleTenant')}
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
            <ToggleButton value="kanban" aria-label={t('header.kanbanBoard')}>
              <Tooltip title={t('header.kanbanBoard')}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <ViewKanbanIcon sx={{ fontSize: 18 }} />
                  <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {t('header.kanban')}
                  </Typography>
                </Box>
              </Tooltip>
            </ToggleButton>
            <ToggleButton value="table" aria-label={t('header.leadsTable')}>
              <Tooltip title={t('header.leadsTableTooltip')}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <TableRowsIcon sx={{ fontSize: 18 }} />
                  <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {t('header.table')}
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
            {t('header.newAudit')}
          </Button>

          {/* Interface language (REV-24) */}
          <Select
            size="small"
            value={language}
            onChange={(e) => setLanguage(e.target.value as AppLanguage)}
            inputProps={{ 'aria-label': t('language.label') }}
            startAdornment={<TranslateIcon sx={{ fontSize: 18, mr: 1, color: 'text.secondary' }} />}
            sx={{ minWidth: 150, fontSize: '0.875rem' }}
          >
            {SUPPORTED_LANGUAGES.map((code) => (
              <MenuItem key={code} value={code} lang={code}>
                {LANGUAGE_NAMES[code]}
              </MenuItem>
            ))}
          </Select>

          {/* Dark / Light Mode Toggle */}
          <Tooltip title={mode === 'dark' ? t('header.switchToLight') : t('header.switchToDark')}>
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
              {t('header.operatorInitials')}
            </Avatar>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', lineHeight: 1.2 }}>
                {t('header.operator')}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('header.operatorRole')}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
