import React from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Button,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { NicheType } from '@revamp/shared-types';

interface LeadItem {
  id: string;
  businessName: string;
  originalUrl: string;
  niche: string;
  city: string;
  totalScore: number;
  status: 'PENDING' | 'AWAITING_APPROVAL' | 'SENT' | 'ENGAGED';
}

const mockLeads: LeadItem[] = [
  {
    id: 'lead-1',
    businessName: 'Стоматология "Дента Люкс"',
    originalUrl: 'https://dental-lux-spb.example.com',
    niche: 'dental',
    city: 'Санкт-Петербург',
    totalScore: 42,
    status: 'AWAITING_APPROVAL',
  },
  {
    id: 'lead-2',
    businessName: 'Автосервис "Мотор Экспресс"',
    originalUrl: 'https://motor-express.example.com',
    niche: 'auto',
    city: 'Москва',
    totalScore: 36,
    status: 'AWAITING_APPROVAL',
  },
  {
    id: 'lead-3',
    businessName: 'Юридическое бюро "Щит и Закон"',
    originalUrl: 'https://shield-legal.example.com',
    niche: 'legal',
    city: 'Казань',
    totalScore: 58,
    status: 'SENT',
  },
  {
    id: 'lead-4',
    businessName: 'Клиника косметологии "Эстетик"',
    originalUrl: 'https://estetik-clinic.example.com',
    niche: 'beauty',
    city: 'Екатеринбург',
    totalScore: 49,
    status: 'ENGAGED',
  },
];

export const LeadsPage: React.FC = () => {
  const { searchQuery, selectedNiche, setSearchQuery, setSelectedNiche } = useLeadFilterStore();
  const { openModal } = useHitlModalStore();

  const filteredLeads = mockLeads.filter((lead) => {
    const matchesSearch = lead.businessName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesNiche = selectedNiche === 'ALL' || lead.niche === selectedNiche;
    return matchesSearch && matchesNiche;
  });

  return (
    <Box>
      {/* Top Metrics Cards */}
      <Grid container spacing={2.5} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Всего лидов
                </Typography>
                <CheckCircleOutlineIcon sx={{ color: '#4F46E5', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#0F172A' }}>
                24
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ borderLeft: '4px solid #F59E0B' }}>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Ожидают аппрува (HITL)
                </Typography>
                <PendingActionsIcon sx={{ color: '#F59E0B', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#F59E0B' }}>
                8
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Отправлено писем
                </Typography>
                <SendIcon sx={{ color: '#10B981', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#0F172A' }}>
                12
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent sx={{ p: 2.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Изучили демо (Engaged)
                </Typography>
                <VisibilityIcon sx={{ color: '#06B6D4', fontSize: 22 }} />
              </Box>
              <Typography variant="h4" sx={{ fontWeight: 700, color: '#06B6D4' }}>
                5
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter Bar */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
          <TextField
            placeholder="Поиск по названию бизнеса..."
            size="small"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ color: '#94A3B8', fontSize: 20 }} />
                </InputAdornment>
              ),
            }}
            sx={{ width: 320 }}
          />

          <FormControl size="small" sx={{ width: 200 }}>
            <InputLabel id="niche-select-label">Ниша бизнеса</InputLabel>
            <Select
              labelId="niche-select-label"
              label="Ниша бизнеса"
              value={selectedNiche}
              onChange={(e) => setSelectedNiche(e.target.value as NicheType | 'ALL')}
            >
              <MenuItem value="ALL">Все ниши</MenuItem>
              <MenuItem value="dental">Стоматология</MenuItem>
              <MenuItem value="auto">Автосервис</MenuItem>
              <MenuItem value="legal">Юристы</MenuItem>
              <MenuItem value="beauty">Салоны красоты</MenuItem>
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      {/* Leads List */}
      <Grid container spacing={2}>
        {filteredLeads.map((lead) => (
          <Grid item xs={12} md={6} key={lead.id}>
            <Card sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 600, color: '#0F172A', mb: 0.5 }}>
                    {lead.businessName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {lead.city} • Ниша: {lead.niche}
                  </Typography>
                </Box>
                <Chip
                  label={`Скоринг: ${lead.totalScore}/100`}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    backgroundColor: lead.totalScore < 50 ? '#FEE2E2' : '#FEF3C7',
                    color: lead.totalScore < 50 ? '#DC2626' : '#D97706',
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1, borderTop: '1px solid #F1F5F9' }}>
                <Typography variant="caption" sx={{ color: '#64748B' }}>
                  URL: {lead.originalUrl}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {lead.status === 'AWAITING_APPROVAL' && (
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      startIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
                      onClick={() => openModal(lead.id, `audit-${lead.id}`)}
                    >
                      HITL Ревью & Аппрув
                    </Button>
                  )}
                  {lead.status === 'SENT' && (
                    <Chip label="Письмо отправлено" size="small" color="success" variant="outlined" />
                  )}
                  {lead.status === 'ENGAGED' && (
                    <Chip label="Смотрит демо" size="small" color="secondary" />
                  )}
                </Box>
              </Box>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};
