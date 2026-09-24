import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  Alert,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import LanguageIcon from '@mui/icons-material/Language';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { NicheType } from '@revamp/shared-types';
import { QuickAddLeadSchema } from '@revamp/validation';
import { useLeadFilterStore } from '../store/useLeadFilterStore.js';
import { useCreateLeadMutation } from '../hooks/useLeads.js';

const NICHES: { value: NicheType; label: string }[] = [
  { value: 'dental', label: '🦷 Стоматология' },
  { value: 'auto', label: '🚗 Автосервис и ТО' },
  { value: 'legal', label: '⚖️ Юридические услуги' },
  { value: 'beauty', label: '💇 Салоны красоты и SPA' },
  { value: 'restaurant', label: '🍽️ Рестораны и кейтеринг' },
  { value: 'fitness', label: '🏋️ Фитнес и спортзалы' },
  { value: 'other', label: '📦 Прочий локальный бизнес' },
];

export const AddLeadModal: React.FC = () => {
  const { isAddModalOpen, closeAddModal } = useLeadFilterStore();
  const createLeadMutation = useCreateLeadMutation();

  const [url, setUrl] = useState('');
  const [niche, setNiche] = useState<NicheType>('other');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const handleClose = () => {
    if (createLeadMutation.isPending) return;
    setFormError(null);
    setUrl('');
    setEmail('');
    setNiche('other');
    closeAddModal();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Format URL with https protocol if missing
    let targetUrl = url.trim();
    if (targetUrl && !/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    const payload = {
      url: targetUrl,
      niche,
      contactEmail: email.trim() || undefined,
    };

    const validation = QuickAddLeadSchema.safeParse(payload);
    if (!validation.success) {
      const errorMsg = validation.error.issues[0]?.message || 'Некорректные параметры сайта';
      setFormError(errorMsg);
      return;
    }

    try {
      await createLeadMutation.mutateAsync(validation.data);
      handleClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Ошибка отправки на сервер');
    }
  };

  return (
    <Dialog
      open={isAddModalOpen}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { p: 1 },
      }}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 38,
              height: 38,
              borderRadius: '10px',
              backgroundColor: 'primary.light',
              color: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AutoAwesomeIcon />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Добавить сайт на аудит
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Запуск автоматического краулера Playwright, Vision LLM и сборки Bento MVP
            </Typography>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ pt: 2 }}>
          {formError && (
            <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>
              {formError}
            </Alert>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
            <TextField
              label="URL сайта бизнеса"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              fullWidth
              required
              autoFocus
              disabled={createLeadMutation.isPending}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LanguageIcon color="action" />
                  </InputAdornment>
                ),
              }}
              helperText="Поддерживаются любые HTTP/HTTPS ссылки на реальные сайты малого бизнеса"
            />

            <FormControl fullWidth disabled={createLeadMutation.isPending}>
              <InputLabel id="add-niche-select-label">Сфера деятельности (Ниша)</InputLabel>
              <Select
                labelId="add-niche-select-label"
                label="Сфера деятельности (Ниша)"
                value={niche}
                onChange={(e) => setNiche(e.target.value as NicheType)}
              >
                {NICHES.map((n) => (
                  <MenuItem key={n.value} value={n.value}>
                    {n.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Email владельца / оператора (опционально)"
              placeholder="contact@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              disabled={createLeadMutation.isPending}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <EmailOutlinedIcon color="action" />
                  </InputAdornment>
                ),
              }}
              helperText="Если не указан, краулер автоматически извлечет email со страниц сайта"
            />
          </Box>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button
            onClick={handleClose}
            color="inherit"
            disabled={createLeadMutation.isPending}
            sx={{ fontWeight: 600 }}
          >
            Отмена
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={createLeadMutation.isPending}
            startIcon={
              createLeadMutation.isPending ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <AutoAwesomeIcon />
              )
            }
            sx={{ px: 2.5, py: 1, fontWeight: 700 }}
          >
            {createLeadMutation.isPending ? 'Запуск аудита...' : 'Запустить аудит'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
