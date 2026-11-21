import { describe, expect, it } from 'vitest';
import { modelFieldPaths, undocumentedFields } from '../data-dictionary.js';

describe('modelFieldPaths (REV-200)', () => {
  const paths = modelFieldPaths();

  it('lists every collection with nested and subdocument paths', () => {
    expect(Object.keys(paths).sort()).toEqual(['analyticsevents', 'audits', 'emailcampaigns', 'leads', 'mvpprojects']);
    expect(paths.audits).toEqual(expect.arrayContaining(['scores.total', 'standardsChecks.https', 'a11ySummary.criticalViolations', 'a11ySummary.criticalViolations.impact', 'measurementErrors.measurement']));
    expect(paths.emailcampaigns).toEqual(expect.arrayContaining(['metrics.openCount', 'trackingToken']));
    expect(paths.mvpprojects).toEqual(expect.arrayContaining(['versions', 'theme']));
  });

  it('leaves out ids, the version key and timestamps', () => {
    for (const list of Object.values(paths)) {
      for (const path of list) expect(path).not.toMatch(/(^|\.)(_id|__v|createdAt|updatedAt)$/);
    }
  });
});

describe('undocumentedFields (REV-200)', () => {
  const paths = { leads: ['businessName', 'status'], emailcampaigns: ['trackingToken', 'metrics.openCount'] };

  it('finds nothing when each field is in backticks in its collection section, nested ones by their last name', () => {
    const md = '### 4.1. `leads`\n| `businessName` | `status` |\n### 4.4. `emailcampaigns`\n| `trackingToken` | `metrics` — `openCount` |\n';
    expect(undocumentedFields(md, paths)).toEqual([]);
  });

  it('reports a field missing from its section', () => {
    const md = '### 4.1. `leads`\n| `businessName` | `status` |\n### 4.4. `emailcampaigns`\n| `metrics` — `openCount` |\n';
    expect(undocumentedFields(md, paths)).toEqual(['emailcampaigns.trackingToken']);
  });

  it('does not count a field documented only under another collection', () => {
    const md = '### 4.1. `leads`\n| `businessName` | `status` | `trackingToken` |\n### 4.4. `emailcampaigns`\n| `openCount` |\n';
    expect(undocumentedFields(md, paths)).toEqual(['emailcampaigns.trackingToken']);
  });

  it('reports every field of a collection without a section, and ignores plain-text mentions', () => {
    const md = '### 4.1. `leads`\nbusinessName and status in plain text\n';
    expect(undocumentedFields(md, paths)).toEqual(['leads.businessName', 'leads.status', 'emailcampaigns.trackingToken', 'emailcampaigns.metrics.openCount']);
  });

  it('ends a section at the next heading of the same or a higher level only', () => {
    const md = '### 4.1. `leads`\n#### Details\n`businessName` `status`\n## 5. Other\n### `emailcampaigns`\n`trackingToken` `openCount`\n';
    expect(undocumentedFields(md, paths)).toEqual([]);
  });
});
