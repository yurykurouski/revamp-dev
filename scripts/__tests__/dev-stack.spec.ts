import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs helper without type declarations (it runs before `npm install`)
import * as stack from '../lib/dev-stack.mjs';

const {
  APPS,
  SetupError,
  appPrefix,
  checkDocker,
  checkNodeVersion,
  ensureEnvFile,
  isPortInUse,
  llmAdvice,
  parseEnv,
  prefixLines,
  stalePackages,
} = stack;

describe('checkNodeVersion', () => {
  it('accepts Node 20 and newer', () => {
    expect(checkNodeVersion('v20.0.0')).toBe(20);
    expect(checkNodeVersion('v22.21.1')).toBe(22);
    expect(checkNodeVersion('24.1.0')).toBe(24);
  });

  it('rejects older or unparseable versions with a hint', () => {
    for (const version of ['v18.19.0', 'v19.9.9', 'garbage', '']) {
      try {
        checkNodeVersion(version);
        expect.unreachable(`accepted ${version}`);
      } catch (error: any) {
        expect(error).toBeInstanceOf(SetupError);
        expect(error.message).toContain('Node.js 20+');
        expect(error.hint).toContain('nodejs.org');
      }
    }
  });
});

describe('checkDocker', () => {
  const runner = (failing: Record<string, number | 'missing'>) => (cmd: string, args: string[]) => {
    const key = [cmd, ...args].join(' ');
    const outcome = failing[key];
    if (outcome === 'missing') return { status: null, error: new Error('ENOENT') };
    return { status: outcome ?? 0 };
  };

  it('passes when the CLI, compose and the daemon respond', () => {
    expect(() => checkDocker(runner({}))).not.toThrow();
  });

  it('explains a missing Docker CLI', () => {
    expect(() => checkDocker(runner({ 'docker --version': 'missing' }))).toThrow(/not installed/);
  });

  it('explains a missing compose plugin', () => {
    expect(() => checkDocker(runner({ 'docker compose version': 1 }))).toThrow(/Compose v2/);
  });

  it('explains a stopped daemon', () => {
    expect(() => checkDocker(runner({ 'docker info': 1 }))).toThrow(/not running/);
  });

  it('gives up on a daemon that does not answer, with a timeout', () => {
    const calls: unknown[] = [];
    const run = (_cmd: string, args: string[], options?: { timeout?: number }) => {
      calls.push(options);
      if (args[0] !== 'info') return { status: 0 };
      return { status: null, error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }) };
    };
    expect(() => checkDocker(run)).toThrow(/did not answer within 20 s/);
    expect(calls).toContainEqual({ timeout: 20000 });
  });

  it("passes the daemon's own error on in the hint", () => {
    const run = (cmd: string, args: string[]) =>
      args[0] === 'info'
        ? { status: 1, stderr: 'Server:\nERROR: Error response from daemon: Docker Desktop is unable to start\n' }
        : { status: 0 };
    try {
      checkDocker(run);
      expect.unreachable();
    } catch (error: any) {
      expect(error.hint).toContain('Docker says: ERROR: Error response from daemon: Docker Desktop is unable to start');
      expect(error.hint).toContain('restart');
    }
  });
});

describe('parseEnv', () => {
  it('reads plain, quoted, empty and exported values and skips comments', () => {
    const env = parseEnv(
      [
        '# comment',
        'PORT=4000',
        'EMPTY=',
        'EMAIL_FROM="Revamp Team <outreach@revampdemo.com>"',
        "SINGLE='a b'",
        'export EXPORTED=yes',
        'INLINE=value # trailing comment',
        'HASH_IN_QUOTES="a # b"',
        'not a line',
      ].join('\n'),
    );
    expect(env).toEqual({
      PORT: '4000',
      EMPTY: '',
      EMAIL_FROM: 'Revamp Team <outreach@revampdemo.com>',
      SINGLE: 'a b',
      EXPORTED: 'yes',
      INLINE: 'value',
      HASH_IN_QUOTES: 'a # b',
    });
  });

  it('handles CRLF line endings', () => {
    expect(parseEnv('A=1\r\nB=2\r\n')).toEqual({ A: '1', B: '2' });
  });
});

describe('llmAdvice', () => {
  it('lists the providers with a key, then the CLI, with no warning', () => {
    expect(llmAdvice({ ANTHROPIC_API_KEY: 'sk', OPENAI_API_KEY: '', GEMINI_API_KEY: 'g' }, true)).toEqual({
      providers: ['anthropic', 'gemini', 'claude-cli'],
      warnings: [],
    });
  });

  it('warns when nothing is configured', () => {
    const { providers, warnings } = llmAdvice({ ANTHROPIC_API_KEY: '' }, false);
    expect(providers).toEqual([]);
    expect(warnings[0]).toMatch(/No LLM provider/);
    expect(warnings.join(' ')).toContain('MVP_LLM_PROVIDER=claude-cli');
  });

  it('asks for MVP_LLM_PROVIDER when the CLI is the only provider', () => {
    const { providers, warnings } = llmAdvice({ MVP_LLM_PROVIDER: '' }, true);
    expect(providers).toEqual(['claude-cli']);
    expect(warnings).toEqual([expect.stringContaining('MVP_LLM_PROVIDER=claude-cli')]);
  });

  it('is satisfied by the CLI once MVP_LLM_PROVIDER picks it', () => {
    expect(llmAdvice({ MVP_LLM_PROVIDER: 'claude-cli' }, true).warnings).toEqual([]);
  });
});

describe('file helpers', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev95-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('ensureEnvFile copies .env.example once and never overwrites .env', () => {
    fs.writeFileSync(path.join(root, '.env.example'), 'PORT=4000\n');
    expect(ensureEnvFile(root)).toBe(true);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('PORT=4000\n');

    fs.writeFileSync(path.join(root, '.env'), 'PORT=5000\n');
    expect(ensureEnvFile(root)).toBe(false);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toBe('PORT=5000\n');
  });

  const writePackage = (name: string, { built, srcAge, distAge }: { built: boolean; srcAge: number; distAge: number }) => {
    const dir = path.join(root, 'packages', name);
    fs.mkdirSync(path.join(dir, 'src', 'nested'), { recursive: true });
    const src = path.join(dir, 'src', 'nested', 'index.ts');
    const pkg = path.join(dir, 'package.json');
    fs.writeFileSync(src, 'export {};');
    fs.writeFileSync(pkg, '{}');
    const now = Date.now() / 1000;
    fs.utimesSync(pkg, now - 1000, now - 1000);
    fs.utimesSync(src, now - srcAge, now - srcAge);
    if (built) {
      fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
      const dist = path.join(dir, 'dist', 'index.js');
      fs.writeFileSync(dist, '');
      fs.utimesSync(dist, now - distAge, now - distAge);
    }
  };

  it('stalePackages flags missing or outdated dist and skips fresh builds', () => {
    writePackage('fresh', { built: true, srcAge: 100, distAge: 10 });
    writePackage('missing', { built: false, srcAge: 100, distAge: 0 });
    writePackage('outdated', { built: true, srcAge: 10, distAge: 100 });
    expect(stalePackages(root, ['fresh', 'missing', 'outdated'])).toEqual(['missing', 'outdated']);
  });

  it('stalePackages flags a package.json changed after the build', () => {
    writePackage('pkg', { built: true, srcAge: 5000, distAge: 2000 });
    expect(stalePackages(root, ['pkg'])).toEqual(['pkg']);
  });
});

describe('prefixLines', () => {
  it('prefixes complete lines and carries the unfinished tail', () => {
    const first = prefixLines('[api]', 'one\ntwo\npar');
    expect(first).toEqual({ text: '[api] one\n[api] two\n', rest: 'par' });
    const second = prefixLines('[api]', 'tial\r\n', first.rest);
    expect(second).toEqual({ text: '[api] partial\n', rest: '' });
  });

  it('keeps empty lines', () => {
    expect(prefixLines('[w]', '\n\n').text).toBe('[w] \n[w] \n');
  });
});

describe('appPrefix', () => {
  it('pads every app name to the same width', () => {
    const plain = APPS.map((app: (typeof APPS)[number]) => appPrefix(app).replace(/\x1b\[[0-9;]*m/g, ''));
    expect(plain).toEqual(['[api      ]', '[workers  ]', '[dashboard]']);
  });
});

describe('isPortInUse', () => {
  it('detects a listening port and a free one', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await isPortInUse(port)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(await isPortInUse(port)).toBe(false);
  });
});

describe('MongoDB users in .env (REV-198)', () => {
  let root: string;
  const passwords = ['root-pw', 'app-pw', 'read-pw', 'admin-pw'];
  const sequence = () => {
    let i = 0;
    return () => passwords[i++];
  };
  const envFile = () => path.join(root, '.env');
  const readEnv = () => stack.parseEnv(fs.readFileSync(envFile(), 'utf8'));

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev198-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('mongoUri builds the revamp_app URI and encodes the password', () => {
    expect(stack.mongoUri('u', 'a/b@c')).toBe(
      'mongodb://u:a%2Fb%40c@localhost:27017/revamp?authSource=admin&replicaSet=rs0&directConnection=true',
    );
  });

  it('adds missing passwords and the app URI to an existing .env', () => {
    fs.writeFileSync(envFile(), 'PORT=4000\nMONGODB_URI=mongodb://localhost:27017/revamp\n');
    const result = stack.ensureMongoSecrets(root, sequence());
    expect(result.added).toEqual(stack.MONGO_PASSWORD_VARS);
    expect(result.uriUpdated).toBe(true);
    const env = readEnv();
    expect(env.PORT).toBe('4000');
    expect(env.MONGO_APP_PASSWORD).toBe('app-pw');
    expect(env.MONGODB_URI).toBe(stack.mongoUri('revamp_app', 'app-pw'));
  });

  it('fills empty values copied from .env.example', () => {
    fs.writeFileSync(envFile(), 'MONGODB_URI=\nMONGO_ROOT_PASSWORD=\nMONGO_APP_PASSWORD=\n');
    stack.ensureMongoSecrets(root, sequence());
    const env = readEnv();
    expect(env.MONGO_ROOT_PASSWORD).toBe('root-pw');
    expect(env.MONGO_ADMIN_PASSWORD).toBe('admin-pw');
    expect(env.MONGODB_URI).toBe(stack.mongoUri('revamp_app', 'app-pw'));
    expect(fs.readFileSync(envFile(), 'utf8').match(/^MONGO_APP_PASSWORD=/gm)).toHaveLength(1);
  });

  it('is idempotent', () => {
    fs.writeFileSync(envFile(), 'MONGODB_URI=mongodb://localhost:27017/revamp\n');
    stack.ensureMongoSecrets(root, sequence());
    const before = fs.readFileSync(envFile(), 'utf8');
    expect(stack.ensureMongoSecrets(root, () => 'never')).toEqual({ added: [], uriUpdated: false });
    expect(fs.readFileSync(envFile(), 'utf8')).toBe(before);
  });

  it('keeps a custom URI and warns', () => {
    const custom = 'mongodb+srv://x@cluster0.example.net/revamp';
    fs.writeFileSync(envFile(), `MONGODB_URI=${custom}\n`);
    const result = stack.ensureMongoSecrets(root, sequence());
    expect(readEnv().MONGODB_URI).toBe(custom);
    expect(result.uriUpdated).toBe(false);
    expect(result.warning).toContain('MONGODB_URI');
    expect(result.warning).toContain('revamp_app');
  });

  it('keeps existing passwords', () => {
    fs.writeFileSync(envFile(), 'MONGODB_URI=mongodb://localhost:27017/revamp\nMONGO_APP_PASSWORD=keep\n');
    const result = stack.ensureMongoSecrets(root, () => 'generated');
    expect(result.added).not.toContain('MONGO_APP_PASSWORD');
    expect(readEnv().MONGO_APP_PASSWORD).toBe('keep');
    expect(readEnv().MONGODB_URI).toBe(stack.mongoUri('revamp_app', 'keep'));
  });
});

describe('ensureMongoReady (REV-198)', () => {
  const env = {
    MONGO_ROOT_PASSWORD: 'r',
    MONGO_APP_PASSWORD: 'a',
    MONGO_READ_PASSWORD: 'x',
    MONGO_ADMIN_PASSWORD: 'd',
  };
  const recorder = (result: { status: number; stderr?: string }) => {
    const calls: Array<{ cmd: string; args: string[]; options: any }> = [];
    const run = (cmd: string, args: string[], options: any) => {
      calls.push({ cmd, args, options });
      return result;
    };
    return { calls, run };
  };

  it('runs ensure-ready.js in the mongo container without passwords in argv', () => {
    const { calls, run } = recorder({ status: 0 });
    stack.ensureMongoReady('/repo', env, run);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('docker');
    expect(calls[0].args).toEqual([
      'compose', 'exec', '-T',
      '-e', 'MONGO_ROOT_PASSWORD', '-e', 'MONGO_APP_PASSWORD', '-e', 'MONGO_READ_PASSWORD', '-e', 'MONGO_ADMIN_PASSWORD',
      'mongo', 'mongosh', '--quiet', '--norc', '/revamp-scripts/ensure-ready.js',
    ]);
    for (const arg of calls[0].args) {
      expect(arg).not.toContain('=');
      expect(Object.values(env)).not.toContain(arg);
    }
    expect(calls[0].options.env.MONGO_APP_PASSWORD).toBe('a');
    expect(calls[0].options.cwd).toBe('/repo');
  });

  it('maps exit 2 to a root-password hint', () => {
    const { run } = recorder({ status: stack.ENSURE_READY_EXIT.rootPasswordMismatch });
    try {
      stack.ensureMongoReady('/repo', env, run);
      expect.unreachable('did not throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(SetupError);
      expect(error.message).toContain('MONGO_ROOT_PASSWORD');
      expect(error.hint).toContain('docker compose down -v');
      expect(error.hint).toContain('deletes');
    }
  });

  it('maps any other failure to a SetupError with mongosh stderr', () => {
    const { run } = recorder({ status: 1, stderr: 'MongoServerError: boom' });
    expect(() => stack.ensureMongoReady('/repo', env, run)).toThrow(SetupError);
    try {
      stack.ensureMongoReady('/repo', env, run);
    } catch (error: any) {
      expect(error.hint).toContain('MongoServerError: boom');
    }
  });

  it('refuses to run with a missing password', () => {
    const { calls, run } = recorder({ status: 0 });
    const { MONGO_READ_PASSWORD: _omit, ...partial } = env;
    expect(() => stack.ensureMongoReady('/repo', partial, run)).toThrow(/npm run setup/);
    expect(calls).toHaveLength(0);
  });
});
