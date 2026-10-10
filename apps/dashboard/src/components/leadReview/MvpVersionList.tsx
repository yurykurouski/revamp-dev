import React from 'react';
import { Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import type { ListedVersion } from '../../utils/mvpPage.js';

interface MvpVersionListProps {
  /** Newest first (`versionsNewestFirst`) */
  versions: ListedVersion[];
  disabled: boolean;
  /** The version being restored */
  pending?: number;
  onRestore: (n: number) => void;
}

/**
 * The page's published versions (REV-140): number, what made it, the operator's words for a change, and when. An
 * older one is restored as a new version, with the current colors and fonts; the published one is marked.
 */
export const MvpVersionList: React.FC<MvpVersionListProps> = ({ versions, disabled, pending, onRestore }) => {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const when = (at: string) => {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? '' : format.format(date);
  };

  return (
    <Box data-testid="mvp-version-list" sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <HistoryIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {t('mvpPage.versions.title')}
        </Typography>
      </Box>
      {versions.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {t('mvpPage.versions.empty')}
        </Typography>
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 220, overflowY: 'auto' }}>
          {versions.map((version) => (
            <Box
              component="li"
              key={version.n}
              data-testid="mvp-version"
              data-version={version.n}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'border.subtle', minWidth: 0 }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {t('mvpPage.versions.number', { n: version.n })}
                  {' · '}
                  {version.from !== undefined
                    ? t('mvpPage.versions.restoredFrom', { n: version.from })
                    : t(`mvpPage.versions.kinds.${version.kind}`)}
                </Typography>
                {version.instruction && (
                  <Typography
                    variant="caption"
                    title={version.instruction}
                    sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {version.instruction}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  {when(version.createdAt)}
                </Typography>
              </Box>
              {version.current ? (
                <Chip label={t('mvpPage.versions.current')} size="small" color="success" sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />
              ) : (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={disabled}
                  onClick={() => onRestore(version.n)}
                  data-testid={`mvp-version-restore-${version.n}`}
                  startIcon={pending === version.n ? <CircularProgress size={12} color="inherit" /> : undefined}
                  sx={{ flexShrink: 0 }}
                >
                  {t('mvpPage.versions.restore')}
                </Button>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
