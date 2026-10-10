import { spawn } from 'child_process';
import os from 'os';

export interface ClaudeCliRequest {
  systemPrompt: string;
  userPrompt: string;
  /** Overrides the runner's model for this call (REV-32) */
  model?: string;
  /** A longer timeout for this call (REV-137); never shortens the runner's own */
  timeoutMs?: number;
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

/** A screenshot sent to the CLI as an image content block (REV-51) */
export interface ClaudeCliImage {
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg';
  data: Buffer;
}

export interface ClaudeCliVisionRequest {
  systemPrompt: string;
  userPrompt: string;
  images: ClaudeCliImage[];
  model?: string;
  /** A longer timeout for this call (REV-137); never shortens the runner's own */
  timeoutMs?: number;
}

export interface ClaudeCliUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ClaudeCliVisionResult {
  text: string;
  /** Undefined when the CLI reports no token counts */
  usage?: ClaudeCliUsage;
}

export type ClaudeCliVisionRunner = (request: ClaudeCliVisionRequest) => Promise<ClaudeCliVisionResult>;

/**
 * Same locked-down run as `buildClaudeCliArgs`, but the prompt arrives as one stream-json user
 * message so it can carry image blocks. The CLI requires stream-json output (and --verbose) then.
 */
export function buildClaudeCliVisionArgs(systemPrompt: string, model: string): string[] {
  const args = buildClaudeCliArgs(systemPrompt, model);
  args.splice(args.indexOf('json'), 1, 'stream-json');
  return [...args, '--input-format', 'stream-json', '--verbose'];
}

/** The single stream-json line that carries the text prompt followed by the images */
export function buildClaudeCliVisionInput(userPrompt: string, images: ClaudeCliImage[]): string {
  const content = [
    { type: 'text', text: userPrompt },
    ...images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data.toString('base64') },
    })),
  ];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

/**
 * Reads the final `result` event from `--output-format stream-json` output, with its token usage.
 */
export function parseClaudeCliStreamOutput(stdout: string): ClaudeCliVisionResult {
  const resultLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => {
      try {
        return (JSON.parse(line) as { type?: string }).type === 'result';
      } catch {
        return false;
      }
    });
  if (!resultLine) {
    throw new Error(`Claude CLI stream did not contain a result event: ${stdout.slice(0, 200)}`);
  }

  const text = parseClaudeCliOutput(resultLine);
  const usage = (
    JSON.parse(resultLine) as {
      usage?: {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        output_tokens?: number;
      };
    }
  ).usage;
  // The CLI caches its prompts, so most input tokens are reported under the cache fields
  const promptTokens =
    (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
  const completionTokens = usage?.output_tokens ?? 0;
  return promptTokens || completionTokens
    ? { text, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } }
    : { text };
}

/**
 * Runs the CLI once with the given arguments and stdin, and resolves with its stdout.
 */
function runClaudeCli(options: ClaudeCliOptions, args: string[], stdin: string, callTimeoutMs?: number): Promise<string> {
  const timeoutMs = Math.max(options.timeoutMs, callTimeoutMs ?? 0);
  return new Promise((resolve, reject) => {
    // A temp cwd keeps the CLI from picking up this repository's CLAUDE.md / AGENTS.md
    const child = spawn(options.cliPath, args, {
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
      finish(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

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
      finish(null, stdout);
    });

    // Ignore EPIPE when the process exits before reading stdin; 'close' reports the failure
    child.stdin.on('error', () => undefined);
    child.stdin.end(stdin);
  });
}

/**
 * Creates a runner that calls the local Claude Code CLI with the account it is logged into.
 */
export function createClaudeCliRunner(options: ClaudeCliOptions): ClaudeCliRunner {
  return async ({ systemPrompt, userPrompt, model, timeoutMs }) =>
    parseClaudeCliOutput(await runClaudeCli(options, buildClaudeCliArgs(systemPrompt, model ?? options.model), userPrompt, timeoutMs));
}

/**
 * Creates a runner that sends a prompt with images to the local Claude Code CLI (REV-51).
 */
export function createClaudeCliVisionRunner(options: ClaudeCliOptions): ClaudeCliVisionRunner {
  return async ({ systemPrompt, userPrompt, images, model, timeoutMs }) =>
    parseClaudeCliStreamOutput(
      await runClaudeCli(
        options,
        buildClaudeCliVisionArgs(systemPrompt, model ?? options.model),
        buildClaudeCliVisionInput(userPrompt, images),
        timeoutMs,
      ),
    );
}
