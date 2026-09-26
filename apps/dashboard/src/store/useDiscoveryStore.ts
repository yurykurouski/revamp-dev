import { create } from 'zustand';

interface DiscoveryState {
  isOpen: boolean;
  /** The running or last finished discovery job; kept while the modal is closed */
  activeJobId: string | null;
  /** The operator has seen the finished job in the modal, so the header indicator can clear (REV-40) */
  resultsSeen: boolean;
  /** The job whose background finish was already announced, so the notification shows once per job (REV-41) */
  notifiedJobId: string | null;

  open: () => void;
  close: () => void;
  setActiveJob: (jobId: string) => void;
  markResultsSeen: () => void;
  /** Records that a background job's finish was announced */
  markJobNotified: (jobId: string) => void;
  /** Clears the finished job so the form can start a new search */
  startNewSearch: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  isOpen: false,
  activeJobId: null,
  resultsSeen: false,
  notifiedJobId: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveJob: (jobId) => set({ activeJobId: jobId, resultsSeen: false, notifiedJobId: null }),
  markResultsSeen: () => set({ resultsSeen: true }),
  // A stale call for an earlier job changes nothing
  markJobNotified: (jobId) => set((s) => (s.activeJobId === jobId ? { notifiedJobId: jobId } : s)),
  startNewSearch: () => set({ activeJobId: null, resultsSeen: false, notifiedJobId: null }),
}));
