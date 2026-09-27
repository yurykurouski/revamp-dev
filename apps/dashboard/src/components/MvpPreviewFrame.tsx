import { forwardRef } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { useRegenerationOverlay } from '../hooks/useRegenerationOverlay.js';

const sweep = keyframes`
  0% { background-position: 0% 50%; }
  100% { background-position: 200% 50%; }
`;

const scan = keyframes`
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.12); opacity: 1; }
`;

interface MvpPreviewFrameProps {
  previewUrl: string;
  /** A regenerate request is in flight or the lead is GENERATING */
  busy: boolean;
}

/**
 * The sandboxed MVP preview iframe. While the MVP is regenerated, it is covered by an animated
 * overlay until the new version has loaded (REV-53). The overlay is a sibling of the iframe and
 * never changes its sandbox.
 */
export const MvpPreviewFrame = forwardRef<HTMLIFrameElement, MvpPreviewFrameProps>(({ previewUrl, busy }, ref) => {
  const { t } = useTranslation();
  const { visible, onFrameLoad } = useRegenerationOverlay({ busy, previewUrl });

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
      <iframe
        key={previewUrl}
        ref={ref}
        src={previewUrl}
        title={t('inspector.iframeTitle')}
        sandbox="allow-scripts allow-same-origin"
        onLoad={() => onFrameLoad(previewUrl)}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />
      {visible && (
        <Box
          role="status"
          aria-live="polite"
          data-testid="mvp-regeneration-overlay"
          sx={(theme) => {
            const primary = theme.palette.primary.main;
            const secondary = theme.palette.secondary.main;
            return {
              position: 'absolute',
              inset: 0,
              zIndex: 20,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1.5,
              p: 3,
              textAlign: 'center',
              backdropFilter: 'blur(6px) saturate(120%)',
              backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.66),
              backgroundImage: `linear-gradient(115deg, ${alpha(primary, 0.1)} 0%, ${alpha(secondary, 0.22)} 25%, ${alpha(primary, 0.1)} 50%, ${alpha(secondary, 0.22)} 75%, ${alpha(primary, 0.1)} 100%)`,
              backgroundSize: '200% 100%',
              animation: `${sweep} 3s linear infinite`,
              // Scanning light band
              '&::before': {
                content: '""',
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                height: '35%',
                background: `linear-gradient(180deg, transparent 0%, ${alpha(primary, 0.18)} 85%, ${alpha(primary, 0.55)} 100%)`,
                animation: `${scan} 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite`,
                pointerEvents: 'none',
              },
              '@media (prefers-reduced-motion: reduce)': {
                animation: 'none',
                '&::before': { display: 'none' },
                '& .revamp-ai-icon': { animation: 'none' },
              },
            };
          }}
        >
          <Box
            className="revamp-ai-icon"
            sx={(theme) => ({
              position: 'relative',
              width: 56,
              height: 56,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.palette.primary.contrastText,
              background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.15)}, 0 8px 28px ${alpha(theme.palette.primary.main, 0.45)}`,
              animation: `${pulse} 1.8s ease-in-out infinite`,
            })}
          >
            <AutoAwesomeIcon />
          </Box>
          <Typography variant="subtitle2" sx={{ position: 'relative', fontWeight: 700 }}>
            {t('inspector.regeneratingTitle')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ position: 'relative', maxWidth: 320 }}>
            {t('inspector.regeneratingBody')}
          </Typography>
        </Box>
      )}
    </Box>
  );
});

MvpPreviewFrame.displayName = 'MvpPreviewFrame';
