import { describe, it, expect } from 'vitest';
import { auditSummarySentence, renderEmailDraft, renderEmailTemplate, UNKNOWN_VALUE } from '../../utils/emailTemplate.js';

export const TEMPLATE_VARIABLES = [
  { tag: '{{businessName}}', label: 'Company' },
  { tag: '{{city}}', label: 'City' },
  { tag: '{{demoUrl}}', label: 'Demo link' },
  { tag: '{{score}}', label: 'Score' },
  { tag: '{{lcpSeconds}}', label: 'LCP speed' },
  { tag: '{{criticalFlaws}}', label: 'Issues' },
];

describe('EmailDraftEditor Logic (REV-16)', () => {
  it('should interpolate all standard variables accurately into subject and body', () => {
    const rawTemplate =
      'Hello! Preparing an MVP for {{businessName}} in {{city}}. Score: {{score}}, LCP: {{lcpSeconds}}. Demo: {{demoUrl}}.\nIssues:\n{{criticalFlaws}}';

    const result = renderEmailTemplate(rawTemplate, {
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

  it('never invents values the audit did not measure (REV-45)', () => {
    const rawTemplate =
      'Business: {{businessName}}, Region: {{city}}, Score: {{score}}, LCP: {{lcpSeconds}}, Demo: {{demoUrl}}\n{{criticalFlaws}}';
    const result = renderEmailTemplate(rawTemplate, { businessName: 'Dental Clinic' });

    expect(result).toBe(
      `Business: Dental Clinic, Region: your city, Score: ${UNKNOWN_VALUE}, LCP: ${UNKNOWN_VALUE}, Demo: ${UNKNOWN_VALUE}\n${UNKNOWN_VALUE}`,
    );
    expect(result).not.toContain('42/100');
    expect(result).not.toContain('3.4s');
  });

  it('keeps a measured score of 0 instead of treating it as missing', () => {
    expect(renderEmailTemplate('{{score}} {{lcpSeconds}}', { businessName: 'X', score: 0, lcpSeconds: 0 })).toBe('0/100 0s');
  });

  it('quotes the LCP in the default draft only when the audit measured it (REV-45)', () => {
    expect(auditSummarySentence('smile.pl', 2.7)).toContain('loads in 2.7s (LCP)');
    const withoutLcp = auditSummarySentence('smile.pl', undefined);
    expect(withoutLcp).toContain('smile.pl');
    expect(withoutLcp).not.toMatch(/\d+(\.\d+)?s \(LCP\)/);
  });

  it('should have valid template variable tags matching double curly brace syntax', () => {
    for (const v of TEMPLATE_VARIABLES) {
      expect(v.tag).toMatch(/^\{\{[a-zA-Z]+\}\}$/);
      expect(v.label.length).toBeGreaterThan(0);
    }
  });
});

describe('renderEmailDraft (REV-72)', () => {
  const context = { businessName: 'Dr. Smile', city: 'Warsaw', demoUrl: 'https://demo.example/dr-smile', score: 42 };

  it('substitutes the variables in the subject, preheader and body', () => {
    const draft = renderEmailDraft(
      { subject: 'For {{businessName}}', preheader: 'In {{city}}', body: 'Score {{score}}\n👉 {{demoUrl}}' },
      context,
    );

    expect(draft).toEqual({
      subject: 'For Dr. Smile',
      preheader: 'In Warsaw',
      body: 'Score 42/100\n👉 https://demo.example/dr-smile',
    });
    expect(JSON.stringify(draft)).not.toMatch(/{{.*}}/);
  });

  it('leaves out an empty preheader', () => {
    expect(renderEmailDraft({ subject: 'S', preheader: '  ', body: 'B' }, context)).toEqual({ subject: 'S', body: 'B' });
  });
});
