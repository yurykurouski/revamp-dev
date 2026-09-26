import { IExtractedBrandTokens, IExtractedContacts, ISiteContent } from '@revamp/shared-types';
import { RawSiteContent } from './site-content.extractor.js';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface RawBrandExtractionData {
  colors: string[];
  fontFamilies: string[];
  faviconUrl?: string;
  logoUrl?: string;
  phone?: string;
  email?: string;
  address?: string;
  workingHours?: string;
  socialLinks: Array<{ platform: string; url: string }>;
  services: string[];
  /** The site's own copy and structured business data (REV-23) */
  content?: RawSiteContent;
}

export interface BrandIdentityResult {
  tokens: IExtractedBrandTokens;
  contacts: IExtractedContacts;
  services: string[];
  siteContent: ISiteContent;
  monogramSvg: string;
}

/** Minimum contrast against white for colors used as button / accent backgrounds */
export const MIN_BRAND_CONTRAST = 3;

export class BrandExtractorService {
  /**
   * Parses a variety of CSS color representations (rgb, rgba, hex, named) into an RGB object.
   */
  static parseColorToRgb(colorStr: string): RgbColor | null {
    if (!colorStr || typeof colorStr !== 'string') return null;
    const clean = colorStr.trim().toLowerCase();

    // 1. Check rgb / rgba format: rgb(255, 0, 0) or rgba(255, 0, 0, 0.5)
    const rgbMatch = clean.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (rgbMatch && rgbMatch[1] && rgbMatch[2] && rgbMatch[3]) {
      const alpha = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
      if (alpha < 0.1) return null; // ignore transparent
      return {
        r: Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10))),
        g: Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10))),
        b: Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10))),
      };
    }

    // 2. Check Hex format: #fff, #ffffff
    const hexMatch = clean.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch && hexMatch[1]) {
      let hex = hexMatch[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex
          .split('')
          .map((c) => c + c)
          .join('');
      }
      if (hex.length >= 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return { r, g, b };
      }
    }

    return null;
  }

  /**
   * Converts RGB components into normalized 6-character hex string (#RRGGBB)
   */
  static rgbToHex(rgb: RgbColor): string {
    const toHex = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  }

  /**
   * Computes Euclidean distance between two RGB colors
   */
  static colorDistance(c1: RgbColor, c2: RgbColor): number {
    return Math.sqrt((c1.r - c2.r) ** 2 + (c1.g - c2.g) ** 2 + (c1.b - c2.b) ** 2);
  }

  /**
   * Computes WCAG 2.1 relative luminance for an RGB color
   */
  static getLuminance(rgb: RgbColor): number {
    const a = [rgb.r, rgb.g, rgb.b].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0]! + 0.7152 * a[1]! + 0.0722 * a[2]!;
  }

  /**
   * Computes WCAG contrast ratio between two colors (range: 1.0 to 21.0)
   */
  static getContrastRatio(colorA: RgbColor, colorB: RgbColor): number {
    const lumA = this.getLuminance(colorA);
    const lumB = this.getLuminance(colorB);
    const brightest = Math.max(lumA, lumB);
    const darkest = Math.min(lumA, lumB);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  /**
   * Evaluates color saturation/chromaticity in range 0.0 - 1.0
   */
  static getSaturation(rgb: RgbColor): number {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (max === 0) return 0;
    return delta / max;
  }

  /**
   * Performs K-Means clustering over a collection of CSS color strings.
   * Extracts:
   * - primaryColor: dominant chromatic brand color
   * - secondaryColor: complementary background/text brand color
   * - accentColor: highest saturation / vibrant CTA color
   */
  static clusterPalette(rawColors: string[]): {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
  } {
    // 1. Parse all valid RGB points
    const rgbPoints: RgbColor[] = [];
    for (const raw of rawColors) {
      const rgb = this.parseColorToRgb(raw);
      if (rgb) rgbPoints.push(rgb);
    }

    // Default fallback if no colors found
    const defaultPalette = {
      primaryColor: '#2563eb', // Royal Blue
      secondaryColor: '#1e293b', // Slate 800
      accentColor: '#06b6d4', // Cyan
    };

    if (rgbPoints.length === 0) {
      return defaultPalette;
    }

    // 2. Separate chromatic (colorful) colors from neutrals (pure black/white/gray)
    const chromaticPoints = rgbPoints.filter((p) => {
      const sat = this.getSaturation(p);
      const lum = this.getLuminance(p);
      // exclude pure whites (lum > 0.92) and pure blacks (lum < 0.04) from chromatic seeds
      return sat >= 0.15 && lum <= 0.92 && lum >= 0.04;
    });

    const candidatePoints = chromaticPoints.length >= 3 ? chromaticPoints : rgbPoints;

    // 3. Initialize K-Means centroids (k = 3)
    const k = 3;
    let centroids: RgbColor[] = [];

    if (candidatePoints.length <= k) {
      centroids = [...candidatePoints];
      while (centroids.length < k) {
        centroids.push(rgbPoints[0] || { r: 37, g: 99, b: 235 });
      }
    } else {
      // Pick diverse initial centroids using k-means++ style distance heuristic
      centroids.push(candidatePoints[0]!);
      for (let i = 1; i < k; i++) {
        let maxDist = -1;
        let bestCandidate = candidatePoints[0]!;
        for (const p of candidatePoints) {
          const minDistToCentroids = Math.min(...centroids.map((c) => this.colorDistance(p, c)));
          if (minDistToCentroids > maxDist) {
            maxDist = minDistToCentroids;
            bestCandidate = p;
          }
        }
        centroids.push(bestCandidate);
      }
    }

    // 4. Run K-Means iterations (12 rounds)
    for (let iter = 0; iter < 12; iter++) {
      const clusters: RgbColor[][] = Array.from({ length: k }, () => []);

      for (const p of candidatePoints) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < k; i++) {
          const dist = this.colorDistance(p, centroids[i]!);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        clusters[bestIdx]!.push(p);
      }

      // Recompute centroids
      for (let i = 0; i < k; i++) {
        const cluster = clusters[i]!;
        if (cluster.length > 0) {
          const sum = cluster.reduce(
            (acc, curr) => ({ r: acc.r + curr.r, g: acc.g + curr.g, b: acc.b + curr.b }),
            { r: 0, g: 0, b: 0 },
          );
          centroids[i] = {
            r: Math.round(sum.r / cluster.length),
            g: Math.round(sum.g / cluster.length),
            b: Math.round(sum.b / cluster.length),
          };
        }
      }
    }

    // 5. Select Primary, Secondary, and Accent from centroids
    // Sort centroids by saturation and distinctiveness
    const sortedBySaturation = [...centroids].sort((a, b) => this.getSaturation(b) - this.getSaturation(a));
    const sortedByLuminance = [...centroids].sort((a, b) => this.getLuminance(a) - this.getLuminance(b));

    const accentColor = this.rgbToHex(sortedBySaturation[0]!);
    const primaryColor = this.rgbToHex(centroids[0]!);
    const secondaryColor = this.rgbToHex(
      sortedByLuminance[sortedByLuminance.length - 1]!.r === centroids[0]!.r
        ? sortedByLuminance[0]!
        : sortedByLuminance[sortedByLuminance.length - 1]!,
    );

    return {
      primaryColor: primaryColor || defaultPalette.primaryColor,
      secondaryColor: secondaryColor || defaultPalette.secondaryColor,
      accentColor: accentColor || defaultPalette.accentColor,
    };
  }

  /**
   * Generates a modern vector SVG Monogram data URI when no image logo is present
   */
  static generateMonogramSvg(businessName: string = 'Revamp', primaryColor: string = '#2563eb', accentColor: string = '#06b6d4'): string {
    // Extract 1 or 2 letter initials
    const words = businessName.trim().split(/\s+/).filter(Boolean);
    let initials = 'R';
    if (words.length >= 2 && words[0] && words[1]) {
      initials = (words[0][0]! + words[1][0]!).toUpperCase();
    } else if (words.length === 1 && words[0]) {
      initials = words[0].substring(0, Math.min(2, words[0].length)).toUpperCase();
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryColor}"/>
      <stop offset="100%" stop-color="${accentColor}"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="24" fill="url(#brandGrad)"/>
  <text x="50" y="52" dominant-baseline="central" text-anchor="middle" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-weight="800" font-size="${initials.length > 1 ? 38 : 44}" fill="#ffffff" letter-spacing="1">${initials}</text>
</svg>`;

    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  /**
   * Cleans and formats font family strings
   */
  static sanitizeFontFamilies(fonts: string[]): string[] {
    const set = new Set<string>();
    for (const f of fonts) {
      if (!f) continue;
      // split comma-separated font stacks: "Inter, sans-serif" -> ["Inter", "sans-serif"]
      const parts = f.split(',').map((p) => p.replace(/['"]/g, '').trim());
      for (const p of parts) {
        if (p && !['inherit', 'initial', 'unset', '-apple-system', 'blinkmacsystemfont'].includes(p.toLowerCase())) {
          set.add(p);
        }
      }
    }
    return Array.from(set).slice(0, 6);
  }

  /**
   * Sanitizes phone strings: strips tel:, extraneous whitespace/quotes, validates 7-18 digits
   */
  static sanitizePhone(phone?: string): string | undefined {
    if (!phone || typeof phone !== 'string') return undefined;
    const clean = phone.trim().replace(/^tel:/i, '').replace(/['"]/g, '');
    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 18) {
      return undefined;
    }
    return clean.replace(/\s+/g, ' ').trim();
  }

  /**
   * Sanitizes email strings: strips mailto:, query params, lowercases, validates RFC regex
   */
  static sanitizeEmail(email?: string): string | undefined {
    if (!email || typeof email !== 'string') return undefined;
    const clean = email.trim().replace(/^mailto:/i, '').split('?')[0]?.trim().toLowerCase();
    if (!clean) return undefined;
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(clean)) {
      return undefined;
    }
    return clean;
  }

  /**
   * Aggregates raw in-page extraction data into structured BrandIdentityResult
   */
  static processBrandData(rawData: RawBrandExtractionData, businessName: string = 'Business'): BrandIdentityResult {
    const palette = this.ensureReadablePalette(this.clusterPalette(rawData.colors));
    const monogramSvg = this.generateMonogramSvg(businessName, palette.primaryColor, palette.accentColor);
    const fontFamilies = this.sanitizeFontFamilies(rawData.fontFamilies);

    const logoUrl = rawData.logoUrl || monogramSvg;
    const content = rawData.content;
    const structured = content?.structured;

    // Contact precedence: schema.org data > dedicated DOM element > visible-text heuristics
    const contacts: IExtractedContacts = {
      phone: this.sanitizePhone(structured?.telephone || rawData.phone),
      email: this.sanitizeEmail(structured?.email || rawData.email),
      // DOM class matches ("[class*=address]", "[class*=hours]") are noisy: trust them only with digits
      address: this.sanitizeText(
        structured?.address || content?.addressText || this.withDigits(rawData.address),
        150,
      ),
      workingHours: this.sanitizeText(
        structured?.openingHours || content?.workingHoursText || this.withDigits(rawData.workingHours),
        100,
      ),
      socialLinks: rawData.socialLinks || [],
    };

    const serviceTitles = [
      ...(rawData.services || []),
      ...(content?.serviceItems || []).map((s) => s.title),
    ];
    const services = serviceTitles.filter(
      (title, idx) => serviceTitles.findIndex((t) => t.toLowerCase() === title.toLowerCase()) === idx,
    );

    return {
      tokens: {
        primaryColor: palette.primaryColor,
        secondaryColor: palette.secondaryColor,
        accentColor: palette.accentColor,
        fontFamilies: fontFamilies.length > 0 ? fontFamilies : ['Inter', 'sans-serif'],
        logoUrl,
        faviconUrl: rawData.faviconUrl,
      },
      contacts,
      services,
      siteContent: this.toSiteContent(content, rawData),
      monogramSvg,
    };
  }

  /**
   * Normalizes raw in-page content into the persisted ISiteContent shape.
   */
  static toSiteContent(content: RawSiteContent | undefined, rawData: RawBrandExtractionData): ISiteContent {
    const serviceItems = [...(content?.serviceItems || [])];
    for (const title of rawData.services || []) {
      if (!serviceItems.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
        serviceItems.push({ title });
      }
    }

    return {
      language: content?.language,
      title: content?.title,
      metaDescription: content?.metaDescription,
      ogImage: content?.ogImage,
      h1: content?.h1,
      headings: content?.headings || [],
      paragraphs: content?.paragraphs || [],
      serviceItems,
      navItems: content?.navItems || [],
      testimonials: content?.testimonials || [],
      images: content?.images || [],
      rating: content?.structured?.ratingValue
        ? { value: content.structured.ratingValue, count: content.structured.reviewCount }
        : undefined,
      foundingYear: content?.structured?.foundingYear,
    };
  }

  static withDigits(value?: string): string | undefined {
    return value && /\d/.test(value) ? value : undefined;
  }

  /**
   * Collapses whitespace and bounds the length of free-text contact fields.
   */
  static sanitizeText(value: string | undefined, maxLength: number): string | undefined {
    const clean = (value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return undefined;
    return clean.length > maxLength ? clean.slice(0, maxLength).replace(/[\s,;]+\S*$/, '') : clean;
  }

  /**
   * Guarantees primary and accent colors are usable as backgrounds for white text.
   * Pale colors (e.g. a white page background picked as "primary") are replaced with a more
   * readable palette color when one exists, otherwise darkened until they reach MIN_BRAND_CONTRAST.
   */
  static ensureReadablePalette(palette: { primaryColor: string; secondaryColor: string; accentColor: string }) {
    const white: RgbColor = { r: 255, g: 255, b: 255 };
    const isReadable = (hex: string) => {
      const rgb = this.parseColorToRgb(hex);
      return rgb ? this.getContrastRatio(rgb, white) >= MIN_BRAND_CONTRAST : false;
    };

    const candidates = [palette.primaryColor, palette.accentColor, palette.secondaryColor]
      .map((hex) => this.parseColorToRgb(hex))
      .filter((rgb): rgb is RgbColor => rgb !== null)
      .filter((rgb) => this.getContrastRatio(rgb, white) >= MIN_BRAND_CONTRAST)
      .sort((a, b) => this.getSaturation(b) - this.getSaturation(a));

    const primaryColor = isReadable(palette.primaryColor)
      ? palette.primaryColor
      : candidates[0]
        ? this.rgbToHex(candidates[0])
        : this.darkenUntilReadable(palette.primaryColor);

    const accentColor = isReadable(palette.accentColor) ? palette.accentColor : primaryColor;

    return { primaryColor, secondaryColor: palette.secondaryColor, accentColor };
  }

  /**
   * Darkens a color in 10% steps until it reaches MIN_BRAND_CONTRAST against white.
   */
  static darkenUntilReadable(hex: string): string {
    const white: RgbColor = { r: 255, g: 255, b: 255 };
    let rgb = this.parseColorToRgb(hex) || { r: 37, g: 99, b: 235 };
    for (let i = 0; i < 12 && this.getContrastRatio(rgb, white) < MIN_BRAND_CONTRAST; i++) {
      rgb = { r: rgb.r * 0.85, g: rgb.g * 0.85, b: rgb.b * 0.85 };
    }
    return this.rgbToHex(rgb);
  }
}

export const brandExtractorService = new BrandExtractorService();
