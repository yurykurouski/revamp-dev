/**
 * The srcdoc of the outbox frame (REV-221). The email is shown exactly as it would arrive, but loads nothing: the CSP
 * lets through inline styles and data: images only, so the open-tracking pixel and remote images never load, and links
 * open in a new tab, which the empty sandbox blocks. Viewing a simulated email is therefore never an open or a click.
 */
export const OUTBOX_FRAME_HEAD =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` +
  '<base target="_blank">';

export function outboxSrcDoc(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + OUTBOX_FRAME_HEAD + html.slice(head.index + head[0].length);
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) return `${html.slice(0, root.index + root[0].length)}<head>${OUTBOX_FRAME_HEAD}</head>${html.slice(root.index + root[0].length)}`;
  return `<head>${OUTBOX_FRAME_HEAD}</head>${html}`;
}
