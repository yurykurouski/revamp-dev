import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { ILead, NicheType, LEAD_OUTREACH_ERROR_CODES, LEAD_STATUSES, LeadSource, OPERATOR_LOCALES, SITE_COMPLEXITY_CLASSES } from '@revamp/shared-types';

export interface ILeadDocument extends Omit<ILead, '_id' | 'tenantId' | 'businessId' | 'outreachError' | 'createdAt' | 'updatedAt'>, Document {
  /** The studio (organization) this lead belongs to (REV-208); absent on leads made before the split until REV-210 */
  tenantId?: Types.ObjectId;
  /** The shared business this lead pursues (REV-208); absent until the backfill */
  businessId?: Types.ObjectId;
  /** Why an approved send was returned to review (REV-226) */
  outreachError?: { code: (typeof LEAD_OUTREACH_ERROR_CODES)[number]; message: string; at: Date };
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILeadDocument>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Organization' },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', index: true },
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: 100,
    },
    originalUrl: {
      type: String,
      required: [true, 'Original URL is required'],
      trim: true,
    },
    domain: {
      type: String,
      required: [true, 'Domain is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    niche: {
      type: String,
      enum: [
        'dental',
        'auto',
        'legal',
        'beauty',
        'construction',
        'medical',
        'restaurant',
        'fitness',
        'real_estate',
        'other',
      ] as NicheType[],
      default: 'other',
      index: true,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    // Optional: filled from the site by the audit when the operator gives none (REV-45)
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    // REV-35: identity used to recognise a business discovery has already imported
    phoneE164: {
      type: String,
      index: true,
    },
    source: {
      type: String,
      enum: ['manual', 'osm', 'google'] as LeadSource[],
    },
    externalId: {
      type: String,
      index: true,
    },
    // REV-162: the dashboard language of the operator who added the lead, for the first MVP's design changes
    operatorLocale: {
      type: String,
      enum: OPERATOR_LOCALES,
    },
    ownerName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    status: {
      type: String,
      enum: [...LEAD_STATUSES],
      default: 'QUEUED',
      index: true,
    },
    totalScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    tags: {
      type: [String],
      default: [],
    },
    previewUrl: {
      type: String,
      trim: true,
    },
    comparisonBannerUrl: {
      type: String,
      trim: true,
    },
    // REV-31: preview cache-busting and the last generation failure shown to the operator
    mvpGeneratedAt: {
      type: Date,
    },
    generationError: {
      type: String,
    },
    // REV-132: the code and reason of a generation the model could not make; Mixed, so leads failed by the
    // previous generator (REV-141) keep their old codes
    generationFailure: { type: Schema.Types.Mixed },
    // REV-44: why the last audit failed for good; shown on the card with a retry action
    auditError: {
      type: String,
    },
    // REV-226: why the approved send was returned to review; cleared by the next approval
    outreachError: {
      type: new Schema(
        {
          code: { type: String, enum: [...LEAD_OUTREACH_ERROR_CODES], required: true },
          message: { type: String, required: true, maxlength: 500 },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
    },
    // REV-38: complexity class from the latest audit; one-page brochure sites sort first
    siteComplexity: {
      type: String,
      enum: [...SITE_COMPLEXITY_CLASSES],
    },
    onePageBrochure: {
      type: Boolean,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: Record<string, unknown>) => {
        ret['id'] = ret['_id'];
        delete ret['__v'];
        return ret;
      },
    },
  },
);

// Default list order (REV-38): one-page brochure sites first, newest first within each group
LeadSchema.index({ onePageBrochure: -1, createdAt: -1 });

// A studio sees only its own leads (REV-209): its list in the default order, and its status filter
LeadSchema.index({ tenantId: 1, onePageBrochure: -1, createdAt: -1 });
LeadSchema.index({ tenantId: 1, status: 1 });

// A studio has at most one lead per business (REV-208). Partial, so leads made before the split (no tenant or no
// business yet) are not restricted until they are migrated
LeadSchema.index(
  { tenantId: 1, businessId: 1 },
  { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, businessId: { $type: 'objectId' } } },
);

export const Lead: Model<ILeadDocument> =
  mongoose.models['Lead'] || mongoose.model<ILeadDocument>('Lead', LeadSchema);
