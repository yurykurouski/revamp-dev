import mongoose, { Schema, Document, Model } from 'mongoose';

/** REV-224: the SHA-256 (`hashAddress`) of an address that opted out; the address itself is never stored */
export interface ISuppressedAddressDocument extends Document {
  hash: string;
  createdAt: Date;
}

const SuppressedAddressSchema = new Schema<ISuppressedAddressDocument>(
  {
    hash: {
      type: String,
      required: true,
      unique: true,
      match: [/^[0-9a-f]{64}$/, 'hash must be 64 lowercase hex characters'],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export const SuppressedAddress: Model<ISuppressedAddressDocument> =
  (mongoose.models.SuppressedAddress as Model<ISuppressedAddressDocument>) ||
  mongoose.model<ISuppressedAddressDocument>('SuppressedAddress', SuppressedAddressSchema);
