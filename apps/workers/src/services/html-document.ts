import { Window } from 'happy-dom';

// happy-dom resolves a preload's href against the window's URL when the tag is parsed, and our window
// has none (about:blank), so a relative `<link rel="preload" as="fetch" href="/_payload.json">` (Nuxt)
// throws "Invalid URL". Resolving it would also fetch it. No signal reads these tags, so drop them.
const PRELOAD_LINK = /<link\b[^>]*\brel\s*=\s*["']?(?:module)?preload\b[^>]*>/gi;

/** The HTML without its preload / modulepreload `<link>` tags, which happy-dom cannot resolve (see above) */
export function withoutPreloadLinks(html: string): string {
  return html.replace(PRELOAD_LINK, '');
}

/**
 * Parses an HTML string and hands its document to `read`: scripts are not evaluated, no file is loaded and no
 * navigation happens, so a page from the site or a model can be read safely. The window is closed afterwards.
 */
export function withHtmlDocument<T>(html: string, read: (doc: Document) => T): T {
  const window = new Window({
    settings: {
      // Script evaluation is off by default; nothing on the page is loaded or run
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
    },
  });
  try {
    const doc = new window.DOMParser().parseFromString(withoutPreloadLinks(html), 'text/html');
    return read(doc as unknown as Document);
  } finally {
    void window.happyDOM.close();
  }
}
