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
import { useTranslation } from 'react-i18next';
import { NICHES, NICHE_EMOJI } from '../i18n/niches.js';

export const AddLeadModal: React.FC = () => {
  const { isAddModalOpen, closeAddModal } = useLeadFilterStore();
  const createLeadMutation = useCreateLeadMutation();
  const { t } = useTranslation();

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
      const errorMsg = validation.error.issues[0]?.message || t('addLead.invalid');
      setFormError(errorMsg);
      return;
    }

    try {
      await createLeadMutation.mutateAsync(validation.data);
      handleClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : t('addLead.submitFailed'));
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
              {t('addLead.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('addLead.subtitle')}
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
              label={t('addLead.urlLabel')}
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
              helperText={t('addLead.urlHelper')}
            />

            <FormControl fullWidth disabled={createLeadMutation.isPending}>
              <InputLabel id="add-niche-select-label">{t('addLead.nicheLabel')}</InputLabel>
              <Select
                labelId="add-niche-select-label"
                label={t('addLead.nicheLabel')}
                value={niche}
                onChange={(e) => setNiche(e.target.value as NicheType)}
              >
                {NICHES.map((n) => (
                  <MenuItem key={n} value={n}>
                    {NICHE_EMOJI[n]} {t(`nichesDetailed.${n}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label={t('addLead.emailLabel')}
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
              helperText={t('addLead.emailHelper')}
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
            {t('addLead.cancel')}
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
            {createLeadMutation.isPending ? t('addLead.starting') : t('addLead.start')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
