import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildClaudeCliArgs, createClaudeCliRunner, parseClaudeCliOutput } from '../claude-cli.js';

/**
 * A stand-in `claude` executable. FAKE_CLAUDE_MODE picks its behavior; in "echo" mode it
 * returns the arguments and stdin it received as the result string.
 */
const FAKE_CLI_SOURCE = `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLAUDE_MODE || 'echo';
  if (mode === 'echo') {
    const result = JSON.stringify({ args: process.argv.slice(2), stdin: input, cwd: process.cwd() });
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result }));
  } else if (mode === 'error-envelope') {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Not logged in' }));
  } else if (mode === 'exit-1') {
    process.stderr.write('boom');
    process.exit(1);
  } else if (mode === 'garbage') {
    process.stdout.write('not json at all');
  } else if (mode === 'hang') {
    setTimeout(() => {}, 60000);
  }
});
`;

describe('Claude CLI runner (REV-30)', () => {
  let dir: string;
  let fakeCli: string;
  const originalMode = process.env.FAKE_CLAUDE_MODE;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    fakeCli = path.join(dir, 'claude');
    fs.writeFileSync(fakeCli, FAKE_CLI_SOURCE, { mode: 0o755 });
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (originalMode === undefined) delete process.env.FAKE_CLAUDE_MODE;
    else process.env.FAKE_CLAUDE_MODE = originalMode;
  });

  const runWith = (mode: string, timeoutMs = 10000) => {
    process.env.FAKE_CLAUDE_MODE = mode;
    const runner = createClaudeCliRunner({ cliPath: fakeCli, model: 'sonnet', timeoutMs });
    return runner({ systemPrompt: 'SYSTEM', userPrompt: '{"businessName":"Cafe; rm -rf /"}' });
  };

  it('builds a locked-down headless argument list', () => {
    const args = buildClaudeCliArgs('SYSTEM', 'opus');
    expect(args).toEqual([
      '-p',
      '--output-format',
      'json',
      '--model',
      'opus',
      '--system-prompt',
      'SYSTEM',
      '--tools',
      '',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence',
      '--disable-slash-commands',
    ]);
  });

  it('sends the user prompt through stdin and returns the result string', async () => {
    const received = JSON.parse(await runWith('echo'));
    expect(received.stdin).toBe('{"businessName":"Cafe; rm -rf /"}');
    expect(received.args).toEqual(buildClaudeCliArgs('SYSTEM', 'sonnet'));
    // Runs outside the repository so project instructions are not loaded
    expect(fs.realpathSync(received.cwd)).toBe(fs.realpathSync(os.tmpdir()));
  });

  it('rejects when the CLI reports an error in its envelope', async () => {
    await expect(runWith('error-envelope')).rejects.toThrow(/error_during_execution.*Not logged in/);
  });

  it('rejects with stderr when the CLI exits with a non-zero code', async () => {
    await expect(runWith('exit-1')).rejects.toThrow(/exited with code 1: boom/);
  });

  it('rejects when the CLI prints non-JSON output', async () => {
    await expect(runWith('garbage')).rejects.toThrow(/non-JSON output/);
  });

  it('kills the CLI and rejects after the timeout', async () => {
    await expect(runWith('hang', 300)).rejects.toThrow(/timed out after 300ms/);
  });

  it('rejects when the executable does not exist', async () => {
    const runner = createClaudeCliRunner({
      cliPath: path.join(dir, 'missing-claude'),
      model: 'sonnet',
      timeoutMs: 5000,
    });
    await expect(runner({ systemPrompt: 'S', userPrompt: 'U' })).rejects.toThrow(/Failed to start Claude CLI/);
  });

  describe('parseClaudeCliOutput', () => {
    it('returns the result of a successful envelope', () => {
      expect(parseClaudeCliOutput('{"is_error":false,"result":"{\\"a\\":1}"}\n')).toBe('{"a":1}');
    });

    it('rejects an envelope without a result string', () => {
      expect(() => parseClaudeCliOutput('{"is_error":false}')).toThrow(/did not contain a result/);
    });
  });
});
