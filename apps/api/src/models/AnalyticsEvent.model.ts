import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { IAnalyticsEvent, AnalyticsEventType } from '@revamp/shared-types';

export interface IAnalyticsEventDocument
  extends Omit<IAnalyticsEvent, '_id' | 'leadId' | 'campaignId' | 'mvpProjectId' | 'timestamp'>,
    Document {
  leadId?: Types.ObjectId;
  campaignId?: Types.ObjectId;
  mvpProjectId?: Types.ObjectId;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEventDocument>(
  {
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      index: true,
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'EmailCampaign',
      index: true,
    },
    mvpProjectId: {
      type: Schema.Types.ObjectId,
      ref: 'MvpProject',
      index: true,
    },
    trackingToken: {
      type: String,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        'open',
        'click',
        'pageview',
        'dwell_time',
        'cta_click',
        'booking_intent',
        'scroll_depth',
      ] as AnalyticsEventType[],
      required: [true, 'Event type is required'],
      index: true,
    },
    dwellTimeSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    scrollDepthPercent: {
      type: Number,
      min: 0,
      max: 100,
    },
    ipHash: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
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

AnalyticsEventSchema.index({ trackingToken: 1, eventType: 1 });
AnalyticsEventSchema.index({ leadId: 1, timestamp: -1 });

export const AnalyticsEvent: Model<IAnalyticsEventDocument> =
  mongoose.models['AnalyticsEvent'] ||
  mongoose.model<IAnalyticsEventDocument>('AnalyticsEvent', AnalyticsEventSchema);
