import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { ORGANIZATION_ROLES, type IOrganizationMember, type OrganizationRole } from '@revamp/shared-types';
import { CreateInvitationSchema } from '@revamp/validation';
import { ApiError } from '../api/client.js';
import {
  useChangeMemberRoleMutation,
  useCreateInvitationMutation,
  useMembersQuery,
  useRemoveMemberMutation,
  useRevokeInvitationMutation,
} from '../hooks/useTeam.js';
import { formatDate } from '../i18n/languages.js';
import { invitePath } from '../routes/paths.js';
import { useAuthStore } from '../store/useAuthStore.js';
import { useLanguageStore } from '../store/useLanguageStore.js';

const KNOWN_ERRORS = ['LAST_OWNER', 'ALREADY_MEMBER', 'MEMBER_NOT_FOUND', 'FORBIDDEN'] as const;

/** The refusal the API gave, in words; anything else is a generic failure */
const useErrorText = () => {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const code = error instanceof ApiError ? error.code : undefined;
    return (KNOWN_ERRORS as readonly string[]).includes(code ?? '')
      ? t(`team.errors.${code as (typeof KNOWN_ERRORS)[number]}`)
      : t('team.errors.generic');
  };
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Card component="section" aria-label={title}>
    <Box sx={{ px: 2.5, py: 2 }}>
      <Typography variant="overline" component="h2" color="text.secondary">
        {title}
      </Typography>
    </Box>
    {children}
  </Card>
);

const RoleSelect: React.FC<{
  value: OrganizationRole;
  onChange: (role: OrganizationRole) => void;
  name?: string;
  label: string;
  disabled?: boolean;
}> = ({ value, onChange, name, label, disabled }) => {
  const { t } = useTranslation();
  return (
    <TextField
      select
      size="small"
      name={name}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as OrganizationRole)}
      slotProps={{ select: { native: true }, htmlInput: { 'aria-label': label } }}
      sx={{ minWidth: 140 }}
    >
      {ORGANIZATION_ROLES.map((role) => (
        <option key={role} value={role}>
          {t(`team.roles.${role}`)}
        </option>
      ))}
    </TextField>
  );
};

const Row: React.FC<{ testId: string; children: React.ReactNode }> = ({ testId, children }) => (
  <Box
    data-testid={testId}
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, px: 2.5, py: 1.5, borderTop: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}
  >
    {children}
  </Box>
);

/** The team of the signed-in owner's organization (REV-207): roles, removal and invitations through a one-time link */
export const TeamPage: React.FC = () => {
  const { t } = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const me = useAuthStore((s) => s.session?.user.id);
  const errorText = useErrorText();
  const members = useMembersQuery();
  const changeRole = useChangeMemberRoleMutation();
  const removeMember = useRemoveMemberMutation();
  const createInvitation = useCreateInvitationMutation();
  const revokeInvitation = useRevokeInvitationMutation();

  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<IOrganizationMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrganizationRole>('operator');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fail = (e: unknown) => setError(errorText(e));

  const submitInvite = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = CreateInvitationSchema.safeParse({ email: inviteEmail, role: inviteRole });
    if (!parsed.success) {
      setError(t('team.errors.email'));
      return;
    }
    setError(null);
    setLink(null);
    setCopied(false);
    createInvitation.mutate(parsed.data, {
      onSuccess: ({ token }) => {
        setLink(`${window.location.origin}${invitePath(token)}`);
        setInviteEmail('');
      },
      onError: fail,
    });
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard blocked: the link stays in the field to copy by hand
    }
  };

  const confirmRemove = () => {
    const member = removing;
    setRemoving(null);
    if (!member) return;
    setError(null);
    removeMember.mutate(member.userId, { onError: fail });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 820 }}>
      <Box>
        <Typography variant="h5" component="h1">
          {t('team.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('team.subtitle')}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {members.isError && <Alert severity="error">{t('team.loadFailed')}</Alert>}

      <Section title={t('team.members')}>
        {members.isLoading && <Skeleton variant="rounded" height={48} sx={{ mx: 2.5, mb: 2 }} />}
        {members.data?.members.map((member) => (
          <Row key={member.userId} testId="member-row">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {member.name ?? member.email}
                {member.userId === me && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    {t('team.you')}
                  </Typography>
                )}
              </Typography>
              {member.name && (
                <Typography variant="caption" color="text.secondary">
                  {member.email}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <RoleSelect
                value={member.role}
                label={t('team.role')}
                onChange={(role) => {
                  setError(null);
                  changeRole.mutate({ userId: member.userId, role }, { onError: fail });
                }}
              />
              <Tooltip title={t('team.remove')}>
                <IconButton size="small" aria-label={t('team.remove')} onClick={() => setRemoving(member)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Row>
        ))}
      </Section>

      <Section title={t('team.inviteTitle')}>
        <Box component="form" onSubmit={submitInvite} noValidate sx={{ display: 'flex', gap: 1.5, px: 2.5, pb: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            name="inviteEmail"
            type="email"
            size="small"
            label={t('team.inviteEmail')}
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            sx={{ flex: '1 1 240px' }}
          />
          <RoleSelect name="inviteRole" value={inviteRole} onChange={setInviteRole} label={t('team.inviteRole')} />
          <Button type="submit" variant="contained" disabled={createInvitation.isPending}>
            {createInvitation.isPending ? t('team.creating') : t('team.createInvitation')}
          </Button>
        </Box>
        {link && (
          <Box sx={{ px: 2.5, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('team.linkTitle')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField data-testid="invitation-link" size="small" value={link} fullWidth slotProps={{ input: { readOnly: true } }} />
              <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyLink}>
                {copied ? t('team.copied') : t('team.copy')}
              </Button>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('team.linkHint')}
            </Typography>
          </Box>
        )}
      </Section>

      <Section title={t('team.pending')}>
        {members.data && members.data.invitations.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, pb: 2 }}>
            {t('team.noPending')}
          </Typography>
        )}
        {members.data?.invitations.map((invitation) => (
          <Row key={invitation.id} testId="invitation-row">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {invitation.email} · {t(`team.roles.${invitation.role}`)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('team.expires', { date: formatDate(invitation.expiresAt, language, { day: 'numeric', month: 'short', year: 'numeric' }) })}
              </Typography>
            </Box>
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                setError(null);
                revokeInvitation.mutate(invitation.id, { onError: fail });
              }}
            >
              {t('team.revoke')}
            </Button>
          </Row>
        ))}
      </Section>

      <Dialog open={removing !== null} onClose={() => setRemoving(null)}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('team.removeTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('team.removeBody', { email: removing?.email ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setRemoving(null)}>
            {t('team.cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={confirmRemove}>
            {t('team.confirmRemove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
