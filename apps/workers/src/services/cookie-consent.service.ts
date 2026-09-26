import type { Frame, Page } from 'playwright';

/**
 * How a capture context dealt with the site's cookie consent UI (REV-33):
 * `dismissed:cmp:<platform>` (known consent platform), `dismissed:text` / `dismissed:iframe-text`
 * (accept button matched by its label), `dismissed:overlay` (leftover consent overlay hidden),
 * `not_found`, `timeout` or `error`.
 */
export type CookieConsentOutcome =
  | `dismissed:${string}`
  | 'not_found'
  | 'timeout'
  | 'error';

export interface CookieConsentOptions {
  /** Hard budget for detection and dismissal. The step never fails or stalls the audit. */
  timeoutMs?: number;
  /** Delay before a second detection pass, for consent platforms that inject late */
  retryDelayMs?: number;
  /** Longest wait, after a dismissal, for the consent UI to finish animating out */
  settleMs?: number;
}

interface ConsentPlatform {
  name: string;
  /** Elements that show the platform's banner is present */
  banner: string;
  /** Accept buttons, tried in order */
  accept: string[];
  /** Accept-all call through the platform's JS API, used when no accept button is clickable */
  api?: string;
}

/**
 * Known consent management platforms. Selectors are searched in the document and in open shadow roots.
 * TCF (`__tcfapi`) exposes no accept call, so TCF banners are handled through the Quantcast selectors
 * and the text matching step.
 */
export const CONSENT_PLATFORMS: ConsentPlatform[] = [
  {
    name: 'onetrust',
    banner: '#onetrust-banner-sdk, #onetrust-pc-sdk',
    accept: ['#onetrust-accept-btn-handler', '#accept-recommended-btn-handler'],
    api: 'OneTrust.AllowAll',
  },
  {
    name: 'cookiebot',
    banner: '#CybotCookiebotDialog',
    accept: [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '#CybotCookiebotDialogBodyLevelButtonAccept',
    ],
    api: 'Cookiebot.submitCustomConsent',
  },
  {
    name: 'didomi',
    banner: '#didomi-notice, #didomi-popup',
    accept: ['#didomi-notice-agree-button', '.didomi-continue-without-agreeing'],
    api: 'Didomi.setUserAgreeToAll',
  },
  {
    name: 'quantcast',
    banner: '#qc-cmp2-container, #qc-cmp2-ui',
    accept: ['#qc-cmp2-ui button[mode="primary"]', '.qc-cmp2-summary-buttons button[mode="primary"]'],
  },
  {
    name: 'usercentrics',
    banner: '#usercentrics-root, #usercentrics-cmp-ui, #uc-center-container',
    accept: ['[data-testid="uc-accept-all-button"]', '#accept'],
    api: 'UC_UI.acceptAllConsents',
  },
  {
    name: 'cookieyes',
    banner: '.cky-consent-container, #cookie-law-info-bar',
    accept: ['.cky-btn-accept', '#wt-cli-accept-all-btn', '#cookie_action_close_header'],
  },
  {
    name: 'complianz',
    banner: '.cmplz-cookiebanner',
    accept: ['.cmplz-accept', '.cmplz-btn.cmplz-accept'],
  },
  {
    name: 'osano',
    banner: '.osano-cm-dialog, .osano-cm-window__dialog',
    accept: ['.osano-cm-accept-all', '.osano-cm-accept', '.osano-cm-dialog__close'],
  },
  {
    name: 'iubenda',
    banner: '#iubenda-cs-banner',
    accept: ['.iubenda-cs-accept-btn', '.iubenda-cs-close-btn'],
  },
  {
    name: 'termly',
    banner: '#termly-code-snippet-support, [data-tid="banner"]',
    accept: ['[data-tid="banner-accept"]'],
  },
  {
    name: 'trustarc',
    banner: '#truste-consent-track, #truste-consent-content, #teconsent',
    accept: ['#truste-consent-button', '.truste-button1'],
  },
];

/**
 * Accept/close labels, strongest first: en, pl, ru, be, lt (dashboard languages) plus de, fr, uk.
 * Labels and phrases are both compared after `normaliseLabel`, so case, punctuation and diacritics
 * ("Akceptuje" for "Akceptuję") do not matter.
 */
export const ACCEPT_PHRASES: string[] = [
  // Accept all
  'accept all', 'accept all cookies', 'allow all', 'allow all cookies', 'accept and close', 'agree and close',
  'akceptuj wszystkie', 'akceptuję wszystkie', 'zaakceptuj wszystkie', 'zezwól na wszystkie', 'akceptuję wszystkie pliki cookie',
  'принять все', 'принять всё', 'разрешить все', 'принять все cookie', 'принять все файлы cookie',
  'прыняць усе', 'дазволіць усе',
  'priimti visus', 'leisti visus', 'sutinku su visais', 'priimti visus slapukus',
  'alle akzeptieren', 'alles akzeptieren', 'alle cookies akzeptieren', 'alle zulassen',
  'tout accepter', 'accepter tout', 'accepter et fermer', 'accepter les cookies',
  'прийняти все', 'прийняти всі', 'дозволити все', 'дозволити всі',
  // Accept / agree
  'accept', 'accept cookies', 'i accept', 'agree', 'i agree', 'yes i agree', 'allow', 'allow cookies',
  'akceptuję', 'akceptuj', 'zaakceptuj', 'zgadzam się', 'zgoda', 'przejdź do serwisu',
  'принять', 'принимаю', 'согласен', 'согласна', 'я согласен', 'соглашаюсь',
  'прыняць', 'згодны', 'згодна', 'пагаджаюся',
  'sutinku', 'priimti', 'leisti',
  'akzeptieren', 'zustimmen', 'einverstanden', 'ich stimme zu',
  'accepter', "j'accepte", "d'accord",
  'прийняти', 'погоджуюсь', 'погоджуюся', 'згоден', 'згодна',
  // Close / acknowledge
  'got it', 'ok', 'okay', 'understood', 'continue', 'close',
  'rozumiem', 'zamknij',
  'понятно', 'хорошо', 'ок', 'закрыть',
  'зразумела', 'добра', 'зачыніць',
  'gerai', 'supratau', 'uždaryti',
  'verstanden', 'schließen',
  'compris', 'fermer',
  'зрозуміло', 'добре', 'закрити',
];

/**
 * Lower case, diacritics folded, letters/digits/single spaces only. Also inlined in `clickAcceptByTextInPage`,
 * which runs in the page and cannot import it.
 */
export function normaliseLabel(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text or attributes that mark an element as part of consent UI */
const CONSENT_CONTEXT_PATTERN =
  'cookie|consent|gdpr|rodo|ciasteczk|slapuk|куки|кукі|datenschutz|confidentialit|privacy|prywatno|конфиденц|персональн';

/** Selectors for leftover consent overlays hidden by the fallback */
export const CONSENT_OVERLAY_SELECTOR = [
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[id*="gdpr" i]',
  '[class*="gdpr" i]',
  '[aria-label*="cookie" i]',
  '[aria-label*="consent" i]',
  '[id*="cmp" i]',
  '[class*="cmp-" i]',
].join(', ');

/**
 * In-page step 1: accept through a known consent platform. Returns the platform name or null.
 * Serialised into the page, so it must stay self-contained.
 */
export function acceptKnownPlatformInPage(platforms: ConsentPlatform[]): string | null {
  const roots = (): Array<Document | ShadowRoot> => {
    const found: Array<Document | ShadowRoot> = [document];
    const walk = (root: Document | ShadowRoot, depth: number) => {
      if (depth > 3) return;
      root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) {
          found.push(el.shadowRoot);
          walk(el.shadowRoot, depth + 1);
        }
      });
    };
    walk(document, 0);
    return found;
  };
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const allRoots = roots();
  const query = (selector: string): Element[] =>
    allRoots.flatMap((root) => {
      try {
        return Array.from(root.querySelectorAll(selector));
      } catch {
        return [];
      }
    });

  for (const platform of platforms) {
    const banner = query(platform.banner).find(isVisible);
    if (!banner) continue;

    for (const selector of platform.accept) {
      const button = query(selector).find(isVisible) as HTMLElement | undefined;
      if (button) {
        button.setAttribute('data-revamp-consent', 'clicked');
        button.click();
        return platform.name;
      }
    }

    if (platform.api) {
      const path = platform.api.split('.');
      let owner: unknown = window;
      for (const key of path.slice(0, -1)) {
        owner = owner && (owner as Record<string, unknown>)[key];
      }
      const method = owner && (owner as Record<string, unknown>)[path[path.length - 1] as string];
      if (typeof method === 'function') {
        try {
          // Cookiebot.submitCustomConsent(preferences, statistics, marketing); the others take no arguments
          (method as (...args: boolean[]) => unknown).call(owner, true, true, true);
          banner.setAttribute('data-revamp-consent', 'clicked');
          return platform.name;
        } catch {
          // fall through to the next platform
        }
      }
    }
  }
  return null;
}

/**
 * In-page step 2: click a visible accept/close button whose label matches a known phrase and that sits
 * inside consent UI. `wholeDocumentIsConsent` is set for iframes, where the frame itself is the banner.
 */
export function clickAcceptByTextInPage(args: {
  phrases: string[];
  contextPattern: string;
  wholeDocumentIsConsent: boolean;
}): boolean {
  const context = new RegExp(args.contextPattern, 'i');
  const normalise = (value: string | null | undefined): string =>
    (value || '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const inConsentUi = (el: Element): boolean => {
    let node: Element | null = el.parentElement;
    for (let depth = 0; node && depth < 10; depth++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      const attrs = `${node.id} ${typeof node.className === 'string' ? node.className : ''} ${node.getAttribute('aria-label') || ''}`;
      if (context.test(attrs)) return true;
      const text = node.textContent || '';
      if (text.length < 3000 && context.test(text)) return true;
    }
    return args.wholeDocumentIsConsent && context.test(document.body?.innerText || '');
  };

  // Hand-rolled banners often use a styled <div>/<span> as the button
  const selector =
    'button, a, [role="button"], input[type="button"], input[type="submit"], [onclick], ' +
    '[class*="btn" i], [class*="button" i]';
  // Innermost matches only, so a ".button-group" wrapper is never clicked instead of its button
  const candidates = Array.from(document.querySelectorAll(selector)).filter(
    (el) => isVisible(el) && !el.querySelector(selector),
  );
  const labelled = candidates.map((el) => ({
    el: el as HTMLElement,
    labels: [
      normalise((el as HTMLElement).innerText || el.textContent),
      normalise(el.getAttribute('aria-label')),
      normalise((el as HTMLInputElement).value),
    ].filter(Boolean),
  }));

  for (const phrase of args.phrases.map(normalise)) {
    const match = labelled.find((c) => c.labels.includes(phrase) && inConsentUi(c.el));
    if (match) {
      match.el.setAttribute('data-revamp-consent', 'clicked');
      match.el.click();
      return true;
    }
  }
  return false;
}

/**
 * In-page step 3: hide fixed/sticky overlays that look like consent UI and lift the scroll lock.
 * Returns the number of overlays hidden.
 */
export function hideConsentOverlaysInPage(args: { selector: string; contextPattern: string }): number {
  const context = new RegExp(args.contextPattern, 'i');
  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const isPinned = (el: Element): boolean => {
    const position = window.getComputedStyle(el).position;
    return position === 'fixed' || position === 'sticky';
  };

  const hidden = new Set<HTMLElement>();
  document.querySelectorAll(args.selector).forEach((match) => {
    // Links such as "Cookie policy" in a sticky header are not consent UI
    if (match.closest('a')) return;
    if (match === document.body || match === document.documentElement) return;
    let node: Element | null = match;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) return;
      if (!isPinned(node)) continue;
      const tag = node.tagName.toLowerCase();
      if (tag === 'header' || tag === 'nav') return;
      if (!isVisible(node) || !context.test(`${node.id} ${node.className} ${node.textContent || ''}`)) return;
      hidden.add(node as HTMLElement);
      return;
    }
  });

  hidden.forEach((el) => el.style.setProperty('display', 'none', 'important'));

  if (hidden.size > 0) {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const style = window.getComputedStyle(el);
      if (style.overflow === 'hidden' || style.overflowY === 'hidden') {
        el.style.setProperty('overflow', 'auto', 'important');
      }
      if (style.position === 'fixed') {
        el.style.setProperty('position', 'static', 'important');
      }
    }
  }
  return hidden.size;
}

/** Frames searched for consent buttons, and the time each one gets */
const MAX_FRAMES = 12;
const FRAME_TIMEOUT_MS = 500;

export class CookieConsentService {
  static readonly DEFAULTS: Required<CookieConsentOptions> = {
    timeoutMs: 3000,
    retryDelayMs: 800,
    settleMs: 1500,
  };

  /**
   * Dismisses the site's cookie consent UI before screenshots are taken (REV-33).
   * Tries known consent platforms, then accept buttons matched by text (page and iframes), then hides
   * leftover consent overlays. Bounded by `timeoutMs`; never throws.
   */
  async dismiss(page: Page, options: CookieConsentOptions = {}): Promise<CookieConsentOutcome> {
    const { timeoutMs, retryDelayMs, settleMs } = { ...CookieConsentService.DEFAULTS, ...options };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<CookieConsentOutcome>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });

    let outcome: CookieConsentOutcome;
    try {
      outcome = await Promise.race([this.detectAndDismiss(page, retryDelayMs), timeout]);
    } catch (err) {
      console.warn('[CookieConsent] Consent handling failed:', err);
      outcome = 'error';
    } finally {
      clearTimeout(timer);
    }

    if (outcome.startsWith('dismissed:') && settleMs > 0) {
      await this.waitForConsentUiGone(page, settleMs);
    }
    console.log(`[CookieConsent] ${safeUrl(page)}: ${outcome}`);
    return outcome;
  }

  /**
   * Banners often slide or fade out after the click (OneTrust on mobile takes ~1s). Waits until the
   * clicked element is gone or hidden, up to `settleMs`, then briefly for the layout to settle.
   */
  private async waitForConsentUiGone(page: Page, settleMs: number): Promise<void> {
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-revamp-consent="clicked"]');
          if (!el || !el.isConnected) return true;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return true;
          return typeof el.checkVisibility === 'function'
            ? !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
            : false;
        },
        undefined,
        { timeout: settleMs, polling: 100 },
      )
      .catch(() => {});
    await page.waitForTimeout(150).catch(() => {});
  }

  private async detectAndDismiss(page: Page, retryDelayMs: number): Promise<CookieConsentOutcome> {
    const first = await this.clickPass(page);
    if (first) return first;

    // Consent platforms often inject their banner shortly after load
    await page.waitForTimeout(retryDelayMs);
    const second = await this.clickPass(page);
    if (second) return second;

    const hidden = await page
      .evaluate(hideConsentOverlaysInPage, {
        selector: CONSENT_OVERLAY_SELECTOR,
        contextPattern: CONSENT_CONTEXT_PATTERN,
      })
      .catch(() => 0);
    return hidden > 0 ? 'dismissed:overlay' : 'not_found';
  }

  /** Steps 1 and 2. Returns the outcome when something was clicked, otherwise null. */
  private async clickPass(page: Page): Promise<CookieConsentOutcome | null> {
    const platform = await page.evaluate(acceptKnownPlatformInPage, CONSENT_PLATFORMS).catch(() => null);
    if (platform) return `dismissed:cmp:${platform}`;

    const mainFrame = page.mainFrame();
    if (await this.clickByText(mainFrame, false)) return 'dismissed:text';

    for (const frame of page.frames().slice(0, MAX_FRAMES)) {
      // Frames that never committed a navigation have no JS context, and evaluate() on them never settles
      if (frame === mainFrame || frame.isDetached() || !frame.url()) continue;
      if (await this.clickByText(frame, true)) return 'dismissed:iframe-text';
    }
    return null;
  }

  private async clickByText(frame: Frame, wholeDocumentIsConsent: boolean): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One stuck frame must not use up the whole consent budget
    const frameTimeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), FRAME_TIMEOUT_MS);
    });
    const clicked = frame
      .evaluate(clickAcceptByTextInPage, {
        phrases: ACCEPT_PHRASES,
        contextPattern: CONSENT_CONTEXT_PATTERN,
        wholeDocumentIsConsent,
      })
      .catch(() => false);
    try {
      return await Promise.race([clicked, frameTimeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return 'page';
  }
}

export const cookieConsentService = new CookieConsentService();
