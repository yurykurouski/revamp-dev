import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { CONTACT_RIGHT_SOURCES, type ContactRightSource } from '@revamp/shared-types';

/**
 * REV-224: one studio's right to contact one business, from `grantedAt` to `expiresAt`, followed by a cooldown until
 * `cooldownUntil` during which no studio may claim the business. Created only by `grantContactRight`, together with the
 * business's `contactHold`.
 */
export interface IContactRightDocument extends Document {
  tenantId: Types.ObjectId;
  businessId: Types.ObjectId;
  leadId: Types.ObjectId;
  source: ContactRightSource;
  grantedAt: Date;
  expiresAt: Date;
  cooldownUntil: Date;
  /** Set when the right ended before `expiresAt` (an opt-out) */
  endedAt?: Date;
  endReason?: 'opted_out';
  createdAt: Date;
  updatedAt: Date;
}

const ContactRightSchema = new Schema<IContactRightDocument>(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    source: { type: String, enum: [...CONTACT_RIGHT_SOURCES], required: true },
    grantedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    cooldownUntil: { type: Date, required: true },
    endedAt: { type: Date },
    endReason: { type: String, enum: ['opted_out'] },
  },
  { timestamps: true },
);

ContactRightSchema.index({ tenantId: 1, businessId: 1, expiresAt: -1 });
ContactRightSchema.index({ leadId: 1 });
ContactRightSchema.index({ businessId: 1, expiresAt: -1 });

export const ContactRight: Model<IContactRightDocument> =
  (mongoose.models.ContactRight as Model<IContactRightDocument>) ||
  mongoose.model<IContactRightDocument>('ContactRight', ContactRightSchema);
