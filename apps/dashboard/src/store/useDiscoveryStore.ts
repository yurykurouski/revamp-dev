import { create } from 'zustand';
import { IDiscoveryImportResult } from '@revamp/shared-types';

interface DiscoveryState {
  isOpen: boolean;
  /** The running or last finished discovery job; kept while the drawer is closed */
  activeJobId: string | null;
  /** The operator has seen the finished job in the drawer, so the header indicator can clear (REV-40) */
  resultsSeen: boolean;
  /** The job whose background finish was already announced, so the notification shows once per job (REV-41) */
  notifiedJobId: string | null;
  /** The active job's last import; while set the drawer shows the Import step (REV-78) */
  importResult: IDiscoveryImportResult | null;

  open: () => void;
  close: () => void;
  setActiveJob: (jobId: string) => void;
  markResultsSeen: () => void;
  /** Records that a background job's finish was announced */
  markJobNotified: (jobId: string) => void;
  /** Records an import of the active job's candidates and moves the drawer to the Import step */
  setImportResult: (jobId: string, result: IDiscoveryImportResult) => void;
  /** Leaves the Import step for the job's remaining candidates */
  backToReview: () => void;
  /** Clears the finished job so the form can start a new search */
  startNewSearch: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  isOpen: false,
  activeJobId: null,
  resultsSeen: false,
  notifiedJobId: null,
  importResult: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveJob: (jobId) => set({ activeJobId: jobId, resultsSeen: false, notifiedJobId: null, importResult: null }),
  markResultsSeen: () => set({ resultsSeen: true }),
  // A stale call for an earlier job changes nothing
  markJobNotified: (jobId) => set((s) => (s.activeJobId === jobId ? { notifiedJobId: jobId } : s)),
  setImportResult: (jobId, result) => set((s) => (s.activeJobId === jobId ? { importResult: result } : s)),
  backToReview: () => set({ importResult: null }),
  startNewSearch: () => set({ activeJobId: null, resultsSeen: false, notifiedJobId: null, importResult: null }),
}));
