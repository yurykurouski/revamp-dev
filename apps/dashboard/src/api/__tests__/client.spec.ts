import { describe, it, expect, expectTypeOf, vi, afterEach } from 'vitest';
import type { Serialized } from '@revamp/shared-types';
import {
  ApiError,
  apiClient,
  fetchAllLeadPages,
  fetchLeadStats,
  IServerAudit,
  IServerLead,
  LEADS_PAGE_SIZE,
  mapServerAudit,
  mapServerLead,
} from '../client.js';

/** The approve call always carries the draft the operator reviewed (REV-61) */
const draft = { subject: 'Subject', body: 'Body' };

describe('Dashboard apiClient', () => {
  const jsonRes = (body: unknown, status = 200) =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
  const unreachable = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getLeads (REV-45: real data only)', () => {
    const stats = { total: 5, byStatus: { NEEDS_APPROVAL: 2, SCHEDULED: 1, SENT: 1, CLICKED: 1 } };
    const stubLeadsApi = (leads: unknown[]) => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(
          url.includes('/leads/stats')
            ? jsonRes({ success: true, data: stats })
            : jsonRes({ success: true, data: leads, pagination: { total: leads.length, totalPages: 1 } }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };

    it('returns the leads from the API', async () => {
      const fetchMock = stubLeadsApi([
        { _id: 'l1', businessName: 'Smile', originalUrl: 'https://www.smile.pl/', domain: 'smile.pl', niche: 'dental', status: 'NEEDS_APPROVAL', createdAt: 'x' },
      ]);

      const { leads, total } = await apiClient.getLeads();

      expect(leads).toEqual([expect.objectContaining({ id: 'l1', domain: 'smile.pl', status: 'NEEDS_APPROVAL' })]);
      expect(total).toBe(1);
      // The pipeline counts have their own query for the rail badge (REV-76)
      expect(fetchMock.mock.calls.some(([u]) => u.includes('/stats'))).toBe(false);
    });

    it('reads the pipeline-wide counts by status', async () => {
      stubLeadsApi([]);
      await expect(apiClient.getLeadStats()).resolves.toEqual(stats);
    });

    it('passes the filters to the API instead of filtering locally', async () => {
      const fetchMock = stubLeadsApi([]);

      await apiClient.getLeads({ search: ' Denta ', status: 'NEEDS_APPROVAL', niche: 'dental', complexity: 'ONE_PAGE_BROCHURE' });

      const listUrl = new URL(fetchMock.mock.calls.map(([u]) => u).find((u) => !u.includes('/stats'))!);
      expect(listUrl.searchParams.get('search')).toBe('Denta');
      expect(listUrl.searchParams.get('status')).toBe('NEEDS_APPROVAL');
      expect(listUrl.searchParams.get('niche')).toBe('dental');
      expect(listUrl.searchParams.get('complexity')).toBe('ONE_PAGE_BROCHURE');
    });

    it('returns an empty board when the API has no leads', async () => {
      stubLeadsApi([]);
      const { leads, total } = await apiClient.getLeads();
      expect(leads).toEqual([]);
      expect(total).toBe(0);
    });

    it('throws when the backend is unreachable instead of showing demo leads', async () => {
      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.getLeads()).rejects.toThrow('Failed to fetch');
    });

    it('throws on a server error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false }, 500)));
      await expect(apiClient.getLeads()).rejects.toThrow('HTTP 500');
    });

    it('rejects a lead without an id instead of inventing one (REV-67)', async () => {
      stubLeadsApi([{ businessName: 'No id', originalUrl: 'https://x.pl', domain: 'x.pl', niche: 'other', status: 'QUEUED', createdAt: 'x' }]);
      await expect(apiClient.getLeads()).rejects.toThrow('Malformed server response');
    });
  });

  describe('mapServerLead (REV-67)', () => {
    const lead: IServerLead = {
      _id: 'l1',
      businessName: 'Smile',
      originalUrl: 'https://www.smile.pl/',
      domain: 'smile.pl',
      niche: 'dental',
      city: 'Warszawa',
      contactPhone: '+48 600 000 000',
      totalScore: 42,
      status: 'NEEDS_APPROVAL',
      tags: [],
      previewUrl: 'http://minio/v/smile/index.html',
      mvpGeneratedAt: '2026-09-27T10:00:00.000Z',
      siteComplexity: 'ONE_PAGE_BROCHURE',
      completeness: { status: 'verified', score: 90, hasCriticalIssues: false, criticalIssues: [] },
      createdAt: '2026-09-26T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    };

    it('maps the fields the API returns', () => {
      expect(mapServerLead(lead)).toEqual({
        id: 'l1',
        businessName: 'Smile',
        domain: 'smile.pl',
        originalUrl: 'https://www.smile.pl/',
        niche: 'dental',
        city: 'Warszawa',
        phone: '+48 600 000 000',
        totalScore: 42,
        status: 'NEEDS_APPROVAL',
        previewUrl: 'http://minio/v/smile/index.html',
        comparisonBannerUrl: undefined,
        mvpGeneratedAt: '2026-09-27T10:00:00.000Z',
        generationError: undefined,
        auditError: undefined,
        completeness: { status: 'verified', score: 90, hasCriticalIssues: false, criticalIssues: [] },
        siteComplexity: 'ONE_PAGE_BROCHURE',
        createdAt: '2026-09-26T00:00:00.000Z',
      });
    });

    it('does not use the lead id as an audit id', () => {
      expect(mapServerLead(lead).auditId).toBeUndefined();
    });

    it('throws on a lead without an id', () => {
      expect(() => mapServerLead({ ...lead, _id: '' })).toThrow('Malformed server response');
      expect(() => mapServerLead({ ...lead, _id: undefined } as unknown as IServerLead)).toThrow('Malformed server response');
    });

    it('ignores legacy fields no API version returns', () => {
      const legacy = { ...lead, city: undefined, contactPhone: undefined, totalScore: undefined, url: 'https://old.pl', score: 7, contacts: { city: 'Old', phone: '1' } };
      expect(mapServerLead(legacy)).toMatchObject({ city: undefined, phone: undefined, totalScore: undefined, originalUrl: lead.originalUrl });
    });

    it('types dates as the ISO strings JSON carries', () => {
      expectTypeOf<Serialized<{ at: Date; list: Date[]; nested: { at?: Date | string } }>>().toEqualTypeOf<{
        at: string;
        list: string[];
        nested: { at?: string };
      }>();
      expectTypeOf<IServerLead['createdAt']>().toEqualTypeOf<string>();
    });
  });

  describe('createLead', () => {
    it('posts the lead and returns it with the server id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonRes({ success: true, data: { id: 'lead-9', auditId: 'audit-9', lead: { _id: 'lead-9' } } }, 201),
      );
      vi.stubGlobal('fetch', fetchMock);

      const newLead = await apiClient.createLead({
        url: 'https://premier-dental.org',
        niche: 'dental',
        businessName: 'Premier Dental Care',
        contactEmail: 'contact@premier-dental.org',
      });

      expect(newLead).toMatchObject({
        id: 'lead-9',
        auditId: 'audit-9',
        domain: 'premier-dental.org',
        businessName: 'Premier Dental Care',
        status: 'QUEUED',
      });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        businessName: 'Premier Dental Care',
        originalUrl: 'https://premier-dental.org',
        contactEmail: 'contact@premier-dental.org',
        niche: 'dental',
      });
    });

    it('does not invent a contact email when none is given (REV-45)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: { id: 'lead-1' } }, 201));
      vi.stubGlobal('fetch', fetchMock);

      const newLead = await apiClient.createLead({ url: 'new-test-clinic.com', niche: 'dental', contactEmail: '' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('contactEmail');
      expect(body.businessName).toBe('New-test-clinic');
      expect(newLead.domain).toBe('new-test-clinic.com');
    });

    it('throws when the backend is unreachable instead of adding a local lead', async () => {
      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.createLead({ url: 'https://x-clinic.com', niche: 'dental' })).rejects.toThrow('Failed to fetch');
    });

    it('surfaces the server validation message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'DUPLICATE', message: 'Duplicate domain' } }, 409)),
      );
      await expect(apiClient.createLead({ url: 'https://dup.com', niche: 'other' })).rejects.toThrow('Duplicate domain');
    });

    it('rejects a response without a lead id', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: true, data: {} }, 201)));
      await expect(apiClient.createLead({ url: 'https://x.com', niche: 'other' })).rejects.toThrow('Malformed server response');
    });

    it('should throw validation error when creating lead with invalid URL', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(apiClient.createLead({ url: 'not-a-valid-url', niche: 'other' })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('getAudit', () => {
    it('maps the audit metrics, critique and brand colors from the API', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonRes({
            success: true,
            data: {
              _id: 'audit-1',
              leadId: 'lead-1',
              screenshotUrls: { desktopOriginal: 'http://minio/d.webp', mobileOriginal: 'http://minio/m.webp' },
              lighthouseMetrics: { lcp: 3400 },
              scores: { accessibility: 68 },
              a11ySummary: { violationsCount: 14 },
              designCritique: {
                visualHierarchyRating: 55,
                mobileFriendlinessRating: 45,
                criticalFlaws: [{ title: 'No CTA', impact: 'i', recommendation: 'r' }],
                quickWins: ['Click-to-call'],
              },
              extractedBrandTokens: { primaryColor: '#123456', secondaryColor: '#abcdef', accentColor: '#654321' },
            },
          }),
        ),
      );

      const audit = await apiClient.getAudit('audit-1');

      expect(audit).toMatchObject({
        id: 'audit-1',
        leadId: 'lead-1',
        desktopScreenshotUrl: 'http://minio/d.webp',
        mobileScreenshotUrl: 'http://minio/m.webp',
        lcpSeconds: 3.4,
        a11yScore: 68,
        a11yViolationsCount: 14,
        visualHierarchyRating: 55,
        mobileFriendlinessRating: 45,
        quickWins: ['Click-to-call'],
        colorPalette: { primary: '#123456', secondary: '#abcdef', accent: '#654321' },
      });
      expect(audit.criticalFlaws).toHaveLength(1);
    });

    it('leaves unmeasured values undefined instead of inventing them (REV-45)', () => {
      const audit = mapServerAudit({ leadId: 'lead-1' }, 'audit-1');

      expect(audit).toEqual({
        id: 'audit-1',
        leadId: 'lead-1',
        desktopScreenshotUrl: undefined,
        mobileScreenshotUrl: undefined,
        desktopFullScreenshotUrl: undefined,
        mobileFullScreenshotUrl: undefined,
        lcpSeconds: undefined,
        a11yScore: undefined,
        a11yViolationsCount: undefined,
        visualHierarchyRating: undefined,
        mobileFriendlinessRating: undefined,
        criticalFlaws: [],
        quickWins: [],
        colorPalette: { primary: undefined, secondary: undefined, accent: undefined },
      });
    });

    it("maps the original site's service count (REV-81)", () => {
      expect(mapServerAudit({ leadId: 'l', extractedServices: ['a', 'b'] }, 'a').originalServiceCount).toBe(2);
      // No extracted services: the service items the crawler found
      expect(mapServerAudit({ leadId: 'l', extractedContent: { headings: [], paragraphs: [], serviceItems: [{ title: 'Cut' }], navItems: [], testimonials: [], images: [] } }, 'a').originalServiceCount).toBe(1);
      // A site with no services found keeps its zero
      expect(mapServerAudit({ leadId: 'l', extractedServices: [] }, 'a').originalServiceCount).toBe(0);
      const unknown = mapServerAudit({ leadId: 'l' }, 'a');
      expect(unknown.originalServiceCount).toBeUndefined();
    });

    it('ignores legacy fields no API version returns (REV-67)', () => {
      const legacy = { leadId: 'l', lcp: 2.5, a11yScore: 80, desktopScreenshotUrl: 'http://old/d.png', mobileScreenshotUrl: 'http://old/m.png', scores: { a11y: 70 } };
      expect(mapServerAudit(legacy as unknown as IServerAudit, 'a')).toMatchObject({
        lcpSeconds: undefined,
        a11yScore: undefined,
        desktopScreenshotUrl: undefined,
        mobileScreenshotUrl: undefined,
      });
    });

    it('keeps measured zeros', () => {
      const audit = mapServerAudit(
        {
          leadId: 'l',
          lighthouseMetrics: { lcp: 0, cls: 0 },
          scores: { total: 0, design: 0, accessibility: 0, performance: 0, standards: 0 },
          a11ySummary: { violationsCount: 0, contrastIssuesCount: 0, missingAltCount: 0, criticalViolations: [] },
        },
        'a',
      );
      expect(audit).toMatchObject({ lcpSeconds: 0, a11yScore: 0, a11yViolationsCount: 0 });
    });

    it('throws when the audit is missing or the backend is unreachable (REV-45)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'AUDIT_NOT_FOUND', message: 'Audit not found' } }, 404)));
      await expect(apiClient.getAudit('missing')).rejects.toThrow('Audit not found');

      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.getAudit('audit-1')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('getMvp', () => {
    it('returns the MVP project', async () => {
      const mvp = { leadId: 'lead-1', fullPreviewUrl: 'http://minio/v/smile/index.html' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: true, data: mvp })));
      await expect(apiClient.getMvp('lead-1')).resolves.toEqual(mvp);
    });

    it('returns null when the lead has no MVP yet (404)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'MVP_NOT_FOUND', message: 'MVP not found' } }, 404)));
      await expect(apiClient.getMvp('lead-1')).resolves.toBeNull();
    });

    it('throws on other failures', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'INTERNAL', message: 'boom' } }, 500)));
      await expect(apiClient.getMvp('lead-1')).rejects.toThrow('boom');

      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.getMvp('lead-1')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('outreach approve/reject status conflicts (REV-59)', () => {
    it('surfaces the server message when approve is refused for a lead not awaiting approval', async () => {
      const message = 'Only a lead awaiting approval can be approved; this lead is SENT.';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'LEAD_NOT_AWAITING_APPROVAL', message } }, 409)),
      );
      await expect(apiClient.approveOutreach('lead-1', draft)).rejects.toThrow(message);
    });

    it('surfaces the server message when reject is refused after outreach was approved', async () => {
      const message = 'A lead can only be rejected before its outreach is approved; this lead is SCHEDULED.';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'LEAD_NOT_REJECTABLE', message } }, 409)),
      );
      await expect(apiClient.rejectLead('lead-1', 'Too late')).rejects.toThrow(message);
    });
  });

  describe('Full-page screenshots (REV-21)', () => {
    const stubAuditResponse = (screenshotUrls: Record<string, string>) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonRes({ success: true, data: { _id: 'audit-full-1', leadId: 'lead-full-1', screenshotUrls } }),
        ),
      );

    it('should map full-page screenshot URLs from the audit API', async () => {
      stubAuditResponse({
        desktopOriginal: 'http://minio/screenshots/l1/desktop.webp',
        mobileOriginal: 'http://minio/screenshots/l1/mobile.webp',
        desktopFull: 'http://minio/screenshots/l1/desktop-full.webp',
        mobileFull: 'http://minio/screenshots/l1/mobile-full.webp',
      });

      const audit = await apiClient.getAudit('audit-full-1');

      expect(audit.desktopScreenshotUrl).toBe('http://minio/screenshots/l1/desktop.webp');
      expect(audit.desktopFullScreenshotUrl).toBe('http://minio/screenshots/l1/desktop-full.webp');
      expect(audit.mobileFullScreenshotUrl).toBe('http://minio/screenshots/l1/mobile-full.webp');
    });

    it('should leave full-page URLs undefined for legacy audits', async () => {
      stubAuditResponse({
        desktopOriginal: 'http://minio/screenshots/l2/desktop.webp',
        mobileOriginal: 'http://minio/screenshots/l2/mobile.webp',
      });

      const audit = await apiClient.getAudit('audit-full-2');

      expect(audit.desktopFullScreenshotUrl).toBeUndefined();
      expect(audit.mobileFullScreenshotUrl).toBeUndefined();
    });
  });

  describe('HITL Approval Gate & Outreach Actions (REV-16)', () => {
    it('should approve outreach through the API', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: { status: 'SCHEDULED' } }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiClient.approveOutreach('lead-1', {
        subject: 'Custom subject',
        preheader: 'Custom preheader',
        body: 'Custom approved email body',
      });

      expect(result).toEqual({ success: true, leadId: 'lead-1', status: 'SCHEDULED' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/outreach\/lead-1\/approve$/);
      expect(JSON.parse(init.body)).toEqual({
        approvedBy: 'operator',
        subject: 'Custom subject',
        preheader: 'Custom preheader',
        body: 'Custom approved email body',
      });
    });

    it('surfaces a refused approval instead of reporting success (REV-45)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonRes(
            {
              success: false,
              error: { code: 'NO_CONTACT_EMAIL', message: 'This lead has no contact email. Add one before approving outreach.' },
            },
            409,
          ),
        ),
      );
      await expect(apiClient.approveOutreach('lead-1', draft)).rejects.toThrow('This lead has no contact email');

      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.approveOutreach('lead-1', draft)).rejects.toThrow('Failed to fetch');
    });

    const testDraft = { subject: 'A new site', preheader: 'A prototype', body: 'Hello' };

    it('sends the draft to the operator and returns the delivery result (REV-60)', async () => {
      const data = { to: 'operator@revamp.io', messageId: 'msg-1', provider: 'smtp', sentAt: '2026-09-27T12:00:00.000Z' };
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiClient.sendTestEmail('lead-2', 'operator@revamp.io', testDraft);
      expect(result).toEqual(data);
      expect(fetchMock.mock.calls[0][0]).toContain('/outreach/lead-2/test');
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ testEmail: 'operator@revamp.io', ...testDraft });
    });

    it('throws an ApiError carrying the error code, status and details (REV-63)', async () => {
      const error = { code: 'LEAD_NOT_AWAITING_APPROVAL', message: 'Only a lead awaiting approval can be approved', details: { status: 'SENT' } };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error }, 409)));
      const thrown = await apiClient.approveOutreach('lead-1', draft).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(ApiError);
      expect(thrown).toMatchObject({ message: error.message, status: 409, code: error.code, details: error.details });
    });

    it('ignores legacy error fields and falls back to the HTTP status (REV-63)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonRes({ success: false, message: 'old', errors: [{ message: 'older' }] }, 502)),
      );
      const thrown = await apiClient.approveOutreach('lead-1', draft).catch((e: unknown) => e);
      expect(thrown).toMatchObject({ message: 'Server error (502)', status: 502, code: undefined });
    });

    it('surfaces a failed test email', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'LEAD_NOT_FOUND', message: 'Lead not found' } }, 404)));
      await expect(apiClient.sendTestEmail('missing', 'op@revamp.io', testDraft)).rejects.toThrow('Lead not found');
    });

    it('surfaces a missing email provider instead of reporting a send (REV-60)', async () => {
      const error = { code: 'EMAIL_PROVIDER_NOT_CONFIGURED', message: 'No email provider is configured' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error }, 503)));
      await expect(apiClient.sendTestEmail('lead-2', 'op@revamp.io', testDraft)).rejects.toThrow(
        'No email provider is configured',
      );
    });

    it('should reject a lead through the API', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: { status: 'REJECTED' } }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiClient.rejectLead('lead-2', 'Off-target niche');
      expect(result).toEqual({ success: true, leadId: 'lead-2', status: 'REJECTED' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reason: 'Off-target niche' });
    });

    it('surfaces a failed rejection', async () => {
      vi.stubGlobal('fetch', unreachable());
      await expect(apiClient.rejectLead('lead-2', 'x')).rejects.toThrow('Failed to fetch');
    });

    it('should save the MVP palette and return the saved MVP (REV-65)', async () => {
      const tokens = { primaryColor: '#7C3AED', secondaryColor: '#C4B5FD', accentColor: '#7C3AED' };
      const saved = { id: 'mvp-1', leadId: 'lead-1', fullPreviewUrl: 'https://x', colorPalette: { primary: '#7C3AED', secondary: '#C4B5FD', accent: '#7C3AED' } };
      const fetchMock = vi.fn().mockResolvedValue(jsonRes({ success: true, data: saved }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiClient.updateMvpTokens('mvp-1', tokens);
      expect(result.colorPalette?.primary).toBe('#7C3AED');
      expect(fetchMock.mock.calls[0][0]).toContain('/mvp/mvp-1/tokens');
      expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    });

    it('surfaces a failed token update', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid color' } }, 400)));
      await expect(apiClient.updateMvpTokens('mvp-1', { primaryColor: 'x' })).rejects.toThrow('Invalid color');
    });

    it('surfaces an unknown MVP id instead of reporting success (REV-65)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ success: false, error: { code: 'MVP_NOT_FOUND', message: 'MVP not found' } }, 404)));
      await expect(apiClient.updateMvpTokens('507f1f77bcf86cd799439011', { primaryColor: '#123456' })).rejects.toThrow('MVP not found');
    });
  });

  describe('discovery (REV-27)', () => {
    const jsonResponse = (body: unknown, status = 200) =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('startDiscovery should POST the validated, defaulted payload and return the job id', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ success: true, data: { jobId: 'disc-1', params: {} } }, 202),
      );
      vi.stubGlobal('fetch', fetchMock);

      const result = await apiClient.startDiscovery({ niche: 'dental', location: '  Vilnius ' });

      expect(result).toEqual({ jobId: 'disc-1' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/discovery$/);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 20 });
    });

    it('startDiscovery should reject invalid input without calling the API', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiClient.startDiscovery({ niche: 'other', location: 'Vilnius' })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('startDiscovery should surface the server validation message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          jsonResponse({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Location too short' } }, 400),
        ),
      );
      await expect(apiClient.startDiscovery({ niche: 'dental', location: 'Riga' })).rejects.toThrow('Location too short');
    });

    it('getDiscoveryStatus should return the job status and encode the id', async () => {
      const status = {
        jobId: 'a/b',
        state: 'completed',
        params: { provider: 'osm', niche: 'dental', location: 'Vilnius', limit: 3 },
        result: { found: 9, created: 3, skippedNoWebsite: 0, skippedDuplicate: 6, skippedInvalid: 0, leadIds: ['1', '2', '3'] },
        error: null,
        attemptsMade: 1,
        createdAt: '2026-09-26T14:58:31.234Z',
        finishedAt: '2026-09-26T14:58:32.955Z',
      };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: status }));
      vi.stubGlobal('fetch', fetchMock);

      expect(await apiClient.getDiscoveryStatus('a/b')).toEqual(status);
      expect(fetchMock.mock.calls[0][0]).toMatch(/\/discovery\/a%2Fb$/);
    });

    it('getDiscoveryStatus should surface 404 messages and fall back to the status code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'DISCOVERY_JOB_NOT_FOUND', message: 'Discovery job not found' } }, 404)),
      );
      await expect(apiClient.getDiscoveryStatus('missing')).rejects.toThrow('Discovery job not found');

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }),
      );
      await expect(apiClient.getDiscoveryStatus('x')).rejects.toThrow('Server error (502)');
    });

    it('reverseGeocode should pass coordinates and language and return the place (REV-28)', async () => {
      const place = { location: 'Warszawa, Polska', city: 'Warszawa', country: 'Polska' };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: place }));
      vi.stubGlobal('fetch', fetchMock);

      expect(await apiClient.reverseGeocode(52.2297, 21.0122, 'pl')).toEqual(place);
      const url = new URL(fetchMock.mock.calls[0][0]);
      expect(url.pathname).toMatch(/\/discovery\/reverse-geocode$/);
      expect(url.searchParams.get('lat')).toBe('52.2297');
      expect(url.searchParams.get('lng')).toBe('21.0122');
      expect(url.searchParams.get('lang')).toBe('pl');

      await apiClient.reverseGeocode(1, 2);
      expect(new URL(fetchMock.mock.calls[1][0]).searchParams.has('lang')).toBe(false);
    });

    it('reverseGeocode should surface a 404 message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'PLACE_NOT_FOUND', message: 'No place found at these coordinates' } }, 404)),
      );
      await expect(apiClient.reverseGeocode(0, -30)).rejects.toThrow('No place found at these coordinates');
    });

    it('importDiscoveryCandidates should POST the selection and return the outcome (REV-29)', async () => {
      const data = { imported: 1, results: [{ externalId: 'node/1', outcome: 'imported', leadId: 'l1' }] };
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data }));
      vi.stubGlobal('fetch', fetchMock);

      expect(await apiClient.importDiscoveryCandidates('disc 1', ['node/1'])).toEqual(data);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toMatch(/\/discovery\/disc%201\/import$/);
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ externalIds: ['node/1'] });
    });

    it('importDiscoveryCandidates should reject an empty selection locally and surface 409s', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(apiClient.importDiscoveryCandidates('d', [])).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'DISCOVERY_JOB_NOT_COMPLETED', message: 'Discovery job has not completed yet' } }, 409)),
      );
      await expect(apiClient.importDiscoveryCandidates('d', ['node/1'])).rejects.toThrow('has not completed yet');
    });

    it('getDiscoveryStatus should reject a 200 response without data', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));
      await expect(apiClient.getDiscoveryStatus('x')).rejects.toThrow('Malformed server response');
    });
  });

  describe('generateMvp / regenerate (REV-31)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const respond = (status: number, body: unknown) =>
      vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

    it('sends forceRegenerate: false for a first generation', async () => {
      const fetchMock = respond(202, { success: true, data: { status: 'GENERATING' } });
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiClient.generateMvp('audit-1')).resolves.toEqual({ success: true, status: 'GENERATING' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/mvp/generate');
      expect(JSON.parse(init.body)).toEqual({ auditId: 'audit-1', forceRegenerate: false });
    });

    it('sends forceRegenerate: true for a regeneration', async () => {
      const fetchMock = respond(202, { success: true, data: { status: 'GENERATING' } });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.generateMvp('audit-1', { forceRegenerate: true });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ auditId: 'audit-1', forceRegenerate: true });
    });

    it('sends the chosen provider and model (REV-32)', async () => {
      const fetchMock = respond(202, { success: true, data: { status: 'GENERATING' } });
      vi.stubGlobal('fetch', fetchMock);

      await apiClient.generateMvp('audit-1', { provider: 'claude-cli', model: 'opus' });
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        auditId: 'audit-1',
        forceRegenerate: false,
        provider: 'claude-cli',
        model: 'opus',
      });
    });

    it('refuses a model the provider does not offer before calling the API (REV-32)', async () => {
      const fetchMock = respond(202, { success: true, data: { status: 'GENERATING' } });
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiClient.generateMvp('audit-1', { provider: 'openai', model: 'opus' })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('loads the provider options (REV-32)', async () => {
      const data = { workersOnline: true, defaultProvider: 'claude-cli', defaultModel: 'sonnet', providers: [] };
      const fetchMock = respond(200, { success: true, data });
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiClient.getLlmProviders()).resolves.toEqual(data);
      expect(fetchMock.mock.calls[0][0]).toContain('/mvp/providers');
    });

    it('surfaces a failed provider request (REV-32)', async () => {
      vi.stubGlobal('fetch', respond(500, { success: false, error: { code: 'INTERNAL', message: 'boom' } }));
      await expect(apiClient.getLlmProviders()).rejects.toThrow('boom');
    });

    it('surfaces a 409 from the API instead of pretending the job started', async () => {
      vi.stubGlobal(
        'fetch',
        respond(409, { success: false, error: { code: 'MVP_GENERATION_NOT_ALLOWED', message: 'MVP generation is not allowed while the lead is SCHEDULED' } }),
      );

      await expect(apiClient.generateMvp('audit-1', { forceRegenerate: true })).rejects.toThrow(
        'MVP generation is not allowed while the lead is SCHEDULED',
      );
    });

    it('surfaces a 404 from the API', async () => {
      vi.stubGlobal('fetch', respond(404, { success: false, error: { code: 'AUDIT_NOT_FOUND', message: 'Audit not found' } }));
      await expect(apiClient.generateMvp('missing')).rejects.toThrow('Audit not found');
    });

    it('throws when the backend is unreachable instead of pretending the job started (REV-45)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(apiClient.generateMvp('audit-1')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('failed audits (REV-44)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const respond = (status: number, body: unknown) =>
      vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });

    it('maps the audit error of a failed lead', async () => {
      const auditError = 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ekomyj.com/';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              success: true,
              data: [
                {
                  _id: 'lead-failed',
                  businessName: 'Ekomyj',
                  originalUrl: 'https://ekomyj.com',
                  domain: 'ekomyj.com',
                  niche: 'other',
                  status: 'AUDIT_FAILED',
                  auditError,
                  createdAt: '2026-09-26T00:00:00.000Z',
                },
              ],
              pagination: { total: 1, page: 1, limit: LEADS_PAGE_SIZE, totalPages: 1 },
            }),
            { status: 200 },
          ),
        ),
      );

      const { leads } = await fetchAllLeadPages();
      expect(leads[0]).toMatchObject({ id: 'lead-failed', status: 'AUDIT_FAILED', auditError });
    });

    it('re-queues the audit through /audits/trigger', async () => {
      const fetchMock = respond(202, { success: true, data: { status: 'QUEUED' } });
      vi.stubGlobal('fetch', fetchMock);

      await expect(apiClient.retryAudit('lead-1')).resolves.toEqual({ success: true, status: 'QUEUED' });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/audits/trigger');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ leadId: 'lead-1', force: false });
    });

    it('surfaces an API error instead of pretending the audit was queued', async () => {
      vi.stubGlobal('fetch', respond(404, { success: false, error: { code: 'LEAD_NOT_FOUND', message: 'Lead not found' } }));
      await expect(apiClient.retryAudit('missing')).rejects.toThrow('Lead not found');
    });

    it('refuses an empty lead id before calling the API', async () => {
      const fetchMock = respond(202, { success: true });
      vi.stubGlobal('fetch', fetchMock);
      await expect(apiClient.retryAudit('')).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the backend is unreachable instead of pretending the audit was queued (REV-45)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(apiClient.retryAudit('lead-1')).rejects.toThrow('Failed to fetch');
    });
  });

  describe('loading every lead (REV-43)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const serverLead = (i: number) => ({
      _id: `lead-${i}`,
      businessName: `Business ${i}`,
      originalUrl: `https://www.site-${i}.com/`,
      domain: `site-${i}.com`,
      niche: 'other',
      status: 'QUEUED',
      createdAt: '2026-09-26T00:00:00.000Z',
    });

    const pageResponse = (page: number, total: number) => {
      const from = (page - 1) * LEADS_PAGE_SIZE;
      const count = Math.max(0, Math.min(LEADS_PAGE_SIZE, total - from));
      return new Response(
        JSON.stringify({
          success: true,
          data: Array.from({ length: count }, (_, i) => serverLead(from + i)),
          pagination: { total, page, limit: LEADS_PAGE_SIZE, totalPages: Math.ceil(total / LEADS_PAGE_SIZE) },
        }),
        { status: 200 },
      );
    };

    it('should walk every page with the maximum page size and return the real total', async () => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(pageResponse(Number(new URL(url).searchParams.get('page')), 241)),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { leads, total } = await fetchAllLeadPages();

      expect(total).toBe(241);
      expect(leads).toHaveLength(241);
      expect(new Set(leads.map((l) => l.id)).size).toBe(241);
      expect(leads[0]).toMatchObject({ id: 'lead-0', domain: 'site-0.com', businessName: 'Business 0' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const pages = fetchMock.mock.calls.map(([url]) => new URL(url).searchParams);
      expect(pages.map((p) => p.get('page'))).toEqual(['1', '2', '3']);
      expect(pages.every((p) => p.get('limit') === String(LEADS_PAGE_SIZE))).toBe(true);
    });

    it('should send search and filters to the server and skip ALL and blank values', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(pageResponse(1, 1)));
      vi.stubGlobal('fetch', fetchMock);

      await fetchAllLeadPages({ search: '  dental  ', status: 'NEEDS_APPROVAL', niche: 'dental', complexity: 'ONE_PAGE_BROCHURE' });
      const params = new URL(fetchMock.mock.calls[0][0]).searchParams;
      expect(params.get('search')).toBe('dental');
      expect(params.get('status')).toBe('NEEDS_APPROVAL');
      expect(params.get('niche')).toBe('dental');
      expect(params.get('complexity')).toBe('ONE_PAGE_BROCHURE');

      await fetchAllLeadPages({ search: '   ', status: 'ALL', niche: 'ALL', complexity: 'ALL' });
      const bare = new URL(fetchMock.mock.calls[1][0]).searchParams;
      expect([...bare.keys()].sort()).toEqual(['limit', 'page']);
    });

    it('should make a single request when the result is empty', async () => {
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(pageResponse(1, 0)));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchAllLeadPages()).resolves.toEqual({ leads: [], total: 0 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw when the server answers with an error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
      await expect(fetchAllLeadPages()).rejects.toThrow(/HTTP 500/);
    });

    it('should read the pipeline stats', async () => {
      const stats = { total: 41, byStatus: { NEEDS_APPROVAL: 5, SENT: 3, OPENED: 2, CLICKED: 1, QUEUED: 30 } };
      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: stats }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchLeadStats();

      expect(fetchMock.mock.calls[0][0]).toMatch(/\/leads\/stats$/);
      expect(result).toEqual(stats);
    });
  });
});
