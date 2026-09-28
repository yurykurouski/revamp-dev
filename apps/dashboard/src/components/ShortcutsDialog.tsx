import React from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { isMacPlatform, SHORTCUT_SCOPES, SHORTCUTS } from '../utils/shortcuts.js';
import { KeyCaps } from './KeyCaps.js';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Whether to show ⌘ rather than Ctrl; the current platform by default */
  mac?: boolean;
}

const TITLE_ID = 'shortcuts-dialog-title';

/** Every keyboard shortcut of the registry, by where it works (REV-47); opened with `?` or from the rail */
export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onClose, mac = isMacPlatform() }) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth aria-labelledby={TITLE_ID}>
      <DialogTitle id={TITLE_ID} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        {t('shortcuts.title')}
        <IconButton onClick={onClose} aria-label={t('shortcuts.close')} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {SHORTCUT_SCOPES.map((scope) => (
          <Box key={scope} component="section" data-shortcut-scope={scope}>
            <Typography variant="overline" component="h3" color="text.secondary">
              {t(`shortcuts.scopes.${scope}`)}
            </Typography>
            <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {SHORTCUTS.filter((def) => def.scope === scope).map((def) => (
                <Box key={def.id} data-shortcut={def.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                  <Typography component="dt" variant="body2">
                    {t(`shortcuts.actions.${def.id}`)}
                  </Typography>
                  <Box component="dd" sx={{ m: 0 }}>
                    <KeyCaps shortcut={def} mac={mac} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
        <Typography variant="body2" color="text.secondary">
          {t('shortcuts.typingHint')}
        </Typography>
      </DialogContent>
    </Dialog>
  );
};
