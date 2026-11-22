import React, { useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, Link as MuiLink, Stack, TextField, Typography } from '@mui/material';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LoginSchema, RegisterSchema } from '@revamp/validation';
import { ApiError, authApi } from '../api/client.js';
import { RevampLogo } from '../components/RevampLogo.js';
import { openedInApp, ROUTES, type LeadLocationState } from '../routes/paths.js';
import { useAuthStore } from '../store/useAuthStore.js';

type Mode = 'login' | 'register';

interface Values {
  email: string;
  password: string;
  organizationName: string;
  name: string;
}

/** Sign-in and registration (REV-206): one form, the registration adds the studio name and an optional name */
export const AuthPage: React.FC<{ mode: Mode }> = ({ mode }) => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const [values, setValues] = useState<Values>({ email: '', password: '', organizationName: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register';
  // Back to the page the guard sent the user away from, only when it is a path of this app
  const target = openedInApp(state) ? (state as LeadLocationState).from! : ROUTES.queue;
  if (session) return <Navigate to={target} replace />;

  const set = (name: keyof Values) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  const validate = () => {
    if (registering) {
      const parsed = RegisterSchema.safeParse({
        email: values.email,
        password: values.password,
        organizationName: values.organizationName,
        ...(values.name.trim() ? { name: values.name } : {}),
      });
      if (parsed.success) return { data: parsed.data };
      const field = parsed.error.issues[0]?.path[0];
      return { message: t(field === 'email' ? 'auth.errors.email' : field === 'password' ? 'auth.errors.passwordShort' : 'auth.errors.organizationName') };
    }
    const parsed = LoginSchema.safeParse({ email: values.email, password: values.password });
    if (parsed.success) return { data: parsed.data };
    return { message: t(parsed.error.issues[0]?.path[0] === 'email' ? 'auth.errors.email' : 'auth.errors.INVALID_CREDENTIALS') };
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const checked = validate();
    if (checked.message) {
      setError(checked.message);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = registering
        ? await authApi.register(checked.data as Parameters<typeof authApi.register>[0])
        : await authApi.login(checked.data as Parameters<typeof authApi.login>[0]);
      signIn(result);
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError) {
        setError(e.code === 'INVALID_CREDENTIALS' || e.code === 'EMAIL_TAKEN' ? t(`auth.errors.${e.code}`) : t('auth.errors.generic'));
      } else {
        setError(t('auth.errors.network'));
      }
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, backgroundColor: 'background.default' }}>
      <Card component="main" sx={{ width: '100%', maxWidth: 400, p: 3.5 }}>
        <Stack component="form" spacing={2} onSubmit={submit} noValidate>
          <RevampLogo />
          <Box>
            <Typography variant="h5" component="h1">
              {t(registering ? 'auth.registerTitle' : 'auth.signInTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(registering ? 'auth.registerSubtitle' : 'auth.signInSubtitle')}
            </Typography>
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {registering && (
            <TextField name="organizationName" label={t('auth.organizationName')} value={values.organizationName} onChange={set('organizationName')} autoComplete="organization" required />
          )}
          {registering && (
            <TextField name="name" label={t('auth.yourName')} value={values.name} onChange={set('name')} autoComplete="name" />
          )}
          <TextField name="email" type="email" label={t('auth.email')} value={values.email} onChange={set('email')} autoComplete="email" required autoFocus />
          <TextField
            name="password"
            type="password"
            label={t('auth.password')}
            value={values.password}
            onChange={set('password')}
            autoComplete={registering ? 'new-password' : 'current-password'}
            helperText={registering ? t('auth.passwordHint') : undefined}
            required
          />
          <Button type="submit" variant="contained" disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {busy ? t(registering ? 'auth.registering' : 'auth.signingIn') : t(registering ? 'auth.register' : 'auth.signIn')}
          </Button>
          <Typography variant="body2" color="text.secondary">
            {t(registering ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
            <MuiLink component={Link} to={registering ? ROUTES.login : ROUTES.register}>
              {t(registering ? 'auth.goSignIn' : 'auth.goRegister')}
            </MuiLink>
          </Typography>
        </Stack>
      </Card>
    </Box>
  );
};
