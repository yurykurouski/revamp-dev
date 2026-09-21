import { describe, it, expect, beforeEach } from 'vitest';
import { useLeadFilterStore } from '../useLeadFilterStore.js';
import { useHitlModalStore, BREAKPOINT_WIDTHS } from '../useHitlModalStore.js';
import { useThemeStore } from '../useThemeStore.js';

describe('Zustand Dashboard Stores', () => {
  describe('useLeadFilterStore', () => {
    beforeEach(() => {
      useLeadFilterStore.getState().resetFilters();
      useLeadFilterStore.getState().setViewMode('kanban');
      useLeadFilterStore.getState().closeAddModal();
    });

    it('should initialize with default empty filters and kanban view mode', () => {
      const state = useLeadFilterStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.selectedStatus).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
      expect(state.viewMode).toBe('kanban');
      expect(state.page).toBe(0);
      expect(state.pageSize).toBe(10);
      expect(state.isAddModalOpen).toBe(false);
    });

    it('should update search query', () => {
      useLeadFilterStore.getState().setSearchQuery('Dentist');
      expect(useLeadFilterStore.getState().searchQuery).toBe('Dentist');
    });

    it('should update selected status', () => {
      useLeadFilterStore.getState().setSelectedStatus('QUEUED');
      expect(useLeadFilterStore.getState().selectedStatus).toBe('QUEUED');
    });

    it('should update selected niche', () => {
      useLeadFilterStore.getState().setSelectedNiche('dental');
      expect(useLeadFilterStore.getState().selectedNiche).toBe('dental');
    });

    it('should toggle view mode between kanban and table', () => {
      useLeadFilterStore.getState().setViewMode('table');
      expect(useLeadFilterStore.getState().viewMode).toBe('table');

      useLeadFilterStore.getState().setViewMode('kanban');
      expect(useLeadFilterStore.getState().viewMode).toBe('kanban');
    });

    it('should handle pagination changes', () => {
      useLeadFilterStore.getState().setPage(2);
      useLeadFilterStore.getState().setPageSize(25);
      expect(useLeadFilterStore.getState().page).toBe(2);
      expect(useLeadFilterStore.getState().pageSize).toBe(25);
    });

    it('should toggle add lead modal state', () => {
      useLeadFilterStore.getState().openAddModal();
      expect(useLeadFilterStore.getState().isAddModalOpen).toBe(true);

      useLeadFilterStore.getState().closeAddModal();
      expect(useLeadFilterStore.getState().isAddModalOpen).toBe(false);
    });

    it('should reset all filters to default and reset page to 0', () => {
      useLeadFilterStore.getState().setSearchQuery('Test Query');
      useLeadFilterStore.getState().setSelectedStatus('SENT');
      useLeadFilterStore.getState().setSelectedNiche('auto');
      useLeadFilterStore.getState().setPage(4);

      useLeadFilterStore.getState().resetFilters();

      const state = useLeadFilterStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.selectedStatus).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
      expect(state.page).toBe(0);
    });
  });

  describe('useHitlModalStore', () => {
    beforeEach(() => {
      useHitlModalStore.getState().closeModal();
      useHitlModalStore.getState().setBreakpoint('desktop');
    });

    it('should initialize with closed modal state and desktop breakpoint', () => {
      const state = useHitlModalStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.selectedLeadId).toBeNull();
      expect(state.selectedAuditId).toBeNull();
      expect(state.activeBreakpoint).toBe('desktop');
    });

    it('should open modal with leadId and auditId', () => {
      useHitlModalStore.getState().openModal('lead-123', 'audit-456');

      const state = useHitlModalStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.selectedLeadId).toBe('lead-123');
      expect(state.selectedAuditId).toBe('audit-456');
    });

    it('should change active breakpoint', () => {
      useHitlModalStore.getState().setBreakpoint('mobile');
      expect(useHitlModalStore.getState().activeBreakpoint).toBe('mobile');

      useHitlModalStore.getState().setBreakpoint('tablet');
      expect(useHitlModalStore.getState().activeBreakpoint).toBe('tablet');
    });

    it('should switch original screenshot tabs between desktop and mobile', () => {
      expect(useHitlModalStore.getState().originalScreenTab).toBe('desktop');

      useHitlModalStore.getState().setOriginalScreenTab('mobile');
      expect(useHitlModalStore.getState().originalScreenTab).toBe('mobile');

      useHitlModalStore.getState().setOriginalScreenTab('desktop');
      expect(useHitlModalStore.getState().originalScreenTab).toBe('desktop');
    });

    it('should switch active modal tabs between inspector and email editor', () => {
      expect(useHitlModalStore.getState().activeTab).toBe('inspector');

      useHitlModalStore.getState().setActiveTab('email_editor');
      expect(useHitlModalStore.getState().activeTab).toBe('email_editor');

      useHitlModalStore.getState().setActiveTab('inspector');
      expect(useHitlModalStore.getState().activeTab).toBe('inspector');
    });

    it('should correctly map breakpoint widths', () => {
      expect(BREAKPOINT_WIDTHS.mobile).toBe('375px');
      expect(BREAKPOINT_WIDTHS.tablet).toBe('768px');
      expect(BREAKPOINT_WIDTHS.desktop).toBe('100%');
    });

    it('should close modal and clear selected ids', () => {
      useHitlModalStore.getState().openModal('lead-1', 'audit-1');
      useHitlModalStore.getState().closeModal();

      const state = useHitlModalStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.selectedLeadId).toBeNull();
      expect(state.selectedAuditId).toBeNull();
    });
  });

  describe('useThemeStore', () => {
    it('should toggle theme mode between light and dark', () => {
      useThemeStore.getState().setTheme('light');
      expect(useThemeStore.getState().mode).toBe('light');

      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().mode).toBe('dark');

      useThemeStore.getState().toggleTheme();
      expect(useThemeStore.getState().mode).toBe('light');
    });

    it('should explicitly set theme mode', () => {
      useThemeStore.getState().setTheme('dark');
      expect(useThemeStore.getState().mode).toBe('dark');

      useThemeStore.getState().setTheme('light');
      expect(useThemeStore.getState().mode).toBe('light');
    });
  });
});
