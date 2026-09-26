import React, { useRef, useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Button,
  ButtonGroup,
  Tab,
  Tabs,
  Card,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import TabletMacIcon from '@mui/icons-material/TabletMac';
import LaptopIcon from '@mui/icons-material/Laptop';
import SpeedIcon from '@mui/icons-material/Speed';
import AccessibilityNewIcon from '@mui/icons-material/AccessibilityNew';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import SecurityIcon from '@mui/icons-material/Security';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import {
  useAuditQuery,
  useMvpQuery,
  useLeadsQuery,
  useApproveOutreachMutation,
  useSendTestEmailMutation,
  useRejectLeadMutation,
  useUpdateMvpTokensMutation,
  withPreviewVersion,
} from '../hooks/useLeads.js';
import { RegenerateMvpButton } from './RegenerateMvpButton.js';
import { ColorPickerToolbar } from './ColorPickerToolbar.js';
import { EmailDraftEditor } from './EmailDraftEditor.js';
import { useTranslation } from 'react-i18next';
import { isDashboardNiche } from '../i18n/niches.js';

export const SideBySideInspectorModal: React.FC = () => {
  const {
    isOpen,
    selectedLeadId,
    selectedAuditId,
    activeBreakpoint,
    originalScreenTab,
    activeTab,
    closeModal,
    setBreakpoint,
    setOriginalScreenTab,
    setActiveTab,
  } = useHitlModalStore();

  const { data: leadsData } = useLeadsQuery();
  const { t } = useTranslation();
  const currentLead = leadsData?.leads.find((l) => l.id === selectedLeadId);

  const { data: audit, isLoading: isAuditLoading } = useAuditQuery(selectedAuditId);
  const { data: mvp } = useMvpQuery(selectedLeadId);

  const approveMutation = useApproveOutreachMutation();
  const sendTestMutation = useSendTestEmailMutation();
  const rejectMutation = useRejectLeadMutation();
  const updateTokensMutation = useUpdateMvpTokensMutation();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentColor, setCurrentColor] = useState<string>('#5c5bed');

  useEffect(() => {
    if (audit?.colorPalette?.primary) {
      setCurrentColor(audit.colorPalette.primary);
    }
  }, [audit?.colorPalette?.primary]);

  const handleColorChange = (newColor: string) => {
    setCurrentColor(newColor);
    // Real-time live update inside iframe without reload
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: 'REVAMP_UPDATE_THEME',
          palette: {
            primary: newColor,
            accent: newColor,
          },
        },
        '*',
      );
    }
    // Persist to backend API
    updateTokensMutation.mutate({
      mvpId: currentLead?.id || 'demo',
      tokens: { primaryColor: newColor, accentColor: newColor },
    });
  };

  const handleColorReset = () => {
    const resetColor = audit?.colorPalette?.primary || '#5c5bed';
    handleColorChange(resetColor);
  };

  const handleApprove = async (emailData: { subject: string; preheader: string; body: string }) => {
    if (!selectedLeadId) return;
    await approveMutation.mutateAsync({ leadId: selectedLeadId, emailData });
  };

  const handleSendTest = async (testEmail: string) => {
    if (!selectedLeadId) return;
    await sendTestMutation.mutateAsync({ leadId: selectedLeadId, testEmail });
  };

  const handleReject = async (reason: string) => {
    if (!selectedLeadId) return;
    await rejectMutation.mutateAsync({ leadId: selectedLeadId, reason });
    closeModal();
  };

  if (!isOpen) return null;

  // Versioned by the generation time so the iframe reloads after a regeneration (REV-31), which
  // overwrites the same preview URL
  const previewUrl = withPreviewVersion(
    mvp?.fullPreviewUrl || currentLead?.previewUrl || '',
    currentLead?.mvpGeneratedAt || mvp?.generatedAt,
  );
  const isRegenerating = currentLead?.status === 'GENERATING' && Boolean(previewUrl);

  // Prefer the full-page capture (REV-21); fall back to the above-the-fold shot for older audits
  const originalScreenshotUrl =
    originalScreenTab === 'desktop'
      ? audit?.desktopFullScreenshotUrl ||
        audit?.desktopScreenshotUrl ||
        'http://localhost:9000/revamp-assets/screenshots/listonosz_desktop.webp'
      : audit?.mobileFullScreenshotUrl ||
        audit?.mobileScreenshotUrl ||
        'http://localhost:9000/revamp-assets/screenshots/listonosz_mobile.webp';
  const isFullPageScreenshot =
    originalScreenTab === 'desktop'
      ? Boolean(audit?.desktopFullScreenshotUrl)
      : Boolean(audit?.mobileFullScreenshotUrl);

  return (
    <Dialog
      open={isOpen}
      onClose={closeModal}
      fullScreen
      PaperProps={{
        sx: {
          backgroundColor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Header Bar */}
      <DialogTitle
        sx={{
          py: 1.5,
          px: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.paper',
        }}
      >
        {/* Left: Lead details */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                {currentLead?.businessName || t('inspector.fallbackTitle')}
              </Typography>
              {currentLead?.niche && (
                <Chip
                  label={isDashboardNiche(currentLead.niche) ? t(`niches.${currentLead.niche}`) : currentLead.niche}
                  size="small"
                  variant="outlined"
                  sx={{ fontWeight: 600 }}
                />
              )}
              {currentLead?.city && (
                <Typography variant="caption" color="text.secondary">
                  {currentLead.city}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t('inspector.original', { url: currentLead?.originalUrl || currentLead?.domain })}
            </Typography>
          </Box>
        </Box>

        {/* Center: Tabs switcher */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
          <Tabs
            value={activeTab}
            onChange={(_e, val) => setActiveTab(val)}
            sx={{
              minHeight: 36,
              '& .MuiTab-root': {
                minHeight: 36,
                py: 0.5,
                px: 2,
                fontSize: '0.85rem',
                fontWeight: 700,
                textTransform: 'none',
              },
            }}
          >
            <Tab
              icon={<VisibilityIcon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label={t('inspector.tabInspector')}
              value="inspector"
            />
            <Tab
              icon={<MailOutlineIcon sx={{ fontSize: 18 }} />}
              iconPosition="start"
              label={t('inspector.tabEmail')}
              value="email_editor"
            />
          </Tabs>
        </Box>

        {/* Right: Score Uplift Badge & Close Action */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ display: { xs: 'none', lg: 'flex' }, alignItems: 'center', gap: 1 }}>
            <Chip
              label={t('inspector.originalScore', { score: currentLead?.totalScore ?? 42 })}
              size="small"
              sx={{
                backgroundColor: 'error.light',
                color: 'error.main',
                fontWeight: 700,
              }}
            />
            <ArrowForwardIcon sx={{ color: 'text.secondary', fontSize: 16 }} />
            <Chip
              icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
              label={t('inspector.mvpScore', { score: 96 })}
              size="small"
              sx={{
                backgroundColor: 'success.light',
                color: 'success.main',
                fontWeight: 700,
              }}
            />
          </Box>
          <Tooltip title={t('inspector.close')}>
            <IconButton onClick={closeModal} size="small" sx={{ p: 1 }}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      {/* Main Content Area */}
      <DialogContent sx={{ p: 0, display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        {activeTab === 'inspector' ? (
          <Box
            sx={{
              display: 'flex',
              width: '100%',
              height: '100%',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            {/* ============================================================ */}
            {/* LEFT PANEL: Original Website Diagnostics & Critique         */}
            {/* ============================================================ */}
            <Box
              sx={{
                width: { xs: '100%', md: '45%' },
                borderRight: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'background.paper',
                overflowY: 'auto',
                p: 3,
                gap: 2.5,
              }}
            >
              {/* Header with Screenshot Mode Tabs */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  {t('inspector.originalAndIssues')}
                </Typography>

                <Tabs
                  value={originalScreenTab}
                  onChange={(_e, val) => setOriginalScreenTab(val)}
                  sx={{
                    minHeight: 32,
                    '& .MuiTab-root': {
                      minHeight: 32,
                      py: 0.5,
                      px: 1.5,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                    },
                  }}
                >
                  <Tab label={t('inspector.desktop')} value="desktop" />
                  <Tab label={t('inspector.mobile')} value="mobile" />
                </Tabs>
              </Box>

              {/* Diagnostic Metrics Pills */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
                <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                  <SpeedIcon sx={{ color: '#EF4444', fontSize: 24 }} />
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t('inspector.lcp')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#EF4444' }}>
                      {t('inspector.seconds', { value: audit?.lcpSeconds ? audit.lcpSeconds.toFixed(1) : '3.4' })}
                    </Typography>
                  </Box>
                </Card>

                <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                  <AccessibilityNewIcon sx={{ color: '#F59E0B', fontSize: 24 }} />
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t('inspector.a11yIssues')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#F59E0B' }}>
                      {t('inspector.violations', { count: audit?.a11yViolationsCount ?? 14 })}
                    </Typography>
                  </Box>
                </Card>

                <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                  <SmartphoneIcon sx={{ color: '#6366F1', fontSize: 24 }} />
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {t('inspector.mobileFriendliness')}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: '#6366F1' }}>
                      {audit?.mobileFriendlinessRating ?? 45}/100
                    </Typography>
                  </Box>
                </Card>
              </Box>

              {/* Screenshot Preview Box: scrollable full-page capture */}
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {isFullPageScreenshot ? t('inspector.fullPage') : t('inspector.firstScreen')}
                  </Typography>
                  <Button
                    size="small"
                    href={originalScreenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                    sx={{ fontSize: '0.75rem', textTransform: 'none', fontWeight: 600 }}
                  >
                    {t('inspector.openFullSize')}
                  </Button>
                </Box>
                <Box
                  data-testid="original-screenshot-viewer"
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    backgroundColor: 'background.default',
                    height: { xs: 360, md: 'calc(100vh - 380px)' },
                    minHeight: 320,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
                    position: 'relative',
                  }}
                >
                  {isAuditLoading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                      <CircularProgress size={24} />
                    </Box>
                  ) : (
                    <Box
                      component="img"
                      src={originalScreenshotUrl}
                      alt={t('inspector.screenshotAlt', { device: t(`inspector.${originalScreenTab}`) })}
                      loading="lazy"
                      sx={{
                        width: '100%',
                        maxWidth: originalScreenTab === 'mobile' ? 375 : '100%',
                        height: 'auto',
                        display: 'block',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80';
                      }}
                    />
                  )}
                </Box>
              </Box>

              {/* 3 Critical Flaws from Vision LLM Design Critique */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ErrorOutlineIcon sx={{ color: '#EF4444', fontSize: 18 }} />
                  {t('inspector.criticalFlaws')}
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {audit?.criticalFlaws.map((flaw, idx) => (
                    <Card
                      key={idx}
                      sx={{
                        p: 1.5,
                        borderLeft: '4px solid #EF4444',
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

              {/* 3 Quick Wins */}
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CheckCircleOutlineIcon sx={{ color: '#10B981', fontSize: 18 }} />
                  {t('inspector.quickWins')}
                </Typography>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                  {audit?.quickWins.map((win, idx) => (
                    <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <CheckCircleOutlineIcon sx={{ color: '#10B981', fontSize: 16, flexShrink: 0 }} />
                      <Typography variant="caption" color="text.primary" sx={{ fontWeight: 500 }}>
                        {win}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>

            {/* ============================================================ */}
            {/* RIGHT PANEL: Interactive Bento MVP Sandboxed IFrame          */}
            {/* ============================================================ */}
            <Box
              sx={{
                width: { xs: '100%', md: '55%' },
                display: 'flex',
                flexDirection: 'column',
                backgroundColor: 'background.default',
                overflow: 'hidden',
              }}
            >
              {/* Toolbar: Breakpoint Selectors & External Link */}
              <Box
                sx={{
                  p: 2,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: 'background.paper',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1.5,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('inspector.interactiveMvp')}
                  </Typography>

                  {/* Device Breakpoint Switcher */}
                  <ButtonGroup size="small" variant="outlined">
                    <Button
                      variant={activeBreakpoint === 'mobile' ? 'contained' : 'outlined'}
                      onClick={() => setBreakpoint('mobile')}
                      startIcon={<SmartphoneIcon sx={{ fontSize: 16 }} />}
                      sx={{ px: 1.5 }}
                    >
                      {t('inspector.bpMobile')}
                    </Button>
                    <Button
                      variant={activeBreakpoint === 'tablet' ? 'contained' : 'outlined'}
                      onClick={() => setBreakpoint('tablet')}
                      startIcon={<TabletMacIcon sx={{ fontSize: 16 }} />}
                      sx={{ px: 1.5 }}
                    >
                      {t('inspector.bpTablet')}
                    </Button>
                    <Button
                      variant={activeBreakpoint === 'desktop' ? 'contained' : 'outlined'}
                      onClick={() => setBreakpoint('desktop')}
                      startIcon={<LaptopIcon sx={{ fontSize: 16 }} />}
                      sx={{ px: 1.5 }}
                    >
                      {t('inspector.bpDesktop')}
                    </Button>
                  </ButtonGroup>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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

                  {currentLead && <RegenerateMvpButton lead={currentLead} variant="button" />}

                  <Chip
                    icon={<SecurityIcon sx={{ fontSize: 14 }} />}
                    label={t('inspector.sandbox')}
                    size="small"
                    color="success"
                    variant="outlined"
                    sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
                  />

                  {previewUrl ? (
                    <Tooltip title={t('inspector.openPrototype')}>
                      <IconButton
                        size="small"
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        color="primary"
                        sx={{ p: 0.8 }}
                      >
                        <OpenInNewIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  ) : (
                    <Tooltip title={t('inspector.building')}>
                      <span>
                        <IconButton size="small" disabled sx={{ p: 0.8 }}>
                          <OpenInNewIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                </Box>
              </Box>

              {/* Color Palette Live Toolbar (REV-16) */}
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  backgroundColor: 'background.paper',
                }}
              >
                <ColorPickerToolbar
                  currentPrimary={currentColor}
                  originalPrimary={audit?.colorPalette?.primary}
                  onColorChange={handleColorChange}
                  onReset={handleColorReset}
                />
              </Box>

              {/* IFrame Viewport Container with simulated device chassis */}
              <Box
                sx={{
                  flexGrow: 1,
                  p: activeBreakpoint === 'desktop' ? 0 : 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  backgroundColor: 'rgba(15, 23, 42, 0.03)',
                }}
              >
                <Box
                  sx={{
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    height: '100%',
                    width:
                      activeBreakpoint === 'mobile'
                        ? 375
                        : activeBreakpoint === 'tablet'
                        ? 768
                        : '100%',
                    borderRadius:
                      activeBreakpoint === 'mobile'
                        ? '32px'
                        : activeBreakpoint === 'tablet'
                        ? '20px'
                        : 0,
                    border:
                      activeBreakpoint === 'desktop'
                        ? 'none'
                        : '10px solid #1E293B',
                    boxShadow:
                      activeBreakpoint === 'desktop'
                        ? 'none'
                        : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    overflow: 'hidden',
                    position: 'relative',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  {/* Mobile Speaker / Camera Notch Simulator */}
                  {activeBreakpoint === 'mobile' && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 120,
                        height: 18,
                        backgroundColor: '#1E293B',
                        borderBottomLeftRadius: 10,
                        borderBottomRightRadius: 10,
                        zIndex: 10,
                      }}
                    />
                  )}

                  {/* Secure Sandboxed Iframe or Loading State */}
                  {previewUrl ? (
                    <iframe
                      key={previewUrl}
                      ref={iframeRef}
                      src={previewUrl}
                      title={t('inspector.iframeTitle')}
                      sandbox="allow-scripts allow-same-origin"
                      style={{
                        width: '100%',
                        height: '100%',
                        border: 'none',
                        display: 'block',
                      }}
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
          </Box>
        ) : (
          <Box sx={{ width: '100%', height: '100%', p: 3, overflowY: 'auto' }}>
            {currentLead && (
              <EmailDraftEditor
                lead={currentLead}
                audit={audit}
                onApprove={handleApprove}
                onSendTest={handleSendTest}
                onReject={handleReject}
                isActionLoading={
                  approveMutation.isPending ||
                  sendTestMutation.isPending ||
                  rejectMutation.isPending
                }
              />
            )}
          </Box>
        )}
      </DialogContent>

      {/* Footer / HITL Gate Navigation */}
      <DialogActions
        sx={{
          py: 1.5,
          px: 3,
          backgroundColor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {t('inspector.hitlNotice')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {activeTab === 'inspector' ? (
            <>
              <Button onClick={closeModal} color="inherit" sx={{ fontWeight: 600 }}>
                {t('inspector.close')}
              </Button>
              <Button
                variant="contained"
                color="primary"
                startIcon={<AutoAwesomeIcon />}
                onClick={() => setActiveTab('email_editor')}
                sx={{ px: 2.5, fontWeight: 700 }}
              >
                {t('inspector.goToApproval')}
              </Button>
            </>
          ) : (
            <>
              <Button
                startIcon={<ArrowBackIcon />}
                onClick={() => setActiveTab('inspector')}
                color="inherit"
                sx={{ fontWeight: 600 }}
              >
                {t('inspector.backToInspector')}
              </Button>
              <Button onClick={closeModal} color="inherit" sx={{ fontWeight: 600 }}>
                {t('inspector.closeButton')}
              </Button>
            </>
          )}
        </Box>
      </DialogActions>
    </Dialog>
  );
};
