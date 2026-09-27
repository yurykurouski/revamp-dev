import { describe, it, expect } from 'vitest';
import { draftToHtml } from '../src/index.js';

describe('draftToHtml (REV-60, REV-72)', () => {
  it('escapes the draft and keeps its paragraphs and line breaks', () => {
    expect(draftToHtml('Hi <b>you</b>\nline 2\n\nA & "B"')).toBe(
      '<p>Hi &lt;b&gt;you&lt;/b&gt;<br>line 2</p>\n<p>A &amp; &quot;B&quot;</p>',
    );
  });

  it('adds the preheader as hidden text before the body', () => {
    const html = draftToHtml('Body', 'Preview <text>');
    expect(html.startsWith('<div style="display:none;')).toBe(true);
    expect(html).toContain('Preview &lt;text&gt;');
    expect(html.endsWith('<p>Body</p>')).toBe(true);
  });

  it('leaves out the hidden preheader when there is none', () => {
    expect(draftToHtml('Body')).toBe('<p>Body</p>');
    expect(draftToHtml('Body', '')).toBe('<p>Body</p>');
  });
});
