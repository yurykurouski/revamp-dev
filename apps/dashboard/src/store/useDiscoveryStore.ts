import { create } from 'zustand';

interface DiscoveryState {
  isOpen: boolean;
  /** The running or last finished discovery job; kept while the modal is closed */
  activeJobId: string | null;
  /** The operator has seen the finished job in the modal, so the header indicator can clear (REV-40) */
  resultsSeen: boolean;

  open: () => void;
  close: () => void;
  setActiveJob: (jobId: string) => void;
  markResultsSeen: () => void;
  /** Clears the finished job so the form can start a new search */
  startNewSearch: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  isOpen: false,
  activeJobId: null,
  resultsSeen: false,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveJob: (jobId) => set({ activeJobId: jobId, resultsSeen: false }),
  markResultsSeen: () => set({ resultsSeen: true }),
  startNewSearch: () => set({ activeJobId: null, resultsSeen: false }),
}));
