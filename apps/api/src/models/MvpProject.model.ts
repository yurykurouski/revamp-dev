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
    generatedContent: {
      type: Schema.Types.Mixed,
      required: true,
    },
    colorPalette: {
      primary: { type: String, required: true },
      secondary: { type: String, required: true },
      accent: { type: String, required: true },
    },
    isPublished: {
      type: Boolean,
      default: true,
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

export const MvpProject: Model<IMvpProjectDocument> =
  mongoose.models['MvpProject'] || mongoose.model<IMvpProjectDocument>('MvpProject', MvpProjectSchema);
