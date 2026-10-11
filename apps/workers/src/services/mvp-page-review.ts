import { browserService, type BrowserService } from './browser.service.js';
import { finishMvpPage, type MvpFinishContext } from './mvp-page-finish.js';
import type { RenderPage } from './mvp-page-generator.js';

// The self-review's renderer (REV-143): the model sees its page as it will be published (contacts filled, search tags,
// booking form) at desktop and mobile width. The tracker is left out, so a render never counts as a visit.

export const REVIEW_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;

export function pageReviewRenderer(
  finish: Omit<MvpFinishContext, 'theme' | 'controls'>,
  browser: Pick<BrowserService, 'captureHtmlScreenshot'> = browserService,
): RenderPage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { publicApiUrl, trackingToken, ...untracked } = finish;
  return async (page, theme) => {
    const html = finishMvpPage(page, { ...untracked, theme });
    const desktop = await browser.captureHtmlScreenshot(html, { ...REVIEW_VIEWPORTS.desktop, deviceScaleFactor: 1, fullPage: true });
    const mobile = await browser.captureHtmlScreenshot(html, { ...REVIEW_VIEWPORTS.mobile, deviceScaleFactor: 1, fullPage: true });
    return { desktop, mobile };
  };
}
