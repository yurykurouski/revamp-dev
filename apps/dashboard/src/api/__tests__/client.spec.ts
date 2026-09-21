import { describe, it, expect } from 'vitest';
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
    const { leads } = await apiClient.getLeads({ search: 'Дента' });
    expect(leads.length).toBeGreaterThan(0);
    expect(leads.every((l) => l.businessName.includes('Дента') || l.domain.includes('Дента'))).toBe(true);
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
});
