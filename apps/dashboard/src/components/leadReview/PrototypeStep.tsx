import React, { useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonGroup,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TabletMacIcon from '@mui/icons-material/TabletMac';
import LaptopIcon from '@mui/icons-material/Laptop';
import SecurityIcon from '@mui/icons-material/Security';
import { useTranslation } from 'react-i18next';
import type { IAuditDetail, ILeadItem, IMvpProjectDetail } from '../../api/client.js';
import {
  mvpPreviewVersion,
  useIsMvpGenerationPending,
  withPreviewVersion,
} from '../../hooks/useLeads.js';
import { MvpPreviewFrame } from '../MvpPreviewFrame.js';
import { RegenerateMvpButton } from '../RegenerateMvpButton.js';
import { MvpSourceChip } from '../MvpSourceChip.js';
import { MvpLayoutChip } from '../MvpLayoutChip.js';
import { MvpChangeSummary } from './MvpChangeSummary.js';
import { MvpDesignTools, useMvpDesignTools } from './MvpDesignTools.js';
import { leadPreviewPath } from '../../routes/paths.js';

type PreviewBreakpoint = 'mobile' | 'tablet' | 'desktop';

/** The simulated device width of each breakpoint */
const BREAKPOINT_WIDTH: Record<PreviewBreakpoint, number | string> = {
  mobile: 375,
  tablet: 768,
  desktop: '100%',
};
const BREAKPOINT_RADIUS: Record<PreviewBreakpoint, string | number> = {
  mobile: '32px',
  tablet: '20px',
  desktop: 0,
};

/** How much of the "What changed" summary shows under the preview before the card is scrolled (REV-96) */
export const CHANGE_SUMMARY_PEEK = 48;

const BREAKPOINTS: Array<{
  value: PreviewBreakpoint;
  icon: React.ReactElement;
  label: 'bpMobile' | 'bpTablet' | 'bpDesktop';
}> = [
  { value: 'mobile', icon: <SmartphoneIcon sx={{ fontSize: 16 }} />, label: 'bpMobile' },
  { value: 'tablet', icon: <TabletMacIcon sx={{ fontSize: 16 }} />, label: 'bpTablet' },
  { value: 'desktop', icon: <LaptopIcon sx={{ fontSize: 16 }} />, label: 'bpDesktop' },
];

interface PrototypeStepProps {
  lead: ILeadItem;
  audit?: IAuditDetail | null;
  mvp?: IMvpProjectDetail | null;
}

/**
 * Step 2 of a lead review (REV-77): the generated MVP in its sandboxed iframe (AGENTS.md §3.2.3) with the
 * device breakpoints, regenerate, the live color toolbar (REV-16) and layout picker (REV-84) in a panel
 * floating over the preview (REV-88), and the "What changed" summary (REV-81) under the preview (REV-94).
 * The toolbar and preview fill the card's height and the summary is scrolled into view below them (REV-96),
 * so a long summary never shrinks the preview.
 */
export const PrototypeStep: React.FC<PrototypeStepProps> = ({ lead, audit, mvp }) => {
  const { t } = useTranslation();
  const [breakpoint, setBreakpoint] = useState<PreviewBreakpoint>('desktop');
  const isGenerationRequestPending = useIsMvpGenerationPending(lead.id);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tools = useMvpDesignTools({ lead, audit, mvp, iframeRef });

  // Versioned by the generation or free-text change (REV-85) time so the iframe reloads after a
  // regeneration (REV-31) or change, which overwrite the same preview URL
  const previewUrl = withPreviewVersion(
    mvp?.fullPreviewUrl || lead.previewUrl || '',
    mvpPreviewVersion(lead, mvp),
  );
  const isRegenerating = lead.status === 'GENERATING' && Boolean(previewUrl);
  // From the regenerate click until the lead is back from GENERATING (REV-53)
  const isPreviewBusy = isGenerationRequestPending || lead.status === 'GENERATING';
  const isDesktop = breakpoint === 'desktop';

  return (
    <Card
      data-testid="prototype-card"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        overflowX: 'hidden',
        overflowY: 'auto',
        height: { xs: 720, lg: '100%' },
      }}
    >
      {/* Toolbar and preview fill the card, leaving the summary's heading in sight below them (REV-96);
          they grow over the peek when there is no summary */}
      <Box
        data-testid="prototype-stage"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 0 auto',
          height: `calc(100% - ${CHANGE_SUMMARY_PEEK}px)`,
          minHeight: 0,
        }}
      >
        {/* Toolbar: breakpoints, MVP facts and actions */}
        <Box
          sx={{
            p: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {t('inspector.interactiveMvp')}
            </Typography>
            <ButtonGroup size="small" variant="outlined">
              {BREAKPOINTS.map(({ value, icon, label }) => (
                <Button
                  key={value}
                  variant={breakpoint === value ? 'contained' : 'outlined'}
                  aria-pressed={breakpoint === value}
                  onClick={() => setBreakpoint(value)}
                  startIcon={icon}
                  sx={{ px: 1.5 }}
                >
                  {t(`inspector.${label}`)}
                </Button>
              ))}
            </ButtonGroup>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            {isRegenerating && (
              <Tooltip title={t('inspector.regenerating')}>
                <Chip
                  icon={<CircularProgress size={12} />}
                  label={t('kanban.generating')}
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
                />
              </Tooltip>
            )}
            <MvpSourceChip mvp={mvp} />
            <MvpLayoutChip mvp={mvp} />
            <RegenerateMvpButton lead={lead} variant="button" />
            <Chip
              icon={<SecurityIcon sx={{ fontSize: 14 }} />}
              label={t('inspector.sandbox')}
              size="small"
              color="success"
              variant="outlined"
              sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
            />
            <Tooltip title={previewUrl ? t('inspector.openPrototype') : t('inspector.building')}>
              <span>
                <IconButton
                  size="small"
                  // The full-window preview keeps the Design tools (REV-91); the page the lead gets is linked there
                  href={previewUrl ? leadPreviewPath(lead.id) : ''}
                  disabled={!previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="primary"
                  aria-label={t('inspector.openPrototype')}
                  sx={{ p: 0.8 }}
                >
                  <OpenInNewIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>

        {/* Iframe viewport with a simulated device chassis */}
        <Box
          sx={{
            flexGrow: 1,
            minHeight: 0,
            p: isDesktop ? 0 : 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            backgroundColor: 'surface.sunken',
          }}
        >
          <Box
            data-testid="prototype-viewport"
            sx={{
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              height: '100%',
              width: BREAKPOINT_WIDTH[breakpoint],
              maxWidth: '100%',
              borderRadius: BREAKPOINT_RADIUS[breakpoint],
              border: isDesktop ? 'none' : '10px solid',
              borderColor: 'border.strong',
              boxShadow: isDesktop
                ? 'none'
                : (theme) => `0 24px 48px -12px ${alpha(theme.palette.common.black, 0.4)}`,
              overflow: 'hidden',
              position: 'relative',
              // The MVP is a light page of its own, whatever the dashboard theme
              backgroundColor: 'common.white',
            }}
          >
            {/* Mobile speaker / camera notch */}
            {breakpoint === 'mobile' && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 120,
                  height: 18,
                  backgroundColor: 'border.strong',
                  borderBottomLeftRadius: 10,
                  borderBottomRightRadius: 10,
                  zIndex: 10,
                }}
              />
            )}

            {/* Live color (REV-16) and layout (REV-84) pickers, floating over the preview (REV-88) */}
            <MvpDesignTools tools={tools} locked={!previewUrl || isPreviewBusy} />

            {previewUrl ? (
              <MvpPreviewFrame
                ref={iframeRef}
                previewUrl={previewUrl}
                busy={isPreviewBusy || tools.edit.isPending}
                onLoad={tools.liveLayout.onFrameLoad}
              />
            ) : (
              <Box
                sx={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  p: 4,
                  textAlign: 'center',
                  gap: 2,
                }}
              >
                <CircularProgress size={40} />
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                  {t('inspector.generatingTitle')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('inspector.generatingBody')}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* What the MVP changed compared with the original site (REV-81), under the preview (REV-94) */}
      <MvpChangeSummary mvp={mvp} audit={audit} />
    </Card>
  );
};
