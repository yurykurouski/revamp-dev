import { create } from 'zustand';

export type PreviewBreakpoint = 'mobile' | 'tablet' | 'desktop';

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
  openModal: (leadId: string, auditId: string) => void;
  closeModal: () => void;
  setBreakpoint: (breakpoint: PreviewBreakpoint) => void;
}

export const useHitlModalStore = create<HitlModalState>((set) => ({
  isOpen: false,
  selectedLeadId: null,
  selectedAuditId: null,
  activeBreakpoint: 'desktop',
  openModal: (leadId, auditId) =>
    set({
      isOpen: true,
      selectedLeadId: leadId,
      selectedAuditId: auditId,
    }),
  closeModal: () =>
    set({
      isOpen: false,
      selectedLeadId: null,
      selectedAuditId: null,
    }),
  setBreakpoint: (breakpoint) => set({ activeBreakpoint: breakpoint }),
}));
