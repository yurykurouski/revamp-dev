import React from 'react';
import { AppBar, Box, Button, InputAdornment, TextField, Toolbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';
import { DiscoveryButton } from './DiscoveryButton.js';
import { DiscoveryIndicator } from '../hooks/useDiscovery.js';
import { activeRailPage, ROUTES } from '../routes/paths.js';

interface TopBarProps {
  discovery: DiscoveryIndicator;
  discoveryNewCount: number;
  /** The search field, so the `/` shortcut can focus it (REV-47) */
  searchRef?: React.Ref<HTMLInputElement>;
}

/**
 * The review-queue top bar (REV-76): lead search, "Find businesses" and "Add lead". Language and theme
 * live on the Settings page.
 */
export const TopBar: React.FC<TopBarProps> = ({ discovery, discoveryNewCount, searchRef }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const searchQuery = useLeadFilterStore((s) => s.searchQuery);
  const setSearchQuery = useLeadFilterStore((s) => s.setSearchQuery);
  const openAddModal = useLeadFilterStore((s) => s.openAddModal);
  const openDiscovery = useDiscoveryStore((s) => s.open);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    // Search results live on the lead pages; from Settings the search goes to All leads
    if (value && activeRailPage(pathname) === 'settings') navigate(ROUTES.leads);
  };

  return (
    <AppBar position="static">
      <Toolbar sx={{ justifyContent: 'space-between', gap: 2, px: { xs: 2, md: 3 }, minHeight: { xs: 56 } }}>
        <TextField
          type="search"
          placeholder={t('topBar.searchPlaceholder')}
          size="small"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          inputRef={searchRef}
          inputProps={{ 'aria-label': t('topBar.searchLabel') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: '100%', md: 440 }, minWidth: 0 }}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {/* Local business discovery (REV-27) with background search progress (REV-40) */}
          <DiscoveryButton indicator={discovery} newCount={discoveryNewCount} onClick={openDiscovery} />
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={openAddModal} sx={{ whiteSpace: 'nowrap' }}>
            {t('topBar.addLead')}
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
};
