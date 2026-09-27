import mongoose, { Schema, Document, Model } from 'mongoose';
import { ILead, NicheType, LeadStatus, LeadSource, SITE_COMPLEXITY_CLASSES } from '@revamp/shared-types';

export interface ILeadDocument extends Omit<ILead, '_id' | 'createdAt' | 'updatedAt'>, Document {
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILeadDocument>(
  {
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
    ownerName: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    status: {
      type: String,
      enum: [
        'QUEUED',
        'PENDING',
        'AUDITING',
        'AUDIT_FAILED',
        'AUDITED',
        'GENERATING',
        'MVP_READY',
        'NEEDS_APPROVAL',
        'AWAITING_APPROVAL',
        'APPROVED',
        'SCHEDULED',
        'SENT',
        'DISPATCHED',
        'OPENED',
        'CLICKED',
        'ENGAGED',
        'REPLIED',
        'REJECTED',
        'UNSUBSCRIBED',
      ] as LeadStatus[],
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
    // REV-44: why the last audit failed for good; shown on the card with a retry action
    auditError: {
      type: String,
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

export const Lead: Model<ILeadDocument> =
  mongoose.models['Lead'] || mongoose.model<ILeadDocument>('Lead', LeadSchema);
