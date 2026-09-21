import { create } from 'zustand';
import { LeadStatus, NicheType } from '@revamp/shared-types';

export type ViewMode = 'kanban' | 'table';

interface LeadFilterState {
  searchQuery: string;
  selectedStatus: LeadStatus | 'ALL';
  selectedNiche: NicheType | 'ALL';
  viewMode: ViewMode;
  page: number;
  pageSize: number;
  isAddModalOpen: boolean;

  setSearchQuery: (query: string) => void;
  setSelectedStatus: (status: LeadStatus | 'ALL') => void;
  setSelectedNiche: (niche: NicheType | 'ALL') => void;
  setViewMode: (mode: ViewMode) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  openAddModal: () => void;
  closeAddModal: () => void;
  resetFilters: () => void;
}

export const useLeadFilterStore = create<LeadFilterState>((set) => ({
  searchQuery: '',
  selectedStatus: 'ALL',
  selectedNiche: 'ALL',
  viewMode: 'kanban',
  page: 0,
  pageSize: 10,
  isAddModalOpen: false,

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedStatus: (status) => set({ selectedStatus: status }),
  setSelectedNiche: (niche) => set({ selectedNiche: niche }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  openAddModal: () => set({ isAddModalOpen: true }),
  closeAddModal: () => set({ isAddModalOpen: false }),
  resetFilters: () =>
    set({
      searchQuery: '',
      selectedStatus: 'ALL',
      selectedNiche: 'ALL',
      page: 0,
    }),
}));
