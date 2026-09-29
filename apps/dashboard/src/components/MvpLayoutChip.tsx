import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import { useTranslation } from 'react-i18next';
import { MVP_LAYOUT_UNREAD_REASON, MVP_LAYOUT_VARIANTS, MvpLayoutVariant } from '@revamp/shared-types';
import { IMvpProjectDetail } from '../api/client.js';

// `manual`: picked by the operator in the Prototype step instead of the automatic choice (REV-84)
// `derived`: follows the original site's layout (REV-104)
const LAYOUT_RULES = [
  'small_brochure',
  'visual_niche',
  'image_rich',
  'professional_niche',
  'text_heavy',
  'default',
  'manual',
  'derived',
] as const;
type LayoutRule = (typeof LAYOUT_RULES)[number];

/** The rule behind the layout choice, from its `rule:<name>` reason code */
export function layoutRuleOf(reasons: string[] | undefined): LayoutRule | undefined {
  const rule = reasons?.find((reason) => reason.startsWith('rule:'))?.slice('rule:'.length);
  return LAYOUT_RULES.find((known) => known === rule);
}

/**
 * Which layout the MVP was rendered with, and why it was picked (REV-54), or that the operator picked
 * it (REV-84)
 */
export const MvpLayoutChip: React.FC<{ mvp: IMvpProjectDetail | null | undefined }> = ({ mvp }) => {
  const { t } = useTranslation();
  const variant = mvp?.layout?.variant;
  if (!variant || !MVP_LAYOUT_VARIANTS.includes(variant)) return null;

  const name = t(`mvpLayout.variants.${variant satisfies MvpLayoutVariant}`);
  const rule = layoutRuleOf(mvp.layout?.reasons);
  const chosen = rule ? t('mvpLayout.tooltip', { name, reason: t(`mvpLayout.rules.${rule}`) }) : name;
  // The fallback is visible: the original layout could not be read, so the rules chose (REV-104)
  const tooltip = mvp.layout?.reasons?.includes(MVP_LAYOUT_UNREAD_REASON) ? `${chosen}. ${t('mvpLayout.unread')}` : chosen;

  return (
    <Tooltip title={tooltip}>
      <Chip
        icon={<DashboardCustomizeIcon sx={{ fontSize: 14 }} />}
        label={name}
        size="small"
        variant="outlined"
        sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
      />
    </Tooltip>
  );
};
