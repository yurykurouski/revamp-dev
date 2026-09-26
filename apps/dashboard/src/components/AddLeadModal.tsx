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
  { value: 'dental', label: '🦷 Dental' },
  { value: 'auto', label: '🚗 Auto repair & service' },
  { value: 'legal', label: '⚖️ Legal services' },
  { value: 'beauty', label: '💇 Beauty salons & spa' },
  { value: 'restaurant', label: '🍽️ Restaurants & catering' },
  { value: 'fitness', label: '🏋️ Fitness & gyms' },
  { value: 'other', label: '📦 Other local business' },
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
      const errorMsg = validation.error.issues[0]?.message || 'Invalid site parameters';
      setFormError(errorMsg);
      return;
    }

    try {
      await createLeadMutation.mutateAsync(validation.data);
      handleClose();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to submit to the server');
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
              Add a site to audit
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Runs the Playwright crawler, Vision LLM critique and Bento MVP build automatically
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
              label="Business website URL"
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
              helperText="Any HTTP/HTTPS link to a real small-business website"
            />

            <FormControl fullWidth disabled={createLeadMutation.isPending}>
              <InputLabel id="add-niche-select-label">Industry (niche)</InputLabel>
              <Select
                labelId="add-niche-select-label"
                label="Industry (niche)"
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
              label="Owner / operator email (optional)"
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
              helperText="If empty, the crawler extracts the email from the site automatically"
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
            Cancel
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
            {createLeadMutation.isPending ? 'Starting audit...' : 'Start audit'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};
