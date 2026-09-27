import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DiscoveryCandidateStatus,
  DiscoveryJobState,
  IDiscoveryCandidate,
  IDiscoveryImportResult,
  IDiscoveryJobResult,
  IDiscoveryJobStatus,
} from '@revamp/shared-types';
import {
  StartDiscoveryDto,
  StartDiscoveryInput,
  StartDiscoverySchema,
  countCandidatesByStatus,
} from '@revamp/validation';
import { apiClient } from '../api/client.js';
import { LEADS_QUERY_KEY } from './useLeads.js';
import { useDiscoveryStore } from '../store/useDiscoveryStore.js';

export const DISCOVERY_POLL_INTERVAL_MS = 2000;

const FINISHED_STATES: DiscoveryJobState[] = ['completed', 'failed'];

export function isDiscoveryFinished(status?: Pick<IDiscoveryJobStatus, 'state'> | null): boolean {
  return Boolean(status && FINISHED_STATES.includes(status.state));
}

/** Poll interval for react-query: keep polling until the job has finished */
export function discoveryRefetchInterval(status?: Pick<IDiscoveryJobStatus, 'state'> | null): number | false {
  return isDiscoveryFinished(status) ? false : DISCOVERY_POLL_INTERVAL_MS;
}

export type DiscoveryStateBucket = 'queued' | 'running' | 'completed' | 'failed';

/** Collapses BullMQ job states into the four the operator sees */
export function discoveryStateBucket(state: DiscoveryJobState): DiscoveryStateBucket {
  if (state === 'active') return 'running';
  if (state === 'completed' || state === 'failed') return state;
  return 'queued';
}

/** What the header button shows about the background search (REV-40) */
export type DiscoveryIndicator = 'idle' | 'running' | 'ready' | 'failed';

export interface DiscoveryIndicatorInput {
  activeJobId: string | null;
  status?: Pick<IDiscoveryJobStatus, 'state'> | null;
  /** The status request itself failed */
  isError?: boolean;
  /** The operator has already seen the finished job in the modal */
  resultsSeen: boolean;
}

export function discoveryIndicator({ activeJobId, status, isError, resultsSeen }: DiscoveryIndicatorInput): DiscoveryIndicator {
  if (!activeJobId) return 'idle';
  if (isError) return resultsSeen ? 'idle' : 'failed';
  // Status not loaded yet counts as queued
  if (!status || !isDiscoveryFinished(status)) return 'running';
  if (resultsSeen) return 'idle';
  return status.state === 'completed' ? 'ready' : 'failed';
}

/** What to do when a job sent to the background finishes (REV-41) */
export type DiscoveryFinishAction = 'none' | 'notifyReady' | 'notifyEmpty' | 'notifyFailed';

export interface DiscoveryFinishInput extends DiscoveryIndicatorInput {
  status?: (Pick<IDiscoveryJobStatus, 'state'> & Partial<Pick<IDiscoveryJobStatus, 'result'>>) | null;
  /** The discovery modal is open, so the operator watches the job finish there */
  isOpen: boolean;
  /** The job whose finish was already announced */
  notifiedJobId: string | null;
}

/**
 * Which notification to show when a background search finishes: new businesses to review, nothing
 * new, or a failure. Once per job, and never while the modal is open, since the operator sees it there.
 */
export function discoveryFinishAction({
  activeJobId,
  status,
  isError,
  resultsSeen,
  isOpen,
  notifiedJobId,
}: DiscoveryFinishInput): DiscoveryFinishAction {
  if (!activeJobId || isOpen || resultsSeen || notifiedJobId === activeJobId) return 'none';
  if (isError) return 'notifyFailed';
  if (!status || !isDiscoveryFinished(status)) return 'none';
  if (status.state === 'failed') return 'notifyFailed';
  return newCandidateCount(status.result) > 0 ? 'notifyReady' : 'notifyEmpty';
}

/** New businesses the operator can still import from a finished search */
export function newCandidateCount(result?: Pick<IDiscoveryJobResult, 'candidates'> | null): number {
  // Searches from before REV-29 kept no candidate list
  return Array.isArray(result?.candidates) ? importableIds(result.candidates).length : 0;
}

export type DiscoveryFormErrorKey =
  | 'discovery.errors.location'
  | 'discovery.errors.keyword'
  | 'discovery.errors.limit'
  | 'discovery.errors.invalid';

/** Validates the form with the API's schema and maps the first issue to a translation key */
export function validateDiscoveryForm(
  input: StartDiscoveryInput,
): { success: true; data: StartDiscoveryDto } | { success: false; errorKey: DiscoveryFormErrorKey } {
  const parsed = StartDiscoverySchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };

  const field = parsed.error.issues[0]?.path[0];
  const errorKey: DiscoveryFormErrorKey =
    field === 'location' || field === 'keyword' || field === 'limit'
      ? `discovery.errors.${field}`
      : 'discovery.errors.invalid';
  return { success: false, errorKey };
}

export type LocationDetectErrorKey =
  | 'discovery.errors.geoUnsupported'
  | 'discovery.errors.geoDenied'
  | 'discovery.errors.geoUnavailable'
  | 'discovery.errors.geoTimeout'
  | 'discovery.errors.geoLookupFailed';

export class LocationDetectError extends Error {
  constructor(public readonly errorKey: LocationDetectErrorKey) {
    super(errorKey);
    this.name = 'LocationDetectError';
  }
}

// GeolocationPositionError codes
const GEO_ERROR_KEYS: Record<number, LocationDetectErrorKey> = {
  1: 'discovery.errors.geoDenied',
  2: 'discovery.errors.geoUnavailable',
  3: 'discovery.errors.geoTimeout',
};

/**
 * Asks the browser for the operator's position and resolves it to a place name for the location field.
 * City-level accuracy is enough, so a cached coarse fix is accepted.
 */
export async function detectLocation(
  lang: string | undefined,
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined = globalThis.navigator?.geolocation,
): Promise<string> {
  if (!geolocation) throw new LocationDetectError('discovery.errors.geoUnsupported');

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new LocationDetectError(GEO_ERROR_KEYS[error.code] ?? 'discovery.errors.geoUnavailable')),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60_000 },
    );
  });

  try {
    const place = await apiClient.reverseGeocode(position.coords.latitude, position.coords.longitude, lang);
    return place.location;
  } catch {
    throw new LocationDetectError('discovery.errors.geoLookupFailed');
  }
}

/** Candidate counts per status, in display order */
export function countCandidates(candidates: IDiscoveryCandidate[]): Record<DiscoveryCandidateStatus, number> {
  return countCandidatesByStatus(candidates);
}

export interface CandidateVisibility {
  /** Show businesses that are already leads (hidden by default, REV-35) */
  showExisting: boolean;
  /** Show listings skipped for other reasons: duplicates, no website, invalid */
  showSkipped: boolean;
}

/** Rows for the review table: new businesses always, the rest only when their toggle is on */
export function visibleCandidates(candidates: IDiscoveryCandidate[], visibility: CandidateVisibility): IDiscoveryCandidate[] {
  return candidates.filter((c) => {
    if (c.status === 'new') return true;
    if (c.status === 'existing_lead') return visibility.showExisting;
    return visibility.showSkipped;
  });
}

export type DiscoverySearchOutcome = 'filled' | 'exhausted' | 'capped';

/**
 * Whether the search found as many new businesses as asked for, ran out of listings in the area,
 * or stopped at the request cap. Uses the counts from search time, so importing businesses later
 * doesn't change it. Jobs from before REV-35 carry no paging info and count as filled.
 */
export function discoverySearchOutcome(
  result: Pick<IDiscoveryJobResult, 'counts' | 'exhausted'>,
  limit: number,
): DiscoverySearchOutcome {
  if (!result.counts || result.exhausted === undefined || result.counts.new >= limit) return 'filled';
  return result.exhausted ? 'exhausted' : 'capped';
}

/** External ids the operator can still import */
export function importableIds(candidates: IDiscoveryCandidate[]): string[] {
  return candidates.filter((c) => c.status === 'new').map((c) => c.externalId);
}

/** Drops selected ids that are no longer importable (e.g. imported since the last poll) */
export function pruneSelection(selected: ReadonlySet<string>, candidates: IDiscoveryCandidate[]): Set<string> {
  const importable = new Set(importableIds(candidates));
  return new Set([...selected].filter((id) => importable.has(id)));
}

/** Import outcome for the operator: how many were imported and how many were not */
export function summarizeImport(result: IDiscoveryImportResult): { imported: number; skipped: number; failed: number } {
  const failed = result.results.filter((r) => r.outcome === 'failed').length;
  return { imported: result.imported, failed, skipped: result.results.length - result.imported - failed };
}

export const useStartDiscoveryMutation = () =>
  useMutation({
    mutationFn: (input: StartDiscoveryInput) => apiClient.startDiscovery(input),
  });

/** Shared by the modal and the header button, which keeps the job polling while the modal is closed (REV-40) */
export const discoveryStatusQueryOptions = (jobId: string | null) =>
  queryOptions({
    queryKey: ['discovery', jobId],
    queryFn: () => apiClient.getDiscoveryStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => discoveryRefetchInterval(q.state.data),
  });

export const useDiscoveryStatusQuery = (jobId: string | null) => useQuery(discoveryStatusQueryOptions(jobId));

export const useImportDiscoveryMutation = (jobId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (externalIds: string[]) => apiClient.importDiscoveryCandidates(jobId as string, externalIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      // Imported rows come back as existing_lead
      queryClient.invalidateQueries({ queryKey: ['discovery', jobId] });
    },
  });
};

/**
 * The background search state for the top bar's "Find businesses" button and the rail's Discovery entry
 * (REV-40, REV-76). Separate selectors: re-rendering on the modal's own state would fight its focus.
 */
export const useDiscoveryIndicator = (): { indicator: DiscoveryIndicator; newCount: number } => {
  const activeJobId = useDiscoveryStore((s) => s.activeJobId);
  const resultsSeen = useDiscoveryStore((s) => s.resultsSeen);
  // Shares the modal's query, so the job keeps polling while the modal is closed and stops once it finishes
  const status = useDiscoveryStatusQuery(activeJobId);
  return {
    indicator: discoveryIndicator({ activeJobId, status: status.data, isError: status.isError, resultsSeen }),
    newCount: newCandidateCount(status.data?.result),
  };
};
