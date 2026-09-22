import crypto from 'crypto';
import { MvpTrackEventDto } from '@revamp/validation';
import { Lead } from '../models/Lead.model.js';
import { EmailCampaign } from '../models/EmailCampaign.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
import { AnalyticsEvent } from '../models/AnalyticsEvent.model.js';

export interface IRequestMetadata {
  ip?: string;
  userAgent?: string;
  referer?: string;
}

export class TrackingService {
  /**
   * Hashes client IP using SHA-256 for GDPR-compliant privacy
   */
  public hashClientIp(ip: string): string {
    if (!ip) return '';
    const salt = process.env['IP_SALT'] || 'revamp_telemetry_salt';
    return crypto.createHash('sha256').update(`${ip}_${salt}`).digest('hex').slice(0, 32);
  }

  /**
   * Records an email open from tracking pixel: GET /track/open/:token.gif
   * Transitions Lead status to OPENED
   */
  public async recordEmailOpen(
    token: string,
    meta: IRequestMetadata = {},
  ): Promise<{ success: boolean; leadId?: string; campaignId?: string }> {
    const campaign = await EmailCampaign.findOne({ trackingToken: token }).exec();
    const now = new Date();
    const ipHash = this.hashClientIp(meta.ip || '');

    if (campaign) {
      if (!campaign.metrics) {
        campaign.metrics = {
          openCount: 0,
          clickCount: 0,
          demoVisitCount: 0,
          totalDwellTimeSeconds: 0,
        };
      }
      campaign.metrics.openCount = (campaign.metrics.openCount || 0) + 1;
      if (!campaign.metrics.openedAt) {
        campaign.metrics.openedAt = now;
      }
      await campaign.save();

      if (campaign.leadId) {
        const lead = await Lead.findById(campaign.leadId).exec();
        if (lead && ['SENT', 'DISPATCHED', 'SCHEDULED', 'QUEUED'].includes(lead.status)) {
          lead.status = 'OPENED';
          await lead.save();
        }
      }
    }

    // Persist immutable AnalyticsEvent
    await AnalyticsEvent.create({
      leadId: campaign?.leadId,
      campaignId: campaign?._id,
      mvpProjectId: campaign?.mvpProjectId,
      trackingToken: token,
      eventType: 'open',
      ipHash,
      userAgent: meta.userAgent,
      metadata: meta.referer ? { referer: meta.referer } : {},
      timestamp: now,
    });

    return {
      success: true,
      leadId: campaign?.leadId?.toString(),
      campaignId: campaign?._id?.toString(),
    };
  }

  /**
   * Records click proxy: GET /track/click/:token
   * Transitions Lead status to CLICKED and returns destination URL
   */
  public async recordClick(
    token: string,
    meta: IRequestMetadata = {},
  ): Promise<{ success: boolean; redirectUrl: string; leadId?: string }> {
    const campaign = await EmailCampaign.findOne({ trackingToken: token }).exec();
    const now = new Date();
    const ipHash = this.hashClientIp(meta.ip || '');

    let redirectUrl = `https://preview.revampdemo.com/v/${token}`;

    if (campaign) {
      if (!campaign.metrics) {
        campaign.metrics = {
          openCount: 0,
          clickCount: 0,
          demoVisitCount: 0,
          totalDwellTimeSeconds: 0,
        };
      }
      campaign.metrics.clickCount = (campaign.metrics.clickCount || 0) + 1;
      if (!campaign.metrics.clickedAt) {
        campaign.metrics.clickedAt = now;
      }
      await campaign.save();

      if (campaign.leadId) {
        const lead = await Lead.findById(campaign.leadId).exec();
        if (
          lead &&
          ['SENT', 'DISPATCHED', 'SCHEDULED', 'QUEUED', 'OPENED'].includes(lead.status)
        ) {
          lead.status = 'CLICKED';
          await lead.save();
        }
      }

      // Resolve destination preview URL from MvpProject
      if (campaign.mvpProjectId) {
        const project = await MvpProject.findById(campaign.mvpProjectId).exec();
        if (project?.fullPreviewUrl) {
          redirectUrl = project.fullPreviewUrl;
        }
      } else if (campaign.leadId) {
        const project = await MvpProject.findOne({ leadId: campaign.leadId }).exec();
        if (project?.fullPreviewUrl) {
          redirectUrl = project.fullPreviewUrl;
        }
      }
    }

    // Append token query param if not already present
    if (!redirectUrl.includes('token=')) {
      const sep = redirectUrl.includes('?') ? '&' : '?';
      redirectUrl = `${redirectUrl}${sep}token=${encodeURIComponent(token)}`;
    }

    // Persist immutable AnalyticsEvent
    await AnalyticsEvent.create({
      leadId: campaign?.leadId,
      campaignId: campaign?._id,
      mvpProjectId: campaign?.mvpProjectId,
      trackingToken: token,
      eventType: 'click',
      ipHash,
      userAgent: meta.userAgent,
      metadata: {
        destinationUrl: redirectUrl,
        referer: meta.referer,
      },
      timestamp: now,
    });

    return {
      success: true,
      redirectUrl,
      leadId: campaign?.leadId?.toString(),
    };
  }

  /**
   * Records telemetry event from client revamp-tracker.js: POST /track/mvp-event
   * Dispatches dwell_time, cta_click, booking_intent, pageview, scroll_depth
   * Automatically transitions Lead to ENGAGED when dwellTimeSeconds >= 30 or on CTA/booking interaction
   */
  public async recordMvpEvent(
    eventData: MvpTrackEventDto,
    meta: IRequestMetadata = {},
  ): Promise<{ success: boolean; engaged?: boolean }> {
    const token = eventData.token || eventData.trackingToken;
    const ipHash = this.hashClientIp(meta.ip || '');
    const now = new Date();

    const campaign = token ? await EmailCampaign.findOne({ trackingToken: token }).exec() : null;

    let leadId = eventData.leadId || campaign?.leadId?.toString();
    let mvpProjectId = eventData.mvpProjectId || campaign?.mvpProjectId?.toString();

    // If leadId is still not resolved but mvpProjectId exists, resolve from MvpProject
    if (!leadId && mvpProjectId) {
      const project = await MvpProject.findById(mvpProjectId).exec();
      if (project?.leadId) {
        leadId = project.leadId.toString();
      }
    }

    // Update campaign metrics if campaign exists
    if (campaign) {
      if (!campaign.metrics) {
        campaign.metrics = {
          openCount: 0,
          clickCount: 0,
          demoVisitCount: 0,
          totalDwellTimeSeconds: 0,
        };
      }

      if (eventData.eventType === 'pageview') {
        campaign.metrics.demoVisitCount = (campaign.metrics.demoVisitCount || 0) + 1;
      }

      if (eventData.dwellTimeSeconds !== undefined) {
        campaign.metrics.totalDwellTimeSeconds = Math.max(
          campaign.metrics.totalDwellTimeSeconds || 0,
          eventData.dwellTimeSeconds,
        );
      }

      await campaign.save();
    }

    // Engagement Gate: >= 30 seconds dwell time OR interaction with CTA/booking
    const isEngagedTrigger =
      (eventData.dwellTimeSeconds !== undefined && eventData.dwellTimeSeconds >= 30) ||
      eventData.eventType === 'cta_click' ||
      eventData.eventType === 'booking_intent';

    let leadTransitionedToEngaged = false;

    if (isEngagedTrigger && leadId) {
      const lead = await Lead.findById(leadId).exec();
      if (
        lead &&
        ['SENT', 'DISPATCHED', 'SCHEDULED', 'QUEUED', 'OPENED', 'CLICKED'].includes(lead.status)
      ) {
        lead.status = 'ENGAGED';
        if (!lead.tags.includes('engaged_visitor')) {
          lead.tags.push('engaged_visitor');
        }
        await lead.save();
        leadTransitionedToEngaged = true;
      }
    }

    // Persist immutable AnalyticsEvent
    await AnalyticsEvent.create({
      leadId,
      campaignId: campaign?._id,
      mvpProjectId,
      trackingToken: token,
      eventType: eventData.eventType,
      dwellTimeSeconds: eventData.dwellTimeSeconds || 0,
      scrollDepthPercent: eventData.scrollDepthPercent,
      ipHash,
      userAgent: meta.userAgent,
      metadata: {
        ...eventData.metadata,
        referer: meta.referer,
      },
      timestamp: now,
    });

    return {
      success: true,
      engaged: leadTransitionedToEngaged,
    };
  }
}

export const trackingService = new TrackingService();
