import React, { useState } from 'react';
import { Box, Button, Chip, Collapse, LinearProgress, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import { useTranslation } from 'react-i18next';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { isMvpChangeSummaryEmpty, MvpChangeSummary as Summary, summarizeMvpChanges } from '../../utils/mvpChanges.js';
import { COMPLETENESS_STATUS_COLOR } from '../../utils/completeness.js';

type Tone = 'success' | 'info' | 'warning' | 'error' | 'default';
interface Tag {
  label: string;
  tone: Tone;
}

interface MvpChangeSummaryProps {
  mvp?: IMvpProjectDetail | null;
  audit?: IAuditDetail | null;
}

/** One kind of change: an icon tile, its name, a tag saying what happened, and the details */
const ChangeCard: React.FC<{ icon: React.ReactElement; title: string; tag?: Tag; wide?: boolean; children: React.ReactNode }> = ({
  icon,
  title,
  tag,
  wide,
  children,
}) => {
  const tone = tag && tag.tone !== 'default' ? tag.tone : 'primary';
  return (
    <Box
      component="li"
      sx={{
        gridColumn: wide ? '1 / -1' : undefined,
        p: 1.5,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.subtle',
        backgroundColor: 'surface.raised',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box
          aria-hidden
          sx={{
            width: 26,
            height: 26,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            backgroundColor: `${tone}.soft`,
            color: `${tone}.main`,
            '& svg': { fontSize: 16 },
          }}
        >
          {icon}
        </Box>
        <Typography variant="caption" component="h4" sx={{ fontWeight: 700, flexGrow: 1, m: 0 }}>
          {title}
        </Typography>
        {tag && <Chip label={tag.label} size="small" color={tag.tone} sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700 }} />}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>{children}</Box>
    </Box>
  );
};

const Text: React.FC<{ children: React.ReactNode; muted?: boolean }> = ({ children, muted }) => (
  <Typography variant="caption" color={muted ? 'text.secondary' : 'text.primary'} sx={{ overflowWrap: 'anywhere' }}>
    {children}
  </Typography>
);

/** A number worth reading at a glance, with what it counts */
const Stat: React.FC<{ value: React.ReactNode; label: string; before?: React.ReactNode }> = ({ value, label, before }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {before !== undefined && (
        <>
          <Typography variant="h6" component="span" color="text.secondary" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {before}
          </Typography>
          <ArrowForwardIcon aria-hidden sx={{ fontSize: 16, color: 'text.secondary' }} />
        </>
      )}
      <Typography variant="h6" component="span" color="primary.main" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
        {value}
      </Typography>
    </Box>
    <Text muted>{label}</Text>
  </Box>
);

const Swatch: React.FC<{ color?: string; caption: string; empty: string }> = ({ color, caption, empty }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
    <Box
      aria-hidden
      sx={{
        width: 28,
        height: 28,
        borderRadius: 1.5,
        flexShrink: 0,
        border: '1px dashed',
        borderColor: color ? 'transparent' : 'border.strong',
        // The swatch shows the stored brand color itself, not a theme token
        backgroundColor: color ?? 'transparent',
      }}
    />
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Text muted>{caption}</Text>
      <Typography variant="caption" sx={{ fontWeight: 700, fontFamily: 'monospace' }}>
        {color ?? empty}
      </Typography>
    </Box>
  </Box>
);

const SummaryCards: React.FC<{ summary: Summary }> = ({ summary }) => {
  const { t } = useTranslation();
  const { layout, copySource, sections, palette, businessData, critiqueGuidance } = summary;
  const fieldLabel = (field: string) => t(`completeness.fields.${field}` as 'completeness.fields.phone');

  const paletteTag: Tag | undefined = palette
    ? palette.original
      ? { label: t('mvpChanges.tags.changed'), tone: 'warning' }
      : { label: t('mvpChanges.tags.default'), tone: 'default' }
    : undefined;

  return (
    <Box
      component="ul"
      sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.25 }}
    >
      {layout && (
        <ChangeCard
          icon={<DashboardCustomizeIcon />}
          title={t('mvpChanges.layout')}
          tag={{ label: t('mvpChanges.tags.newLayout'), tone: 'info' }}
        >
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {t(`mvpLayout.variants.${layout.variant}`)}
          </Typography>
          {layout.rule && <Text muted>{t(`mvpLayout.rules.${layout.rule}`)}</Text>}
        </ChangeCard>
      )}

      {copySource && (
        <ChangeCard
          icon={<AutoAwesomeIcon />}
          title={t('mvpChanges.copy')}
          tag={
            copySource.actual === 'deterministic'
              ? { label: t('mvpChanges.tags.template'), tone: 'default' }
              : { label: t('mvpChanges.tags.rewritten'), tone: 'info' }
          }
        >
          <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
            {copySource.actual === 'deterministic' ? t('llm.deterministic') : copySource.actual}
          </Typography>
          {copySource.requested && <Text muted>{t('llm.requested', { name: copySource.requested })}</Text>}
        </ChangeCard>
      )}

      {sections && (
        <ChangeCard icon={<ViewQuiltOutlinedIcon />} title={t('mvpChanges.sections')}>
          {(sections.services || sections.trustSignals > 0) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5 }}>
              {/* The original count is what the crawler extracted as a list, not everything the site mentions */}
              {sections.services && (
                <Stat
                  before={sections.services.original || '—'}
                  value={sections.services.mvp}
                  label={t(sections.services.original === 0 ? 'mvpChanges.servicesNoneFound' : 'mvpChanges.servicesCompared')}
                />
              )}
              {sections.trustSignals > 0 && <Stat value={sections.trustSignals} label={t('mvpChanges.trustSignals')} />}
            </Box>
          )}
          {sections.about && (
            <Box>
              <Chip label={t('mvpChanges.aboutSection')} size="small" color="success" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }} />
            </Box>
          )}
        </ChangeCard>
      )}

      {palette && (
        <ChangeCard icon={<PaletteOutlinedIcon />} title={t('mvpChanges.palette')} tag={paletteTag}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Swatch color={palette.original} caption={t('mvpChanges.paletteOriginal')} empty={t('mvpChanges.paletteNone')} />
            <ArrowForwardIcon aria-hidden sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Swatch color={palette.mvp} caption={t('mvpChanges.paletteMvp')} empty={t('mvpChanges.paletteNone')} />
          </Box>
          {!palette.original && <Text muted>{t('mvpChanges.paletteDefault')}</Text>}
        </ChangeCard>
      )}

      {businessData && (
        <ChangeCard
          icon={<FactCheckIcon />}
          title={t('mvpChanges.businessData')}
          tag={{ label: t('mvpChanges.tags.issues', { count: businessData.issues.length }), tone: 'error' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LinearProgress
              variant="determinate"
              value={businessData.checked ? (businessData.kept / businessData.checked) * 100 : 0}
              color="warning"
              aria-label={t('mvpChanges.businessData')}
              sx={{ flexGrow: 1, height: 6, borderRadius: 3 }}
            />
            <Typography variant="caption" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {businessData.kept}/{businessData.checked}
            </Typography>
          </Box>
          <Text muted>{t('mvpChanges.dataKept', { kept: businessData.kept, checked: businessData.checked })}</Text>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {businessData.issues.map(({ field, status }) => (
              <Chip
                key={field}
                size="small"
                color={COMPLETENESS_STATUS_COLOR[status]}
                label={`${fieldLabel(field)}: ${t(`completeness.statuses.${status}`)}`}
                sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
              />
            ))}
          </Box>
        </ChangeCard>
      )}

      {critiqueGuidance.length > 0 && (
        <ChangeCard
          wide
          icon={<LightbulbOutlinedIcon />}
          title={t('mvpChanges.critique')}
          tag={{ label: t('mvpChanges.tags.guidance'), tone: 'default' }}
        >
          <Text muted>{t('mvpChanges.critiqueNote')}</Text>
          <Box component="ol" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {critiqueGuidance.map((win, idx) => (
              <li key={idx}>
                <Text>{win}</Text>
              </li>
            ))}
          </Box>
        </ChangeCard>
      )}
    </Box>
  );
};

/**
 * "What changed": the generated MVP compared with the original site (REV-81), built only from
 * data the pipeline stored (AGENTS.md §3.2.2). Renders nothing until an MVP exists.
 */
export const MvpChangeSummary: React.FC<MvpChangeSummaryProps> = ({ mvp, audit }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const summary = summarizeMvpChanges(mvp, audit);
  if (!summary) return null;

  return (
    <Box component="section" aria-labelledby="mvp-changes-title" sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography id="mvp-changes-title" variant="subtitle2" component="h3" sx={{ fontWeight: 700 }}>
          {t('mvpChanges.title')}
        </Typography>
        <Button
          size="small"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mvp-changes-body"
          endIcon={open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          sx={{ textTransform: 'none' }}
        >
          {open ? t('mvpChanges.hide') : t('mvpChanges.show')}
        </Button>
      </Box>
      <Collapse in={open}>
        <Box id="mvp-changes-body" sx={{ pt: 1, pb: 0.5, maxHeight: 340, overflowY: 'auto' }}>
          {isMvpChangeSummaryEmpty(summary) ? (
            <Typography variant="caption" color="text.secondary">
              {t('mvpChanges.empty')}
            </Typography>
          ) : (
            <SummaryCards summary={summary} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
};
