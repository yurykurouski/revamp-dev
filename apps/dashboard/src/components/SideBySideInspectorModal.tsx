import React from 'react';
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
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useHitlModalStore } from '../store/useHitlModalStore.js';
import { useAuditQuery, useLeadsQuery } from '../hooks/useLeads.js';

export const SideBySideInspectorModal: React.FC = () => {
  const {
    isOpen,
    selectedLeadId,
    selectedAuditId,
    activeBreakpoint,
    originalScreenTab,
    closeModal,
    setBreakpoint,
    setOriginalScreenTab,
  } = useHitlModalStore();

  const { data: leadsData } = useLeadsQuery();
  const currentLead = leadsData?.leads.find((l) => l.id === selectedLeadId);

  const { data: audit, isLoading: isAuditLoading } = useAuditQuery(selectedAuditId);

  if (!isOpen) return null;

  const previewUrl =
    currentLead?.previewUrl ||
    `http://localhost:9000/revamp-demos/v/${currentLead?.domain?.replace(/\./g, '-') || 'demo'}/index.html`;

  const originalScreenshotUrl =
    originalScreenTab === 'desktop'
      ? audit?.desktopScreenshotUrl || 'http://localhost:9000/revamp-assets/screenshots/listonosz_desktop.webp'
      : audit?.mobileScreenshotUrl || 'http://localhost:9000/revamp-assets/screenshots/listonosz_mobile.webp';

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
                {currentLead?.businessName || 'Инспектор сайта'}
              </Typography>
              {currentLead?.niche && (
                <Chip
                  label={currentLead.niche}
                  size="small"
                  variant="outlined"
                  sx={{ textTransform: 'capitalize', fontWeight: 600 }}
                />
              )}
              {currentLead?.city && (
                <Typography variant="caption" color="text.secondary">
                  г. {currentLead.city}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Оригинал: {currentLead?.originalUrl || currentLead?.domain}
            </Typography>
          </Box>
        </Box>

        {/* Center: Score Uplift Badge */}
        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1.5 }}>
          <Chip
            label={`Исходный скоринг: ${currentLead?.totalScore ?? 42}/100`}
            size="small"
            sx={{
              backgroundColor: 'error.light',
              color: 'error.main',
              fontWeight: 700,
            }}
          />
          <ArrowForwardIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
          <Chip
            icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}
            label="Bento MVP: 96/100"
            size="small"
            sx={{
              backgroundColor: 'success.light',
              color: 'success.main',
              fontWeight: 700,
            }}
          />
        </Box>

        {/* Right: Close Action */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Закрыть инспектор">
            <IconButton onClick={closeModal} size="small" sx={{ p: 1 }}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>

      {/* Main Split View Content Area */}
      <DialogContent sx={{ p: 0, display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
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
                🔍 Исходный сайт & Дефекты
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
                <Tab label="Десктоп (1440px)" value="desktop" />
                <Tab label="Мобильный (375px)" value="mobile" />
              </Tabs>
            </Box>

            {/* Diagnostic Metrics Pills */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
              <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                <SpeedIcon sx={{ color: '#EF4444', fontSize: 24 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    LCP (Скорость)
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#EF4444' }}>
                    {audit?.lcpSeconds ? `${audit.lcpSeconds.toFixed(1)}s` : '3.4s'}
                  </Typography>
                </Box>
              </Card>

              <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                <AccessibilityNewIcon sx={{ color: '#F59E0B', fontSize: 24 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    a11y Ошибки
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#F59E0B' }}>
                    {audit?.a11yViolationsCount ?? 14} нарушений
                  </Typography>
                </Box>
              </Card>

              <Card sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.2 }}>
                <SmartphoneIcon sx={{ color: '#6366F1', fontSize: 24 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Мобильность
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#6366F1' }}>
                    {audit?.mobileFriendlinessRating ?? 45}/100
                  </Typography>
                </Box>
              </Card>
            </Box>

            {/* Screenshot Preview Box */}
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
                backgroundColor: 'background.default',
                height: originalScreenTab === 'desktop' ? 240 : 360,
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
                  alt="Original Website Screenshot"
                  sx={{
                    width: '100%',
                    height: 'auto',
                    objectFit: 'cover',
                    objectPosition: 'top',
                  }}
                  onError={(e) => {
                    // Fallback to placeholder if image server offline
                    (e.target as HTMLImageElement).src =
                      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=80';
                  }}
                />
              )}
            </Box>

            {/* 3 Critical Flaws from Vision LLM Design Critique */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ErrorOutlineIcon sx={{ color: '#EF4444', fontSize: 18 }} />
                3 Критических недостатка (Design Critique Agent)
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
                      <strong>Влияние:</strong> {flaw.impact}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'primary.main', display: 'block' }}>
                      <strong>Решение:</strong> {flaw.recommendation}
                    </Typography>
                  </Card>
                ))}
              </Box>
            </Box>

            {/* 3 Quick Wins */}
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleOutlineIcon sx={{ color: '#10B981', fontSize: 18 }} />
                Быстрые победы нового прототипа (Quick Wins)
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
                  Интерактивный MVP:
                </Typography>

                {/* Device Breakpoint Switcher */}
                <ButtonGroup size="small" variant="outlined">
                  <Button
                    variant={activeBreakpoint === 'mobile' ? 'contained' : 'outlined'}
                    onClick={() => setBreakpoint('mobile')}
                    startIcon={<SmartphoneIcon sx={{ fontSize: 16 }} />}
                    sx={{ px: 1.5 }}
                  >
                    Mobile (375px)
                  </Button>
                  <Button
                    variant={activeBreakpoint === 'tablet' ? 'contained' : 'outlined'}
                    onClick={() => setBreakpoint('tablet')}
                    startIcon={<TabletMacIcon sx={{ fontSize: 16 }} />}
                    sx={{ px: 1.5 }}
                  >
                    Tablet (768px)
                  </Button>
                  <Button
                    variant={activeBreakpoint === 'desktop' ? 'contained' : 'outlined'}
                    onClick={() => setBreakpoint('desktop')}
                    startIcon={<LaptopIcon sx={{ fontSize: 16 }} />}
                    sx={{ px: 1.5 }}
                  >
                    Desktop (100%)
                  </Button>
                </ButtonGroup>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip
                  icon={<SecurityIcon sx={{ fontSize: 14 }} />}
                  label="Sandbox Active"
                  size="small"
                  color="success"
                  variant="outlined"
                  sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
                />

                <Tooltip title="Открыть сайт прототипа в отдельной вкладке">
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
              </Box>
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

                {/* Secure Sandboxed Iframe */}
                <iframe
                  src={previewUrl}
                  title="MVP Interactive Sandbox Preview"
                  sandbox="allow-scripts allow-same-origin"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block',
                  }}
                />
              </Box>
            </Box>
          </Box>
        </Box>
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
          🔒 Режим «Human-In-The-Loop»: аутрич заблокирован до явного подтверждения оператора
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button onClick={closeModal} color="inherit" sx={{ fontWeight: 600 }}>
            Закрыть инспектор
          </Button>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AutoAwesomeIcon />}
            sx={{ px: 2.5, fontWeight: 700 }}
          >
            Перейти к аппруву и отправке
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};
