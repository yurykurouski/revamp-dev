import { Window } from 'happy-dom';

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
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    return read(doc as unknown as Document);
  } finally {
    void window.happyDOM.close();
  }
}
