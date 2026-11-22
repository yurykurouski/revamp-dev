import { AppError } from '../middlewares/errorHandler.js';
import { OrganizationError, type OrganizationErrorCode } from '../models/Invitation.model.js';

const STATUS: Record<OrganizationErrorCode, number> = {
  ALREADY_MEMBER: 409,
  LAST_OWNER: 409,
  MEMBER_NOT_FOUND: 404,
  INVITATION_NOT_FOUND: 404,
  INVITATION_EXPIRED: 410,
  INVITATION_EMAIL_MISMATCH: 403,
};

/** An organization rule that was not met (REV-207) becomes the API's error; anything else is rethrown unchanged */
export function mapOrganizationError(error: unknown): never {
  if (error instanceof OrganizationError) throw new AppError(STATUS[error.code], error.code, error.message);
  throw error;
}
