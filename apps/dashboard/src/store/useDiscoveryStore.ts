import { create } from 'zustand';

interface DiscoveryState {
  isOpen: boolean;
  /** The running or last finished discovery job; kept while the modal is closed */
  activeJobId: string | null;

  open: () => void;
  close: () => void;
  setActiveJob: (jobId: string) => void;
  /** Clears the finished job so the form can start a new search */
  startNewSearch: () => void;
}

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  isOpen: false,
  activeJobId: null,

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveJob: (jobId) => set({ activeJobId: jobId }),
  startNewSearch: () => set({ activeJobId: null }),
}));
