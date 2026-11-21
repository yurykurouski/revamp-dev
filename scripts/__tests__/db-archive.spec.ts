import { describe, expect, it } from 'vitest';
import { archiveCommand, archiveContainer, parseArchiveArgs } from '../db-archive.js';

const URI = 'mongodb://revamp_app:s3cr%40t@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true';

describe('archiveCommand (REV-199)', () => {
  it('dumps the database of the URI through mongodump in the container', () => {
    const { args, env } = archiveCommand('dump', { uri: URI, drop: false, container: 'revamp-mongo' });
    expect(args.slice(0, 2)).toEqual(['exec', '-i']);
    expect(args).toContain('revamp-mongo');
    const script = args[args.length - 1]!;
    expect(script).toContain('mongodump');
    expect(script).toContain('--archive --gzip');
    expect(env).toMatchObject({ RV_DB: 'revamp', RV_USER: 'revamp_app', RV_AUTH_DB: 'admin', RV_PASSWORD: 's3cr@t' });
  });

  it('never puts the password in argv', () => {
    for (const mode of ['dump', 'restore'] as const) {
      const { args } = archiveCommand(mode, { uri: URI, drop: true, container: 'revamp-mongo' });
      expect(args.join(' ')).not.toMatch(/s3cr/);
    }
  });

  it('drops collections on restore only when asked', () => {
    const plain = archiveCommand('restore', { uri: URI, drop: false, container: 'revamp-mongo' }).args.join(' ');
    const dropping = archiveCommand('restore', { uri: URI, drop: true, container: 'revamp-mongo' }).args.join(' ');
    expect(plain).toContain('mongorestore');
    expect(plain).not.toContain('--drop');
    expect(dropping).toContain('--drop');
  });

  it('connects without credentials when the URI has none', () => {
    const { args, env } = archiveCommand('dump', { uri: 'mongodb://localhost:27217/demo', drop: false, container: 'other' });
    expect(env).toMatchObject({ RV_DB: 'demo', RV_USER: '', RV_PASSWORD: '' });
    expect(args).toContain('other');
  });
});

describe('parseArchiveArgs (REV-199)', () => {
  it('names a timestamped file in backups/ for a dump without a path', () => {
    const parsed = parseArchiveArgs(['dump'], 'revamp', new Date('2026-11-21T12:34:56Z'));
    expect(parsed).toEqual({ mode: 'dump', file: 'backups/revamp-20261121-123456.archive.gz', drop: false });
  });

  it('takes a dump path and a restore file with --drop', () => {
    expect(parseArchiveArgs(['dump', 'x.gz'], 'revamp', new Date())).toMatchObject({ file: 'x.gz' });
    expect(parseArchiveArgs(['restore', 'x.gz', '--drop'], 'revamp', new Date())).toEqual({ mode: 'restore', file: 'x.gz', drop: true });
  });

  it('refuses a restore without a file and an unknown mode', () => {
    expect(() => parseArchiveArgs(['restore'], 'revamp', new Date())).toThrow(/file/);
    expect(() => parseArchiveArgs(['wipe'], 'revamp', new Date())).toThrow(/dump|restore/);
  });
});

describe('archiveContainer (review I2)', () => {
  it('uses revamp-mongo for the default port', () => {
    expect(archiveContainer(URI, undefined)).toBe('revamp-mongo');
    expect(archiveContainer('mongodb://localhost/revamp', undefined)).toBe('revamp-mongo');
  });

  it('refuses another port unless MONGO_CONTAINER names the container', () => {
    const other = 'mongodb://revamp_app:pw@localhost:27117/revamp?replicaSet=rs0';
    expect(() => archiveContainer(other, undefined)).toThrow(/27117.*MONGO_CONTAINER/);
    expect(() => archiveContainer(other, '')).toThrow(/MONGO_CONTAINER/);
    expect(archiveContainer(other, 'revamp-check-mongo')).toBe('revamp-check-mongo');
  });
});
