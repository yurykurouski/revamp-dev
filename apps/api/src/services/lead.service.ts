import { ILeadStats, LeadSource, SiteComplexityClass } from '@revamp/shared-types';
import {
  CreateLeadDto,
  LOT_CLAIMABLE_BY_STUDIO,
  MvpCompletenessReportDto,
  leadFieldsFromAudit,
  normalizeDomain,
  normalizePhone,
  summarizeCompletenessReport,
} from '@revamp/validation';
import { ILeadDocument, addLeadToBusiness } from '../models/Lead.model.js';
import { contactRightViews, latestContactRight, toContactRightView } from '../data/contact-rights.js';
import { scopeFor, tenantIdOf, type TenantScope } from '../data/tenant-scope.js';
import { ContactRightRefusedError, type DeriveFromAudit } from '@revamp/db';
import { env } from '../config/env.js';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { findAuditForLead } from '../models/Audit.model.js';
import { AUDIT_ENQUEUE_TIMEOUT_MS, enqueueAuditOrFail } from './audit-enqueue.js';
import { withTimeout } from './with-timeout.js';
import { AppError } from '../middlewares/errorHandler.js';

export interface GetLeadsQuery {
  page?: number;
  limit?: number;
  status?: string;
  niche?: string;
  search?: string;
  complexity?: SiteComplexityClass;
}

/** One-page brochure sites are the easiest to replace, so they lead the list; newest first within (REV-38) */
export const LEAD_LIST_SORT = { onePageBrochure: -1, createdAt: -1 } as const;

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * REV-225: the answer for a refused contact right. It says only why and until when, never which studio holds the
 * business. Shared by Add lead and the discovery import.
 */
export function contactRightRefusal(error: ContactRightRefusedError): AppError {
  const until = error.until?.toISOString();
  if (error.reason === 'held') {
    return new AppError(409, 'CONTACT_RIGHT_HELD', `Another studio holds the right to contact this business until ${until}.`, { expiresAt: until });
  }
  if (error.reason === 'cooldown') {
    return new AppError(409, 'BUSINESS_IN_COOLDOWN', `This business can be contacted again from ${until}.`, { availableAt: until });
  }
  return new AppError(409, 'BUSINESS_OPTED_OUT', 'This business asked not to be contacted.');
}

export class LeadService {
  /**
   * Counts every lead by status, regardless of list filters, for the dashboard KPI cards (REV-43)
   */
  static async getLeadStats(scope: TenantScope): Promise<ILeadStats> {
    const rows: Array<{ _id: string | null; count: number }> = await scope.leads.aggregate<{ _id: string | null; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec();

    const byStatus: ILeadStats['byStatus'] = {};
    let total = 0;
    for (const row of rows) {
      total += row.count;
      if (row._id) byStatus[row._id as keyof ILeadStats['byStatus']] = row.count;
    }
    return { total, byStatus };
  }

  /**
   * Adds a lead for a studio (REV-208). The site's shared business is found or created; when it already has a
   * completed audit the lead starts AUDITED with it and only the MVP generation is queued, otherwise the lead gets
   * its own QUEUED audit and the audit job is queued (REV-202).
   */
  static async createLead(
    dto: CreateLeadDto,
    options: { tags?: string[]; source?: LeadSource; externalId?: string; tenantId: string },
  ): Promise<{ lead: ILeadDocument; auditId: string; jobId?: string; reused?: boolean; contactRightExpiresAt?: Date }> {
    let domain: string | undefined;
    try {
      domain = normalizeDomain(new URL(dto.originalUrl).hostname);
    } catch {
      domain = undefined;
    }
    if (!domain) {
      throw new AppError(400, 'INVALID_URL', 'Invalid original URL format');
    }

    // 1. The business, the lead and its audit (or the shared audit), in one transaction: a failed insert leaves nothing
    let created;
    try {
      created = await addLeadToBusiness({
        tenantId: options.tenantId,
        deriveFromAudit: leadFieldsFromAudit as DeriveFromAudit,
        // REV-225: the studio claims the business's contact right in the same transaction, or the add is refused
        contactRight: { durations: { rightDays: env.CONTACT_RIGHT_DAYS, cooldownDays: env.CONTACT_COOLDOWN_DAYS }, source: 'ADD_LEAD' },
        // REV-232: the studio's own add wins over a draft or open lot of the business; the lot is withdrawn in the same
        // transaction and nothing about it reaches the response
        withdrawLots: { statuses: [...LOT_CLAIMABLE_BY_STUDIO] },
        lead: {
          businessName: dto.businessName,
          originalUrl: dto.originalUrl,
          domain,
          niche: dto.niche || 'other',
          city: dto.city,
          contactEmail: dto.contactEmail,
          contactPhone: dto.contactPhone,
          phoneE164: normalizePhone(dto.contactPhone),
          ownerName: dto.ownerName,
          status: 'QUEUED',
          source: options.source ?? 'manual',
          ...(options.externalId ? { externalId: options.externalId } : {}),
          ...(options.tags ? { tags: options.tags } : {}),
          // REV-162: the first MVP's design changes are written in the dashboard language the lead was added in
          ...(dto.operatorLocale ? { operatorLocale: dto.operatorLocale } : {}),
        },
      });
    } catch (error) {
      if (error instanceof ContactRightRefusedError) throw contactRightRefusal(error);
      if ((error as { code?: unknown } | null)?.code === 'LEAD_ALREADY_EXISTS') {
        throw new AppError(409, 'LEAD_ALREADY_EXISTS', 'Your studio already has a lead for this site', {
          leadId: (error as { leadId?: string }).leadId,
        });
      }
      throw error;
    }
    const { lead } = created;
    const contactRightExpiresAt = created.contactRight?.expiresAt;

    // 2a. The lead took another studio's completed audit: it is AUDITED, so queue the MVP generation as after an audit.
    // If that fails the lead stays AUDITED and the operator can press Generate MVP, so nothing is reverted
    if (created.reused) {
      const auditId = String(created.sourceAudit!._id);
      let jobId: string | undefined;
      try {
        // The Redis connection retries forever, so the call needs the same limit as the audit job (REV-202)
        jobId = (await withTimeout(addAiGenerationJob({ leadId: lead._id.toString(), tenantId: tenantIdOf(scopeFor(options.tenantId)), auditId }), AUDIT_ENQUEUE_TIMEOUT_MS, 'AI generation queue')).id;
      } catch (error) {
        console.error(`[LeadService] Could not queue the MVP generation for lead ${lead._id}:`, error);
      }
      return { lead, auditId, jobId, reused: true, ...(contactRightExpiresAt ? { contactRightExpiresAt } : {}) };
    }

    // 2b. Queue the audit; if that fails the lead becomes AUDIT_FAILED and a 503 is thrown (REV-202)
    const { jobId } = await enqueueAuditOrFail(scopeFor(options.tenantId), {
      leadId: lead._id.toString(),
      auditId: created.audit!._id.toString(),
      url: lead.originalUrl,
      niche: lead.niche,
    });

    return {
      lead,
      auditId: created.audit!._id.toString(),
      jobId,
      ...(contactRightExpiresAt ? { contactRightExpiresAt } : {}),
    };
  }

  /**
   * Retrieves a paginated list of leads with optional filtering
   */
  static async getLeads(scope: TenantScope, query: GetLeadsQuery) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter['status'] = query.status;
    }

    if (query.niche) {
      filter['niche'] = query.niche;
    }

    if (query.complexity) {
      // Leads audited before REV-38 have no class yet; they count as unknown
      filter['siteComplexity'] =
        query.complexity === 'UNKNOWN' ? { $in: [null, 'UNKNOWN'] } : query.complexity;
    }

    if (query.search) {
      // The operator types plain text; escape it so "(" or "+" cannot break the regex (REV-43)
      const searchRegex = new RegExp(escapeRegex(query.search), 'i');
      filter['$or'] = [
        { businessName: searchRegex },
        { domain: searchRegex },
        { contactEmail: searchRegex },
        { city: searchRegex },
      ];
    }

    const [leads, total] = await Promise.all([
      scope.leads.find(filter).sort(LEAD_LIST_SORT).skip(skip).limit(limit).exec(),
      scope.leads.countDocuments(filter).exec(),
    ]);

    let mvpMap = new Map<
      string,
      { fullPreviewUrl?: string; comparisonBannerUrl?: string; completenessReport?: MvpCompletenessReportDto }
    >();
    const leadIds = leads.map((l: any) => l._id || l.id).filter(Boolean);
    if (leadIds.length > 0) {
      const mvps = await scope.mvps.find({ leadId: { $in: leadIds } }).lean().exec();
      mvpMap = new Map(mvps.map((m: any) => [m.leadId?.toString(), m]));
    }

    // The studio's own right per business, one query for the page (REV-228)
    const now = new Date();
    const businessIds = [...new Set(leads.flatMap((l) => (l.businessId ? [l.businessId.toString()] : [])))];
    const rightViews = await contactRightViews(scope, businessIds, now);

    const enrichedLeads = leads.map((lead: any) => {
      const obj = typeof lead.toJSON === 'function' ? lead.toJSON() : { ...lead };
      obj.contactRight = (lead.businessId && rightViews.get(lead.businessId.toString())) || null;
      const leadIdStr = (lead._id || lead.id)?.toString();
      const mvp = mvpMap.get(leadIdStr);
      if (mvp) {
        if (!obj.previewUrl && mvp.fullPreviewUrl) {
          obj.previewUrl = mvp.fullPreviewUrl;
        }
        if (!obj.comparisonBannerUrl && mvp.comparisonBannerUrl) {
          obj.comparisonBannerUrl = mvp.comparisonBannerUrl;
        }
        // The Kanban card warns when the MVP lost or changed critical business data (REV-36)
        const completeness = summarizeCompletenessReport(mvp.completenessReport);
        if (completeness) {
          obj.completeness = completeness;
        }
      }
      return obj;
    });

    return {
      leads: enrichedLeads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves a single lead with its latest audit details
   */
  static async getLeadById(scope: TenantScope, id: string) {
    const lead = await scope.leads.findById(id).exec();
    if (!lead) {
      throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
    }

    // The lead's own newest audit, else the completed audit of its business (REV-208)
    const audit = await findAuditForLead(lead);

    const right = await latestContactRight(scope, lead.businessId);
    const obj = typeof lead.toJSON === 'function' ? lead.toJSON() : { ...lead };
    return {
      lead: { ...obj, contactRight: right ? toContactRightView(right) : null },
      audit,
    };
  }
}
