import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IEmailCampaign, EmailCampaignStatus } from '@revamp/shared-types';

export interface IEmailCampaignDocument
  extends Omit<
      IEmailCampaign,
      | '_id'
      | 'leadId'
      | 'auditId'
      | 'mvpProjectId'
      | 'createdAt'
      | 'updatedAt'
      | 'scheduledAt'
      | 'sentAt'
      | 'approvedAt'
    >,
    Document {
  leadId: Types.ObjectId;
  auditId?: Types.ObjectId;
  mvpProjectId?: Types.ObjectId;
  bouncedAt?: Date;
  bounceReason?: string;
  approvedAt?: Date;
  scheduledAt?: Date;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailMetricsSchema = new Schema(
  {
    openedAt: { type: Date },
    openCount: { type: Number, default: 0 },
    clickedAt: { type: Date },
    clickCount: { type: Number, default: 0 },
    demoVisitCount: { type: Number, default: 0 },
    totalDwellTimeSeconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const EmailCampaignSchema = new Schema<IEmailCampaignDocument>(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      required: [true, 'Lead ID is required'],
      index: true,
    },
    auditId: {
      type: Schema.Types.ObjectId,
      ref: 'Audit',
    },
    mvpProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'MvpProject',
    },
    status: {
      type: String,
      enum: [
        'DRAFT',
        'NEEDS_APPROVAL',
        'APPROVED',
        'SCHEDULED',
        'SENDING',
        'DELIVERED',
        'BOUNCED',
        'REJECTED',
      ] as EmailCampaignStatus[],
      default: 'DRAFT',
      index: true,
    },
    senderEmail: {
      type: String,
      required: [true, 'Sender email is required'],
      trim: true,
    },
    recipientEmail: {
      type: String,
      required: [true, 'Recipient email is required'],
      trim: true,
      lowercase: true,
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
    },
    previewText: {
      type: String,
      trim: true,
    },
    bodyHtml: {
      type: String,
      required: [true, 'Body HTML is required'],
    },
    bodyPlainText: {
      type: String,
    },
    trackingToken: {
      type: String,
      required: [true, 'Tracking token is required'],
      unique: true,
      index: true,
    },
    requiresManualReview: {
      type: Boolean,
      default: true,
    },
    approvedBy: {
      type: String,
    },
    approvedAt: {
      type: Date,
    },
    scheduledAt: {
      type: Date,
    },
    sentAt: {
      type: Date,
    },
    bouncedAt: {
      type: Date,
    },
    bounceReason: {
      type: String,
    },
    metrics: {
      type: EmailMetricsSchema,
      default: () => ({
        openCount: 0,
        clickCount: 0,
        demoVisitCount: 0,
        totalDwellTimeSeconds: 0,
      }),
    },
  },
  {
    timestamps: true,
  },
);

export const EmailCampaign: Model<IEmailCampaignDocument> =
  mongoose.models['EmailCampaign'] ||
  mongoose.model<IEmailCampaignDocument>('EmailCampaign', EmailCampaignSchema);
