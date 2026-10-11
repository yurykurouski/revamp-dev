import { describe, it, expect } from 'vitest';
import { withHtmlDocument, withoutPreloadLinks } from '../html-document.js';

const NUXT_HEAD =
  '<link rel="preload" as="fetch" crossorigin="anonymous" href="/_payload.json?eb0b6d00">' +
  "<link rel='modulepreload' href='/_nuxt/a.js'><LINK REL=preload as=script href=/_nuxt/b.js>";

describe('withoutPreloadLinks', () => {
  it('should drop preload and modulepreload links and keep every other tag', () => {
    const html = `<head>${NUXT_HEAD}<link rel="stylesheet" href="/a.css"><link rel="canonical" href="/x"></head>`;
    expect(withoutPreloadLinks(html)).toBe('<head><link rel="stylesheet" href="/a.css"><link rel="canonical" href="/x"></head>');
  });

  it('should leave markup without preload links unchanged', () => {
    expect(withoutPreloadLinks('<p>preload</p>')).toBe('<p>preload</p>');
  });
});

describe('withHtmlDocument', () => {
  it('should read a page with relative preload links without an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const title = withHtmlDocument(`<html><head>${NUXT_HEAD}<title>Nuxt</title></head></html>`, (doc) => doc.title);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(title).toBe('Nuxt');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
