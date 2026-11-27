import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { IContactRightView } from '@revamp/shared-types';
import { useLanguageStore } from '../store/useLanguageStore.js';
import { formatDate } from '../i18n/languages.js';
import { useNow } from '../hooks/useNow.js';
import { contactRightState, DATE_FORMAT } from '../utils/contactRight.js';

/** The studio's contact right on a lead: until when, a warning when it is about to end, and why it ended (REV-228) */
/** `compact` (the table, REV-229) shortens the label so the full date fits; the full text is its tooltip */
export const ContactRightChip: React.FC<{ right: IContactRightView | null | undefined; size?: 'small' | 'medium'; variant?: 'full' | 'compact' }> = ({ right, size = 'small', variant = 'full' }) => {
  const { t } = useTranslation();
  const { language } = useLanguageStore();
  const now = useNow(60_000);
  const state = contactRightState(right, now);
  if (state === 'none' || !right) return null;
  if (state === 'ended') {
    return <Chip size={size} color="default" data-testid="contact-right-chip" label={right.endReason === 'opted_out' ? t('contactRight.optedOut') : t('contactRight.expired')} />;
  }
  const date = formatDate(right.expiresAt, language, DATE_FORMAT);
  const color = state === 'expiring' ? 'warning' : 'success';
  if (variant === 'compact') {
    return (
      <Tooltip title={t('contactRight.until', { date })}>
        <Chip size={size} color={color} data-testid="contact-right-chip" label={t('contactRight.untilShort', { date })} />
      </Tooltip>
    );
  }
  return <Chip size={size} color={color} data-testid="contact-right-chip" label={t('contactRight.until', { date })} />;
};
