import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** REV-219: the Containers section of the README stays in step with the environment templates and the compose files */
describe('README › Containers', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf-8');
  const start = readme.indexOf('\n## Containers\n');
  const end = readme.indexOf('\n## CI/CD\n');
  const section = readme.slice(start, end);

  const keysOf = (file: string): string[] =>
    [...fs.readFileSync(path.join(rootDir, file), 'utf-8').matchAll(/^[#\s]*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] ?? '');

  it('has the section before CI/CD', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it.each(['.env.example', '.env.production.example'])('documents every variable of %s in the environment table', (file) => {
    const keys = [...new Set(keysOf(file))];
    expect(keys.length).toBeGreaterThan(10);
    const missing = keys.filter((key) => !section.includes(`\`${key}\``));
    expect(missing, `variables missing from the README table: ${missing.join(', ')}`).toEqual([]);
  });

  it('documents every variable the full stack requires from .env', () => {
    const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.full.yml'), 'utf-8');
    const required = [...compose.matchAll(/\$\{([A-Z0-9_]+)(?::\?|:-)/g)].map((m) => m[1] ?? '');
    expect(required).toContain('STACK_S3_SECRET_KEY');
    const missing = [...new Set(required)].filter((key) => !section.includes(`\`${key}\``));
    expect(missing).toEqual([]);
  });

  it('describes every service of the full stack with its published ports', () => {
    const compose = fs.readFileSync(path.join(rootDir, 'docker-compose.full.yml'), 'utf-8');
    for (const service of ['api', 'workers', 'dashboard', 'mongo', 'redis', 'minio']) {
      expect(compose).toContain(`\n  ${service}:\n`);
      expect(section, `${service} row`).toContain(`| \`${service}\` |`);
    }
  });

  it('has the diagram, the image table, the resource requirements and the caching strategy', () => {
    expect(section).toContain('```mermaid');
    for (const heading of ['### Architecture', '### Images', '### Resource requirements', '### Layer caching and clean-up', '### Environment variables']) {
      expect(section).toContain(heading);
    }
  });

  it('has the clean-up script it documents', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['docker:prune']).toContain('docker image prune');
    expect(section).toContain('npm run docker:prune');
  });
});
