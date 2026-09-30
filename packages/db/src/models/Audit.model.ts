import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IAudit, AuditStatus, AUDIT_MEASUREMENTS } from '@revamp/shared-types';

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

const MeasurementErrorSchema = new Schema(
  {
    measurement: { type: String, enum: AUDIT_MEASUREMENTS, required: true },
    message: { type: String, required: true },
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
      // No default: a pillar that was not measured stays absent (REV-100); a fallback critique is not scored (REV-101)
      design: { type: Number, min: 0, max: 100 },
      accessibility: { type: Number, min: 0, max: 100 },
      performance: { type: Number, min: 0, max: 100 },
      standards: { type: Number, min: 0, max: 100 },
    },
    // Measured in the page, not by Lighthouse; `lighthouseMetrics` before REV-102 (migrate:audit-vitals)
    webVitals: {
      lcp: { type: Number },
      cls: { type: Number },
    },
    // No defaults: an audit that could not read the page's standards has no checks (REV-100)
    standardsChecks: {
      type: new Schema(
        {
          https: { type: Boolean, required: true },
          viewport: { type: Boolean, required: true },
          title: { type: Boolean, required: true },
          favicon: { type: Boolean, required: true },
          structuredData: { type: Boolean, required: true },
          openGraph: { type: Boolean, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // No count defaults: an audit whose scan did not run has no violation counts (REV-100)
    a11ySummary: {
      violationsCount: { type: Number },
      contrastIssuesCount: { type: Number },
      missingAltCount: { type: Number },
      criticalViolations: { type: [A11yViolationSchema], default: [] },
    },
    measurementErrors: { type: [MeasurementErrorSchema], default: undefined },
    // REV-102: axe-core violations, trimmed by the worker (truncated HTML, capped nodes per rule)
    axeViolations: { type: Schema.Types.Mixed },
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
    // REV-38: deterministic complexity class, the DOM signals behind it, and reason codes
    siteComplexity: { type: Schema.Types.Mixed },
    // REV-104: the original home page's layout (validated by SiteLayoutSchema), or why it could not be read
    siteLayout: { type: Schema.Types.Mixed },
    siteLayoutError: { type: String },
    // REV-109: the original home page read section by section (validated by SiteSectionsSchema), or why it could not be read
    siteSections: { type: Schema.Types.Mixed },
    siteSectionsError: { type: String },
    // REV-33: how each capture context handled the cookie banner (e.g. dismissed:cmp:onetrust, not_found)
    cookieBannerHandled: {
      desktop: { type: String },
      mobile: { type: String },
    },
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
