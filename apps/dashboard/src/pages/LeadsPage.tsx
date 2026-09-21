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
                  Всего лидов в воронке
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
                  Ожидают аппрува (HITL)
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
                  Отправлено писем
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
                  Изучили демо (Engaged)
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
            placeholder="Поиск по сайту, названию или городу..."
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
            <InputLabel id="status-select-label">Статус воронки</InputLabel>
            <Select
              labelId="status-select-label"
              label="Статус воронки"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value as LeadStatus | 'ALL')}
            >
              <MenuItem value="ALL">Все статусы</MenuItem>
              <MenuItem value="QUEUED">В очереди</MenuItem>
              <MenuItem value="NEEDS_APPROVAL">Ожидает ревью</MenuItem>
              <MenuItem value="SCHEDULED">Запланировано</MenuItem>
              <MenuItem value="SENT">Отправлено</MenuItem>
              <MenuItem value="OPENED">Открыто</MenuItem>
              <MenuItem value="CLICKED">Изучает демо</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ width: { xs: '100%', sm: 190 } }}>
            <InputLabel id="niche-select-label">Ниша бизнеса</InputLabel>
            <Select
              labelId="niche-select-label"
              label="Ниша бизнеса"
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value as NicheType | 'ALL')}
            >
              <MenuItem value="ALL">Все ниши</MenuItem>
              <MenuItem value="dental">🦷 Стоматология</MenuItem>
              <MenuItem value="auto">🚗 Автосервис</MenuItem>
              <MenuItem value="legal">⚖️ Юристы</MenuItem>
              <MenuItem value="beauty">💇 Салоны красоты</MenuItem>
              <MenuItem value="restaurant">🍽️ Рестораны</MenuItem>
              <MenuItem value="fitness">🏋️ Фитнес</MenuItem>
              <MenuItem value="other">📦 Прочий бизнес</MenuItem>
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
              Сбросить
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Typography variant="body2" color="text.secondary">
            Найдено: <strong>{leads.length}</strong>
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
          <Typography variant="h6">Не удалось загрузить лиды</Typography>
        </Box>
      ) : viewMode === 'kanban' ? (
        <KanbanBoard leads={leads} />
      ) : (
        <LeadsDataGrid leads={leads} isLoading={isLoading} />
      )}

      {/* Quick Add Lead Modal Dialog */}
      <AddLeadModal />
    </Box>
  );
};
