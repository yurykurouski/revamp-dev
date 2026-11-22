import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@revamp/shared-types';

export interface IMembershipDocument extends Document {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  role: OrganizationRole;
  createdAt: Date;
  updatedAt: Date;
}

const MembershipSchema = new Schema<IMembershipDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    role: { type: String, enum: [...ORGANIZATION_ROLES], required: true },
  },
  { timestamps: true },
);

// A user is a member of an organization at most once; the same index serves "memberships of this user"
MembershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });

export const Membership: Model<IMembershipDocument> =
  (mongoose.models.Membership as Model<IMembershipDocument>) ||
  mongoose.model<IMembershipDocument>('Membership', MembershipSchema);
