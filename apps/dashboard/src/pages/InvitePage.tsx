import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RegisterSchema } from '@revamp/validation';
import type { IInvitationPreview } from '@revamp/shared-types';
import { ApiError, authApi, invitationApi } from '../api/client.js';
import { RevampLogo } from '../components/RevampLogo.js';
import { ROUTES } from '../routes/paths.js';
import { useAuthStore } from '../store/useAuthStore.js';

type Mode = 'register' | 'login';
type Preview = { state: 'loading' } | { state: 'ready'; data: IInvitationPreview } | { state: 'error'; message: string };

const KNOWN = [
  'INVITATION_NOT_FOUND',
  'INVITATION_EXPIRED',
  'INVITATION_EMAIL_MISMATCH',
  'ALREADY_MEMBER',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
] as const;

/** The join page of an invitation link (REV-207): public, the token in the link is the secret */
export const InvitePage: React.FC = () => {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);

  const [preview, setPreview] = useState<Preview>({ state: 'loading' });
  const [mode, setMode] = useState<Mode>('register');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const messageOf = (e: unknown): string => {
    if (!(e instanceof ApiError)) return t('invite.errors.network');
    return (KNOWN as readonly string[]).includes(e.code ?? '') ? t(`invite.errors.${e.code as (typeof KNOWN)[number]}`) : t('invite.errors.generic');
  };

  useEffect(() => {
    let current = true;
    setPreview({ state: 'loading' });
    invitationApi.preview(token).then(
      (data) => current && setPreview({ state: 'ready', data }),
      (e: unknown) => current && setPreview({ state: 'error', message: messageOf(e) }),
    );
    return () => {
      current = false;
    };
    // The lookup is by token; the message is rendered in the language of the moment
  }, [token]);

  const toApp = () => navigate(ROUTES.queue, { replace: true });

  /** Joins the invited studio with the current session and switches to the session of that studio */
  const accept = async () => {
    const joined = await invitationApi.accept(token);
    signIn(joined);
    toApp();
  };

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e));
      setBusy(false);
    }
  };

  const join = () => run(accept);

  const submit = (invited: IInvitationPreview) => (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'register') {
      const parsed = RegisterSchema.safeParse({
        email: invited.email,
        password,
        invitationToken: token,
        ...(name.trim() ? { name } : {}),
      });
      if (!parsed.success) {
        setError(t('invite.errors.passwordShort'));
        return;
      }
      void run(async () => {
        const registered = await authApi.register({
          email: parsed.data.email,
          password: parsed.data.password,
          invitationToken: token,
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
        });
        signIn(registered);
        toApp();
      });
      return;
    }
    void run(async () => {
      signIn(await authApi.login({ email: invited.email, password }));
      await accept();
    });
  };

  const shell = (children: React.ReactNode) => (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, backgroundColor: 'background.default' }}>
      <Card component="main" sx={{ width: '100%', maxWidth: 420, p: 3.5 }}>
        <Stack spacing={2}>{children}</Stack>
      </Card>
    </Box>
  );

  if (preview.state === 'loading') {
    return shell(
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={18} />
        <Typography variant="body2">{t('invite.loading')}</Typography>
      </Box>,
    );
  }

  if (preview.state === 'error') {
    return shell(
      <>
        <RevampLogo />
        <Alert severity="error">{preview.message}</Alert>
        <MuiLink component={Link} to={ROUTES.login} variant="body2">
          {t('invite.goSignIn')}
        </MuiLink>
      </>,
    );
  }

  const invited = preview.data;
  const header = (
    <>
      <RevampLogo />
      <Box>
        <Typography variant="h5" component="h1">
          {t('invite.title')}
        </Typography>
        <Typography variant="body2">{t('invite.body', { studio: invited.organizationName, role: t(`team.roles.${invited.role}`) })}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('invite.forEmail', { email: invited.email })}
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
    </>
  );

  if (session) {
    const sameAddress = session.user.email.trim().toLowerCase() === invited.email.toLowerCase();
    return shell(
      <>
        {header}
        {sameAddress ? (
          <Button variant="contained" disabled={busy} onClick={join} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {busy ? t('invite.joining') : t('invite.join', { studio: invited.organizationName })}
          </Button>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {t('invite.signedInAs', { email: session.user.email, invited: invited.email })}
            </Typography>
            <Button variant="outlined" onClick={signOut}>
              {t('invite.switchAccount')}
            </Button>
          </>
        )}
      </>,
    );
  }

  const registering = mode === 'register';
  return shell(
    <>
      {header}
      <Stack component="form" spacing={2} onSubmit={submit(invited)} noValidate>
        <TextField name="email" type="email" label={t('auth.email')} value={invited.email} slotProps={{ input: { readOnly: true } }} />
        {registering && <TextField name="name" label={t('auth.yourName')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        <TextField
          name="password"
          type="password"
          label={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={registering ? 'new-password' : 'current-password'}
          helperText={registering ? t('auth.passwordHint') : undefined}
          required
          autoFocus
        />
        <Button type="submit" variant="contained" disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {busy ? t(registering ? 'auth.registering' : 'auth.signingIn') : t(registering ? 'auth.register' : 'auth.signIn')}
        </Button>
      </Stack>
      <Button
        size="small"
        color="inherit"
        onClick={() => {
          setMode(registering ? 'login' : 'register');
          setError(null);
        }}
      >
        {registering ? t('invite.haveAccount') : t('invite.createAccount')}
      </Button>
    </>,
  );
};
