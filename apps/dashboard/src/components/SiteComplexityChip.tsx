import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import WebAssetIcon from '@mui/icons-material/WebAsset';
import { useTranslation } from 'react-i18next';
import { SiteComplexityClass } from '@revamp/shared-types';

const CHIP_COLOR: Record<SiteComplexityClass, 'success' | 'default' | 'warning'> = {
  ONE_PAGE_BROCHURE: 'success',
  SMALL_MULTI_PAGE: 'default',
  COMPLEX: 'warning',
  UNKNOWN: 'default',
};

/**
 * How complex the original site is (REV-38). One-page brochure sites are the easiest to replace
 * with an MVP, so their badge stands out; unknown (not yet audited) renders nothing.
 */
export const SiteComplexityChip: React.FC<{ complexity: SiteComplexityClass | undefined }> = ({ complexity }) => {
  const { t } = useTranslation();
  if (!complexity || complexity === 'UNKNOWN') return null;

  const isBrochure = complexity === 'ONE_PAGE_BROCHURE';
  return (
    <Tooltip title={t(`siteComplexity.hints.${complexity}`)}>
      <Chip
        icon={isBrochure ? <WebAssetIcon sx={{ fontSize: 14 }} /> : undefined}
        label={t(`siteComplexity.classes.${complexity}`)}
        size="small"
        color={CHIP_COLOR[complexity]}
        variant={isBrochure ? 'filled' : 'outlined'}
        sx={{ fontSize: '0.72rem', height: 20, fontWeight: isBrochure ? 700 : 500 }}
      />
    </Tooltip>
  );
};
