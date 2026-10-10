import React, { useState } from 'react';
import { Box, Button, Chip, Collapse, LinearProgress, Typography } from '@mui/material';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import SpeedIcon from '@mui/icons-material/Speed';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
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

const SummaryCards: React.FC<{ summary: Summary }> = ({ summary }) => {
  const { t } = useTranslation();
  const { standards, accessibility, performance, businessData } = summary;
  const fieldLabel = (field: string) => t(`completeness.fields.${field}` as 'completeness.fields.phone');
  const checkLabel = (check: string) => t(`seo.checks.${check}` as 'seo.checks.https');
  const standardsTag: Tag | undefined = standards
    ? standards.regressed.length > 0
      ? { label: t('mvpChanges.tags.check'), tone: 'warning' }
      : standards.fixed.length > 0
        ? { label: t('mvpChanges.tags.improved'), tone: 'success' }
        : undefined
    : undefined;

  return (
    <Box
      component="ul"
      sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1.25 }}
    >
      {standards && (
        <ChangeCard icon={<TravelExploreIcon />} title={t('mvpChanges.seo')} tag={standardsTag}>
          <Stat
            before={standards.originalScore}
            value={standards.mvpScore}
            label={t(standards.originalScore !== undefined ? 'mvpChanges.seoScore' : 'mvpChanges.seoMvpScore')}
          />
          {standards.fixed.length > 0 && <Text>{t('seo.fixed', { checks: standards.fixed.map(checkLabel).join(', ') })}</Text>}
          {standards.regressed.length > 0 && (
            <Text muted>{t('seo.regressed', { checks: standards.regressed.map(checkLabel).join(', ') })}</Text>
          )}
        </ChangeCard>
      )}

      {performance && (
        <ChangeCard icon={<SpeedIcon />} title={t('mvpChanges.performance')}>
          {performance.lcp || performance.cls ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5 }}>
              {performance.lcp && (
                <Stat before={performance.lcp.original?.toFixed(1)} value={performance.lcp.mvp.toFixed(1)} label={t('mvpChanges.lcp')} />
              )}
              {performance.cls && (
                <Stat before={performance.cls.original?.toFixed(2)} value={performance.cls.mvp.toFixed(2)} label={t('mvpChanges.cls')} />
              )}
            </Box>
          ) : (
            <Text muted>{t('mvpChanges.perfNotMeasured', { error: performance.error ?? '' })}</Text>
          )}
          <Text muted>{t('mvpChanges.measuredOn', { host: performance.host })}</Text>
        </ChangeCard>
      )}

      {accessibility && (
        <ChangeCard icon={<AccessibilityNewIcon />} title={t('mvpChanges.accessibility')}>
          <Text>{t('mvpChanges.a11yOriginal', { count: accessibility.originalViolations })}</Text>
          <Text muted>{t('mvpChanges.a11yNotMeasured')}</Text>
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
            {/* A field can fail more than once, even with the same status (several unsourced phones) */}
            {businessData.issues.map(({ field, status }, idx) => (
              <Chip
                key={`${field}-${status}-${idx}`}
                size="small"
                color={COMPLETENESS_STATUS_COLOR[status]}
                label={`${fieldLabel(field)}: ${t(`completeness.statuses.${status}`)}`}
                sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
              />
            ))}
          </Box>
        </ChangeCard>
      )}
    </Box>
  );
};

/**
 * "What changed": the published MVP compared with the original site (REV-81), from measured facts only
 * (REV-140, AGENTS.md §3.2.2). Renders nothing until an MVP exists.
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
        <Box id="mvp-changes-body" sx={{ pt: 1, pb: 0.5, maxHeight: 520, overflowY: 'auto' }}>
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
