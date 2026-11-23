// ==============================================================================
// Docker secrets through `*_FILE` variables (REV-220)
// ==============================================================================
import { readFileSync } from 'node:fs';

/**
 * For every `NAME_FILE` variable, reads that file into `NAME` unless `NAME` already has a value. Docker mounts a
 * secret as a file under /run/secrets, so the value never appears in `docker inspect` or in the environment of
 * the image. Returns the names it filled. An unreadable file is an error: a service must not start half configured.
 */
export function loadFileSecrets(env: NodeJS.ProcessEnv = process.env, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): string[] {
  const loaded: string[] = [];
  for (const key of Object.keys(env)) {
    if (!key.endsWith('_FILE')) continue;
    const path = env[key];
    const name = key.slice(0, -'_FILE'.length);
    if (!path || !name || env[name]) continue;
    let value: string;
    try {
      value = read(path);
    } catch (error) {
      throw new Error(`${key} points to ${path}, which cannot be read: ${(error as Error).message}`);
    }
    env[name] = value.replace(/\r?\n$/, '');
    loaded.push(name);
  }
  return loaded;
}
