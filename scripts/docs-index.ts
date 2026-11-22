/**
 * REV-205: writes or checks ../Revamp-docs/INDEX.md, the heading → line-range index agents read before a document.
 *
 *   npm run docs:index                 # write ../Revamp-docs/INDEX.md
 *   npm run docs:check-index           # exit 1 when INDEX.md does not match the documents
 *   npm run docs:index -- path/to/docs # another docs checkout
 *
 * The docs live in their own repository, so CI does not run this; run it after editing the docs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDocsIndex } from './lib/docs-index.js';

const DEFAULT_DIR = '../Revamp-docs';
/** The large documents agents consult, in the order of the AGENTS.md doc map */
const DOCUMENTS = ['blueprint.md', 'spec.md', 'research.md', 'milestones.md', 'AGENTS.md', 'database-expertise.md'];

function main(): void {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const dir = path.resolve(args.find((arg) => !arg.startsWith('--')) ?? DEFAULT_DIR);
  const files = DOCUMENTS.map((name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new Error(`${file} not found (pass the docs directory as the first argument)`);
    return { name, text: fs.readFileSync(file, 'utf8') };
  });
  const index = buildDocsIndex(files);
  const target = path.join(dir, 'INDEX.md');

  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== index) {
      console.error(`[DocsIndex] ${target} is out of date: run npm run docs:index`);
      process.exit(1);
    }
    console.log(`[DocsIndex] ${target} matches ${files.length} documents`);
    return;
  }
  fs.writeFileSync(target, index);
  console.log(`[DocsIndex] Wrote ${target} (${files.length} documents)`);
}

main();
