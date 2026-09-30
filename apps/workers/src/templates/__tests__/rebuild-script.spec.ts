import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import type { IRebuildPlan } from '@revamp/shared-types';
import { renderRebuild } from '../rebuild/index.js';

const windows: Window[] = [];
afterEach(async () => {
  for (const w of windows.splice(0)) await w.happyDOM.close();
});

function open(plan: IRebuildPlan): Window {
  const window = new Window({ url: 'https://mvp.example/', settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } });
  windows.push(window);
  window.document.write(renderRebuild(plan));
  return window;
}

const slider = (n: number): IRebuildPlan => ({
  language: 'pl', businessName: 'X', year: 2026,
  theme: { primary: '#0e7490', onPrimary: '#ffffff', pageBackground: '#ffffff', pageText: '#111111', headingFont: 'serif', bodyFont: 'sans-serif',
    headingWeight: 700, headingUppercase: false, h1Size: 48, h2Size: 34, bodySize: 16, lineHeight: 1.6, buttonRadius: 6, buttonUppercase: false },
  header: { nav: [], cta: { label: 'CTA' } },
  sections: [{ id: 's-1', index: 1, kind: 'other', arrangement: 'slider', headingLevel: 2, intro: { heading: 'S', text: [], links: [] },
    items: Array.from({ length: n }, (_, i) => ({ title: `Slajd ${i}`, text: [], links: [] })), extra: [], images: [], embeds: [], booking: false, collapsed: false,
    style: { text: '#111111', align: 'left', paddingY: 64, fullBleed: false } }],
  bookingAppended: true, bookingServices: [], footer: { contacts: {}, social: [] },
  summary: { coverage: 1, sections: 1, omitted: [], tuning: [] },
});

describe('rebuild page script (REV-110)', () => {
  it('shows prev/next only for a slider with more than one slide', () => {
    expect(open(slider(3)).document.querySelectorAll('[data-slide-step]')).toHaveLength(2);
    expect(open(slider(1)).document.querySelectorAll('[data-slide-step]')).toHaveLength(0);
  });

  it('shows the controls once the script runs', () => {
    const controls = open(slider(3)).document.querySelector('.rb-slider-controls');
    expect(controls?.hasAttribute('hidden')).toBe(false);
  });

  it('the next button scrolls the track by one slide', () => {
    const window = open(slider(3));
    const track = window.document.querySelector('.rb-track') as unknown as { scrollBy: (o: unknown) => void };
    const calls: unknown[] = [];
    track.scrollBy = (o) => calls.push(o);
    (window.document.querySelector('[data-slide-step="1"]') as unknown as { click: () => void }).click();
    expect(calls).toHaveLength(1);
  });

  it('applies a live palette from the dashboard', async () => {
    const window = open(slider(1));
    window.postMessage({ type: 'REVAMP_UPDATE_THEME', palette: { primary: '#ff0000' } }, '*');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.document.documentElement.style.getPropertyValue('--rb-primary')).toBe('#ff0000');
  });
});
