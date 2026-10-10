import React from 'react';
import { TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { MVP_FONT_CHOICES, MvpFontChoice } from '@revamp/shared-types';

interface MvpFontControlProps {
  /** The saved pairing, or null for the page's own fonts */
  value: MvpFontChoice['id'] | null;
  disabled: boolean;
  onChange: (fonts: { heading: string; body: string } | null) => void;
}

/** The page's fonts (REV-140): one of the fixed pairings, or the page's own; a pick publishes at once, no model call */
export const MvpFontControl: React.FC<MvpFontControlProps> = ({ value, disabled, onChange }) => {
  const { t } = useTranslation();
  return (
    <TextField
      select
      size="small"
      fullWidth
      label={t('mvpPage.fonts.title')}
      value={value ?? ''}
      disabled={disabled}
      SelectProps={{ native: true }}
      data-testid="mvp-font-control"
      onChange={(event) => {
        const id = event.target.value;
        if (id === (value ?? '')) return;
        const choice = MVP_FONT_CHOICES.find((c) => c.id === id);
        onChange(choice ? { heading: choice.heading, body: choice.body } : null);
      }}
    >
      <option value="">{t('mvpPage.fonts.pageOwn')}</option>
      {MVP_FONT_CHOICES.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {t('mvpPage.fonts.pair', { heading: choice.heading, body: choice.body })}
        </option>
      ))}
    </TextField>
  );
};
