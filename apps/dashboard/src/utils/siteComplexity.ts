import { SiteComplexityClass } from '@revamp/shared-types';

export type ComplexityFilter = SiteComplexityClass | 'ALL';

/** Leads audited before REV-38 carry no class; they count as not estimated */
export const leadComplexity = (lead: { siteComplexity?: SiteComplexityClass }): SiteComplexityClass =>
  lead.siteComplexity ?? 'UNKNOWN';

export const matchesComplexityFilter = (
  lead: { siteComplexity?: SiteComplexityClass },
  filter: ComplexityFilter | undefined,
): boolean => !filter || filter === 'ALL' || leadComplexity(lead) === filter;
