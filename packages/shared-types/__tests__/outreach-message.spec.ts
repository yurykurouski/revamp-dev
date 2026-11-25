import { describe, expect, it } from 'vitest';
import { formatFromHeader, renderOutreachMessage } from '../src/index.js';

const sender = { name: 'Studio A', address: 'a@studio-a.test' };
const base = {
  sender,
  to: 'director@listonosz.site',
  subject: 'Audit and a new website',
  html: '<p>Hello!</p>',
  text: 'Hello!',
  trackingToken: 'token-abc-123',
  publicApiUrl: 'http://localhost:4000/api/v1',
};

describe('formatFromHeader (REV-221)', () => {
  it('formats a From header with quotes and non-ASCII', () => {
    expect(formatFromHeader({ name: 'Studio "Kraków", Ltd', address: 'a@b.test' })).toBe(
      '"Studio \\"Kraków\\", Ltd" <a@b.test>',
    );
  });

  it('quotes a plain name too', () => {
    expect(formatFromHeader(sender)).toBe('"Studio A" <a@studio-a.test>');
  });
});

describe('renderOutreachMessage (REV-221)', () => {
  it('carries from, to and subject', () => {
    const m = renderOutreachMessage(base);
    expect(m.from).toBe('"Studio A" <a@studio-a.test>');
    expect(m.to).toBe(base.to);
    expect(m.subject).toBe(base.subject);
  });

  it('adds the unsubscribe footer link and the open pixel to the html', () => {
    const m = renderOutreachMessage(base);
    expect(m.html).toContain('http://localhost:4000/api/v1/track/unsubscribe/token-abc-123');
    expect(m.html).toContain('Unsubscribe in one click');
    expect(m.html).toContain('http://localhost:4000/api/v1/track/open/token-abc-123.gif');
    expect(m.html).toContain('width="1" height="1"');
  });

  it('leaves out the pixel but keeps the footer when trackOpens is false', () => {
    const m = renderOutreachMessage({ ...base, trackOpens: false });
    expect(m.html).not.toContain('/track/open/');
    expect(m.html).toContain('Unsubscribe in one click');
  });

  it('puts the footer before </body> when there is one', () => {
    const m = renderOutreachMessage({ ...base, html: '<html><body><p>Hi</p></body></html>' });
    expect(m.html.indexOf('Unsubscribe in one click')).toBeLessThan(m.html.indexOf('</body>'));
    expect(m.html.endsWith('</body></html>')).toBe(true);
  });

  it('ends the text with the unsubscribe line', () => {
    const m = renderOutreachMessage(base);
    expect(m.text.startsWith('Hello!')).toBe(true);
    expect(m.text.endsWith('Unsubscribe in one click: http://localhost:4000/api/v1/track/unsubscribe/token-abc-123')).toBe(true);
  });

  it('has the compliance headers and nothing else', () => {
    const m = renderOutreachMessage({ ...base, unsubscribeEmail: 'unsubscribe@studio-a.test' });
    expect(m.headers).toEqual({
      'List-Unsubscribe':
        '<mailto:unsubscribe@studio-a.test?subject=unsubscribe>, <http://localhost:4000/api/v1/track/unsubscribe/token-abc-123>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });

  it('defaults the unsubscribe mailbox to the sender domain, never a platform address', () => {
    const m = renderOutreachMessage(base);
    expect(m.headers['List-Unsubscribe']).toContain('mailto:unsubscribe@studio-a.test?subject=unsubscribe');
  });

  it('does not duplicate a footer or pixel already present', () => {
    const url = 'http://localhost:4000/api/v1/track/unsubscribe/token-xyz';
    const html = `<p>Hi</p><a href="${url}">Unsubscribe</a><img src="http://localhost:4000/api/v1/track/open/token-xyz.gif" width="1" height="1" alt="" />`;
    const text = `Hi. Unsubscribe: ${url}`;
    const m = renderOutreachMessage({ ...base, trackingToken: 'token-xyz', html, text });
    expect(m.html).toBe(html);
    expect(m.text).toBe(text);
  });

  it('tolerates a trailing slash on the public URL', () => {
    const m = renderOutreachMessage({ ...base, publicApiUrl: 'http://localhost:4000/api/v1/' });
    expect(m.html).toContain('http://localhost:4000/api/v1/track/open/token-abc-123.gif');
  });

  it('renders an empty text as only the footer', () => {
    const m = renderOutreachMessage({ ...base, text: undefined });
    expect(m.text.startsWith('---')).toBe(true);
  });
});
