import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import { ORGANIZATION_ROLES, type OrganizationRole } from '@revamp/shared-types';

export interface IInvitationDocument extends Document {
  organizationId: Types.ObjectId;
  /** The address the invitation is for; lowercase. The invitee must sign in or register with it */
  email: string;
  role: OrganizationRole;
  /** SHA-256 of the one-time token; the token itself is never stored */
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  /** Set once, when the invitation is used */
  acceptedAt?: Date | null;
  /** Set when an owner revokes it or a newer invitation for the same address replaces it */
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const InvitationSchema = new Schema<IInvitationDocument>(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: [...ORGANIZATION_ROLES], required: true },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// The Team screen lists an organization's invitations, newest first
InvitationSchema.index({ organizationId: 1, createdAt: -1 });

export const Invitation: Model<IInvitationDocument> =
  (mongoose.models.Invitation as Model<IInvitationDocument>) ||
  mongoose.model<IInvitationDocument>('Invitation', InvitationSchema);
