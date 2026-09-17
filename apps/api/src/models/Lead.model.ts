import mongoose, { Schema, Document, Model } from 'mongoose';
import { ILead, NicheType, LeadStatus } from '@revamp/shared-types';

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
    contactEmail: {
      type: String,
      required: [true, 'Contact email is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    contactPhone: {
      type: String,
      trim: true,
      maxlength: 30,
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

export const Lead: Model<ILeadDocument> =
  mongoose.models['Lead'] || mongoose.model<ILeadDocument>('Lead', LeadSchema);
