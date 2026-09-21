import { create } from 'zustand';

export type PreviewBreakpoint = 'mobile' | 'tablet' | 'desktop';
export type OriginalScreenTab = 'desktop' | 'mobile';
export type ModalActiveTab = 'inspector' | 'email_editor';

export const BREAKPOINT_WIDTHS: Record<PreviewBreakpoint, string> = {
  mobile: '375px',
  tablet: '768px',
  desktop: '100%',
};

interface HitlModalState {
  isOpen: boolean;
  selectedLeadId: string | null;
  selectedAuditId: string | null;
  activeBreakpoint: PreviewBreakpoint;
  originalScreenTab: OriginalScreenTab;
  activeTab: ModalActiveTab;

  openModal: (leadId: string, auditId?: string) => void;
  closeModal: () => void;
  setBreakpoint: (breakpoint: PreviewBreakpoint) => void;
  setOriginalScreenTab: (tab: OriginalScreenTab) => void;
  setActiveTab: (tab: ModalActiveTab) => void;
}

export const useHitlModalStore = create<HitlModalState>((set) => ({
  isOpen: false,
  selectedLeadId: null,
  selectedAuditId: null,
  activeBreakpoint: 'desktop',
  originalScreenTab: 'desktop',
  activeTab: 'inspector',

  openModal: (leadId, auditId) =>
    set({
      isOpen: true,
      selectedLeadId: leadId,
      selectedAuditId: auditId || `audit-${leadId}`,
      activeBreakpoint: 'desktop',
      originalScreenTab: 'desktop',
      activeTab: 'inspector',
    }),
  closeModal: () =>
    set({
      isOpen: false,
      selectedLeadId: null,
      selectedAuditId: null,
    }),
  setBreakpoint: (breakpoint) => set({ activeBreakpoint: breakpoint }),
  setOriginalScreenTab: (tab) => set({ originalScreenTab: tab }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
