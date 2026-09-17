import { describe, it, expect, beforeEach } from 'vitest';
import { useLeadFilterStore } from '../useLeadFilterStore.js';
import { useHitlModalStore, BREAKPOINT_WIDTHS } from '../useHitlModalStore.js';

describe('Zustand Dashboard Stores', () => {
  describe('useLeadFilterStore', () => {
    beforeEach(() => {
      useLeadFilterStore.getState().resetFilters();
    });

    it('should initialize with default empty filters', () => {
      const state = useLeadFilterStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.selectedStatus).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
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

    it('should reset all filters to default', () => {
      useLeadFilterStore.getState().setSearchQuery('Test Query');
      useLeadFilterStore.getState().setSelectedStatus('SENT');
      useLeadFilterStore.getState().setSelectedNiche('auto');

      useLeadFilterStore.getState().resetFilters();

      const state = useLeadFilterStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.selectedStatus).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
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
});
