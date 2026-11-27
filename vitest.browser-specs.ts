// REV-230: specs that launch a real Chromium. They run in the `browser` Vitest project (see vitest.config.ts),
// after the unit tests and one file at a time. scripts/__tests__/browser-specs.spec.ts fails on an unlisted one.
export const BROWSER_SPECS: readonly string[] = [
  'apps/workers/src/services/__tests__/mvp-page-finish.browser.spec.ts',
  'apps/workers/src/services/__tests__/vitals.service.spec.ts',
  'apps/workers/src/services/__tests__/browser.service.spec.ts',
  'apps/workers/src/services/__tests__/cookie-consent.service.spec.ts',
  'apps/workers/src/services/__tests__/site-era.page.spec.ts',
];
