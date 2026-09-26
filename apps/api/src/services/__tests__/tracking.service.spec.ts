import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrackingService } from '../tracking.service.js';
import { Lead } from '../../models/Lead.model.js';
import { EmailCampaign } from '../../models/EmailCampaign.model.js';
import { MvpProject } from '../../models/MvpProject.model.js';
import { AnalyticsEvent } from '../../models/AnalyticsEvent.model.js';

vi.mock('../../models/Lead.model.js');
vi.mock('../../models/EmailCampaign.model.js');
vi.mock('../../models/MvpProject.model.js');
vi.mock('../../models/AnalyticsEvent.model.js');

describe('TrackingService (REV-18 Telemetry & Tracking)', () => {
  let service: TrackingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TrackingService();
  });

  describe('hashClientIp', () => {
    it('should return empty string if IP is empty or undefined', () => {
      expect(service.hashClientIp('')).toBe('');
    });

    it('should return 32-character hex SHA-256 hash for valid IP', () => {
      const hash1 = service.hashClientIp('192.168.1.1');
      const hash2 = service.hashClientIp('192.168.1.1');
      const hash3 = service.hashClientIp('10.0.0.1');

      expect(hash1).toHaveLength(32);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('recordEmailOpen', () => {
    it('should increment openCount, set openedAt, transition Lead to OPENED, and create AnalyticsEvent', async () => {
      const mockLead = {
        _id: 'lead-001',
        status: 'SENT',
        save: vi.fn().mockResolvedValue(true),
      };

      const mockCampaign = {
        _id: 'camp-001',
        leadId: 'lead-001',
        trackingToken: 'tok-abc',
        metrics: {
          openCount: 0,
          clickCount: 0,
          demoVisitCount: 0,
          totalDwellTimeSeconds: 0,
        },
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCampaign),
      } as any);

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-1' } as any);

      const res = await service.recordEmailOpen('tok-abc', {
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0 ThunderBird',
      });

      expect(res.success).toBe(true);
      expect(mockCampaign.metrics.openCount).toBe(1);
      expect(mockCampaign.metrics.openedAt).toBeDefined();
      expect(mockCampaign.save).toHaveBeenCalled();
      expect(mockLead.status).toBe('OPENED');
      expect(mockLead.save).toHaveBeenCalled();
      expect(AnalyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trackingToken: 'tok-abc',
          eventType: 'open',
          leadId: 'lead-001',
          userAgent: 'Mozilla/5.0 ThunderBird',
        }),
      );
    });

    it('should still record AnalyticsEvent if campaign is not found', async () => {
      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-2' } as any);

      const res = await service.recordEmailOpen('unknown-tok');
      expect(res.success).toBe(true);
      expect(AnalyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trackingToken: 'unknown-tok',
          eventType: 'open',
        }),
      );
    });
  });

  describe('recordClick', () => {
    it('should increment clickCount, transition Lead to CLICKED, resolve previewUrl from MvpProject, and redirect', async () => {
      const mockLead = {
        _id: 'lead-002',
        status: 'OPENED',
        save: vi.fn().mockResolvedValue(true),
      };

      const mockCampaign = {
        _id: 'camp-002',
        leadId: 'lead-002',
        mvpProjectId: 'mvp-002',
        trackingToken: 'tok-click',
        metrics: {
          openCount: 1,
          clickCount: 0,
          demoVisitCount: 0,
          totalDwellTimeSeconds: 0,
        },
        save: vi.fn().mockResolvedValue(true),
      };

      const mockMvpProject = {
        _id: 'mvp-002',
        fullPreviewUrl: 'http://localhost:9000/revamp-demos/v/dental-preview/index.html',
      };

      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCampaign),
      } as any);

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.spyOn(MvpProject, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockMvpProject),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-3' } as any);

      const res = await service.recordClick('tok-click', {
        ip: '10.0.0.5',
        userAgent: 'Mobile Safari',
      });

      expect(res.success).toBe(true);
      expect(mockCampaign.metrics.clickCount).toBe(1);
      expect(mockLead.status).toBe('CLICKED');
      expect(res.redirectUrl).toBe(
        'http://localhost:9000/revamp-demos/v/dental-preview/index.html?token=tok-click',
      );
      expect(AnalyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          trackingToken: 'tok-click',
          eventType: 'click',
          leadId: 'lead-002',
        }),
      );
    });
  });

  describe('recordMvpEvent', () => {
    it('should transition Lead to ENGAGED when dwellTimeSeconds >= 30', async () => {
      const mockLead = {
        _id: 'lead-003',
        status: 'CLICKED',
        tags: [],
        save: vi.fn().mockResolvedValue(true),
      };

      const mockCampaign = {
        _id: 'camp-003',
        leadId: 'lead-003',
        metrics: {
          openCount: 1,
          clickCount: 1,
          demoVisitCount: 1,
          totalDwellTimeSeconds: 15,
        },
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCampaign),
      } as any);

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-4' } as any);

      const res = await service.recordMvpEvent({
        token: 'tok-engaged',
        eventType: 'dwell_time',
        dwellTimeSeconds: 35,
        scrollDepthPercent: 85,
      });

      expect(res.success).toBe(true);
      expect(res.engaged).toBe(true);
      expect(mockCampaign.metrics.totalDwellTimeSeconds).toBe(35);
      expect(mockLead.status).toBe('ENGAGED');
      expect(mockLead.tags).toContain('engaged_visitor');
      expect(mockLead.save).toHaveBeenCalled();
    });

    it('should transition Lead to ENGAGED when eventType is cta_click or booking_intent', async () => {
      const mockLead = {
        _id: 'lead-004',
        status: 'OPENED',
        tags: [],
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: 'camp-004',
          leadId: 'lead-004',
          metrics: { demoVisitCount: 1 },
          save: vi.fn().mockResolvedValue(true),
        }),
      } as any);

      vi.spyOn(Lead, 'findById').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockLead),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-5' } as any);

      const res = await service.recordMvpEvent({
        token: 'tok-cta',
        eventType: 'cta_click',
        metadata: { button: 'Book an appointment' },
      });

      expect(res.success).toBe(true);
      expect(res.engaged).toBe(true);
      expect(mockLead.status).toBe('ENGAGED');
    });

    it('should increment demoVisitCount on pageview event', async () => {
      const mockCampaign = {
        _id: 'camp-005',
        metrics: { demoVisitCount: 2 },
        save: vi.fn().mockResolvedValue(true),
      };

      vi.spyOn(EmailCampaign, 'findOne').mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCampaign),
      } as any);

      vi.spyOn(AnalyticsEvent, 'create').mockResolvedValue({ _id: 'event-6' } as any);

      const res = await service.recordMvpEvent({
        token: 'tok-pv',
        eventType: 'pageview',
      });

      expect(res.success).toBe(true);
      expect(mockCampaign.metrics.demoVisitCount).toBe(3);
    });
  });
});
