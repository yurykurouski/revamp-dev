import { describe, it, expect } from 'vitest';
import {
  BrandExtractorService,
  RawBrandExtractionData,
  MIN_BRAND_CONTRAST,
} from '../brand-extractor.service.js';

describe('BrandExtractorService', () => {
  describe('Color parsing and conversions', () => {
    it('should parse standard rgb and rgba strings', () => {
      expect(BrandExtractorService.parseColorToRgb('rgb(255, 0, 128)')).toEqual({
        r: 255,
        g: 0,
        b: 128,
      });

      expect(BrandExtractorService.parseColorToRgb('rgba(0, 100, 200, 0.9)')).toEqual({
        r: 0,
        g: 100,
        b: 200,
      });

      // Ignore transparent colors
      expect(BrandExtractorService.parseColorToRgb('rgba(0, 0, 0, 0)')).toBeNull();
      expect(BrandExtractorService.parseColorToRgb('rgba(255, 255, 255, 0.05)')).toBeNull();
    });

    it('should parse 6-character and 3-character hex codes', () => {
      expect(BrandExtractorService.parseColorToRgb('#ff0088')).toEqual({
        r: 255,
        g: 0,
        b: 136,
      });

      expect(BrandExtractorService.parseColorToRgb('#03f')).toEqual({
        r: 0,
        g: 51,
        b: 255,
      });
    });

    it('should convert RGB to normalized hex string', () => {
      expect(BrandExtractorService.rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080');
      expect(BrandExtractorService.rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
      expect(BrandExtractorService.rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
    });

    it('should return null for invalid color formats', () => {
      expect(BrandExtractorService.parseColorToRgb('invalid-color')).toBeNull();
      expect(BrandExtractorService.parseColorToRgb('')).toBeNull();
    });
  });

  describe('WCAG Luminance and Contrast Calculation', () => {
    it('should calculate accurate relative luminance', () => {
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };

      expect(BrandExtractorService.getLuminance(white)).toBeCloseTo(1.0, 2);
      expect(BrandExtractorService.getLuminance(black)).toBeCloseTo(0.0, 2);
    });

    it('should calculate accurate contrast ratio between colors', () => {
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };

      const maxContrast = BrandExtractorService.getContrastRatio(white, black);
      expect(maxContrast).toBeCloseTo(21.0, 1);

      const minContrast = BrandExtractorService.getContrastRatio(white, white);
      expect(minContrast).toBeCloseTo(1.0, 1);
    });
  });

  describe('K-Means Palette Clustering', () => {
    it('should return default modern palette when no raw colors provided', () => {
      const palette = BrandExtractorService.clusterPalette([]);
      expect(palette.primaryColor).toBe('#2563eb');
      expect(palette.secondaryColor).toBe('#1e293b');
      expect(palette.accentColor).toBe('#06b6d4');
    });

    it('should cluster colors into valid Primary, Secondary, and Accent hex values', () => {
      const sampleColors = [
        'rgb(79, 70, 229)', // Indigo 600
        'rgb(67, 56, 202)', // Indigo 700
        'rgb(99, 102, 241)', // Indigo 500
        'rgb(30, 27, 75)', // Indigo 950
        'rgb(244, 63, 94)', // Rose 500 (vibrant accent)
        'rgb(255, 255, 255)', // Neutral white
        'rgb(17, 24, 39)', // Neutral dark
      ];

      const palette = BrandExtractorService.clusterPalette(sampleColors);

      expect(palette.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.secondaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(palette.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('Monogram Generator', () => {
    it('should generate 2-letter monogram for multi-word business name', () => {
      const svgUri = BrandExtractorService.generateMonogramSvg('Dr. Smile Dental', '#4f46e5', '#f43f5e');
      expect(svgUri).toContain('data:image/svg+xml;utf8');
      expect(decodeURIComponent(svgUri)).toContain('>DS<');
      expect(decodeURIComponent(svgUri)).toContain('#4f46e5');
    });

    it('should generate 1-2 letter monogram for single-word business name', () => {
      const svgUri = BrandExtractorService.generateMonogramSvg('Listonosz', '#2563eb', '#06b6d4');
      expect(decodeURIComponent(svgUri)).toContain('>LI<');
    });

    it('should fallback to default initial when business name is empty', () => {
      const svgUri = BrandExtractorService.generateMonogramSvg('', '#2563eb', '#06b6d4');
      expect(decodeURIComponent(svgUri)).toContain('>R<');
    });
  });

  describe('Font stack sanitization', () => {
    it('should clean and deduplicate font families', () => {
      const rawFonts = [
        '"Inter", sans-serif',
        'Inter, system-ui, -apple-system',
        'inherit',
        'Roboto, sans-serif',
      ];

      const cleaned = BrandExtractorService.sanitizeFontFamilies(rawFonts);
      expect(cleaned).toContain('Inter');
      expect(cleaned).toContain('Roboto');
      expect(cleaned).toContain('sans-serif');
      expect(cleaned).not.toContain('inherit');
    });
  });

  describe('ensureReadablePalette (REV-23)', () => {
    const white = { r: 255, g: 255, b: 255 };
    const contrast = (hex: string) =>
      BrandExtractorService.getContrastRatio(BrandExtractorService.parseColorToRgb(hex)!, white);

    it('should replace a white primary with a readable palette color', () => {
      const palette = BrandExtractorService.ensureReadablePalette({
        primaryColor: '#ffffff',
        secondaryColor: '#000000',
        accentColor: '#d0001c',
      });

      expect(palette.primaryColor).toBe('#d0001c');
      expect(palette.accentColor).toBe('#d0001c');
    });

    it('should keep already readable colors untouched', () => {
      const palette = BrandExtractorService.ensureReadablePalette({
        primaryColor: '#2563eb',
        secondaryColor: '#1e293b',
        accentColor: '#06b6d4',
      });

      expect(palette.primaryColor).toBe('#2563eb');
    });

    it('should darken a pale color when no readable candidate exists', () => {
      const palette = BrandExtractorService.ensureReadablePalette({
        primaryColor: '#ffe4a0',
        secondaryColor: '#fafafa',
        accentColor: '#f0f0f0',
      });

      expect(contrast(palette.primaryColor)).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST);
      expect(contrast(palette.accentColor)).toBeGreaterThanOrEqual(MIN_BRAND_CONTRAST);
    });
  });

  describe('processBrandData', () => {
    it('should aggregate raw extraction data into structured BrandIdentityResult', () => {
      const rawData: RawBrandExtractionData = {
        colors: ['rgb(37, 99, 235)', 'rgb(249, 115, 22)', 'rgb(15, 23, 42)'],
        fontFamilies: ['"Inter", sans-serif'],
        faviconUrl: 'https://example.com/favicon.ico',
        logoUrl: 'https://example.com/logo.png',
        phone: '+1 (555) 123-4567',
        email: 'info@example.com',
        address: '123 Main St, New York, NY',
        workingHours: 'Mon-Fri: 9am - 6pm',
        socialLinks: [{ platform: 'telegram', url: 'https://t.me/example' }],
        services: ['General Dentistry', 'Teeth Whitening', 'Dental Implants'],
      };

      const result = BrandExtractorService.processBrandData(rawData, 'Apex Dental');

      expect(result.tokens.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(result.tokens.logoUrl).toBe('https://example.com/logo.png');
      expect(result.tokens.faviconUrl).toBe('https://example.com/favicon.ico');
      expect(result.tokens.fontFamilies).toContain('Inter');

      expect(result.contacts.phone).toBe('+1 (555) 123-4567');
      expect(result.contacts.email).toBe('info@example.com');
      expect(result.contacts.address).toBe('123 Main St, New York, NY');
      expect(result.contacts.socialLinks).toHaveLength(1);
      expect(result.services).toHaveLength(3);
    });

    it('should assign SVG monogram as logoUrl when no logo is discovered', () => {
      const rawData: RawBrandExtractionData = {
        colors: [],
        fontFamilies: [],
        socialLinks: [],
        services: [],
      };

      const result = BrandExtractorService.processBrandData(rawData, 'Listonosz');
      expect(result.tokens.logoUrl).toContain('data:image/svg+xml');
      expect(decodeURIComponent(result.tokens.logoUrl!)).toContain('>LI<');
    });

    it('should sanitize messy phone numbers and email links', () => {
      const rawData: RawBrandExtractionData = {
        colors: [],
        fontFamilies: [],
        socialLinks: [],
        services: [],
        phone: '  tel:+1 (555) 234-5678  ',
        email: 'mailto:SUPPORT@Clinic.com?subject=Hello ',
      };

      const result = BrandExtractorService.processBrandData(rawData, 'Health Clinic');
      expect(result.contacts.phone).toBe('+1 (555) 234-5678');
      expect(result.contacts.email).toBe('support@clinic.com');
    });

    it('should prefer schema.org data and visible-text heuristics over noisy DOM class matches (REV-23)', () => {
      const rawData: RawBrandExtractionData = {
        colors: [],
        fontFamilies: [],
        socialLinks: [],
        services: ['Implants'],
        phone: '+48 111 222 333',
        address: 'Our address',
        workingHours: 'Centrum handlowe',
        content: {
          headings: [],
          paragraphs: ['A long description of the clinic and what it offers to patients.'],
          serviceItems: [{ title: 'Veneers', description: 'Thin ceramic shells.' }, { title: 'implants' }],
          navItems: [],
          testimonials: [],
          images: [],
          addressText: 'ul. Powstańców Śląskich 126, 01-466 Warszawa',
          workingHoursText: 'Pon-Pt: 09:00 – 19:00',
          structured: { telephone: '+48 22 542 18 04', ratingValue: 4.8, reviewCount: 120, foundingYear: 2005 },
        },
      };

      const result = BrandExtractorService.processBrandData(rawData, 'Clinic');

      expect(result.contacts.phone).toBe('+48 22 542 18 04');
      expect(result.contacts.address).toBe('ul. Powstańców Śląskich 126, 01-466 Warszawa');
      expect(result.contacts.workingHours).toBe('Pon-Pt: 09:00 – 19:00');
      expect(result.services).toEqual(['Implants', 'Veneers']);
      expect(result.siteContent.serviceItems).toEqual([
        { title: 'Veneers', description: 'Thin ceramic shells.' },
        { title: 'implants' },
      ]);
      expect(result.siteContent.rating).toEqual({ value: 4.8, count: 120 });
      expect(result.siteContent.foundingYear).toBe(2005);
      expect(result.siteContent.paragraphs).toHaveLength(1);
    });

    it('should ignore DOM address/hours matches without digits', () => {
      const rawData: RawBrandExtractionData = {
        colors: [],
        fontFamilies: [],
        socialLinks: [],
        services: [],
        address: 'See our address below',
        workingHours: 'Centrum handlowe',
      };

      const result = BrandExtractorService.processBrandData(rawData, 'Mall');
      expect(result.contacts.address).toBeUndefined();
      expect(result.contacts.workingHours).toBeUndefined();
      expect(result.siteContent).toMatchObject({ headings: [], paragraphs: [], serviceItems: [], testimonials: [] });
    });

    it('should bound free-text contact fields at a word boundary', () => {
      expect(BrandExtractorService.sanitizeText('  a   b  ', 10)).toBe('a b');
      expect(BrandExtractorService.sanitizeText('one two three four', 11)).toBe('one two');
      expect(BrandExtractorService.sanitizeText('', 10)).toBeUndefined();
    });

    it('should reject invalid phone and email candidates', () => {
      expect(BrandExtractorService.sanitizePhone('12345')).toBeUndefined(); // too short (< 7 digits)
      expect(BrandExtractorService.sanitizePhone('not-a-number')).toBeUndefined();
      expect(BrandExtractorService.sanitizeEmail('not-an-email')).toBeUndefined();
      expect(BrandExtractorService.sanitizeEmail('missing-domain@')).toBeUndefined();
    });
  });
});
