import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// REV-201: the API and workers say at startup that the leadId migration still has to run
const root = path.resolve(__dirname, '../../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf-8');

describe('leadId index check at startup (REV-201)', () => {
  it.each(['apps/api/src/index.ts', 'apps/workers/src/index.ts'])(
    '%s checks the index after connecting and logs each warning',
    (file) => {
      const source = read(file);
      const connect = source.indexOf('await mongoose.connect(env.MONGODB_URI)');
      const check = source.indexOf('checkLeadChildIndexes(mongoose.connection)');
      expect(connect).toBeGreaterThan(-1);
      expect(check).toBeGreaterThan(connect);
      expect(source).toMatch(
        /checkLeadChildIndexes\(mongoose\.connection\)[\s\S]{0,200}console\.warn/,
      );
    },
  );

  it('the migration script builds the index itself, with autoIndex off', () => {
    expect(read('apps/api/src/scripts/migrate-unique-lead-children.ts')).toContain(
      'autoIndex: false',
    );
  });
});
