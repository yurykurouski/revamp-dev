import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findViolations, scanApi } from './tenant-guard.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('tenant guard (REV-209)', () => {
  it('finds no query on leads, MVPs, campaigns or events outside the scope layer and the operator scripts', () => {
    const violations = scanApi(SRC);
    expect(
      violations,
      `Read and write these through req.tenant / scopeFor() (apps/api/src/data/tenant-scope.ts):\n${violations
        .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  describe('the scanner itself', () => {
    const planted = [
      'await Lead.find({ status: "QUEUED" }).exec();',
      'const p = await MvpProject.findOne({ previewSlug });',
      'await EmailCampaign.updateOne({ _id }, { $set: x });',
      'await AnalyticsEvent.create({ leadId });',
      'const l = new Lead({ businessName });',
      'await Lead.collection.deleteMany({});',
      'await Lead . findById(id);',
    ];

    it.each(planted)('catches %s', (line) => {
      expect(findViolations('routes/x.ts', `import x;\n${line}\n`)).toEqual([{ file: 'routes/x.ts', line: 2, text: line }]);
    });

    it('catches a call split over lines', () => {
      expect(findViolations('routes/x.ts', 'const rows = await Lead\n  .find({})\n  .exec();\n')).toEqual([
        { file: 'routes/x.ts', line: 1, text: 'const rows = await Lead' },
      ]);
    });

    it('does not take a comment, a string, a type or an unrelated name for a query', () => {
      const clean = [
        '// Lead.find is only allowed in data/',
        '/* MvpProject.findOne(\n   EmailCampaign.create( */',
        "const text = 'Lead.find(x)';",
        'const doc: ILeadDocument = lead; leadService.find();',
        'const a = Business.find({}); const b = Audit.findById(id);',
      ].join('\n');
      expect(findViolations('services/x.ts', clean)).toEqual([]);
    });
  });
});
