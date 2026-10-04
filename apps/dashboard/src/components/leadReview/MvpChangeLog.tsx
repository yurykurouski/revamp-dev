import React from 'react';
import { Box, Button, Chip, Typography } from '@mui/material';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ChangeEntry, ChangeText, ChangeTone } from '../../utils/mvpChangeLog.js';
import { groupChangeLog } from '../../utils/mvpChangeLog.js';

/** The samples shown per omission entry; the rest are counted */
const MAX_SAMPLES = 6;

const TONE_COLOR: Record<ChangeTone, 'success' | 'error' | 'info'> = { improved: 'success', lost: 'error', info: 'info' };
const TONE_ICON: Record<ChangeTone, React.ReactElement> = {
  improved: <AddCircleOutlineIcon />,
  lost: <RemoveCircleOutlineIcon />,
  info: <InfoOutlinedIcon />,
};

/** A template filled with its values, its `refs` translated first */
export function renderChangeText(t: TFunction, text: ChangeText): string {
  const refs = Object.fromEntries(Object.entries(text.refs ?? {}).map(([name, ref]) => [name, renderChangeText(t, ref)]));
  // Keys are built from the recorded codes; the locale tests check every one exists
  return t(text.key as never, { ...text.values, ...refs }) as string;
}

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0, overflowWrap: 'anywhere' }}>
    <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
      {label}:
    </Box>{' '}
    {children}
  </Typography>
);

const Entry: React.FC<{ entry: ChangeEntry; onShowSection?: (anchor: string) => void }> = ({ entry, onShowSection }) => {
  const { t } = useTranslation();
  const color = TONE_COLOR[entry.tone];
  const samples = entry.samples ?? [];
  return (
    <Box component="li" data-change={entry.id} sx={{ display: 'flex', gap: 1, py: 1, borderTop: '1px solid', borderColor: 'border.subtle', '&:first-of-type': { borderTop: 'none' } }}>
      <Box aria-hidden sx={{ color: `${color}.main`, display: 'flex', pt: 0.25, '& svg': { fontSize: 16 } }}>
        {TONE_ICON[entry.tone]}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0, flexGrow: 1 }}>
        <Typography variant="caption" component="p" sx={{ m: 0, fontWeight: 700, overflowWrap: 'anywhere' }}>
          {renderChangeText(t, entry.what)}
        </Typography>
        {(entry.section !== undefined || entry.anchor) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            {entry.section !== undefined && (
              <Chip
                size="small"
                variant="outlined"
                label={entry.section ?? t('mvpChangeLog.untitledSection')}
                sx={{ height: 20, fontSize: '0.68rem', maxWidth: 280 }}
              />
            )}
            {entry.anchor && onShowSection && (
              <Button
                size="small"
                startIcon={<VisibilityOutlinedIcon />}
                onClick={() => onShowSection(entry.anchor!)}
                sx={{ textTransform: 'none', minHeight: 0, py: 0, fontSize: '0.7rem' }}
              >
                {t('mvpChangeLog.showInPreview')}
              </Button>
            )}
          </Box>
        )}
        <Line label={t('mvpChangeLog.why')}>{renderChangeText(t, entry.why)}</Line>
        <Line label={entry.group === 'omitted' ? t('mvpChangeLog.loss') : t('mvpChangeLog.effect')}>{renderChangeText(t, entry.effect)}</Line>
        {samples.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }} aria-label={t('mvpChangeLog.samples')}>
            {samples.slice(0, MAX_SAMPLES).map((sample) => (
              <Chip key={sample} size="small" label={`“${sample}”`} sx={{ height: 20, fontSize: '0.68rem', maxWidth: 240 }} />
            ))}
            {samples.length > MAX_SAMPLES && (
              <Typography variant="caption" color="text.secondary">
                +{samples.length - MAX_SAMPLES}
              </Typography>
            )}
          </Box>
        )}
        {entry.note && (
          <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0, fontStyle: 'italic' }}>
            {renderChangeText(t, entry.note)}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

interface MvpChangeLogProps {
  entries: ChangeEntry[];
  /** Scrolls the preview to an element of the published page */
  onShowSection?: (anchor: string) => void;
}

/**
 * Every change of the published MVP with its reason and what it means for visitors (REV-119), grouped. The text is
 * built from recorded codes and measured values (`buildMvpChangeLog`); nothing here is written by a model.
 */
export const MvpChangeLog: React.FC<MvpChangeLogProps> = ({ entries, onShowSection }) => {
  const { t } = useTranslation();
  const omitted = entries.filter((entry) => entry.group === 'omitted').length;
  return (
    <Box component="section" aria-labelledby="mvp-change-log-title" data-testid="mvp-change-log" sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography id="mvp-change-log-title" variant="caption" component="h4" sx={{ fontWeight: 700, m: 0 }}>
          {t('mvpChangeLog.title')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t('mvpChangeLog.counts', { changes: entries.length - omitted, omitted })}
        </Typography>
      </Box>
      <Typography variant="caption" component="p" color="text.secondary" sx={{ m: 0, mb: 1 }}>
        {t('mvpChangeLog.intro')}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {t('mvpChangeLog.empty')}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {groupChangeLog(entries).map(({ group, entries: list }) => (
            <Box
              key={group}
              data-group={group}
              sx={{ p: 1.25, borderRadius: 2, border: '1px solid', borderColor: 'border.subtle', backgroundColor: 'surface.raised' }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" component="h5" sx={{ fontWeight: 700, m: 0, flexGrow: 1 }}>
                  {t(`mvpChangeLog.groups.${group}`)}
                </Typography>
                <Chip size="small" label={list.length} color={group === 'omitted' ? 'warning' : 'default'} sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />
              </Box>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {list.map((entry) => (
                  <Entry key={entry.id} entry={entry} onShowSection={onShowSection} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
