import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Skeleton, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { StudioSenderSchema } from '@revamp/validation';
import { useSaveSenderMutation, useSenderQuery } from '../../hooks/useSender.js';
import { usePermissions } from '../../hooks/usePermissions.js';

/**
 * The studio's sender (REV-221): every role sees it, the owner edits it. Emails are simulated, so the address is not
 * verified and the note says nothing is delivered.
 */
export const SenderSection: React.FC = () => {
  const { t } = useTranslation();
  const { canManageMembers } = usePermissions();
  const { data, isLoading, isError, error } = useSenderQuery();
  const save = useSaveSenderMutation();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  // The form starts from the saved sender, and follows it when it changes
  useEffect(() => {
    if (data?.configured) {
      setName(data.name ?? '');
      setAddress(data.address ?? '');
    }
  }, [data?.configured, data?.name, data?.address]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    const parsed = StudioSenderSchema.safeParse({ name, address });
    if (!parsed.success) {
      setMessage({ severity: 'error', text: t('settings.sender.invalid') });
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      setMessage({ severity: 'success', text: t('settings.sender.saved') });
    } catch (err) {
      setMessage({ severity: 'error', text: t('settings.sender.saveFailed', { error: err instanceof Error ? err.message : String(err) }) });
    }
  };

  return (
    <Box sx={{ px: 2.5, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="sender-section">
      {isLoading && <Skeleton variant="rounded" height={24} />}
      {isError && <Alert severity="error">{error instanceof Error ? error.message : String(error)}</Alert>}
      {data && (
        <Typography variant="body2" data-testid="sender-current">
          {data.configured ? t('settings.sender.current', { name: data.name, address: data.address }) : t('settings.sender.none')}
        </Typography>
      )}
      {data && canManageMembers && (
        <Box component="form" onSubmit={submit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField label={t('settings.sender.name')} value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth required />
          <TextField label={t('settings.sender.address')} value={address} onChange={(e) => setAddress(e.target.value)} size="small" type="email" fullWidth required />
          <Box>
            <Button type="submit" variant="contained" disabled={save.isPending} data-testid="sender-save">
              {t('settings.sender.save')}
            </Button>
          </Box>
        </Box>
      )}
      {data && !canManageMembers && (
        <Typography variant="caption" color="text.secondary" data-testid="sender-owner-only">
          {t('settings.sender.ownerOnly')}
        </Typography>
      )}
      {message && <Alert severity={message.severity}>{message.text}</Alert>}
      <Typography variant="caption" color="text.secondary">
        {t('settings.sender.simulatedNote')}
      </Typography>
    </Box>
  );
};
