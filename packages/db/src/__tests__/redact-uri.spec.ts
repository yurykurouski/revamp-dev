import { describe, expect, it } from 'vitest';
import { redactMongoUri } from '../redact-uri.js';

describe('redactMongoUri (REV-198)', () => {
  it('hides the password and keeps the user, host and options', () => {
    expect(
      redactMongoUri(
        'mongodb://revamp_app:s3cr3t-Pw_x@localhost:27017/revamp?authSource=admin&replicaSet=rs0',
      ),
    ).toBe('mongodb://revamp_app:***@localhost:27017/revamp?authSource=admin&replicaSet=rs0');
  });

  it('hides the password of an Atlas SRV URI', () => {
    expect(redactMongoUri('mongodb+srv://prod:p%40ss@cluster0.example.net/revamp')).toBe(
      'mongodb+srv://prod:***@cluster0.example.net/revamp',
    );
  });

  it('hides the password with several hosts', () => {
    expect(redactMongoUri('mongodb://u:pw@a:1,b:2/revamp')).toBe('mongodb://u:***@a:1,b:2/revamp');
  });

  it('leaves a URI without credentials unchanged', () => {
    expect(redactMongoUri('mongodb://localhost:27017/revamp')).toBe(
      'mongodb://localhost:27017/revamp',
    );
  });

  it('never echoes a value that is not a MongoDB URI', () => {
    expect(redactMongoUri('user:secret@host')).toBe('<not a MongoDB URI>');
  });
});

describe('MongoDB URI in logs (REV-198)', () => {
  const root = new URL('../../../../', import.meta.url);
  const files = ['apps/api/src/index.ts', 'apps/workers/src/index.ts', 'scripts/crawl_live.ts'];

  it.each(files)('%s logs the URI only through redactMongoUri', async (file) => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL(file, root), 'utf8');
    const logLines = source
      .split('\n')
      .filter(
        (line) => /console\.(log|info|warn|error)/.test(line) && line.includes('MONGODB_URI'),
      );
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) expect(line).toContain('redactMongoUri(env.MONGODB_URI)');
  });
});
