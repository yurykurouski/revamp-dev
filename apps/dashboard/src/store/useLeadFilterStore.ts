import { create } from 'zustand';
import { NicheType } from '@revamp/shared-types';
import { ComplexityFilter } from '../utils/siteComplexity.js';
import { BucketFilter } from '../utils/leadStages.js';

export type ViewMode = 'kanban' | 'table';

interface LeadFilterState {
  searchQuery: string;
  /** Review-queue bucket (REV-76); replaces the single-status filter */
  selectedBucket: BucketFilter;
  selectedNiche: NicheType | 'ALL';
  /** Site complexity class from the audit; ONE_PAGE_BROCHURE shows the easiest targets (REV-38) */
  selectedComplexity: ComplexityFilter;
  viewMode: ViewMode;
  page: number;
  pageSize: number;
  isAddModalOpen: boolean;

  setSearchQuery: (query: string) => void;
  setSelectedBucket: (bucket: BucketFilter) => void;
  setSelectedNiche: (niche: NicheType | 'ALL') => void;
  setSelectedComplexity: (complexity: ComplexityFilter) => void;
  setViewMode: (mode: ViewMode) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  openAddModal: () => void;
  closeAddModal: () => void;
  resetFilters: () => void;
}

export const useLeadFilterStore = create<LeadFilterState>((set) => ({
  searchQuery: '',
  selectedBucket: 'ALL',
  selectedNiche: 'ALL',
  selectedComplexity: 'ALL',
  viewMode: 'kanban',
  page: 0,
  pageSize: 10,
  isAddModalOpen: false,

  // A new filter yields a new result set, so the table goes back to its first page (REV-43)
  setSearchQuery: (query) => set({ searchQuery: query, page: 0 }),
  setSelectedBucket: (bucket) => set({ selectedBucket: bucket, page: 0 }),
  setSelectedNiche: (niche) => set({ selectedNiche: niche, page: 0 }),
  setSelectedComplexity: (complexity) => set({ selectedComplexity: complexity, page: 0 }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize }),
  openAddModal: () => set({ isAddModalOpen: true }),
  closeAddModal: () => set({ isAddModalOpen: false }),
  resetFilters: () =>
    set({
      searchQuery: '',
      selectedBucket: 'ALL',
      selectedNiche: 'ALL',
      selectedComplexity: 'ALL',
      page: 0,
    }),
}));
