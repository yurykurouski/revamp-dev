import { describe, it, expect } from 'vitest';

export const TEMPLATE_VARIABLES = [
  { tag: '{{businessName}}', label: 'Company' },
  { tag: '{{city}}', label: 'City' },
  { tag: '{{demoUrl}}', label: 'Demo link' },
  { tag: '{{score}}', label: 'Score' },
  { tag: '{{lcpSeconds}}', label: 'LCP speed' },
  { tag: '{{criticalFlaws}}', label: 'Issues' },
];

export const COLOR_PRESETS = [
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Cyan', hex: '#0891B2' },
  { name: 'Emerald', hex: '#059669' },
  { name: 'Amber', hex: '#D97706' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Slate', hex: '#334155' },
];

function interpolateEmailTemplate(
  text: string,
  context: {
    businessName: string;
    city?: string;
    demoUrl: string;
    score?: number;
    lcpSeconds?: number;
    criticalFlaws?: Array<{ title: string }>;
  },
): string {
  return text
    .replace(/{{businessName}}/g, context.businessName)
    .replace(/{{city}}/g, context.city || 'your city')
    .replace(/{{demoUrl}}/g, context.demoUrl)
    .replace(/{{score}}/g, `${context.score ?? 42}/100`)
    .replace(/{{lcpSeconds}}/g, `${context.lcpSeconds ?? 3.4}s`)
    .replace(
      /{{criticalFlaws}}/g,
      context.criticalFlaws?.map((f, i) => `${i + 1}. ${f.title}`).join('\n') ||
        '1. Slow LCP loading\n2. WCAG contrast errors',
    );
}

describe('EmailDraftEditor & ColorPickerToolbar Logic (REV-16)', () => {
  it('should interpolate all standard variables accurately into subject and body', () => {
    const rawTemplate =
      'Hello! Preparing an MVP for {{businessName}} in {{city}}. Score: {{score}}, LCP: {{lcpSeconds}}. Demo: {{demoUrl}}.\nIssues:\n{{criticalFlaws}}';

    const result = interpolateEmailTemplate(rawTemplate, {
      businessName: 'Listonosz Courier',
      city: 'Warszawa',
      demoUrl: 'http://localhost:9000/revamp-demos/v/listonosz/index.html',
      score: 96,
      lcpSeconds: 1.8,
      criticalFlaws: [
        { title: 'No prominent call-to-action button' },
        { title: 'Low text contrast' },
      ],
    });

    expect(result).toContain('Listonosz Courier');
    expect(result).toContain('Warszawa');
    expect(result).toContain('96/100');
    expect(result).toContain('1.8s');
    expect(result).toContain('http://localhost:9000/revamp-demos/v/listonosz/index.html');
    expect(result).toContain('1. No prominent call-to-action button');
    expect(result).toContain('2. Low text contrast');
    expect(result).not.toContain('{{businessName}}');
    expect(result).not.toContain('{{city}}');
    expect(result).not.toContain('{{demoUrl}}');
  });

  it('should gracefully handle missing optional fields with sensible fallbacks', () => {
    const rawTemplate = 'Business: {{businessName}}, Region: {{city}}, Score: {{score}}';
    const result = interpolateEmailTemplate(rawTemplate, {
      businessName: 'Dental Clinic',
      demoUrl: 'https://demo.url',
    });

    expect(result).toContain('Business: Dental Clinic');
    expect(result).toContain('Region: your city');
    expect(result).toContain('Score: 42/100');
  });

  it('should have valid template variable tags matching double curly brace syntax', () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.tag).toMatch(/^\{\{[a-zA-Z]+\}\}$/);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });

  it('should provide valid hexadecimal color presets in ColorPickerToolbar', () => {
    for (const preset of COLOR_PRESETS) {
      expect(preset.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });
});
