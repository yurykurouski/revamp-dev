/**
 * REV-198: proves the MongoDB users have the rights they should and no more.
 *
 *   npm run db:check-roles                    # uses .env in the repository root
 *   ENV_FILE=/path/to/.env npm run db:check-roles
 *
 * Logs in as each user with the host and options of MONGODB_URI (so it works on any port, and on Atlas)
 * and the password from .env. Dangerous rights (dropDatabase, createUser) are read from the user's own
 * privileges (connectionStatus), never tried, so a misconfigured user cannot destroy data here.
 * Exits 1 when any check differs from the expected result.
 */
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
// @ts-expect-error plain .mjs helper without type declarations
import { parseEnv } from './lib/dev-stack.mjs';

type Outcome = 'allowed' | 'denied';
interface Check {
  user: string;
  action: string;
  expected: Outcome;
  actual?: Outcome;
  note?: string;
}

const UNAUTHORIZED = 13;
const DB = 'revamp';
const COLLECTION = '__rolecheck';

const envFile = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
const env: Record<string, string> = parseEnv(fs.readFileSync(envFile, 'utf8'));

function uriFor(user: string, password: string): string {
  const url = new URL(env.MONGODB_URI);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString();
}

async function attempt(fn: () => Promise<unknown>): Promise<{ outcome: Outcome; note?: string }> {
  try {
    await fn();
    return { outcome: 'allowed' };
  } catch (error: unknown) {
    const { code, message } = (error ?? {}) as { code?: number; message?: string };
    if (code === UNAUTHORIZED) return { outcome: 'denied' };
    return { outcome: 'denied', note: `unexpected error: ${message ?? String(error)}` };
  }
}

/** Actions the logged-in user holds on the `revamp` database itself (connectionStatus). */
async function actionsOnDatabase(conn: mongoose.Connection): Promise<Set<string>> {
  const status = await conn.db!.admin().command({ connectionStatus: 1, showPrivileges: true });
  const privileges: Array<{ resource: { db?: string; collection?: string }; actions: string[] }> =
    status.authInfo?.authenticatedUserPrivileges ?? [];
  return new Set(
    privileges
      .filter((p) => p.resource.db === DB && (p.resource.collection === '' || p.resource.collection === undefined))
      .flatMap((p) => p.actions),
  );
}

async function withUser<T>(user: string, passwordVar: string, fn: (conn: mongoose.Connection) => Promise<T>) {
  const password = env[passwordVar];
  if (!password) throw new Error(`${passwordVar} is not set in ${envFile}`);
  const conn = await mongoose.createConnection(uriFor(user, password), { serverSelectionTimeoutMS: 5000 }).asPromise();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

export async function checkRoles(): Promise<Check[]> {
  const checks: Check[] = [];
  const record = (user: string, action: string, expected: Outcome, result: { outcome: Outcome; note?: string }) =>
    checks.push({ user, action, expected, actual: result.outcome, note: result.note });

  await withUser('revamp_app', 'MONGO_APP_PASSWORD', async (conn) => {
    const collection = conn.db!.collection(COLLECTION);
    record('revamp_app', 'insert + delete', 'allowed', await attempt(async () => {
      const { insertedId } = await collection.insertOne({ at: new Date() });
      await collection.deleteOne({ _id: insertedId });
    }));
    const actions = await actionsOnDatabase(conn);
    for (const action of ['dropDatabase', 'createUser', 'grantRole']) {
      record('revamp_app', `${action} on revamp (privileges)`, 'denied', { outcome: actions.has(action) ? 'allowed' : 'denied' });
    }
    // MongoDB answers listDatabases for any user, filtered to the databases it holds rights on
    // (authorizedDatabases), so the check is that no other database shows up.
    const { databases } = await conn.db!.admin().listDatabases({ nameOnly: true });
    const others = databases.map((d) => d.name).filter((name) => name !== DB);
    record('revamp_app', 'see databases other than revamp', 'denied', {
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
  const checks = await checkRoles();
  console.table(checks.map(({ user, action, expected, actual, note }) => ({ user, action, expected, actual, ok: actual === expected ? '✓' : '✗', note: note ?? '' })));
  const failed = checks.filter((c) => c.actual !== c.expected);
  if (failed.length) {
    console.error(`${failed.length} role check(s) failed.`);
    process.exit(1);
  }
  console.log('All MongoDB role checks passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
