import { create } from 'zustand';
import { LeadStatus, NicheType } from '@revamp/shared-types';

interface LeadFilterState {
  searchQuery: string;
  selectedStatus: LeadStatus | 'ALL';
  selectedNiche: NicheType | 'ALL';
  setSearchQuery: (query: string) => void;
  setSelectedStatus: (status: LeadStatus | 'ALL') => void;
  setSelectedNiche: (niche: NicheType | 'ALL') => void;
  resetFilters: () => void;
}

export const useLeadFilterStore = create<LeadFilterState>((set) => ({
  searchQuery: '',
  selectedStatus: 'ALL',
  selectedNiche: 'ALL',
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStatus: (status) => set({ selectedStatus: status }),
  setSelectedNiche: (niche) => set({ selectedNiche: niche }),
  resetFilters: () =>
    set({
      searchQuery: '',
      selectedStatus: 'ALL',
      selectedNiche: 'ALL',
    }),
}));
