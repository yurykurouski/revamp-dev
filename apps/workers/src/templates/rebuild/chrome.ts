import type { IRebuildPlan } from '@revamp/shared-types';
import type { MvpStrings } from '../mvp-locale.js';
import { escapeHtml } from '../html.js';
import { monogramSvg } from '../shared/page.js';
import { img, renderSection, RenderCtx } from './sections.js';

// The rebuild's header and footer (REV-110): original logo and anchor nav, the verified phone and contacts

const telHref = (phone: string) => `tel:${phone.replace(/[^+\d]/g, '')}`;

export function renderHeader(plan: IRebuildPlan): string {
  const logo = plan.header.logo
    ? img({ ...plan.header.logo, eager: true }, 'rb-logo')
    : `<span class="rb-logo">${monogramSvg(plan.businessName, plan.theme.primary)}</span>`;
  const nav = plan.header.nav.length
    ? `<nav class="rb-nav">${plan.header.nav.map((n) => `<a class="rb-nav-link" href="${escapeHtml(n.href)}">${escapeHtml(n.label)}</a>`).join('')}</nav>`
    : '';
  const phone = plan.header.phone ? `<a class="rb-phone" href="${escapeHtml(telHref(plan.header.phone))}">${escapeHtml(plan.header.phone)}</a>` : '';
  return `<header class="rb-header">
  <div class="rb-container rb-header-row">
    <a class="rb-brand" href="#top" aria-label="${escapeHtml(plan.businessName)}">${logo}</a>
    ${nav}
    <div class="rb-header-actions">${phone}<a class="rb-cta" href="#booking">${escapeHtml(plan.header.cta.label)}</a></div>
  </div>
</header>`;
}

export function renderFooter(plan: IRebuildPlan, t: MvpStrings, ctx: RenderCtx): string {
  const c = plan.footer.contacts;
  const contacts = [
    c.phone ? `<li><a href="${escapeHtml(telHref(c.phone))}">${escapeHtml(c.phone)}</a></li>` : '',
    c.email ? `<li><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></li>` : '',
    c.address ? `<li>${escapeHtml(c.address)}</li>` : '',
    c.workingHours ? `<li><span class="rb-footer-label">${escapeHtml(t.openingHoursTitle)}</span> ${escapeHtml(c.workingHours)}</li>` : '',
  ].join('');
  const social = plan.footer.social.map((s) => `<a href="${escapeHtml(s.href)}" target="_blank" rel="noopener">${escapeHtml(s.label)}</a>`).join('');
  // The original footer keeps its anchor id but never holds a second booking form
  return `<footer class="rb-footer">
  ${plan.footer.section ? renderSection({ ...plan.footer.section, booking: false }, ctx, 'div') : ''}
  <div class="rb-container rb-footer-contacts">
    ${contacts || social ? `<h2 class="rb-footer-title">${escapeHtml(t.contactsTitle)}</h2>` : ''}
    ${contacts ? `<ul>${contacts}</ul>` : ''}
    ${social ? `<div class="rb-social">${social}</div>` : ''}
    <p class="rb-copyright">© ${plan.year} ${escapeHtml(plan.businessName)}. ${escapeHtml(t.rightsReserved)}</p>
  </div>
</footer>`;
}
