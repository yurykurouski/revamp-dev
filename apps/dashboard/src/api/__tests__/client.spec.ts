import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from '../client.js';

describe('Dashboard apiClient', () => {
  it('should fetch leads and compute accurate KPI counters', async () => {
    const { leads, kpi } = await apiClient.getLeads();

    expect(leads.length).toBeGreaterThan(0);
    expect(kpi.totalLeads).toBeGreaterThanOrEqual(leads.length);
    expect(kpi.needsApproval).toBeGreaterThan(0);

    // Listonosz target should be present in mock/cache
    const listonosz = leads.find((l) => l.domain === 'listonosz.site');
    expect(listonosz).toBeDefined();
    expect(listonosz?.status).toBe('NEEDS_APPROVAL');
    expect(listonosz?.previewUrl).toContain('listonosz-courier-mvp');
  });

  it('should filter leads by search term', async () => {
    const { leads } = await apiClient.getLeads({ search: 'Denta' });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.businessName.includes('Denta') || l.domain.includes('Denta'))).toBe(true);
  });

  it('should filter leads by status', async () => {
    const { leads } = await apiClient.getLeads({ status: 'NEEDS_APPROVAL' });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.status === 'NEEDS_APPROVAL')).toBe(true);
  });

  it('should filter leads by niche', async () => {
    const { leads } = await apiClient.getLeads({ niche: 'dental' });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.niche === 'dental')).toBe(true);
  });

  it('should create new lead with valid URL and niche', async () => {
    const newLead = await apiClient.createLead({
      url: 'https://new-test-clinic.com',
      niche: 'dental',
    });

    expect(newLead.id).toBeDefined();
    expect(newLead.domain).toBe('new-test-clinic.com');
    expect(newLead.status).toBe('QUEUED');
    expect(newLead.niche).toBe('dental');

    // Verify it is now present in leads query
    const { leads } = await apiClient.getLeads({ search: 'new-test-clinic' });
    expect(leads.length).toBeGreaterThan(0);
  });

  it('should create new lead with valid URL, niche, and contactEmail', async () => {
    const newLead = await apiClient.createLead({
      url: 'https://premier-dental.org',
      niche: 'dental',
      businessName: 'Premier Dental Care',
      contactEmail: 'contact@premier-dental.org',
    });

    expect(newLead.id).toBeDefined();
    expect(newLead.domain).toBe('premier-dental.org');
    expect(newLead.businessName).toBe('Premier Dental Care');
    expect(newLead.status).toBe('QUEUED');
  });

  it('should throw validation error when creating lead with invalid URL', async () => {
    await expect(
      apiClient.createLead({
        url: 'not-a-valid-url',
        niche: 'other',
      }),
    ).rejects.toThrow();
  });

  it('should fetch audit diagnostics and critique details', async () => {
    const audit = await apiClient.getAudit('audit-listonosz-001');

    expect(audit).toBeDefined();
    expect(audit.id).toBe('audit-listonosz-001');
    expect(audit.lcpSeconds).toBe(3.4);
    expect(audit.a11yViolationsCount).toBe(14);
    expect(audit.criticalFlaws.length).toBe(3);
    expect(audit.quickWins.length).toBe(3);
    expect(audit.desktopScreenshotUrl).toBeDefined();
    expect(audit.mobileScreenshotUrl).toBeDefined();
    expect(audit.colorPalette.primary).toBe('#5c5bed');
  });

  describe('Full-page screenshots (REV-21)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const stubAuditResponse = (screenshotUrls: Record<string, string>) =>
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: { _id: 'audit-full-1', leadId: 'lead-full-1', screenshotUrls },
          }),
        }),
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
    it('should approve outreach and transition lead status to SCHEDULED', async () => {
      const result = await apiClient.approveOutreach('lead-listonosz-001', {
        subject: 'Custom subject for Listonosz',
        preheader: 'Custom preheader',
        body: 'Custom approved email body',
      });

      expect(result.success).toBe(true);
      expect(result.leadId).toBe('lead-listonosz-001');
      expect(result.status).toBe('SCHEDULED');

      // Verify status in leads list
      const { leads } = await apiClient.getLeads();
      const updated = leads.find((l) => l.id === 'lead-listonosz-001');
      expect(updated?.status).toBe('SCHEDULED');
    });

    it('should send test email to operator', async () => {
      const result = await apiClient.sendTestEmail('lead-dental-002', 'operator@revamp.io');
      expect(result.success).toBe(true);
      expect(result.message).toContain('operator@revamp.io');
    });

    it('should reject lead and transition status to REJECTED', async () => {
      const result = await apiClient.rejectLead('lead-dental-002', 'Off-target niche');
      expect(result.success).toBe(true);
      expect(result.leadId).toBe('lead-dental-002');
      expect(result.status).toBe('REJECTED');

      // Verify status in leads list
      const { leads } = await apiClient.getLeads();
      const updated = leads.find((l) => l.id === 'lead-dental-002');
      expect(updated?.status).toBe('REJECTED');
    });

    it('should update MVP brand design tokens', async () => {
      const tokens = {
        primaryColor: '#7C3AED',
        secondaryColor: '#C4B5FD',
        accentColor: '#7C3AED',
      };
      const result = await apiClient.updateMvpTokens('lead-listonosz-001', tokens);
      expect(result.success).toBe(true);
      expect(result.data.primaryColor).toBe('#7C3AED');
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
          jsonResponse({ success: false, message: 'Validation Error', errors: [{ message: 'Location too short' }] }, 400),
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
        vi.fn().mockResolvedValue(jsonResponse({ success: false, message: 'Discovery job not found' }, 404)),
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
        vi.fn().mockResolvedValue(jsonResponse({ success: false, message: 'No place found at these coordinates' }, 404)),
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
        vi.fn().mockResolvedValue(jsonResponse({ success: false, message: 'Discovery job has not completed yet' }, 409)),
      );
      await expect(apiClient.importDiscoveryCandidates('d', ['node/1'])).rejects.toThrow('has not completed yet');
    });

    it('getDiscoveryStatus should reject a 200 response without data', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));
      await expect(apiClient.getDiscoveryStatus('x')).rejects.toThrow('Malformed server response');
    });
  });
});
