import { describe, it, expect } from 'vitest';
import { OUTBOX_FRAME_HEAD, outboxSrcDoc } from '../outboxFrame.js';

describe('outboxSrcDoc (REV-221)', () => {
  it('the head carries a CSP that loads nothing but inline styles and data images, and a base target', () => {
    expect(OUTBOX_FRAME_HEAD).toContain(`default-src 'none'; style-src 'unsafe-inline'; img-src data:`);
    expect(OUTBOX_FRAME_HEAD).toContain('<base target="_blank">');
  });

  it('puts the head content inside an existing <head>, before everything else in it', () => {
    const out = outboxSrcDoc('<html><head><title>x</title></head><body><p>Hi</p></body></html>');
    expect(out).toBe(`<html><head>${OUTBOX_FRAME_HEAD}<title>x</title></head><body><p>Hi</p></body></html>`);
  });

  it('keeps attributes of an existing <head>', () => {
    expect(outboxSrcDoc('<head lang="en"></head><p>x</p>')).toBe(`<head lang="en">${OUTBOX_FRAME_HEAD}</head><p>x</p>`);
  });

  it('adds a <head> to a document that has <html> but no head', () => {
    expect(outboxSrcDoc('<html lang="pl"><body>Hi</body></html>')).toBe(`<html lang="pl"><head>${OUTBOX_FRAME_HEAD}</head><body>Hi</body></html>`);
  });

  it('adds a <head> in front of a fragment', () => {
    expect(outboxSrcDoc('<p>Hi</p>')).toBe(`<head>${OUTBOX_FRAME_HEAD}</head><p>Hi</p>`);
  });
});
