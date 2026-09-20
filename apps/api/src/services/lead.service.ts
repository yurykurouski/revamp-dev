import { URL } from 'url';
import { CreateLeadDto } from '@revamp/validation';
import { Lead, ILeadDocument } from '../models/Lead.model.js';
import { Audit } from '../models/Audit.model.js';
import { addAuditJob } from '../queues/audit.queue.js';
import { AppError } from '../middlewares/errorHandler.js';

export interface GetLeadsQuery {
  page?: number;
  limit?: number;
  status?: string;
  niche?: string;
  search?: string;
}

export class LeadService {
  /**
   * Creates a new lead, creates initial audit record, and enqueues audit job
   */
  static async createLead(
    dto: CreateLeadDto,
  ): Promise<{ lead: ILeadDocument; auditId: string; jobId?: string }> {
    let domain: string;
    try {
      const parsedUrl = new URL(dto.originalUrl);
      domain = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      throw new AppError('Invalid original URL format', 400);
    }

    // 1. Create Lead in MongoDB with status QUEUED
    const lead = await Lead.create({
      businessName: dto.businessName,
      originalUrl: dto.originalUrl,
      domain,
      niche: dto.niche || 'other',
      city: dto.city,
      contactEmail: dto.contactEmail,
      contactPhone: dto.contactPhone,
      ownerName: dto.ownerName,
      status: 'QUEUED',
    });

    // 2. Create corresponding Audit record in MongoDB
    const audit = await Audit.create({
      leadId: lead._id,
      status: 'QUEUED',
    });

    // 3. Dispatch job to BullMQ audit-queue
    const job = await addAuditJob({
      leadId: lead._id.toString(),
      url: lead.originalUrl,
      niche: lead.niche,
    });

    return {
      lead,
      auditId: audit._id.toString(),
      jobId: job.id,
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

    if (query.search) {
      const searchRegex = new RegExp(query.search, 'i');
      filter['$or'] = [
        { businessName: searchRegex },
        { domain: searchRegex },
        { contactEmail: searchRegex },
        { city: searchRegex },
      ];
    }

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      Lead.countDocuments(filter).exec(),
    ]);

    return {
      leads,
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
      throw new AppError('Lead not found', 404);
    }

    const audit = await Audit.findOne({ leadId: lead._id }).sort({ createdAt: -1 }).exec();

    return {
      lead,
      audit,
    };
  }
}
