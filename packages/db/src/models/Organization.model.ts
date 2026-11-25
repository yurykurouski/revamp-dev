import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOrganizationDocument extends Document {
  /** The studio's name, as members see it */
  name: string;
  /** The sender the studio's outreach goes out under (REV-221); absent until the owner sets it */
  sender?: { name: string; address: string };
  createdAt: Date;
  updatedAt: Date;
}

const OrganizationSchema = new Schema<IOrganizationDocument>(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: 100,
    },
    sender: {
      type: new Schema({ name: { type: String, trim: true, maxlength: 100 }, address: { type: String, trim: true, lowercase: true } }, { _id: false }),
    },
  },
  { timestamps: true },
);

export const Organization: Model<IOrganizationDocument> =
  (mongoose.models.Organization as Model<IOrganizationDocument>) ||
  mongoose.model<IOrganizationDocument>('Organization', OrganizationSchema);
