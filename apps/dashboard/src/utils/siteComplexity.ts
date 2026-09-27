import { SiteComplexityClass } from '@revamp/shared-types';

export type ComplexityFilter = SiteComplexityClass | 'ALL';

/** Leads audited before REV-38 carry no class; they count as not estimated */
export const leadComplexity = (lead: { siteComplexity?: SiteComplexityClass }): SiteComplexityClass =>
  lead.siteComplexity ?? 'UNKNOWN';
