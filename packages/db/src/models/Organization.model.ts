import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IOrganizationDocument extends Document {
  /** The studio's name, as members see it */
  name: string;
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
  },
  { timestamps: true },
);

export const Organization: Model<IOrganizationDocument> =
  (mongoose.models.Organization as Model<IOrganizationDocument>) ||
  mongoose.model<IOrganizationDocument>('Organization', OrganizationSchema);
