import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLeadFilterStore } from '../useLeadFilterStore.js';
import { useThemeStore } from '../useThemeStore.js';
import { useLanguageStore, LANGUAGE_STORAGE_KEY } from '../useLanguageStore.js';
import { useDiscoveryStore } from '../useDiscoveryStore.js';
import { discoveryStep } from '../../hooks/useDiscovery.js';

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
      expect(state.selectedBucket).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
      expect(state.selectedComplexity).toBe('ALL');
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
      useLeadFilterStore.getState().setSelectedBucket('in_progress');
      expect(useLeadFilterStore.getState().selectedBucket).toBe('in_progress');
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

    it('should return the table to the first page when any filter changes (REV-43)', () => {
      const store = useLeadFilterStore.getState();
      const setters: Array<() => void> = [
        () => store.setSearchQuery('dental'),
        () => store.setSelectedBucket('needs_you'),
        () => store.setSelectedNiche('dental'),
        () => store.setSelectedComplexity('ONE_PAGE_BROCHURE'),
      ];
      for (const applyFilter of setters) {
        useLeadFilterStore.getState().setPage(3);
        applyFilter();
        expect(useLeadFilterStore.getState().page).toBe(0);
      }
    });

    it('should keep the page when only the page size changes', () => {
      useLeadFilterStore.getState().setPage(2);
      useLeadFilterStore.getState().setPageSize(25);
      expect(useLeadFilterStore.getState().page).toBe(2);
    });

    it('should update the site complexity filter (REV-38)', () => {
      useLeadFilterStore.getState().setSelectedComplexity('ONE_PAGE_BROCHURE');
      expect(useLeadFilterStore.getState().selectedComplexity).toBe('ONE_PAGE_BROCHURE');

      useLeadFilterStore.getState().setSelectedComplexity('ALL');
      expect(useLeadFilterStore.getState().selectedComplexity).toBe('ALL');
    });

    it('should toggle add lead modal state', () => {
      useLeadFilterStore.getState().openAddModal();
      expect(useLeadFilterStore.getState().isAddModalOpen).toBe(true);

      useLeadFilterStore.getState().closeAddModal();
      expect(useLeadFilterStore.getState().isAddModalOpen).toBe(false);
    });

    it('should reset all filters to default and reset page to 0', () => {
      useLeadFilterStore.getState().setSearchQuery('Test Query');
      useLeadFilterStore.getState().setSelectedBucket('outreach');
      useLeadFilterStore.getState().setSelectedNiche('auto');
      useLeadFilterStore.getState().setSelectedComplexity('COMPLEX');
      useLeadFilterStore.getState().setPage(4);

      useLeadFilterStore.getState().resetFilters();

      const state = useLeadFilterStore.getState();
      expect(state.searchQuery).toBe('');
      expect(state.selectedBucket).toBe('ALL');
      expect(state.selectedNiche).toBe('ALL');
      expect(state.selectedComplexity).toBe('ALL');
      expect(state.page).toBe(0);
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

  describe('useLanguageStore (REV-24)', () => {
    let storage: Map<string, string>;

    beforeEach(() => {
      storage = new Map();
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
      });
    });

    afterEach(() => {
      useLanguageStore.getState().setLanguage('en');
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it('should switch and persist the interface language', () => {
      useLanguageStore.getState().setLanguage('lt');
      expect(useLanguageStore.getState().language).toBe('lt');
      expect(storage.get(LANGUAGE_STORAGE_KEY)).toBe('lt');

      useLanguageStore.getState().setLanguage('ru');
      expect(useLanguageStore.getState().language).toBe('ru');
      expect(storage.get(LANGUAGE_STORAGE_KEY)).toBe('ru');
    });

    it('should restore the saved language on startup', async () => {
      storage.set(LANGUAGE_STORAGE_KEY, 'be');
      vi.resetModules();
      const { useLanguageStore: fresh } = await import('../useLanguageStore.js');
      expect(fresh.getState().language).toBe('be');
    });

    it('should detect the browser language when nothing is saved', async () => {
      vi.stubGlobal('navigator', { languages: ['de-DE', 'pl-PL'], language: 'de-DE' });
      vi.resetModules();
      const { useLanguageStore: fresh } = await import('../useLanguageStore.js');
      expect(fresh.getState().language).toBe('pl');
    });

    it('should fall back to English when storage is unavailable', async () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      });
      vi.resetModules();
      const { useLanguageStore: fresh } = await import('../useLanguageStore.js');
      expect(fresh.getState().language).toBe('en');
      fresh.getState().setLanguage('pl');
      expect(fresh.getState().language).toBe('pl');
    });
  });

  describe('useDiscoveryStore (REV-27)', () => {
    beforeEach(() => {
      useDiscoveryStore.setState({
        isOpen: false,
        activeJobId: null,
        resultsSeen: false,
        notifiedJobId: null,
        importResult: null,
        assessmentFilter: 'all',
        sortByAssessment: true,
      });
    });

    describe('verdict filter and sort (REV-98)', () => {
      it('should start with every candidate shown, best first', () => {
        expect(useDiscoveryStore.getState()).toMatchObject({ assessmentFilter: 'all', sortByAssessment: true });
      });

      it('should change the filter and the sort, and keep them while the drawer is closed', () => {
        const s = useDiscoveryStore.getState();
        s.setActiveJob('disc-7');
        s.setAssessmentFilter('poor');
        s.setSortByAssessment(false);
        s.close();
        s.open();
        expect(useDiscoveryStore.getState()).toMatchObject({ assessmentFilter: 'poor', sortByAssessment: false });
      });

      it('should reset them for a new job and on a new search', () => {
        const s = useDiscoveryStore.getState();
        s.setAssessmentFilter('good');
        s.setSortByAssessment(false);
        s.setActiveJob('disc-8');
        expect(useDiscoveryStore.getState()).toMatchObject({ assessmentFilter: 'all', sortByAssessment: true });

        s.setAssessmentFilter('failed');
        s.startNewSearch();
        expect(useDiscoveryStore.getState()).toMatchObject({ assessmentFilter: 'all', sortByAssessment: true });
      });

      it('should keep them when moving between Review and Import', () => {
        const s = useDiscoveryStore.getState();
        s.setActiveJob('disc-7');
        s.setAssessmentFilter('maybe');
        s.setImportResult('disc-7', { imported: 1, results: [] });
        s.backToReview();
        expect(useDiscoveryStore.getState().assessmentFilter).toBe('maybe');
      });
    });

    it('should start closed with no active job', () => {
      const state = useDiscoveryStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.activeJobId).toBeNull();
    });

    it('should open and close the drawer', () => {
      useDiscoveryStore.getState().open();
      expect(useDiscoveryStore.getState().isOpen).toBe(true);
      useDiscoveryStore.getState().close();
      expect(useDiscoveryStore.getState().isOpen).toBe(false);
    });

    it('should keep the active job while the drawer is closed and reopened', () => {
      useDiscoveryStore.getState().open();
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().close();
      useDiscoveryStore.getState().open();
      expect(useDiscoveryStore.getState().activeJobId).toBe('disc-7');
    });

    it('should clear the active job on a new search without closing the drawer', () => {
      useDiscoveryStore.getState().open();
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().startNewSearch();
      expect(useDiscoveryStore.getState().activeJobId).toBeNull();
      expect(useDiscoveryStore.getState().isOpen).toBe(true);
    });

    it('should track whether the operator has seen the finished job (REV-40)', () => {
      expect(useDiscoveryStore.getState().resultsSeen).toBe(false);
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().markResultsSeen();
      expect(useDiscoveryStore.getState().resultsSeen).toBe(true);
      // Closing the drawer keeps the job and the seen flag
      useDiscoveryStore.getState().close();
      expect(useDiscoveryStore.getState()).toMatchObject({ activeJobId: 'disc-7', resultsSeen: true });
    });

    it('should reset the seen flag for a new job and on a new search (REV-40)', () => {
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().markResultsSeen();
      useDiscoveryStore.getState().setActiveJob('disc-8');
      expect(useDiscoveryStore.getState().resultsSeen).toBe(false);

      useDiscoveryStore.getState().markResultsSeen();
      useDiscoveryStore.getState().startNewSearch();
      expect(useDiscoveryStore.getState()).toMatchObject({ activeJobId: null, resultsSeen: false });
    });

    it('should record a background job as notified without opening the drawer (REV-41)', () => {
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().markJobNotified('disc-7');
      expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, notifiedJobId: 'disc-7' });
    });

    it('should ignore a notification for a job that is no longer active (REV-41)', () => {
      useDiscoveryStore.getState().setActiveJob('disc-8');
      useDiscoveryStore.getState().markJobNotified('disc-7');
      expect(useDiscoveryStore.getState().notifiedJobId).toBeNull();
    });

    it('should reset the notified job for a new job and on a new search (REV-41)', () => {
      useDiscoveryStore.getState().setActiveJob('disc-7');
      useDiscoveryStore.getState().markJobNotified('disc-7');
      useDiscoveryStore.getState().setActiveJob('disc-8');
      expect(useDiscoveryStore.getState().notifiedJobId).toBeNull();

      useDiscoveryStore.getState().markJobNotified('disc-8');
      useDiscoveryStore.getState().startNewSearch();
      expect(useDiscoveryStore.getState().notifiedJobId).toBeNull();
    });

    describe('drawer steps (REV-78)', () => {
      const imported = { imported: 2, results: [] };
      const step = () => discoveryStep(useDiscoveryStore.getState());

      it('should start on Where with no import', () => {
        expect(useDiscoveryStore.getState().importResult).toBeNull();
        expect(step()).toBe('where');
      });

      it('should move Where → Review → Import → Review → Where', () => {
        const s = useDiscoveryStore.getState();
        s.open();
        s.setActiveJob('disc-7');
        expect(step()).toBe('review');
        s.setImportResult('disc-7', imported);
        expect(step()).toBe('import');
        expect(useDiscoveryStore.getState().importResult).toEqual(imported);
        s.backToReview();
        expect(step()).toBe('review');
        s.startNewSearch();
        expect(step()).toBe('where');
        expect(useDiscoveryStore.getState().isOpen).toBe(true);
      });

      it('should ignore an import that finishes after the operator moved to another job', () => {
        useDiscoveryStore.getState().setActiveJob('disc-8');
        useDiscoveryStore.getState().setImportResult('disc-7', imported);
        expect(useDiscoveryStore.getState().importResult).toBeNull();
        expect(step()).toBe('review');
      });

      it('should drop the import for a new job and on a new search', () => {
        useDiscoveryStore.getState().setActiveJob('disc-7');
        useDiscoveryStore.getState().setImportResult('disc-7', imported);
        useDiscoveryStore.getState().setActiveJob('disc-8');
        expect(useDiscoveryStore.getState().importResult).toBeNull();

        useDiscoveryStore.getState().setImportResult('disc-8', imported);
        useDiscoveryStore.getState().startNewSearch();
        expect(useDiscoveryStore.getState().importResult).toBeNull();
      });

      it('should return to the same step after running a search in the background', () => {
        const s = useDiscoveryStore.getState();
        s.open();
        s.setActiveJob('disc-7');
        // "Run in background" closes the drawer; the job and its step stay
        s.close();
        expect(useDiscoveryStore.getState()).toMatchObject({ isOpen: false, activeJobId: 'disc-7' });
        s.open();
        expect(step()).toBe('review');

        s.setImportResult('disc-7', imported);
        s.close();
        s.open();
        expect(step()).toBe('import');
      });
    });
  });
});
