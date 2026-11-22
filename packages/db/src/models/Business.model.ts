import mongoose, { Schema, Document, Model } from 'mongoose';
import type { NicheType } from '@revamp/shared-types';

/** The same list as `Lead.niche` */
const NICHES: NicheType[] = ['dental', 'auto', 'legal', 'beauty', 'construction', 'medical', 'restaurant', 'fitness', 'real_estate', 'other'];

export interface IBusinessDocument extends Document {
  /** Canonical domain (`normalizeDomain`): lowercase, no `www.`, no port. One business per domain, shared by every studio */
  domain: string;
  originalUrl: string;
  businessName: string;
  niche: NicheType;
  city?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BusinessSchema = new Schema<IBusinessDocument>(
  {
    domain: {
      type: String,
      required: [true, 'Domain is required'],
      trim: true,
      lowercase: true,
      // The company and its site are shared (REV-208): a second studio adding the same site finds this document
      unique: true,
    },
    originalUrl: { type: String, required: [true, 'Original URL is required'], trim: true },
    businessName: { type: String, required: [true, 'Business name is required'], trim: true, maxlength: 100 },
    niche: { type: String, enum: NICHES, default: 'other' },
    city: { type: String, trim: true, maxlength: 100 },
  },
  { timestamps: true },
);

export const Business: Model<IBusinessDocument> =
  (mongoose.models.Business as Model<IBusinessDocument>) ||
  mongoose.model<IBusinessDocument>('Business', BusinessSchema);
