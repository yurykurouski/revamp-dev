import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUserDocument extends Document {
  /** Sign-in name; stored lowercase, unique across the platform */
  email: string;
  /** `scrypt$<salt>$<hash>` (hex); the password itself is never stored */
  passwordHash: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 254,
      // One account per address (REV-206); makes a concurrent double registration fail with E11000
      unique: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
    },
    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },
  },
  { timestamps: true },
);

export const User: Model<IUserDocument> =
  (mongoose.models.User as Model<IUserDocument>) || mongoose.model<IUserDocument>('User', UserSchema);
