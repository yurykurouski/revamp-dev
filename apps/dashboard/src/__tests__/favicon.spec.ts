import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const indexHtml = readFileSync(path.join(root, 'index.html'), 'utf8');
const publicFile = (name: string) => path.join(root, 'public', name);

describe('dashboard favicon (REV-75)', () => {
  it('links the Revamp SVG favicon and an .ico fallback, not the Vite logo', () => {
    expect(indexHtml).not.toContain('vite.svg');
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexHtml).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />');
  });

  it('serves the SVG favicon from public with light and dark colors', () => {
    expect(existsSync(publicFile('favicon.svg'))).toBe(true);
    const svg = readFileSync(publicFile('favicon.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('prefers-color-scheme: dark');
  });

  it('serves a valid .ico with a PNG image from public', () => {
    expect(existsSync(publicFile('favicon.ico'))).toBe(true);
    const ico = readFileSync(publicFile('favicon.ico'));
    // ICONDIR: reserved 0, type 1 (icon), at least one image
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16;
      const size = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + size).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset, offset + 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
  });
});
