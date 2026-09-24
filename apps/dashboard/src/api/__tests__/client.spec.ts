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
      const result = await apiClient.rejectLead('lead-dental-002', 'Нецелевая ниша');
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
});
