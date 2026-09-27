/** Client-side routes of the review-queue layout (REV-76); Discovery is an overlay, not a route */
export const ROUTES = {
  queue: '/',
  leads: '/leads',
  lead: '/leads/:id',
  settings: '/settings',
} as const;

/** The URL of one lead */
export const leadPath = (id: string): string => `${ROUTES.leads}/${encodeURIComponent(id)}`;

/** Rail entries that are pages; Discovery opens its overlay instead */
export type RailPage = 'queue' | 'leads' | 'settings';

/** The rail entry to mark as the current page; a lead belongs to All leads */
export function activeRailPage(pathname: string): RailPage | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === ROUTES.queue) return 'queue';
  if (path === ROUTES.leads || path.startsWith(`${ROUTES.leads}/`)) return 'leads';
  if (path === ROUTES.settings || path.startsWith(`${ROUTES.settings}/`)) return 'settings';
  return null;
}

/** Where a lead opened from a page goes back to when it closes */
export interface LeadLocationState {
  from?: string;
}

/**
 * Whether a lead was opened from a page of the app (history state set by `useOpenLead` / `LeadLink`), so
 * closing it can step back to that page instead of stacking a new history entry. Only in-app paths
 * count, never an absolute URL smuggled into history state.
 */
export function openedInApp(state: unknown): boolean {
  const from = (state as LeadLocationState | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//');
}
