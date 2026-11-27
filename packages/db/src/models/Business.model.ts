import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import type { NicheType } from '@revamp/shared-types';

/** The same list as `Lead.niche` */
const NICHES: NicheType[] = ['dental', 'auto', 'legal', 'beauty', 'construction', 'medical', 'restaurant', 'fitness', 'real_estate', 'other'];

/**
 * REV-224: the one document that decides who may contact the business. `grantContactRight` writes it with a
 * compare-and-set, so concurrent grants have exactly one winner. `expiresAt` ends the right, `cooldownUntil` ends the
 * cooldown that follows; both are copies of the winning `ContactRight`.
 */
export interface IContactHold {
  rightId: Types.ObjectId;
  tenantId: Types.ObjectId;
  expiresAt: Date;
  cooldownUntil: Date;
}

export interface IBusinessDocument extends Document {
  /** Canonical domain (`normalizeDomain`): lowercase, no `www.`, no port. One business per domain, shared by every studio */
  domain: string;
  originalUrl: string;
  businessName: string;
  niche: NicheType;
  city?: string;
  /** The current or last contact right; absent until a studio first claims the business */
  contactHold?: IContactHold;
  /** Set when the business asked not to be contacted (REV-224): no studio may claim it any more */
  optedOutAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ContactHoldSchema = new Schema<IContactHold>(
  {
    rightId: { type: Schema.Types.ObjectId, ref: 'ContactRight', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    expiresAt: { type: Date, required: true },
    cooldownUntil: { type: Date, required: true },
  },
  { _id: false },
);

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
    contactHold: { type: ContactHoldSchema },
    optedOutAt: { type: Date },
  },
  { timestamps: true },
);

export const Business: Model<IBusinessDocument> =
  (mongoose.models.Business as Model<IBusinessDocument>) ||
  mongoose.model<IBusinessDocument>('Business', BusinessSchema);
