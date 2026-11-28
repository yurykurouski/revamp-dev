import crypto from 'crypto';
import { isValidObjectId } from 'mongoose';
import { recordBusinessOptOut } from '@revamp/db';
import { LOT_LIVE_STATUSES, MvpTrackEventDto, canTransition, leadStatusesInto } from '@revamp/validation';
import { bySecret, scopeFor, type TenantScope } from '../data/tenant-scope.js';

export interface IRequestMetadata {
  ip?: string;
  userAgent?: string;
  referer?: string;
}

/**
 * The studio a public request belongs to is the one of the campaign (or MVP) its secret names, never one the request
 * states (REV-209). Records made before the migration have none and form the legacy bucket.
 */
const scopeOf = (record: { tenantId?: unknown } | null | undefined): TenantScope =>
  scopeFor(record?.tenantId as Parameters<typeof scopeFor>[0]);

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
    const campaign = await bySecret.campaignByToken(token).exec();
    const scope = scopeOf(campaign);
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
        const lead = await scope.leads.findById(campaign.leadId).exec();
        if (lead && canTransition(lead.status, 'OPENED')) {
          lead.status = 'OPENED';
          await lead.save();
        }
      }
    }

    // Persist immutable AnalyticsEvent
    await scope.events.create({
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
    const campaign = await bySecret.campaignByToken(token).exec();
    const scope = scopeOf(campaign);
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
        const lead = await scope.leads.findById(campaign.leadId).exec();
        if (lead && canTransition(lead.status, 'CLICKED')) {
          lead.status = 'CLICKED';
          await lead.save();
        }
      }

      // Resolve destination preview URL from MvpProject
      if (campaign.mvpProjectId) {
        const project = await scope.mvps.findById(campaign.mvpProjectId).exec();
        if (project?.fullPreviewUrl) {
          redirectUrl = project.fullPreviewUrl;
        }
      } else if (campaign.leadId) {
        const project = await scope.mvps.findOne({ leadId: campaign.leadId }).exec();
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
    await scope.events.create({
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
   * Looks up the campaign behind an unsubscribe link without changing anything, so the
   * GET confirmation page is safe for link scanners that prefetch email URLs (REV-73)
   */
  public async findUnsubscribeCampaign(
    token: string,
  ): Promise<{ found: boolean; unsubscribed: boolean }> {
    const campaign = await bySecret.campaignByToken(token).exec();
    return { found: Boolean(campaign), unsubscribed: campaign?.status === 'UNSUBSCRIBED' };
  }

  /**
   * Records an opt-out: POST /track/unsubscribe/:token (RFC 8058 one-click or the confirmation form).
   * Moves the lead and its campaign to UNSUBSCRIBED; repeat calls change nothing (REV-73)
   */
  public async recordUnsubscribe(
    token: string,
    meta: IRequestMetadata = {},
  ): Promise<{ found: boolean; alreadyUnsubscribed: boolean; leadId?: string }> {
    const now = new Date();
    // The token names the campaign and so the studio; the opt-out touches that studio's records only (REV-209)
    const named = await bySecret.campaignByToken(token).exec();
    if (!named) return { found: false, alreadyUnsubscribed: false };
    const scope = scopeOf(named);
    // The status filter makes the first opt-out win, so a repeat call records nothing new
    const campaign = await scope.campaigns
      .findOneAndUpdate(
        { trackingToken: token, status: { $ne: 'UNSUBSCRIBED' } },
        { $set: { status: 'UNSUBSCRIBED', unsubscribedAt: now } },
        { new: true },
      )
      .exec();

    if (!campaign) {
      const existing = named;
      // Make sure the lead is opted out too, in case the first call failed before updating it
      await scope.leads.findOneAndUpdate(
        { _id: existing.leadId, status: { $in: leadStatusesInto('UNSUBSCRIBED') } },
        { $set: { status: 'UNSUBSCRIBED' } },
      ).exec();
      // A first call may have stopped before the business write: the repeat completes it (idempotent, REV-227)
      await this.optBusinessOut(scope, existing);
      return { found: true, alreadyUnsubscribed: true, leadId: existing.leadId?.toString() };
    }

    // An opt-out applies whatever stage the lead reached; approve and dispatch refuse it from now on
    await scope.leads.findOneAndUpdate(
      { _id: campaign.leadId, status: { $in: leadStatusesInto('UNSUBSCRIBED') } },
      { $set: { status: 'UNSUBSCRIBED' }, $addToSet: { tags: 'unsubscribed' } },
    ).exec();

    await this.optBusinessOut(scope, campaign);

    await scope.events.create({
      leadId: campaign.leadId,
      campaignId: campaign._id,
      mvpProjectId: campaign.mvpProjectId,
      trackingToken: token,
      eventType: 'unsubscribe',
      ipHash: this.hashClientIp(meta.ip || ''),
      userAgent: meta.userAgent,
      metadata: meta.referer ? { referer: meta.referer } : {},
      timestamp: now,
    });

    return { found: true, alreadyUnsubscribed: false, leadId: campaign.leadId?.toString() };
  }

  /**
   * REV-227: an opt-out blocks the business for every studio and suppresses the recipient's address. The one
   * cross-studio write lives in `@revamp/db`; the state machine's own list says which statuses may move. Logs name ids
   * only, never an address.
   */
  private async optBusinessOut(
    scope: TenantScope,
    campaign: { leadId?: unknown; recipientEmail?: string },
  ): Promise<void> {
    const lead = await scope.leads.findById(campaign.leadId as never).exec();
    const outcome = await recordBusinessOptOut({
      businessId: lead?.businessId as never,
      recipientEmail: campaign.recipientEmail,
      unsubscribableStatuses: leadStatusesInto('UNSUBSCRIBED'),
      // REV-232: an opted-out business is not offered as a lot
      withdrawLotStatuses: [...LOT_LIVE_STATUSES],
    });
    if (outcome.leadsUnsubscribed > 0 || outcome.campaignsClosed > 0 || outcome.newlyOptedOut) {
      console.info(
        `[tracking] Opt-out of business ${String(lead?.businessId)} from lead ${String(campaign.leadId)}: ` +
          `${outcome.leadsUnsubscribed} lead(s) and ${outcome.campaignsClosed} campaign(s) closed, right ended: ${outcome.rightEnded}`,
      );
    }
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

    const campaign = token ? await bySecret.campaignByToken(token).exec() : null;
    // Without a campaign the event may still carry an MVP id; either names the studio. A lead id in the request is
    // never trusted: the lead is the campaign's or the MVP's own (REV-209)
    const project = campaign || !eventData.mvpProjectId || !isValidObjectId(eventData.mvpProjectId) ? null : await bySecret.mvpById(eventData.mvpProjectId).exec();
    const scope = scopeOf(campaign ?? project);

    const leadId = campaign?.leadId?.toString() ?? project?.leadId?.toString();
    const mvpProjectId = campaign?.mvpProjectId?.toString() ?? project?._id?.toString();

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
      const lead = await scope.leads.findById(leadId).exec();
      if (lead && canTransition(lead.status, 'ENGAGED')) {
        lead.status = 'ENGAGED';
        if (!lead.tags.includes('engaged_visitor')) {
          lead.tags.push('engaged_visitor');
        }
        await lead.save();
        leadTransitionedToEngaged = true;
      }
    }

    // Persist immutable AnalyticsEvent
    await scope.events.create({
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
