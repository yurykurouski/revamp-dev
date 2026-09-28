import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MVP_COLOR_PRESETS, QUEUE_NAMES } from '@revamp/shared-types';
import { Lead } from '../../models/Lead.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { findGenerationAudit } from '../../services/audit-lookup.js';
import { republishSavedMvp } from '../deploy.worker.js';
import type { MvpEditPlan, MvpEditService } from '../../services/mvp-edit.service.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../services/audit-lookup.js');
vi.mock('../deploy.worker.js', () => ({ republishSavedMvp: vi.fn() }));
vi.mock('../../queues/connection.js', () => ({ redisConnection: {} }));
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(function (this: any, name: string, processor: unknown, opts: unknown) {
    Object.assign(this, { name, processor, opts, on: vi.fn() });
  }),
}));

const { processMvpEditJob, colorCandidates, createMvpEditWorker } = await import('../mvp-edit.worker.js');

const mvpProjectId = '64b000000000000000000001';
const leadId = '64b000000000000000000002';
const auditId = '64b000000000000000000003';
const content = {
  hero: { badge: 'b', headline: 'Old headline', subheadline: 's', primaryCtaText: 'p', secondaryCtaText: 's' },
  services: [{ title: 'Cut', description: 'A haircut.', lucideIconName: 'sparkles' }],
  trustSignals: [],
  offerNotice: 'Call us',
};
const project = {
  _id: mvpProjectId,
  leadId: { toString: () => leadId },
  auditId: { toString: () => auditId },
  generatedContent: content,
  colorPalette: { primary: '#4F46E5', secondary: '#B8C4FE', accent: '#4F46E5' },
  layout: { variant: 'bento', reasons: ['rule:default', 'images:3'] },
};
const lead = { _id: leadId, status: 'NEEDS_APPROVAL', businessName: 'Studio Cut', niche: 'beauty', city: 'Kraków' };
const audit = {
  _id: auditId,
  extractedServices: ['Cut'],
  extractedContacts: { phone: '+48 600 100 200' },
  extractedContent: { headings: [], paragraphs: ['We cut hair.'], serviceItems: [], navItems: [], testimonials: [], images: [] },
  extractedBrandTokens: { primaryColor: '#c33', secondaryColor: '#222222', accentColor: 'rgb(1,2,3)' },
};

const exec = (value: unknown) => ({ exec: vi.fn().mockResolvedValue(value) }) as any;
const serviceReturning = (plan: MvpEditPlan) =>
  ({ interpret: vi.fn().mockResolvedValue(plan) }) as unknown as MvpEditService & { interpret: ReturnType<typeof vi.fn> };
const job = (deadline = Date.now() + 60_000) => ({ mvpProjectId, instruction: 'Punchier headline', deadline });

describe('mvp edit worker (REV-85)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(MvpProject.findById).mockReturnValue(exec(project));
    vi.mocked(MvpProject.findByIdAndUpdate).mockReturnValue(exec(project));
    vi.mocked(Lead.findById).mockReturnValue(exec(lead));
    vi.mocked(findGenerationAudit).mockResolvedValue(audit as any);
    vi.mocked(republishSavedMvp).mockResolvedValue({ success: true } as any);
  });

  it('listens on its own queue', () => {
    const worker = createMvpEditWorker() as any;
    expect(worker.name).toBe(QUEUE_NAMES.MVP_EDIT);
  });

  it('interprets the instruction with the MVP, the lead facts and the allowed colors', async () => {
    const service = serviceReturning({ summary: 'Nothing to change', changes: [] });

    await processMvpEditJob(job(), service);

    const request = service.interpret.mock.calls[0]![0];
    expect(request.instruction).toBe('Punchier headline');
    expect(request.current).toEqual({ content, primaryColor: '#4F46E5', layout: 'bento' });
    expect(request.grounding).toMatchObject({
      businessName: 'Studio Cut',
      extractedServices: ['Cut'],
      contacts: { phone: '+48 600 100 200' },
      siteContent: audit.extractedContent,
    });
    expect(request.colorCandidates[0]).toEqual({ hex: '#4F46E5', source: 'current' });
    expect(findGenerationAudit).toHaveBeenCalledWith(leadId, auditId);
  });

  it('saves only what changed, re-publishes the page and reports the change', async () => {
    const newContent = { ...content, hero: { ...content.hero, headline: 'New headline' } };
    const service = serviceReturning({
      summary: 'Punchier headline and a split layout',
      content: newContent,
      layout: 'split',
      changes: ['content', 'layout'],
    });

    const result = await processMvpEditJob(job(), service);

    expect(result).toEqual({ applied: true, summary: 'Punchier headline and a split layout', changes: ['content', 'layout'] });
    const [id, update] = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]! as [string, any];
    expect(id).toBe(mvpProjectId);
    expect(update.$set.generatedContent).toEqual(newContent);
    // The layout becomes the operator's, keeping the audit facts behind the automatic choice
    expect(update.$set.layout).toEqual({ variant: 'split', reasons: ['rule:manual', 'images:3'] });
    expect(update.$set.editedAt).toBeInstanceOf(Date);
    // The palette was not part of the change, so a color picked meanwhile is kept
    expect(update.$set).not.toHaveProperty(['colorPalette.primary']);
    expect(republishSavedMvp).toHaveBeenCalledWith(leadId);
  });

  it('saves a picked color as primary and accent, as the palette picker does', async () => {
    const service = serviceReturning({ summary: 'Amber', primaryColor: '#D97706', changes: ['palette'] });

    await processMvpEditJob(job(), service);

    const update = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]![1] as any;
    expect(update.$set['colorPalette.primary']).toBe('#D97706');
    expect(update.$set['colorPalette.accent']).toBe('#D97706');
    expect(update.$set).not.toHaveProperty('generatedContent');
  });

  it('writes and re-publishes nothing when the model changed nothing', async () => {
    const service = serviceReturning({ summary: 'No prices on the site', changes: [] });

    await expect(processMvpEditJob(job(), service)).resolves.toEqual({
      applied: false,
      summary: 'No prices on the site',
      changes: [],
    });
    expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(republishSavedMvp).not.toHaveBeenCalled();
  });

  it('treats an MVP saved without a layout as Bento', async () => {
    vi.mocked(MvpProject.findById).mockReturnValue(exec({ ...project, layout: undefined }));
    const service = serviceReturning({ summary: 'ok', changes: [] });
    await processMvpEditJob(job(), service);
    expect(service.interpret.mock.calls[0]![0].current.layout).toBe('bento');
  });

  describe('custom design (REV-92)', () => {
    const design = { hidden: ['gallery'], theme: { corners: 'sharp' } };

    it('hands the saved design to the agent and saves the new one', async () => {
      vi.mocked(MvpProject.findById).mockReturnValue(exec({ ...project, design }));
      const next = { ...design, theme: { corners: 'soft' } };
      const service = serviceReturning({ summary: 'Softer corners', design: next as never, changes: ['design'] });

      await processMvpEditJob(job(), service);

      expect(service.interpret.mock.calls[0]![0].current.design).toEqual(design);
      const update = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]![1] as any;
      expect(update.$set.design).toEqual(next);
      expect(update.$unset).toBeUndefined();
      expect(republishSavedMvp).toHaveBeenCalledWith(leadId);
    });

    it('unsets the design when the agent returns an empty one', async () => {
      vi.mocked(MvpProject.findById).mockReturnValue(exec({ ...project, design }));
      const service = serviceReturning({ summary: 'Original look', design: {}, changes: ['design'] });

      await processMvpEditJob(job(), service);

      const update = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]![1] as any;
      expect(update.$set).not.toHaveProperty('design');
      expect(update.$unset).toEqual({ design: '' });
    });

    it('resets the design without asking the model and re-publishes', async () => {
      vi.mocked(MvpProject.findById).mockReturnValue(exec({ ...project, design }));
      const service = serviceReturning({ summary: 'unused', changes: [] });

      const result = await processMvpEditJob({ ...job(), action: 'reset-design', instruction: '' }, service);

      expect(result).toEqual({ applied: true, summary: 'The custom design was removed.', changes: ['design'] });
      expect(service.interpret).not.toHaveBeenCalled();
      const update = vi.mocked(MvpProject.findByIdAndUpdate).mock.calls[0]![1] as any;
      expect(update.$unset).toEqual({ design: '' });
      expect(update.$set.editedAt).toBeInstanceOf(Date);
      expect(republishSavedMvp).toHaveBeenCalledWith(leadId);
    });

    it('changes nothing on a reset when there is no custom design', async () => {
      const service = serviceReturning({ summary: 'unused', changes: [] });
      const result = await processMvpEditJob({ ...job(), action: 'reset-design', instruction: '' }, service);
      expect(result).toEqual({ applied: false, summary: 'The MVP has no custom design.', changes: [] });
      expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
      expect(republishSavedMvp).not.toHaveBeenCalled();
    });

    it('refuses a reset once the lead has left review', async () => {
      vi.mocked(Lead.findById).mockReturnValue(exec({ ...lead, status: 'SCHEDULED' }));
      const service = serviceReturning({ summary: 'unused', changes: [] });
      await expect(processMvpEditJob({ ...job(), action: 'reset-design', instruction: '' }, service)).rejects.toThrow(
        'while the lead is SCHEDULED',
      );
    });
  });

  it.each(['GENERATING', 'SCHEDULED', 'SENT', 'REJECTED'])('refuses to change the MVP while the lead is %s', async (status) => {
    vi.mocked(Lead.findById).mockReturnValue(exec({ ...lead, status }));
    const service = serviceReturning({ summary: 'ok', changes: [] });

    await expect(processMvpEditJob(job(), service)).rejects.toThrow(`while the lead is ${status}`);
    expect(service.interpret).not.toHaveBeenCalled();
  });

  it('does not apply a change when the lead moved on while the model was thinking', async () => {
    vi.mocked(Lead.findById).mockReturnValueOnce(exec(lead)).mockReturnValueOnce(exec({ ...lead, status: 'GENERATING' }));
    const service = serviceReturning({ summary: 'Split', layout: 'split', changes: ['layout'] });

    await expect(processMvpEditJob(job(), service)).rejects.toThrow('while the lead is GENERATING');
    expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(republishSavedMvp).not.toHaveBeenCalled();
  });

  it('skips a job whose deadline passed before it started', async () => {
    const service = serviceReturning({ summary: 'ok', changes: [] });
    await expect(processMvpEditJob(job(Date.now() - 1), service)).rejects.toThrow(/stopped waiting/);
    expect(service.interpret).not.toHaveBeenCalled();
  });

  it('does not apply a change that arrives after the deadline', async () => {
    const deadline = 1_000;
    const now = vi.fn().mockReturnValueOnce(500).mockReturnValueOnce(1_500);
    const service = serviceReturning({ summary: 'Split', layout: 'split', changes: ['layout'] });

    await expect(processMvpEditJob(job(deadline), service, now)).rejects.toThrow(/stopped waiting/);
    expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('fails when the MVP, its lead or its audit is gone', async () => {
    const service = serviceReturning({ summary: 'ok', changes: [] });
    vi.mocked(MvpProject.findById).mockReturnValueOnce(exec(null));
    await expect(processMvpEditJob(job(), service)).rejects.toThrow(`MVP ${mvpProjectId} not found`);

    vi.mocked(Lead.findById).mockReturnValueOnce(exec(null));
    await expect(processMvpEditJob(job(), service)).rejects.toThrow(`Lead ${leadId} not found`);

    vi.mocked(findGenerationAudit).mockResolvedValueOnce(null);
    await expect(processMvpEditJob(job(), service)).rejects.toThrow('No completed audit');
  });

  it('passes the model error on without saving anything', async () => {
    const service = { interpret: vi.fn().mockRejectedValue(new Error('No LLM provider is configured')) } as any;
    await expect(processMvpEditJob(job(), service)).rejects.toThrow('No LLM provider is configured');
    expect(MvpProject.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  describe('colorCandidates', () => {
    it('offers the current color, the hex brand colors and the presets once each', () => {
      const candidates = colorCandidates('#4f46e5', audit.extractedBrandTokens);
      expect(candidates.slice(0, 3)).toEqual([
        { hex: '#4F46E5', source: 'current' },
        { hex: '#CC3333', source: 'brand primary' },
        { hex: '#222222', source: 'brand secondary' },
      ]);
      // rgb() brand colors are not offered; the Indigo preset equals the current color
      expect(candidates.some((c) => c.source === 'brand accent')).toBe(false);
      expect(candidates.some((c) => c.source === 'preset Indigo')).toBe(false);
      expect(candidates).toHaveLength(3 + MVP_COLOR_PRESETS.length - 1);
    });

    it('offers the presets when there is no current or brand color', () => {
      expect(colorCandidates(undefined, undefined).map((c) => c.hex)).toEqual(MVP_COLOR_PRESETS.map((p) => p.hex));
    });
  });
});
