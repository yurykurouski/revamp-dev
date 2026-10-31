import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

// REV-177: the GitHub Actions pipeline runs the local gates on every PR and deploys main.
const rootDir = path.resolve(__dirname, '../..');
const workflowPath = path.join(rootDir, '.github/workflows/ci.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  needs?: string | string[];
  if?: string;
  steps: Step[];
  environment?: string | { name: string };
  concurrency?: unknown;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}

const readWorkflow = (): { raw: string; wf: Workflow } => {
  const raw = fs.readFileSync(workflowPath, 'utf-8');
  return { raw, wf: parse(raw) as Workflow };
};

const rootScripts = (): Record<string, string> =>
  (JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as { scripts: Record<string, string> })
    .scripts;

const runs = (job: Job): string[] => job.steps.flatMap((s) => (s.run ? [s.run] : []));

describe('CI/CD workflow (.github/workflows/ci.yml, REV-177)', () => {
  it('exists and parses as YAML', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const { wf } = readWorkflow();
    expect(wf.jobs).toBeTypeOf('object');
  });

  it('runs on every pull request, on push to main and on manual dispatch', () => {
    const { wf } = readWorkflow();
    expect(wf.on).toHaveProperty('pull_request');
    expect(wf.on).toHaveProperty('workflow_dispatch');
    expect((wf.on.push as { branches: string[] }).branches).toEqual(['main']);
  });

  it('grants the token read-only repository access by default', () => {
    const { wf } = readWorkflow();
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('has a gates job with a stable name for the required status check', () => {
    const { wf } = readWorkflow();
    expect(wf.jobs.gates?.name).toBe('Gates');
  });

  it('runs the local gates in order: build:packages, typecheck, lint, test, build', () => {
    const { wf } = readWorkflow();
    const commands = runs(wf.jobs.gates).filter((r) => r.startsWith('npm '));
    expect(commands).toEqual([
      'npm ci',
      'npm run build:packages',
      'npm run typecheck',
      'npm run lint',
      'npm test',
      'npm run build',
    ]);
  });

  it('installs the Playwright Chromium the browser tests need before running them', () => {
    const { wf } = readWorkflow();
    const all = runs(wf.jobs.gates);
    const install = all.findIndex((r) => r.includes('playwright install') && r.includes('chromium'));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(install).toBeLessThan(all.indexOf('npm test'));
  });

  it('references only npm scripts that exist in the root package.json', () => {
    const { raw } = readWorkflow();
    const scripts = rootScripts();
    const referenced = [...raw.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) expect(scripts, `npm run ${name}`).toHaveProperty(name);
  });

  it('deploys only after the gates pass, only from main, never on a pull request', () => {
    const { wf } = readWorkflow();
    const deploy = wf.jobs.deploy;
    expect(deploy).toBeDefined();
    expect(deploy.needs).toBe('gates');
    expect(deploy.if).toContain("github.ref == 'refs/heads/main'");
    expect(deploy.if).toContain("github.event_name == 'push'");
    expect(deploy.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(deploy.if).not.toContain('pull_request');
    expect(deploy.environment).toBe('production');
    expect(deploy.concurrency).toBeDefined();
  });

  it('builds the production Docker images and deploys with deploy/deploy.sh', () => {
    const { wf } = readWorkflow();
    const commands = runs(wf.jobs.deploy).join('\n');
    expect(commands).toContain('docker compose -f docker-compose.prod.yml build');
    expect(commands).toContain('./deploy/deploy.sh --skip-pull');
    // The server is moved to exactly the commit whose gates passed.
    expect(commands).toContain('git merge --ff-only');
    expect(commands).toContain('GITHUB_SHA');
    expect(fs.existsSync(path.join(rootDir, 'deploy/deploy.sh'))).toBe(true);
  });

  it('checks the host key instead of trusting any server', () => {
    const { raw } = readWorkflow();
    expect(raw).toContain('known_hosts');
    expect(raw).not.toMatch(/StrictHostKeyChecking\s*=?\s*no/i);
  });

  it('reads every secret from GitHub secrets and holds no secret literal', () => {
    const { raw } = readWorkflow();
    const secretRefs = [...raw.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    expect(new Set(secretRefs)).toEqual(new Set(['DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_SSH_KEY', 'DEPLOY_KNOWN_HOSTS']));

    const literals: RegExp[] = [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\bsk-[A-Za-z0-9_-]{16,}/,
      /\bre_[A-Za-z0-9]{16,}/,
      /\bgh[pousr]_[A-Za-z0-9]{20,}/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /mongodb(\+srv)?:\/\/[^\s'"]*:[^\s'"]*@/,
      /rediss?:\/\/[^\s'"]*:[^\s'"]*@/,
      /(password|secret|token|api_key)\s*[:=]\s*['"]?[A-Za-z0-9/+_-]{8,}/i,
    ];
    for (const pattern of literals) expect(raw, String(pattern)).not.toMatch(pattern);
  });

  it('never writes the production env file from the workflow (it lives on the server)', () => {
    const { raw } = readWorkflow();
    expect(raw).not.toMatch(/>\s*\.env\.production\b/);
  });
});
