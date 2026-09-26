import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IAudit, AuditStatus } from '@revamp/shared-types';

export interface IAuditDocument
  extends Omit<IAudit, '_id' | 'leadId' | 'createdAt' | 'completedAt'>,
    Document {
  leadId: Types.ObjectId;
  desktopScreenshotUrl?: string;
  mobileScreenshotUrl?: string;
  lcp?: number;
  a11yScore?: number;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const A11yViolationSchema = new Schema(
  {
    id: { type: String, required: true },
    description: { type: String, required: true },
    impact: {
      type: String,
      enum: ['minor', 'moderate', 'serious', 'critical'],
    },
    selector: { type: String, required: true },
  },
  { _id: false },
);

const CriticalFlawSchema = new Schema(
  {
    title: { type: String, required: true },
    impact: { type: String, required: true },
    recommendation: { type: String, required: true },
  },
  { _id: false },
);

const AuditSchema = new Schema<IAuditDocument>(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: [true, 'Lead ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as AuditStatus[],
      default: 'QUEUED',
      index: true,
    },
    scores: {
      total: { type: Number, min: 0, max: 100, default: 0 },
      design: { type: Number, min: 0, max: 100, default: 0 },
      accessibility: { type: Number, min: 0, max: 100, default: 0 },
      performance: { type: Number, min: 0, max: 100, default: 0 },
      standards: { type: Number, min: 0, max: 100, default: 0 },
    },
    lighthouseMetrics: {
      lcp: { type: Number },
      fidOrInp: { type: Number },
      cls: { type: Number },
      speedIndex: { type: Number },
    },
    a11ySummary: {
      violationsCount: { type: Number, default: 0 },
      contrastIssuesCount: { type: Number, default: 0 },
      missingAltCount: { type: Number, default: 0 },
      criticalViolations: { type: [A11yViolationSchema], default: [] },
    },
    designCritique: {
      visualHierarchyRating: { type: Number, default: 0 },
      mobileFriendlinessRating: { type: Number, default: 0 },
      primaryCtaFound: { type: Boolean, default: false },
      datedDesignFactors: { type: [String], default: [] },
      criticalFlaws: { type: [CriticalFlawSchema], default: [] },
      quickWins: { type: [String], default: [] },
    },
    extractedBrandTokens: {
      primaryColor: { type: String, default: '#000000' },
      secondaryColor: { type: String, default: '#ffffff' },
      accentColor: { type: String, default: '#0070f3' },
      fontFamilies: { type: [String], default: [] },
      logoUrl: { type: String },
      faviconUrl: { type: String },
    },
    screenshotUrls: {
      desktopOriginal: { type: String, default: '' },
      mobileOriginal: { type: String, default: '' },
      desktopFull: { type: String },
      mobileFull: { type: String },
      comparisonBanner: { type: String },
    },
    // REV-23: contacts and original content extracted from the site (free-form, deterministic)
    extractedContacts: { type: Schema.Types.Mixed },
    extractedContent: { type: Schema.Types.Mixed },
    desktopScreenshotUrl: { type: String },
    mobileScreenshotUrl: { type: String },
    lcp: { type: Number },
    a11yScore: { type: Number },
    aiFallbackUsed: {
      type: Boolean,
      default: false,
    },
    errorMessage: {
      type: String,
    },
    extractedServices: {
      type: [String],
      default: [],
    },
    generatedContent: {
      type: Schema.Types.Mixed,
    },
    completedAt: {
      type: Date,
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

export const Audit: Model<IAuditDocument> =
  mongoose.models['Audit'] || mongoose.model<IAuditDocument>('Audit', AuditSchema);
