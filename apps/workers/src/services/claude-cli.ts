import { spawn } from 'child_process';
import os from 'os';

export interface ClaudeCliRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface ClaudeCliOptions {
  /** Path to the `claude` executable */
  cliPath: string;
  /** Model alias or full model id passed to `--model` */
  model: string;
  timeoutMs: number;
}

export type ClaudeCliRunner = (request: ClaudeCliRequest) => Promise<string>;

/**
 * Arguments for a locked-down, single-turn headless run: no tools, no MCP servers,
 * no user/project settings and nothing saved to disk. The user prompt goes through stdin.
 */
export function buildClaudeCliArgs(systemPrompt: string, model: string): string[] {
  return [
    '-p',
    '--output-format',
    'json',
    '--model',
    model,
    '--system-prompt',
    systemPrompt,
    '--tools',
    '',
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--disable-slash-commands',
  ];
}

/**
 * Reads the model's text from the CLI's `--output-format json` result envelope.
 */
export function parseClaudeCliOutput(stdout: string): string {
  let envelope: { is_error?: boolean; result?: unknown; subtype?: string };
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Claude CLI returned non-JSON output: ${stdout.slice(0, 200)}`);
  }

  if (envelope.is_error) {
    throw new Error(`Claude CLI reported an error (${envelope.subtype ?? 'unknown'}): ${String(envelope.result ?? '')}`);
  }
  if (typeof envelope.result !== 'string') {
    throw new Error('Claude CLI output did not contain a result string.');
  }
  return envelope.result;
}

/**
 * Creates a runner that calls the local Claude Code CLI with the account it is logged into.
 */
export function createClaudeCliRunner(options: ClaudeCliOptions): ClaudeCliRunner {
  return ({ systemPrompt, userPrompt }) =>
    new Promise((resolve, reject) => {
      // A temp cwd keeps the CLI from picking up this repository's CLAUDE.md / AGENTS.md
      const child = spawn(options.cliPath, buildClaudeCliArgs(systemPrompt, options.model), {
        cwd: os.tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (err: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(value ?? '');
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new Error(`Claude CLI timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (err) => finish(new Error(`Failed to start Claude CLI (${options.cliPath}): ${err.message}`)));
      child.on('close', (code) => {
        if (code !== 0) {
          // On failure the CLI may print its JSON envelope (e.g. "Not logged in") to stdout
          const reason = stderr.trim() || stdout.trim();
          finish(new Error(`Claude CLI exited with code ${code}: ${reason.slice(0, 500)}`));
          return;
        }
        try {
          finish(null, parseClaudeCliOutput(stdout));
        } catch (err) {
          finish(err as Error);
        }
      });

      // Ignore EPIPE when the process exits before reading stdin; 'close' reports the failure
      child.stdin.on('error', () => undefined);
      child.stdin.end(userPrompt);
    });
}
