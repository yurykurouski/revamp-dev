import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useLeadsQuery } from '../hooks/useLeads.js';
import { KanbanBoard } from '../components/KanbanBoard.js';
import { LeadsDataGrid } from '../components/LeadsDataGrid.js';
import { AddLeadModal } from '../components/AddLeadModal.js';
import { SideBySideInspectorModal } from '../components/SideBySideInspectorModal.js';
import { LeadStatus, NicheType } from '@revamp/shared-types';

export const LeadsPage: React.FC = () => {
  const {
    searchQuery,
    selectedStatus,
    selectedNiche,
    viewMode,
    setSearchQuery,
    setSelectedStatus,
    setSelectedNiche,
    resetFilters,
  } = useLeadFilterStore();

  const { data, isLoading, isError } = useLeadsQuery();

  const leads = data?.leads ?? [];
  const kpi = data?.kpi ?? {
    totalLeads: leads.length,
    needsApproval: leads.filter((l) => l.status === 'NEEDS_APPROVAL').length,
    scheduled: leads.filter((l) => l.status === 'SCHEDULED').length,
    sent: leads.filter((l) => l.status === 'SENT').length,
    engaged: leads.filter((l) => l.status === 'CLICKED' || l.status === 'OPENED').length,
  };

  return (
    <Box>
      {/* Top Metrics Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3.5 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Total leads in pipeline
                </Typography>
                <CheckCircleOutlineIcon sx={{ color: 'primary.main', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {kpi.totalLeads}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ borderLeft: '4px solid #F59E0B' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Awaiting approval (HITL)
                </Typography>
                <PendingActionsIcon sx={{ color: '#F59E0B', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#F59E0B' }}>
                {kpi.needsApproval}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Emails sent
                </Typography>
                <SendIcon sx={{ color: '#10B981', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: 'text.primary' }}>
                {kpi.sent}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Viewed demo (Engaged)
                </Typography>
                <VisibilityIcon sx={{ color: '#06B6D4', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: '#06B6D4' }}>
                {kpi.engaged}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter Bar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            placeholder="Search by website, name or city..."
            size="small"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                </InputAdornment>
              ),
            }}
            sx={{ width: { xs: '100%', sm: 300 } }}
          />

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 180 } }}>
            <InputLabel id="status-select-label">Pipeline status</InputLabel>
            <Select
              labelId="status-select-label"
              label="Pipeline status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as LeadStatus | 'ALL')}
            >
              <MenuItem value="ALL">All statuses</MenuItem>
              <MenuItem value="QUEUED">Queued</MenuItem>
              <MenuItem value="NEEDS_APPROVAL">Awaiting review</MenuItem>
              <MenuItem value="SCHEDULED">Scheduled</MenuItem>
              <MenuItem value="SENT">Sent</MenuItem>
              <MenuItem value="OPENED">Opened</MenuItem>
              <MenuItem value="CLICKED">Viewing demo</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 190 } }}>
            <InputLabel id="niche-select-label">Business niche</InputLabel>
            <Select
              labelId="niche-select-label"
              label="Business niche"
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value as NicheType | 'ALL')}
            >
              <MenuItem value="ALL">All niches</MenuItem>
              <MenuItem value="dental">🦷 Dental</MenuItem>
              <MenuItem value="auto">🚗 Auto repair</MenuItem>
              <MenuItem value="legal">⚖️ Legal</MenuItem>
              <MenuItem value="beauty">💇 Beauty salons</MenuItem>
              <MenuItem value="restaurant">🍽️ Restaurants</MenuItem>
              <MenuItem value="fitness">🏋️ Fitness</MenuItem>
              <MenuItem value="other">📦 Other business</MenuItem>
            </Select>
          </FormControl>

          {(searchQuery || selectedStatus !== 'ALL' || selectedNiche !== 'ALL') && (
            <Button
              variant="text"
              color="inherit"
              size="small"
              startIcon={<RestartAltIcon sx={{ fontSize: 16 }} />}
              onClick={resetFilters}
              sx={{ color: 'text.secondary' }}
            >
              Reset
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Typography variant="body2" color="text.secondary">
            Found: <strong>{leads.length}</strong>
          </Typography>
        </CardContent>
      </Card>

      {/* Main View: Kanban vs Table */}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : isError ? (
        <Box sx={{ textAlign: 'center', py: 6, color: 'error.main' }}>
          <Typography variant="h6">Failed to load leads</Typography>
        </Box>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard leads={leads} />
      ) : (
        <LeadsDataGrid leads={leads} isLoading={isLoading} />
      )}

      {/* Quick Add Lead Modal Dialog */}
      <AddLeadModal />

      {/* Side-by-Side Split Screen Inspector Dialog */}
      <SideBySideInspectorModal />
    </Box>
  );
};
