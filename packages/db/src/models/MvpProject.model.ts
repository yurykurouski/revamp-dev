import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IMvpProject } from '@revamp/shared-types';

export interface IMvpProjectDocument
  extends Omit<IMvpProject, '_id' | 'leadId' | 'auditId' | 'createdAt' | 'updatedAt'>,
    Document {
  leadId: Types.ObjectId;
  auditId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MvpProjectSchema = new Schema<IMvpProjectDocument>(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: true,
      index: true,
    },
    auditId: {
      type: Schema.Types.ObjectId,
      ref: 'Audit',
      required: true,
      index: true,
    },
    previewSlug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fullPreviewUrl: {
      type: String,
      required: true,
    },
    storageHtmlPath: {
      type: String,
      required: true,
    },
    comparisonBannerUrl: {
      type: String,
    },
    // Absent on a model-designed page (REV-138); removed with the rebuild in REV-141
    generatedContent: {
      type: Schema.Types.Mixed,
    },
    colorPalette: {
      primary: { type: String },
      secondary: { type: String },
      accent: { type: String },
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    // REV-31: regeneration replaces the project in place; these record the latest run
    generatedAt: {
      type: Date,
    },
    generationCount: {
      type: Number,
      default: 0,
    },
    // REV-36: the MVP compared with the original site's key business data
    completenessReport: {
      type: Schema.Types.Mixed,
    },
    // Provider and model that wrote the copy, and the operator's choice for the run (REV-32)
    provider: { type: String },
    modelUsed: { type: String },
    requestedProvider: { type: String },
    requestedModel: { type: String },
    // REV-54: the layout this version was rendered with, and the audit facts behind the choice
    layout: { type: Schema.Types.Mixed },
    // REV-85: when an operator's free-text change was last applied and re-published
    editedAt: { type: Date },
    // REV-92: the operator's custom design spec, applied by the template on every render
    design: { type: Schema.Types.Mixed },
    // REV-110: what the rebuild of the original site left out and which fixes it applied
    rebuild: { type: Schema.Types.Mixed },
    // REV-111: the operator's change to the rebuilt page (ids and fixed values), applied on every rebuild render
    rebuildEdit: { type: Schema.Types.Mixed },
    // REV-114: the modernize level's design (ids and fixed values), applied under the operator's edit
    modernize: { type: Schema.Types.Mixed },
    // REV-132: why the last re-render was not published (MvpRenderFailureSchema); cleared by a publish
    renderFailure: { type: Schema.Types.Mixed },
    // REV-118: the published page's standards checks and score (MvpStandardsSchema), re-checked on every publish
    standards: { type: Schema.Types.Mixed },
    // REV-119: the published page's web vitals (MvpPerformanceSchema), measured on every publish
    performance: { type: Schema.Types.Mixed },
    // REV-138: the model's page (placeholders unfilled), its theme, the operator's controls, grounding flags, versions
    page: { type: String },
    theme: { type: Schema.Types.Mixed },
    controls: { type: Schema.Types.Mixed },
    grounding: { type: Schema.Types.Mixed },
    versions: { type: Schema.Types.Mixed },
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

export const MvpProject: Model<IMvpProjectDocument> =
  mongoose.models['MvpProject'] || mongoose.model<IMvpProjectDocument>('MvpProject', MvpProjectSchema);
