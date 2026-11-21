import type { Schema } from 'mongoose';
import { AnalyticsEvent } from './models/AnalyticsEvent.model.js';
import { Audit } from './models/Audit.model.js';
import { EmailCampaign } from './models/EmailCampaign.model.js';
import { Lead } from './models/Lead.model.js';
import { MvpProject } from './models/MvpProject.model.js';

// REV-200: keeps the data dictionary (revamp-docs `database-expertise.md`) in step with the models. Dev tooling for
// `npm run docs:check-dictionary`; not exported from the package, so no app loads it.

const SKIPPED = new Set(['_id', '__v', 'createdAt', 'updatedAt']);

function schemaPaths(schema: Schema, prefix = ''): string[] {
  const paths: string[] = [];
  schema.eachPath((path, type) => {
    if (SKIPPED.has(path)) return;
    const full = `${prefix}${path}`;
    paths.push(full);
    // A single nested schema or an array of subdocuments: its fields are fields of the collection too
    const sub = (type as unknown as { schema?: Schema }).schema;
    if (sub) paths.push(...schemaPaths(sub, `${full}.`));
  });
  return paths;
}

/** Every field path of the five models, per MongoDB collection, without ids, the version key and timestamps */
export function modelFieldPaths(): Record<string, string[]> {
  return Object.fromEntries(
    [Lead, Audit, MvpProject, EmailCampaign, AnalyticsEvent].map((model) => [model.collection.collectionName, schemaPaths(model.schema)]),
  );
}

/** The Markdown under the heading that names `collection` in backticks, up to the next heading of the same or a higher level */
function sectionOf(markdown: string, collection: string): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s/.test(line) && line.includes(`\`${collection}\``));
  if (start < 0) return undefined;
  const level = /^(#+)/.exec(lines[start] ?? '')?.[1]?.length ?? 6;
  const end = lines.findIndex((line, i) => i > start && /^(#+)\s/.test(line) && (/^(#+)/.exec(line)?.[1]?.length ?? 7) <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/**
 * The `collection.path` of every model field the dictionary does not name in backticks in its collection's section. A
 * top-level field counts when its name is there; a nested one when its full path is, or its last name and its parent's
 * name are on one line (`| \`scores\` | … \`total\` |`), so a value elsewhere in the section that happens to share the
 * last name (`design` in an enum list) does not count
 */
export function undocumentedFields(markdown: string, paths: Record<string, string[]> = modelFieldPaths()): string[] {
  const missing: string[] = [];
  for (const [collection, fields] of Object.entries(paths)) {
    const section = sectionOf(markdown, collection);
    const namesOf = (text: string) => new Set(Array.from(text.matchAll(/`([^`]+)`/g), (m) => (m[1] ?? '').trim()));
    const named = namesOf(section ?? '');
    const lines = (section ?? '').split('\n').map(namesOf);
    for (const field of fields) {
      const parts = field.split('.');
      const last = parts[parts.length - 1] ?? field;
      const parent = parts[parts.length - 2];
      const documented = named.has(field) || (parent === undefined ? named.has(last) : lines.some((line) => line.has(parent) && line.has(last)));
      if (!documented) missing.push(`${collection}.${field}`);
    }
  }
  return missing;
}
