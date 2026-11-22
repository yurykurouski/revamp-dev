/**
 * REV-200: lists the model fields the data dictionary does not mention, so the two do not drift apart.
 *
 *   npm run docs:check-dictionary                       # ../Revamp-docs/database-expertise.md
 *   npm run docs:check-dictionary -- path/to/file.md
 *
 * A field counts as documented when its path, or its last name for a nested field, is in backticks in the section whose
 * heading names its collection (`leads`, `audits`, `mvpprojects`, `emailcampaigns`, `analyticsevents`, `organizations`, `users`, `memberships`, `invitations`, `businesses`). Exits 1 when
 * any field is missing. The dictionary lives in the docs repository, so CI does not run this; run it with schema changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFieldPaths, undocumentedFields } from '../packages/db/src/data-dictionary.js';

const DEFAULT_FILE = '../Revamp-docs/database-expertise.md';

function main(): void {
  const file = path.resolve(process.argv[2] ?? DEFAULT_FILE);
  if (!fs.existsSync(file)) throw new Error(`${file} not found (pass the dictionary file as the first argument)`);
  const paths = modelFieldPaths();
  const total = Object.values(paths).reduce((sum, list) => sum + list.length, 0);
  const missing = undocumentedFields(fs.readFileSync(file, 'utf8'), paths);
  if (missing.length === 0) {
    console.log(`[Dictionary] All ${total} model fields are documented in ${file}`);
    return;
  }
  console.error(`[Dictionary] ${missing.length} of ${total} model fields are not documented in ${file}:`);
  for (const field of missing) console.error(`  - ${field}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[Dictionary] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
