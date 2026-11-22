import { ILeadStats, LeadSource, SiteComplexityClass } from '@revamp/shared-types';
import {
  CreateLeadDto,
  MvpCompletenessReportDto,
  leadFieldsFromAudit,
  normalizeDomain,
  normalizePhone,
  summarizeCompletenessReport,
} from '@revamp/validation';
import { Lead, ILeadDocument, addLeadToBusiness } from '../models/Lead.model.js';
import type { DeriveFromAudit } from '@revamp/db';
import { addAiGenerationJob } from '../queues/ai.queue.js';
import { findAuditForLead } from '../models/Audit.model.js';
import { MvpProject } from '../models/MvpProject.model.js';
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

export class LeadService {
  /**
   * Counts every lead by status, regardless of list filters, for the dashboard KPI cards (REV-43)
   */
  static async getLeadStats(): Promise<ILeadStats> {
    const rows: Array<{ _id: string | null; count: number }> = await Lead.aggregate([
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
    options: { tags?: string[]; source?: LeadSource; externalId?: string; tenantId?: string } = {},
  ): Promise<{ lead: ILeadDocument; auditId: string; jobId?: string; reused?: boolean }> {
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
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
        deriveFromAudit: leadFieldsFromAudit as DeriveFromAudit,
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
      if ((error as { code?: unknown } | null)?.code === 'LEAD_ALREADY_EXISTS') {
        throw new AppError(409, 'LEAD_ALREADY_EXISTS', 'Your studio already has a lead for this site', {
          leadId: (error as { leadId?: string }).leadId,
        });
      }
      throw error;
    }
    const { lead } = created;

    // 2a. The lead took another studio's completed audit: it is AUDITED, so queue the MVP generation as after an audit.
    // If that fails the lead stays AUDITED and the operator can press Generate MVP, so nothing is reverted
    if (created.reused) {
      const auditId = String(created.sourceAudit!._id);
      let jobId: string | undefined;
      try {
        // The Redis connection retries forever, so the call needs the same limit as the audit job (REV-202)
        jobId = (await withTimeout(addAiGenerationJob({ leadId: lead._id.toString(), auditId }), AUDIT_ENQUEUE_TIMEOUT_MS, 'AI generation queue')).id;
      } catch (error) {
        console.error(`[LeadService] Could not queue the MVP generation for lead ${lead._id}:`, error);
      }
      return { lead, auditId, jobId, reused: true };
    }

    // 2b. Queue the audit; if that fails the lead becomes AUDIT_FAILED and a 503 is thrown (REV-202)
    const { jobId } = await enqueueAuditOrFail({
      leadId: lead._id.toString(),
      auditId: created.audit!._id.toString(),
      url: lead.originalUrl,
      niche: lead.niche,
    });

    return {
      lead,
      auditId: created.audit!._id.toString(),
      jobId,
    };
  }

  /**
   * Retrieves a paginated list of leads with optional filtering
   */
  static async getLeads(query: GetLeadsQuery) {
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
      Lead.find(filter).sort(LEAD_LIST_SORT).skip(skip).limit(limit).exec(),
      Lead.countDocuments(filter).exec(),
    ]);

    let mvpMap = new Map<
      string,
      { fullPreviewUrl?: string; comparisonBannerUrl?: string; completenessReport?: MvpCompletenessReportDto }
    >();
    const leadIds = leads.map((l: any) => l._id || l.id).filter(Boolean);
    if (leadIds.length > 0) {
      const mvps = await MvpProject.find({ leadId: { $in: leadIds } }).lean().exec();
      mvpMap = new Map(mvps.map((m: any) => [m.leadId?.toString(), m]));
    }

    const enrichedLeads = leads.map((lead: any) => {
      const obj = typeof lead.toJSON === 'function' ? lead.toJSON() : { ...lead };
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
  static async getLeadById(id: string) {
    const lead = await Lead.findById(id).exec();
    if (!lead) {
      throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found');
    }

    // The lead's own newest audit, else the completed audit of its business (REV-208)
    const audit = await findAuditForLead(lead);

    return {
      lead,
      audit,
    };
  }
}
