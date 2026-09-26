import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DiscoveryCandidateStatus,
  DiscoveryJobState,
  IDiscoveryCandidate,
  IDiscoveryImportResult,
  IDiscoveryJobStatus,
} from '@revamp/shared-types';
import { StartDiscoveryDto, StartDiscoveryInput, StartDiscoverySchema } from '@revamp/validation';
import { apiClient } from '../api/client.js';
import { LEADS_QUERY_KEY } from './useLeads.js';

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
  const counts: Record<DiscoveryCandidateStatus, number> = {
    new: 0,
    existing_lead: 0,
    duplicate: 0,
    no_website: 0,
    invalid: 0,
  };
  for (const candidate of candidates) counts[candidate.status]++;
  return counts;
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

export const useDiscoveryStatusQuery = (jobId: string | null) =>
  useQuery({
    queryKey: ['discovery', jobId],
    queryFn: () => apiClient.getDiscoveryStatus(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (q) => discoveryRefetchInterval(q.state.data),
  });

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
