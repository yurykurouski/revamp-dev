import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { LOT_BANDS, LOT_STATUSES, LOT_WITHDRAW_REASONS } from '@revamp/shared-types';
import type { ILot, ILotPriceSignal, LotBandCode, LotStatus, LotWithdrawReason, NicheType } from '@revamp/shared-types';

/** The same list as `Business.niche` */
const NICHES: NicheType[] = ['dental', 'auto', 'legal', 'beauty', 'construction', 'medical', 'restaurant', 'fitness', 'real_estate', 'other'];

export interface ILotDocument
  extends Omit<ILot, '_id' | 'businessId' | 'auditId' | 'releaseAt' | 'withdrawnAt' | 'createdAt' | 'updatedAt' | 'status' | 'withdrawReason' | 'band'>,
    Document {
  businessId: Types.ObjectId;
  auditId: Types.ObjectId;
  status: LotStatus;
  band: LotBandCode;
  releaseAt?: Date;
  withdrawnAt?: Date;
  withdrawReason?: LotWithdrawReason;
  /** True while the lot can still change (DRAFT, OPEN, RESERVED); removed when it is SOLD or WITHDRAWN. Backs the unique index */
  live?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PriceSignalSchema = new Schema<ILotPriceSignal>(
  {
    signal: { type: String, required: true },
    value: { type: Number, required: true },
    need: { type: Number, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
);

/**
 * REV-232: a priced offer of one business and its audit. The price and band come from `priceFromAudit` (REV-231),
 * never from a model. `live` plus the partial unique index keep at most one live lot per business.
 */
const LotSchema = new Schema<ILotDocument>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    auditId: { type: Schema.Types.ObjectId, ref: 'Audit', required: true },
    niche: { type: String, enum: NICHES, required: true },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    priceCents: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    band: { type: String, enum: LOT_BANDS, required: true },
    need: { type: Number, required: true, min: 0, max: 1 },
    priceSignals: { type: [PriceSignalSchema], default: [] },
    status: { type: String, enum: LOT_STATUSES, default: 'DRAFT' },
    releaseAt: { type: Date },
    withdrawnAt: { type: Date },
    withdrawReason: { type: String, enum: LOT_WITHDRAW_REASONS },
    live: { type: Boolean },
  },
  { timestamps: true },
);

// At most one live lot per business: a second one is E11000, whoever races
LotSchema.index({ businessId: 1 }, { unique: true, partialFilterExpression: { live: true } });
// Listings by status, niche, city and band (REV-233)
LotSchema.index({ status: 1, niche: 1, city: 1, band: 1 });
LotSchema.index({ auditId: 1 });

export const Lot: Model<ILotDocument> =
  (mongoose.models.Lot as Model<ILotDocument>) || mongoose.model<ILotDocument>('Lot', LotSchema);
