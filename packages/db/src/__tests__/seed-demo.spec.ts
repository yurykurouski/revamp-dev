import { describe, expect, it } from 'vitest';
import { assertLocalSeedTarget } from '../seed/seed-demo.js';

describe('assertLocalSeedTarget (REV-199)', () => {
  it.each([
    'mongodb://revamp_app:secret@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true',
    'mongodb://127.0.0.1:27017/revamp',
    'mongodb://[::1]:27017/revamp',
    'mongodb://mongo:27017/revamp',
    'mongodb://localhost:27017,127.0.0.1:27018/revamp?replicaSet=rs0',
  ])('accepts the local database %s', (uri) => {
    expect(() => assertLocalSeedTarget(uri, 'development')).not.toThrow();
    expect(() => assertLocalSeedTarget(uri, undefined)).not.toThrow();
  });

  it.each([
    'mongodb+srv://user:pass@cluster0.abcde.mongodb.net/revamp_prod',
    'mongodb://db.example.net:27017/revamp',
    'mongodb://localhost:27017,remote.host:27017/revamp',
    'mongodb://localhost.evil.net/revamp',
    'mongodb://user:pass@/revamp',
    '',
    'not a uri',
  ])('refuses %s', (uri) => {
    expect(() => assertLocalSeedTarget(uri, 'development')).toThrow();
  });

  it('refuses a local database when NODE_ENV is production', () => {
    expect(() => assertLocalSeedTarget('mongodb://localhost:27017/revamp', 'production')).toThrow(/production/);
  });

  it('never prints the password in its reason', () => {
    expect(() => assertLocalSeedTarget('mongodb://u:topsecret@db.example.net/revamp', 'development')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('topsecret') }),
    );
  });
});
