import type { Translation } from './locales/en.js';

/** The niches the operator can pick; other stored niches are shown by their raw value */
export type DashboardNiche = keyof Translation['niches'];

/** Niche order and pictograms shared by the filters, the add-lead form and the table */
export const NICHE_EMOJI: Record<DashboardNiche, string> = {
  dental: '🦷',
  auto: '🚗',
  legal: '⚖️',
  beauty: '💇',
  restaurant: '🍽️',
  fitness: '🏋️',
  other: '📦',
};

export const NICHES = Object.keys(NICHE_EMOJI) as DashboardNiche[];

export function isDashboardNiche(niche: string): niche is DashboardNiche {
  return Object.prototype.hasOwnProperty.call(NICHE_EMOJI, niche);
}
