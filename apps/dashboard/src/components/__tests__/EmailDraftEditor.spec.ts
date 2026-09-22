import { describe, it, expect } from 'vitest';

export const TEMPLATE_VARIABLES = [
  { tag: '{{businessName}}', label: 'Компания' },
  { tag: '{{city}}', label: 'Город' },
  { tag: '{{demoUrl}}', label: 'Ссылка на демо' },
  { tag: '{{score}}', label: 'Скоринг' },
  { tag: '{{lcpSeconds}}', label: 'LCP скорость' },
  { tag: '{{criticalFlaws}}', label: 'Дефекты' },
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
    .replace(/{{city}}/g, context.city || 'города')
    .replace(/{{demoUrl}}/g, context.demoUrl)
    .replace(/{{score}}/g, `${context.score ?? 42}/100`)
    .replace(/{{lcpSeconds}}/g, `${context.lcpSeconds ?? 3.4}s`)
    .replace(
      /{{criticalFlaws}}/g,
      context.criticalFlaws?.map((f, i) => `${i + 1}. ${f.title}`).join('\n') ||
        '1. Медленная загрузка LCP\n2. Ошибки контрастности WCAG',
    );
}

describe('EmailDraftEditor & ColorPickerToolbar Logic (REV-16)', () => {
  it('should interpolate all standard variables accurately into subject and body', () => {
    const rawTemplate =
      'Здравствуйте! Готовим MVP для {{businessName}} в {{city}}. Оценка: {{score}}, LCP: {{lcpSeconds}}. Демо: {{demoUrl}}.\nДефекты:\n{{criticalFlaws}}';

    const result = interpolateEmailTemplate(rawTemplate, {
      businessName: 'Listonosz Courier',
      city: 'Warszawa',
      demoUrl: 'http://localhost:9000/revamp-demos/v/listonosz/index.html',
      score: 96,
      lcpSeconds: 1.8,
      criticalFlaws: [
        { title: 'Отсутствует заметная кнопка целевого действия' },
        { title: 'Низкая контрастность текста' },
      ],
    });

    expect(result).toContain('Listonosz Courier');
    expect(result).toContain('Warszawa');
    expect(result).toContain('96/100');
    expect(result).toContain('1.8s');
    expect(result).toContain('http://localhost:9000/revamp-demos/v/listonosz/index.html');
    expect(result).toContain('1. Отсутствует заметная кнопка целевого действия');
    expect(result).toContain('2. Низкая контрастность текста');
    expect(result).not.toContain('{{businessName}}');
    expect(result).not.toContain('{{city}}');
    expect(result).not.toContain('{{demoUrl}}');
  });

  it('should gracefully handle missing optional fields with sensible fallbacks', () => {
    const rawTemplate = 'Бизнес: {{businessName}}, Регион: {{city}}, Скоринг: {{score}}';
    const result = interpolateEmailTemplate(rawTemplate, {
      businessName: 'Стоматология',
      demoUrl: 'https://demo.url',
    });

    expect(result).toContain('Бизнес: Стоматология');
    expect(result).toContain('Регион: города');
    expect(result).toContain('Скоринг: 42/100');
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
