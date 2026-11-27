import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_SPECS } from '../../vitest.browser-specs';

// REV-230: specs that launch a real Chromium run in the `browser` Vitest project, after the unit tests.
const ROOT = path.resolve(__dirname, '../..');
const BROWSER_SOURCE = /chromium\.launch|from ['"]playwright['"]|from ['"]@playwright\/test['"]/;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.claude']);

function findSpecs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSpecs(full, out);
    // This file holds the planted sources below, so it is not itself a browser spec
    else if (entry.name.endsWith('.spec.ts') && full !== __filename) out.push(full);
  }
  return out;
}

describe('browser spec list (REV-230)', () => {
  it('the regex catches chromium.launch and both import forms', () => {
    expect(BROWSER_SOURCE.test('const b = await chromium.launch({ headless: true });')).toBe(true);
    expect(BROWSER_SOURCE.test("import { chromium } from 'playwright';")).toBe(true);
    expect(BROWSER_SOURCE.test('import { test } from "@playwright/test";')).toBe(true);
    expect(BROWSER_SOURCE.test("import { describe } from 'vitest';")).toBe(false);
  });

  it('lists every spec that launches a browser, and only those', () => {
    const found = ['apps', 'packages', 'scripts']
      .flatMap((d) => findSpecs(path.join(ROOT, d)))
      .filter((f) => BROWSER_SOURCE.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort();
    const listed = [...BROWSER_SPECS].sort();
    const missing = found.filter((f) => !listed.includes(f));
    const stale = listed.filter((f) => !found.includes(f));
    expect(missing, `${missing.join(', ')} launches a browser: add it to vitest.browser-specs.ts`).toEqual([]);
    expect(stale, `${stale.join(', ')} is listed in vitest.browser-specs.ts but is missing or launches no browser`).toEqual([]);
  });
});
