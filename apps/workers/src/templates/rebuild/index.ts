import type { IRebuildPlan } from '@revamp/shared-types';
import { escapeHtml } from '../html.js';
import { getMvpStrings } from '../mvp-locale.js';
import { bookingFormHtml, bookingScript } from '../shared/booking.js';
import { monogramSvg, resolveTrackerUrls, svgDataUri, trackerScriptTag } from '../shared/page.js';
import { renderFooter, renderHeader } from './chrome.js';
import { renderSection, RenderCtx } from './sections.js';
import { REBUILD_SCRIPT } from './script.js';
import { rebuildCss } from './styles.js';

/** The rebuilt original home page (REV-110), from a validated plan; no markup from the site or a model */
// The form goes where the plan places it; when no section took it (bookingAppended, or an inconsistent plan) it is
// appended before the footer, so the header CTA always has its target and `id="booking"` appears exactly once
export function renderRebuild(plan: IRebuildPlan, opts: { publicApiUrl?: string; trackingToken?: string } = {}): string {
  const t = getMvpStrings(plan.language);
  const tracker = resolveTrackerUrls(opts.publicApiUrl);
  const options = plan.bookingServices.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  const bookingHtml = `<section class="booking-section rb-section" id="booking" data-arrangement="booking">
  <div class="rb-container">${bookingFormHtml({ t, businessName: plan.businessName, heading: escapeHtml(plan.header.cta.label), serviceOptionsHtml: options })}</div>
</section>`;
  const ctx: RenderCtx = { t, bookingHtml, booking: { placed: false } };
  const favicon = plan.header.logo?.src ?? svgDataUri(monogramSvg(plan.businessName, plan.theme.primary));
  return `<!DOCTYPE html>
<html lang="${escapeHtml(plan.language)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(plan.businessName)}</title>
  <link rel="icon" href="${escapeHtml(favicon)}">
  <style>${rebuildCss(plan)}</style>
</head>
<body id="top">
${renderHeader(plan)}
<main>
${plan.hiddenH1 ? `<h1 class="rb-visually-hidden">${escapeHtml(plan.hiddenH1)}</h1>` : ''}
${plan.sections.map((section) => renderSection(section, ctx)).join('\n')}
${ctx.booking.placed ? '' : bookingHtml}
</main>
${renderFooter(plan, t, ctx)}
${bookingScript({ t, tracker, trackingToken: opts.trackingToken, themeVars: { primary: '--rb-primary', onPrimary: '--rb-on-primary' } })}
${REBUILD_SCRIPT}
${trackerScriptTag(tracker, opts.trackingToken)}
</body>
</html>`;
}
