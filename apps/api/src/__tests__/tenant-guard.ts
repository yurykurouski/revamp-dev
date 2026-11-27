import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// REV-209: finds code that reads or writes a tenant-owned collection without going through `data/tenant-scope.ts`.
// Leads, MVPs, campaigns and events belong to a studio; a query written outside the scope can forget the studio filter
// and show one studio another's records.

const GUARDED = ['Lead', 'MvpProject', 'EmailCampaign', 'AnalyticsEvent', 'ContactRight'];

/** Any use of a guarded model as a value: a static call (`Lead.find(`), `new Lead(`, or its raw `.collection` */
const USE = new RegExp(`\\b(?:${GUARDED.join('|')})\\s*\\.\\s*[a-zA-Z]+|\\bnew\\s+(?:${GUARDED.join('|')})\\s*\\(`);

export interface Violation {
  file: string;
  line: number;
  text: string;
}

/** Violations in one file's source; comments and strings are not code, so a mention in either is not a use */
export function findViolations(file: string, source: string): Violation[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'))
    .join('\n');
  const lines = source.split('\n');
  const found: Violation[] = [];
  // Searched in the whole text, so a call split over lines (`Lead\n  .find(`) is caught too
  for (const match of code.matchAll(new RegExp(USE.source, 'g'))) {
    const line = code.slice(0, match.index).split('\n').length;
    found.push({ file, line, text: lines[line - 1]!.trim() });
  }
  return found;
}

/** Folders whose files may query the four models: the scope itself, and the operator scripts, which run unscoped on purpose */
const ALLOWED = [/^data\//, /^scripts\//, /(^|\/)__tests__\//];

export function scanApi(root: string): Violation[] {
  const out: Violation[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name)) {
        const rel = relative(root, path).split('\\').join('/');
        if (!ALLOWED.some((re) => re.test(rel))) out.push(...findViolations(rel, readFileSync(path, 'utf8')));
      }
    }
  };
  walk(root);
  return out;
}
