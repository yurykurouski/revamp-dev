import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  MVP_LAYOUT_UNREAD_REASON,
  MVP_LAYOUT_VARIANTS,
  MvpLayoutVariant,
  REBUILD_FALLBACK_REASONS,
  RebuildFallbackReason,
} from '@revamp/shared-types';
import { IMvpProjectDetail } from '../api/client.js';

// `manual`: picked by the operator in the Prototype step instead of the automatic choice (REV-84)
// `derived`: follows the original site's layout (REV-104)
// `rebuild`: the original site rebuilt section by section (REV-110)
const LAYOUT_RULES = [
  'small_brochure',
  'visual_niche',
  'image_rich',
  'professional_niche',
  'text_heavy',
  'default',
  'manual',
  'derived',
  'rebuild',
] as const;
type LayoutRule = (typeof LAYOUT_RULES)[number];

/** The rule behind the layout choice, from its `rule:<name>` reason code */
export function layoutRuleOf(reasons: string[] | undefined): LayoutRule | undefined {
  const rule = reasons?.find((reason) => reason.startsWith('rule:'))?.slice('rule:'.length);
  return LAYOUT_RULES.find((known) => known === rule);
}

/** Why the rebuild fell back to the template (REV-110), with the coverage it read */
export function rebuildFallbackOf(
  reasons: string[] | undefined,
): { reason: RebuildFallbackReason; percent?: number } | undefined {
  const reason = reasons?.find((r): r is RebuildFallbackReason => (REBUILD_FALLBACK_REASONS as readonly string[]).includes(r));
  if (!reason) return undefined;
  const coverage = reasons?.find((r) => r.startsWith('coverage:'));
  const ratio = coverage ? Number(coverage.slice('coverage:'.length)) : NaN;
  // Rounded down, so a page just under the threshold never reads as reaching it; the epsilon absorbs
  // float error (0.29 * 100 is 28.999…)
  return Number.isFinite(ratio) ? { reason, percent: Math.floor(ratio * 100 + 1e-9) } : { reason };
}

type RebuildFallbackKind = RebuildFallbackReason extends `rebuild:${infer Kind}` ? Kind : never;

/** The localized sentence for a rebuild fallback (REV-110) */
function rebuildFallbackText(t: TFunction, fallback: { reason: RebuildFallbackReason; percent?: number }): string {
  const kind = fallback.reason.slice('rebuild:'.length) as RebuildFallbackKind;
  return t(`mvpLayout.fallback.${kind}`, { percent: fallback.percent });
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
  const fallback = rebuildFallbackOf(mvp.layout?.reasons);
  // The summary belongs to the rebuilt page; it can outlive a switch to a template until the re-render
  const rebuild = variant === 'original' ? mvp.rebuild : undefined;
  const notes = [
    chosen,
    rebuild &&
      t('mvpLayout.rebuildSummary', { sections: rebuild.sections, omitted: rebuild.omitted.length, fixes: rebuild.tuning.length }),
    // The fallbacks are visible: the rebuild could not be used (REV-110), or the original layout could
    // not be read, so the rules chose (REV-104)
    fallback && rebuildFallbackText(t, fallback),
    mvp.layout?.reasons?.includes(MVP_LAYOUT_UNREAD_REASON) && t('mvpLayout.unread'),
  ].filter((note): note is string => Boolean(note));
  // Each note is a sentence; the ones ending in a full stop already carry it
  const tooltip = notes.reduce((text, note) => (/[.!?…]$/.test(text) ? `${text} ${note}` : `${text}. ${note}`));

  return (
    <Tooltip title={tooltip}>
      <Chip
        icon={<DashboardCustomizeIcon sx={{ fontSize: 14 }} />}
        label={name}
        size="small"
        variant="outlined"
        color={fallback ? 'warning' : 'default'}
        sx={{ fontSize: '0.72rem', height: 24, fontWeight: 600 }}
      />
    </Tooltip>
  );
};
