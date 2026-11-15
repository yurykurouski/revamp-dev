/**
 * REV-198: proves the MongoDB users have the rights they should and no more.
 *
 *   npm run db:check-roles                    # uses .env in the repository root
 *   ENV_FILE=/path/to/.env npm run db:check-roles
 *
 * Logs in as each user with the host, database and options of MONGODB_URI (so it works on any port, and
 * on Atlas, whose database is revamp_prod) and the password from .env. Dangerous rights (dropDatabase,
 * createUser, grantRole) are read from the user's own privileges (connectionStatus), never tried, so a
 * misconfigured user cannot destroy data here. Any error other than Unauthorized fails its check.
 * Exits 1 when any check differs from the expected result.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
// @ts-expect-error plain .mjs helper without type declarations
import { parseEnv } from './lib/dev-stack.mjs';

type Outcome = 'allowed' | 'denied' | 'error';
interface Result {
  outcome: Outcome;
  note?: string;
}
interface Check extends Result {
  user: string;
  action: string;
  expected: Exclude<Outcome, 'error'>;
}
interface Privilege {
  resource: { db?: string; collection?: string; anyResource?: boolean; cluster?: boolean };
  actions: string[];
}

const UNAUTHORIZED = 13;
const COLLECTION = '__rolecheck';
const DANGEROUS_ACTIONS = ['createUser', 'dropDatabase', 'grantRole'];

/** The database the app uses: the path of MONGODB_URI (revamp locally, revamp_prod on Atlas). */
export function databaseFromUri(uri: string): string {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : 'revamp';
}

/** Unauthorized is the only "denied"; a timeout or any other error must not pass a "denied" check. */
export function outcomeOf(error: unknown): Result {
  const { code, message } = (error ?? {}) as { code?: number; message?: string };
  if (code === UNAUTHORIZED) return { outcome: 'denied' };
  return { outcome: 'error', note: message ?? String(error) };
}

/** Dangerous actions granted on `db`, on every database (`db: ''`) or on any resource. */
export function dangerousActionsHeld(privileges: Privilege[], db: string): string[] {
  const held = new Set<string>();
  for (const { resource, actions } of privileges) {
    const covers = resource.anyResource === true || ((resource.db === db || resource.db === '') && !resource.collection);
    if (covers) for (const action of actions) if (DANGEROUS_ACTIONS.includes(action)) held.add(action);
  }
  return [...held].sort();
}

/** True when this module is the script node was started with (paths with spaces included). */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  return Boolean(argv1) && path.resolve(argv1 as string) === fileURLToPath(moduleUrl);
}

async function attempt(fn: () => Promise<unknown>): Promise<Result> {
  try {
    await fn();
    return { outcome: 'allowed' };
  } catch (error: unknown) {
    return outcomeOf(error);
  }
}

export async function checkRoles(env: Record<string, string>): Promise<Check[]> {
  const db = databaseFromUri(env.MONGODB_URI);
  const uriFor = (user: string, password: string) => {
    const url = new URL(env.MONGODB_URI);
    url.username = encodeURIComponent(user);
    url.password = encodeURIComponent(password);
    return url.toString();
  };
  const withUser = async (user: string, passwordVar: string, fn: (conn: mongoose.Connection) => Promise<void>) => {
    const password = env[passwordVar];
    if (!password) throw new Error(`${passwordVar} is not set in .env`);
    const conn = await mongoose.createConnection(uriFor(user, password), { serverSelectionTimeoutMS: 5000 }).asPromise();
    try {
      await fn(conn);
    } finally {
      await conn.close();
    }
  };

  const checks: Check[] = [];
  const record = (user: string, action: string, expected: Check['expected'], result: Result) =>
    checks.push({ user, action, expected, ...result });

  await withUser('revamp_app', 'MONGO_APP_PASSWORD', async (conn) => {
    const collection = conn.db!.collection(COLLECTION);
    record('revamp_app', 'insert + delete', 'allowed', await attempt(async () => {
      const { insertedId } = await collection.insertOne({ at: new Date() });
      await collection.deleteOne({ _id: insertedId });
    }));
    const status = await conn.db!.admin().command({ connectionStatus: 1, showPrivileges: true });
    const held = dangerousActionsHeld(status.authInfo?.authenticatedUserPrivileges ?? [], db);
    for (const action of DANGEROUS_ACTIONS) {
      record('revamp_app', `${action} on ${db} (privileges)`, 'denied', { outcome: held.includes(action) ? 'allowed' : 'denied' });
    }
    // MongoDB answers listDatabases for any user, filtered to the databases it holds rights on
    // (authorizedDatabases), so the check is that no other database shows up.
    const { databases } = await conn.db!.admin().listDatabases({ nameOnly: true });
    const others = databases.map((d) => d.name).filter((name) => name !== db);
    record('revamp_app', `see databases other than ${db}`, 'denied', {
      outcome: others.length ? 'allowed' : 'denied',
      note: others.length ? `sees ${others.join(', ')}` : undefined,
    });
  });

  await withUser('revamp_read', 'MONGO_READ_PASSWORD', async (conn) => {
    const collection = conn.db!.collection(COLLECTION);
    record('revamp_read', 'find', 'allowed', await attempt(() => collection.findOne({})));
    record('revamp_read', 'insert', 'denied', await attempt(() => collection.insertOne({ at: new Date() })));
  });

  await withUser('revamp_admin', 'MONGO_ADMIN_PASSWORD', async (conn) => {
    const collection = conn.db!.collection(COLLECTION);
    record('revamp_admin', 'createIndex + dropIndex', 'allowed', await attempt(async () => {
      const name = await collection.createIndex({ at: 1 });
      await collection.dropIndex(name);
    }));
    await collection.drop().catch(() => undefined);
  });

  return checks;
}

async function main() {
  const envFile = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
  const checks = await checkRoles(parseEnv(fs.readFileSync(envFile, 'utf8')));
  console.table(checks.map(({ user, action, expected, outcome, note }) => ({ user, action, expected, actual: outcome, ok: outcome === expected ? '✓' : '✗', note: note ?? '' })));
  const failed = checks.filter((c) => c.outcome !== c.expected);
  if (failed.length) {
    console.error(`${failed.length} role check(s) failed.`);
    process.exit(1);
  }
  console.log('All MongoDB role checks passed.');
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
