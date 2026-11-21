import { IMvpPageVersion } from '@revamp/shared-types';
import { MvpPageVersionSchema } from '@revamp/validation';

/**
 * A version entry of a model-designed page (REV-138), checked by MvpPageVersionSchema before it is pushed onto the
 * Mixed MvpProject.versions (REV-200). Throws on an entry the schema refuses: a bug, never a page problem.
 */
export function pageVersionEntry(entry: IMvpPageVersion): IMvpPageVersion {
  return MvpPageVersionSchema.parse(entry) as IMvpPageVersion;
}
