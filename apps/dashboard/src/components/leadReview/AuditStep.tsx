import React, { useState } from 'react';
import { Alert, Box, Button, Card, CircularProgress, Tab, Tabs, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SpeedIcon from '@mui/icons-material/Speed';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useTranslation } from 'react-i18next';
import type { IAuditDetail, IMvpProjectDetail } from '../../api/client.js';
import { CompletenessChecklist } from '../CompletenessChecklist.js';

/** Shown for a metric the audit did not measure */
export const NOT_MEASURED = '—';

type ScreenshotDevice = 'desktop' | 'mobile';

/** Width of the findings column when it sits beside the screenshot */
export const AUDIT_FINDINGS_WIDTH = 380;

/**
 * From this breakpoint up the findings sit beside the screenshot; below it they stack under it, full
 * width (REV-83). At `lg` the review queue's lead list (380px) and the findings column leave the
 * screenshot too little room, so the row waits for `xl`.
 */
export const AUDIT_ROW_BREAKPOINT = 'xl';

interface AuditStepProps {
  audit?: IAuditDetail | null;
  mvp?: IMvpProjectDetail | null;
  isLoading: boolean;
  /** The audit failed to load */
  error?: unknown;
}

interface MetricProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}

const Metric: React.FC<MetricProps> = ({ icon, label, value, color }) => (
  <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
    {icon}
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color }}>
        {value}
      </Typography>
    </Box>
  </Card>
);

/**
 * Step 1 of a lead review (REV-77): the original site's full-page screenshot next to (or, below `xl`, above) the audit — the
 * measured metrics (a value the audit did not measure shows as missing, REV-45), the MVP data check,
 * the critical flaws and the quick wins.
 */
export const AuditStep: React.FC<AuditStepProps> = ({ audit, mvp, isLoading, error }) => {
  const { t } = useTranslation();
  const [device, setDevice] = useState<ScreenshotDevice>('desktop');
  // Screenshot URL that failed to load; the viewer then says so instead of showing another image
  const [brokenScreenshotUrl, setBrokenScreenshotUrl] = useState<string | null>(null);

  // Prefer the full-page capture (REV-21); fall back to the above-the-fold shot for older audits
  const screenshotUrl =
    device === 'desktop'
      ? audit?.desktopFullScreenshotUrl || audit?.desktopScreenshotUrl
      : audit?.mobileFullScreenshotUrl || audit?.mobileScreenshotUrl;
  const screenshotAvailable = Boolean(screenshotUrl) && brokenScreenshotUrl !== screenshotUrl;
  const isFullPage = Boolean(device === 'desktop' ? audit?.desktopFullScreenshotUrl : audit?.mobileFullScreenshotUrl);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', [AUDIT_ROW_BREAKPOINT]: `minmax(0, 1fr) ${AUDIT_FINDINGS_WIDTH}px` },
        gap: 3,
        height: { [AUDIT_ROW_BREAKPOINT]: '100%' },
        minHeight: 0,
      }}
    >
      {/* Original site screenshot */}
      <Card sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <Box
          sx={{
            px: 2,
            py: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('review.originalSite')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {isFullPage ? t('inspector.fullPage') : t('inspector.firstScreen')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tabs
              value={device}
              onChange={(_e, value: ScreenshotDevice) => setDevice(value)}
              sx={{
                minHeight: 32,
                '& .MuiTab-root': { minHeight: 32, py: 0.5, px: 1.5, fontSize: '0.8rem', fontWeight: 600 },
              }}
            >
              <Tab label={t('inspector.desktop')} value="desktop" />
              <Tab label={t('inspector.mobile')} value="mobile" />
            </Tabs>
            <Button
              size="small"
              href={screenshotUrl ?? ''}
              disabled={!screenshotAvailable}
              target="_blank"
              rel="noopener noreferrer"
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              sx={{ fontSize: '0.75rem', textTransform: 'none', fontWeight: 600 }}
            >
              {t('inspector.openFullSize')}
            </Button>
          </Box>
        </Box>
        <Box
          data-testid="original-screenshot-viewer"
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            backgroundColor: 'background.default',
            height: { xs: 420, [AUDIT_ROW_BREAKPOINT]: 'auto' },
            minHeight: 320,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
          }}
        >
          {isLoading ? (
            <Box sx={{ alignSelf: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : !screenshotAvailable ? (
            <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center', p: 3, textAlign: 'center' }}>
              {t('inspector.noScreenshot')}
            </Typography>
          ) : (
            <Box
              component="img"
              src={screenshotUrl}
              alt={t('inspector.screenshotAlt', { device: t(`inspector.${device}`) })}
              loading="lazy"
              sx={{ width: '100%', maxWidth: device === 'mobile' ? 375 : '100%', height: 'auto', display: 'block' }}
              onError={() => setBrokenScreenshotUrl(screenshotUrl ?? null)}
            />
          )}
        </Box>
      </Card>

      {/* Audit findings */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, overflowY: { [AUDIT_ROW_BREAKPOINT]: 'auto' }, minHeight: 0, pr: { [AUDIT_ROW_BREAKPOINT]: 0.5 } }}>
        {Boolean(error) && (
          <Alert severity="error">
            {t('inspector.auditLoadError', { error: error instanceof Error ? error.message : '' })}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1.5 }}>
          <Metric
            icon={<SpeedIcon sx={{ color: 'error.main', fontSize: 20 }} />}
            label={t('inspector.lcp')}
            value={audit?.lcpSeconds != null ? t('inspector.seconds', { value: audit.lcpSeconds.toFixed(1) }) : NOT_MEASURED}
            color="error.main"
          />
          <Metric
            icon={<AccessibilityNewIcon sx={{ color: 'warning.main', fontSize: 20 }} />}
            label={t('inspector.a11yIssues')}
            value={
              audit?.a11yViolationsCount != null
                ? t('inspector.violations', { count: audit.a11yViolationsCount })
                : NOT_MEASURED
            }
            color="warning.main"
          />
          <Metric
            icon={<SmartphoneIcon sx={{ color: 'info.main', fontSize: 20 }} />}
            label={t('inspector.mobileFriendliness')}
            value={audit?.mobileFriendlinessRating != null ? `${audit.mobileFriendlinessRating}/100` : NOT_MEASURED}
            color="info.main"
          />
        </Box>

        {/* The MVP checked against the original site's key business data (REV-36) */}
        <CompletenessChecklist report={mvp?.completenessReport} />

        {/* Critical flaws from the Vision LLM design critique */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ErrorOutlineIcon sx={{ color: 'error.main', fontSize: 18 }} />
            {t('inspector.criticalFlaws')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {audit?.criticalFlaws.map((flaw, idx) => (
              <Card
                key={idx}
                sx={{
                  p: 1.5,
                  boxShadow: (theme) => `inset 2px 0 0 ${theme.palette.error.main}`,
                  backgroundColor: 'background.default',
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary', mb: 0.5 }}>
                  {idx + 1}. {flaw.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                  <strong>{t('inspector.impact')}</strong> {flaw.impact}
                </Typography>
                <Typography variant="caption" sx={{ color: 'primary.main', display: 'block' }}>
                  <strong>{t('inspector.fix')}</strong> {flaw.recommendation}
                </Typography>
              </Card>
            ))}
          </Box>
        </Box>

        {/* Quick wins */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleOutlineIcon sx={{ color: 'success.main', fontSize: 18 }} />
            {t('inspector.quickWins')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
            {audit?.quickWins.map((win, idx) => (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleOutlineIcon sx={{ color: 'success.main', fontSize: 16, flexShrink: 0 }} />
                <Typography variant="caption" color="text.primary" sx={{ fontWeight: 500 }}>
                  {win}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  );
};
