/**
 * REV-199: exports and imports the local database with mongodump / mongorestore inside the mongo container, so the
 * host needs no MongoDB tools.
 *
 *   npm run db:dump                              # backups/<db>-<timestamp>.archive.gz (gitignored)
 *   npm run db:dump -- path/to/file.archive.gz
 *   npm run db:restore -- path/to/file.archive.gz          # adds documents; existing ids are skipped
 *   npm run db:restore -- path/to/file.archive.gz --drop   # replaces each collection in the archive
 *
 * Connects as the user of MONGODB_URI (revamp_app, readWrite on its database) to the database in its path. The
 * password travels in the environment and a config file inside the container, never in argv. MONGO_CONTAINER
 * names another container (default revamp-mongo). Refuses a database that is not local and NODE_ENV=production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLocalSeedTarget } from '@revamp/db';
// @ts-expect-error plain .mjs helper without type declarations
import { parseEnv } from './lib/dev-stack.mjs';

export type ArchiveMode = 'dump' | 'restore';

interface UriParts {
  user: string;
  password: string;
  db: string;
  authDb: string;
}

function uriParts(uri: string): UriParts {
  const match = /^mongodb:\/\/(?:([^:@/]*)(?::([^@/]*))?@)?[^/?]*\/?([^?]*)(?:\?(.*))?$/.exec(uri.trim());
  if (!match) throw new Error('MONGODB_URI is not a mongodb:// URI.');
  const [, user = '', password = '', dbPath = '', query = ''] = match;
  const db = decodeURIComponent(dbPath) || 'revamp';
  const authSource = new URLSearchParams(query).get('authSource');
  return { user: decodeURIComponent(user), password: decodeURIComponent(password), db, authDb: authSource ?? db };
}

// The container side; static text, so no value from the URI is ever interpolated into a command line
const CONNECT = `set -e
cfg=$(mktemp)
trap 'rm -f "$cfg"' EXIT
set --
if [ -n "$RV_USER" ]; then
  printf 'password: "%s"\\n' "$(printf '%s' "$RV_PASSWORD" | sed 's/[\\\\"]/\\\\&/g')" > "$cfg"
  set -- --config "$cfg" --username "$RV_USER" --authenticationDatabase "$RV_AUTH_DB"
fi
`;

/** The `docker` arguments and the environment that carry the credentials */
export function archiveCommand(
  mode: ArchiveMode,
  opts: { uri: string; drop: boolean; container: string },
): { args: string[]; env: Record<string, string> } {
  const { user, password, db, authDb } = uriParts(opts.uri);
  const tool =
    mode === 'dump'
      ? 'mongodump --host localhost --port 27017 "$@" --db "$RV_DB" --archive --gzip'
      : `mongorestore --host localhost --port 27017 "$@" --nsInclude "$RV_DB.*" --archive --gzip${opts.drop ? ' --drop' : ''}`;
  const names = ['RV_USER', 'RV_PASSWORD', 'RV_DB', 'RV_AUTH_DB'];
  return {
    args: ['exec', '-i', ...names.flatMap((name) => ['-e', name]), opts.container, 'sh', '-c', CONNECT + tool],
    env: { RV_USER: user, RV_PASSWORD: password, RV_DB: db, RV_AUTH_DB: authDb },
  };
}

/** `dump [file]` or `restore <file> [--drop]`; a dump without a file goes to backups/<db>-<UTC timestamp>.archive.gz */
export function parseArchiveArgs(argv: string[], db: string, now: Date): { mode: ArchiveMode; file: string; drop: boolean } {
  const [mode, ...rest] = argv;
  if (mode !== 'dump' && mode !== 'restore') throw new Error('Usage: db-archive.ts dump [file] | restore <file> [--drop]');
  const drop = rest.includes('--drop');
  const file = rest.find((arg) => !arg.startsWith('--'));
  if (mode === 'restore') {
    if (!file) throw new Error('db:restore needs the archive file: npm run db:restore -- <file> [--drop]');
    return { mode, file, drop };
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return { mode, file: file ?? `backups/${db}-${stamp}.archive.gz`, drop: false };
}

async function main(): Promise<void> {
  const envFile = process.env.ENV_FILE ?? path.resolve(process.cwd(), '.env');
  const file: Record<string, string> = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const uri = process.env.MONGODB_URI || file['MONGODB_URI'] || '';
  assertLocalSeedTarget(uri, process.env.NODE_ENV || file['NODE_ENV']);
  const { mode, file: archive, drop } = parseArchiveArgs(process.argv.slice(2), uriParts(uri).db, new Date());
  const container = process.env.MONGO_CONTAINER || 'revamp-mongo';
  const { args, env } = archiveCommand(mode, { uri, drop, container });

  let fd: number;
  let partial = '';
  if (mode === 'dump') {
    fs.mkdirSync(path.dirname(path.resolve(archive)), { recursive: true });
    partial = `${archive}.partial`;
    fd = fs.openSync(partial, 'w');
  } else {
    fd = fs.openSync(archive, 'r');
  }

  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn('docker', args, {
      env: { ...process.env, ...env },
      stdio: mode === 'dump' ? ['ignore', fd, 'inherit'] : [fd, 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('close', (exit) => resolve(exit ?? 1));
  });
  fs.closeSync(fd);

  if (code !== 0) {
    if (partial) fs.rmSync(partial, { force: true });
    throw new Error(`${mode === 'dump' ? 'mongodump' : 'mongorestore'} exited with ${code}`);
  }
  if (partial) fs.renameSync(partial, archive);
  console.log(`[DB] ${mode === 'dump' ? `Dumped to ${archive}` : `Restored from ${archive}${drop ? ' (collections replaced)' : ''}`}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(`[DB] Failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
