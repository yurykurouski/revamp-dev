import { describe, expect, it } from 'vitest';
import { loadFileSecrets } from '../src/observability/secrets.js';

describe('loadFileSecrets (REV-220)', () => {
  const files: Record<string, string> = { '/run/secrets/jwt': 'long-secret-value\n', '/run/secrets/uri': 'mongodb://u:p@mongo/revamp\r\n' };
  const read = (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error('ENOENT: no such file');
    return content;
  };

  it('fills NAME from NAME_FILE and strips the trailing newline', () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_FILE: '/run/secrets/jwt', MONGODB_URI_FILE: '/run/secrets/uri' };
    expect(loadFileSecrets(env, read).sort()).toEqual(['JWT_SECRET', 'MONGODB_URI']);
    expect(env.JWT_SECRET).toBe('long-secret-value');
    expect(env.MONGODB_URI).toBe('mongodb://u:p@mongo/revamp');
  });

  it('treats an empty NAME as unset, since env_file may inject an empty value', () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET: '', JWT_SECRET_FILE: '/run/secrets/jwt' };
    loadFileSecrets(env, read);
    expect(env.JWT_SECRET).toBe('long-secret-value');
  });

  it('never overrides a value that is already set', () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET: 'from-env', JWT_SECRET_FILE: '/run/secrets/jwt' };
    expect(loadFileSecrets(env, read)).toEqual([]);
    expect(env.JWT_SECRET).toBe('from-env');
  });

  it('fails clearly when the file cannot be read', () => {
    expect(() => loadFileSecrets({ JWT_SECRET_FILE: '/run/secrets/missing' }, read)).toThrow('JWT_SECRET_FILE points to /run/secrets/missing, which cannot be read');
  });

  it('ignores an empty path and variables that only look similar', () => {
    const env: NodeJS.ProcessEnv = { JWT_SECRET_FILE: '', _FILE: '/x', OTHER: 'y' };
    expect(loadFileSecrets(env, read)).toEqual([]);
  });
});
