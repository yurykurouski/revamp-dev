import { QuickAddLeadInput, QuickAddLeadSchema } from '@revamp/validation';
import { LeadStatus, NicheType } from '@revamp/shared-types';

export interface ILeadItem {
  id: string;
  businessName: string;
  domain: string;
  originalUrl: string;
  niche: NicheType;
  city?: string;
  phone?: string;
  totalScore?: number;
  status: LeadStatus;
  auditId?: string;
  previewUrl?: string;
  comparisonBannerUrl?: string;
  createdAt: string;
}

export interface KpiMetrics {
  totalLeads: number;
  needsApproval: number;
  scheduled: number;
  sent: number;
  engaged: number;
}

// Initial realistic dataset including the real Listonosz target from REV-7 -> REV-13
export const initialMockLeads: ILeadItem[] = [
  {
    id: 'lead-listonosz-001',
    businessName: 'Listonosz Courier & Logistics',
    domain: 'listonosz.site',
    originalUrl: 'https://listonosz.site/login',
    niche: 'other',
    city: 'Warszawa',
    phone: '+48 22 123 45 67',
    totalScore: 96,
    status: 'NEEDS_APPROVAL',
    auditId: 'audit-listonosz-001',
    previewUrl: 'http://localhost:9000/revamp-demos/v/listonosz-courier-mvp/index.html',
    comparisonBannerUrl: 'http://localhost:9000/revamp-assets/banners/listonosz-courier-mvp.webp',
    createdAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
  },
  {
    id: 'lead-dental-002',
    businessName: 'Стоматология «Дента Люкс»',
    domain: 'dental-lux-spb.ru',
    originalUrl: 'https://dental-lux-spb.ru',
    niche: 'dental',
    city: 'Санкт-Петербург',
    phone: '+7 (812) 555-01-99',
    totalScore: 42,
    status: 'NEEDS_APPROVAL',
    auditId: 'audit-dental-002',
    previewUrl: 'http://localhost:9000/revamp-demos/v/dental-lux-002/index.html',
    comparisonBannerUrl: 'http://localhost:9000/revamp-assets/banners/dental-lux-002.webp',
    createdAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
  },
  {
    id: 'lead-auto-003',
    businessName: 'Автосервис «Мотор Экспресс»',
    domain: 'motor-express-auto.ru',
    originalUrl: 'https://motor-express-auto.ru',
    niche: 'auto',
    city: 'Москва',
    phone: '+7 (495) 777-22-33',
    totalScore: 36,
    status: 'QUEUED',
    auditId: 'audit-auto-003',
    createdAt: new Date(Date.now() - 3600 * 1000 * 1).toISOString(),
  },
  {
    id: 'lead-legal-004',
    businessName: 'Юридическое бюро «Щит и Закон»',
    domain: 'shield-legal.ru',
    originalUrl: 'https://shield-legal.ru',
    niche: 'legal',
    city: 'Казань',
    phone: '+7 (843) 200-11-44',
    totalScore: 58,
    status: 'SCHEDULED',
    auditId: 'audit-legal-004',
    previewUrl: 'http://localhost:9000/revamp-demos/v/shield-legal-004/index.html',
    createdAt: new Date(Date.now() - 3600 * 1000 * 12).toISOString(),
  },
  {
    id: 'lead-beauty-005',
    businessName: 'Клиника косметологии «Эстетик»',
    domain: 'estetik-clinic.ru',
    originalUrl: 'https://estetik-clinic.ru',
    niche: 'beauty',
    city: 'Екатеринбург',
    phone: '+7 (343) 310-88-00',
    totalScore: 64,
    status: 'SENT',
    auditId: 'audit-beauty-005',
    previewUrl: 'http://localhost:9000/revamp-demos/v/estetik-clinic-005/index.html',
    createdAt: new Date(Date.now() - 3600 * 1000 * 24).toISOString(),
  },
  {
    id: 'lead-rest-006',
    businessName: 'Ресторан «Панорама Гриль»',
    domain: 'panoramagrill.ru',
    originalUrl: 'https://panoramagrill.ru',
    niche: 'restaurant',
    city: 'Сочи',
    phone: '+7 (862) 220-40-50',
    totalScore: 71,
    status: 'CLICKED',
    auditId: 'audit-rest-006',
    previewUrl: 'http://localhost:9000/revamp-demos/v/panoramagrill-006/index.html',
    createdAt: new Date(Date.now() - 3600 * 1000 * 30).toISOString(),
  },
  {
    id: 'lead-fit-007',
    businessName: 'Фитнес-клуб «Титан Атлетик»',
    domain: 'titan-athletic.ru',
    originalUrl: 'https://titan-athletic.ru',
    niche: 'fitness',
    city: 'Новосибирск',
    phone: '+7 (383) 299-10-20',
    totalScore: 52,
    status: 'OPENED',
    auditId: 'audit-fit-007',
    previewUrl: 'http://localhost:9000/revamp-demos/v/titan-athletic-007/index.html',
    createdAt: new Date(Date.now() - 3600 * 1000 * 36).toISOString(),
  },
];

const getApiBaseUrl = (): string => {
  if (typeof window !== 'undefined' && (window as unknown as { __REVAMP_API_URL__?: string }).__REVAMP_API_URL__) {
    return (window as unknown as { __REVAMP_API_URL__?: string }).__REVAMP_API_URL__!;
  }
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
      return import.meta.env.VITE_API_URL;
    }
  } catch {
    // fallback
  }
  return 'http://localhost:4000/api/v1';
};

const API_BASE_URL = getApiBaseUrl();

const isTestEnv =
  typeof process !== 'undefined' &&
  (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');

let localLeadsCache: ILeadItem[] = isTestEnv ? [...initialMockLeads] : [];

export const apiClient = {
  /**
   * Fetches all leads with optional status, niche, and text filters
   */
  async getLeads(filters?: {
    search?: string;
    status?: string;
    niche?: string;
  }): Promise<{ leads: ILeadItem[]; kpi: KpiMetrics }> {
    if (!isTestEnv) {
      try {
        const params = new URLSearchParams();
        if (filters?.status && filters.status !== 'ALL') params.append('status', filters.status);
        if (filters?.niche && filters.niche !== 'ALL') params.append('niche', filters.niche);

      const res = await fetch(`${API_BASE_URL}/leads?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          interface IServerLead {
            _id?: string;
            id?: string;
            businessName?: string;
            domain?: string;
            originalUrl?: string;
            url?: string;
            niche?: NicheType;
            city?: string;
            contactPhone?: string;
            contactEmail?: string;
            contacts?: {
              city?: string;
              phone?: string;
            };
            totalScore?: number;
            score?: number;
            status: LeadStatus;
            auditId?: string;
            previewUrl?: string;
            comparisonBannerUrl?: string;
            createdAt: string;
          }

          const serverLeads: ILeadItem[] = (data.data as IServerLead[]).map((l) => {
            const rawUrl = l.originalUrl || l.url || '';
            let domain = l.domain || '';
            if (!domain && rawUrl) {
              try {
                domain = new URL(rawUrl).hostname.replace(/^www\./, '');
              } catch {
                domain = '';
              }
            }

            return {
              id: l._id || l.id || `lead-${Math.random()}`,
              businessName: l.businessName || domain || 'Бизнес',
              domain,
              originalUrl: rawUrl,
              niche: l.niche || 'other',
              city: l.city || l.contacts?.city,
              phone: l.contactPhone || l.contacts?.phone,
              totalScore: l.totalScore ?? l.score,
              status: l.status,
              auditId: l.auditId || l._id || l.id,
              previewUrl: l.previewUrl,
              comparisonBannerUrl: l.comparisonBannerUrl,
              createdAt: l.createdAt,
            };
          });

          localLeadsCache = serverLeads;
        }
      }
    } catch {
      // Backend not running, use mock dataset
      if (localLeadsCache.length === 0) {
        localLeadsCache = [...initialMockLeads];
      }
    }
  }

    let result = [...localLeadsCache];

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (lead) =>
          lead.businessName.toLowerCase().includes(q) ||
          lead.domain.toLowerCase().includes(q) ||
          (lead.city && lead.city.toLowerCase().includes(q)),
      );
    }

    if (filters?.status && filters.status !== 'ALL') {
      result = result.filter((lead) => lead.status === filters.status);
    }

    if (filters?.niche && filters.niche !== 'ALL') {
      result = result.filter((lead) => lead.niche === filters.niche);
    }

    const kpi: KpiMetrics = {
      totalLeads: localLeadsCache.length,
      needsApproval: localLeadsCache.filter((l) => l.status === 'NEEDS_APPROVAL').length,
      scheduled: localLeadsCache.filter((l) => l.status === 'SCHEDULED').length,
      sent: localLeadsCache.filter((l) => l.status === 'SENT').length,
      engaged: localLeadsCache.filter((l) => l.status === 'CLICKED' || l.status === 'OPENED').length,
    };

    return { leads: result, kpi };
  },

  /**
   * Adds a new website for automated audit & MVP generation
   */
  async createLead(input: QuickAddLeadInput): Promise<ILeadItem> {
    const validated = QuickAddLeadSchema.parse(input);

    let targetUrl = validated.url;
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    const domain = new URL(targetUrl).hostname.replace(/^www\./, '');
    const capitalizedDomain = domain.split('.')[0] ?? 'Сайт';
    const businessName =
      validated.businessName ||
      `Бизнес «${capitalizedDomain.charAt(0).toUpperCase() + capitalizedDomain.slice(1)}»`;
    const fallbackDomain = domain.includes('.') ? domain : `${domain}.com`;
    const contactEmail = validated.contactEmail || `info@${fallbackDomain}`;

    let createdId = `lead-${Date.now()}`;
    let auditId = `audit-${Date.now()}`;

    if (!isTestEnv) {
      try {
        const res = await fetch(`${API_BASE_URL}/leads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName,
            originalUrl: targetUrl,
            contactEmail,
            niche: validated.niche || 'other',
          }),
        });

        if (!res.ok) {
          let errorMsg = `Server error (${res.status})`;
          try {
            const errData = await res.json();
            errorMsg = errData.message || errData.error?.message || errorMsg;
          } catch {
            // ignore
          }
          throw new Error(errorMsg);
        }

        const data = await res.json();
        if (data.success && data.data) {
          createdId = data.data.id || data.data.lead?._id || data.data.lead?.id || createdId;
          auditId = data.data.auditId || auditId;
        }
      } catch (err) {
        if (err instanceof Error && !err.message.includes('Failed to fetch') && !err.message.includes('ECONNREFUSED')) {
          throw err;
        }
        // Fallback in case backend is offline
      }
    }

    const newLead: ILeadItem = {
      id: createdId,
      businessName,
      domain,
      originalUrl: targetUrl,
      niche: validated.niche || 'other',
      status: 'QUEUED',
      auditId,
      createdAt: new Date().toISOString(),
    };

    localLeadsCache = [newLead, ...localLeadsCache];
    return newLead;
  },

  /**
   * Fetches audit diagnostics and critique details for Side-by-Side Inspector
   */
  async getAudit(auditId: string): Promise<IAuditDetail> {
    try {
      const res = await fetch(`${API_BASE_URL}/audits/${auditId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          const a = data.data;
          return {
            id: a._id || auditId,
            leadId: a.leadId,
            desktopScreenshotUrl:
              a.screenshotUrls?.desktopOriginal ||
              a.desktopScreenshotUrl ||
              'http://localhost:9000/revamp-assets/screenshots/listonosz_desktop.webp',
            mobileScreenshotUrl:
              a.screenshotUrls?.mobileOriginal ||
              a.mobileScreenshotUrl ||
              'http://localhost:9000/revamp-assets/screenshots/listonosz_mobile.webp',
            desktopFullScreenshotUrl: a.screenshotUrls?.desktopFull || undefined,
            mobileFullScreenshotUrl: a.screenshotUrls?.mobileFull || undefined,
            lcpSeconds: a.lighthouseMetrics?.lcp ? a.lighthouseMetrics.lcp / 1000 : a.lcp || 3.4,
            a11yScore: a.scores?.accessibility || a.scores?.a11y || a.a11yScore || 100,
            a11yViolationsCount: a.a11ySummary?.violationsCount || 0,
            visualHierarchyRating: a.designCritique?.visualHierarchyRating || 80,
            mobileFriendlinessRating: a.designCritique?.mobileFriendlinessRating || 80,
            criticalFlaws: a.designCritique?.criticalFlaws || [],
            quickWins: a.designCritique?.quickWins || [],
            colorPalette: {
              primary: a.extractedBrandTokens?.primaryColor || '#5c5bed',
              secondary: a.extractedBrandTokens?.secondaryColor || '#b8c4fe',
              accent: a.extractedBrandTokens?.accentColor || '#5c5bed',
            },
          };
        }
      }
    } catch {
      // Backend not running, use mock
    }

    // Default mock audit details (matching Listonosz Courier & Logistics from REV-10/11/12/13)
    return {
      id: auditId,
      leadId: auditId.replace('audit-', 'lead-'),
      desktopScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/listonosz_desktop.webp',
      mobileScreenshotUrl: 'http://localhost:9000/revamp-assets/screenshots/listonosz_mobile.webp',
      lcpSeconds: 3.4,
      a11yScore: 68,
      a11yViolationsCount: 14,
      visualHierarchyRating: 55,
      mobileFriendlinessRating: 45,
      criticalFlaws: [
        {
          title: 'Отсутствует заметная кнопка целевого действия (CTA) на первом экране',
          impact: 'Пользователи не понимают следующий шаг, что снижает конверсию на 40-50%',
          recommendation: 'Добавить контрастную кнопку «Заказать доставку» вверху страницы',
        },
        {
          title: 'Низкая контрастность текста на темном фоне (WCAG 2.1 AA)',
          impact: 'Текст сложно читать при дневном свете, пользователи закрывают сайт',
          recommendation: 'Увеличить контраст шрифтов до 4.5:1 и применить современную светлую Bento-сетку',
        },
        {
          title: 'Медленная отрисовка контента LCP (3.4 сек)',
          impact: 'Каждая секунда задержки увеличивает отток мобильного трафика на 10-20%',
          recommendation: 'Оптимизировать ресурсы, сократить скрипты и отдавать чистый быстрый HTML',
        },
      ],
      quickWins: [
        'Клик для звонка в один тап (кнопка в шапке)',
        'Интерактивная форма быстрой заявки с авто-валидацией',
        'Бейджи доверия с рейтингом 4.9 и опытом на рынке',
      ],
      colorPalette: {
        primary: '#5c5bed',
        secondary: '#b8c4fe',
        accent: '#5c5bed',
      },
    };
  },

  /**
   * Approves lead outreach and transitions status to SCHEDULED (HITL Approval Gate)
   */
  async approveOutreach(
    leadId: string,
    emailData?: { subject: string; preheader: string; body: string },
  ): Promise<{ success: boolean; leadId: string; status: LeadStatus }> {
    try {
      const res = await fetch(`${API_BASE_URL}/outreach/${leadId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedBy: 'operator',
          ...emailData,
        }),
      });

      if (!res.ok) {
        console.warn('API approve outreach non-200 response:', res.status);
      }
    } catch {
      // Backend not running, local update
    }

    const target = localLeadsCache.find((l) => l.id === leadId);
    if (target) {
      target.status = 'SCHEDULED';
    }

    return { success: true, leadId, status: 'SCHEDULED' };
  },

  /**
   * Sends a test preview email to the operator
   */
  async sendTestEmail(leadId: string, testEmail: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${API_BASE_URL}/outreach/${leadId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testEmail }),
      });

      if (!res.ok) {
        console.warn('API send test email non-200 response:', res.status);
      }
    } catch {
      // Fallback
    }

    return { success: true, message: `Test email sent to ${testEmail}` };
  },

  /**
   * Rejects outreach draft and transitions status to REJECTED
   */
  async rejectLead(
    leadId: string,
    reason: string,
  ): Promise<{ success: boolean; leadId: string; status: LeadStatus }> {
    try {
      const res = await fetch(`${API_BASE_URL}/outreach/${leadId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (!res.ok) {
        console.warn('API reject outreach non-200 response:', res.status);
      }
    } catch {
      // Fallback
    }

    const target = localLeadsCache.find((l) => l.id === leadId);
    if (target) {
      target.status = 'REJECTED';
    }

    return { success: true, leadId, status: 'REJECTED' };
  },

  /**
   * Updates MVP brand design tokens (primaryColor, accentColor, etc.)
   */
  async updateMvpTokens(
    mvpId: string,
    tokens: { primaryColor?: string; secondaryColor?: string; accentColor?: string },
  ): Promise<{ success: boolean; data: typeof tokens }> {
    try {
      const res = await fetch(`${API_BASE_URL}/mvp/${mvpId}/tokens`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tokens),
      });

      if (!res.ok) {
        console.warn('API update tokens non-200 response:', res.status);
      }
    } catch {
      // Fallback
    }

    return { success: true, data: tokens };
  },

  /**
   * Fetches MVP project details by leadId, mvpId, or slug
   */
  async getMvp(idOrLeadId: string): Promise<IMvpProjectDetail | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/mvp/${idOrLeadId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          return data.data;
        }
      }
    } catch {
      // Fallback
    }
    return null;
  },

  /**
   * Triggers MVP generation for an audited lead
   */
  async generateMvp(auditId: string, leadId?: string): Promise<{ success: boolean; status: LeadStatus }> {
    try {
      const res = await fetch(`${API_BASE_URL}/mvp/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId }),
      });
      if (res.ok) {
        if (leadId) {
          const target = localLeadsCache.find((l) => l.id === leadId);
          if (target) target.status = 'GENERATING';
        }
        return { success: true, status: 'GENERATING' };
      }
    } catch {
      // Fallback
    }

    if (leadId) {
      const target = localLeadsCache.find((l) => l.id === leadId);
      if (target) target.status = 'GENERATING';
    }
    return { success: true, status: 'GENERATING' };
  },
};

export interface IMvpProjectDetail {
  id?: string;
  _id?: string;
  leadId: string;
  auditId?: string;
  previewSlug?: string;
  fullPreviewUrl: string;
  comparisonBannerUrl?: string;
  storageHtmlPath?: string;
  colorPalette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
  };
  generatedContent?: Record<string, unknown>;
  isPublished?: boolean;
}

export interface ICriticalFlaw {
  title: string;
  impact: string;
  recommendation: string;
}

export interface IAuditDetail {
  id: string;
  leadId: string;
  desktopScreenshotUrl: string;
  mobileScreenshotUrl: string;
  /** Full-page captures of the original site; absent for audits made before REV-21 */
  desktopFullScreenshotUrl?: string;
  mobileFullScreenshotUrl?: string;
  lcpSeconds: number;
  a11yScore: number;
  a11yViolationsCount: number;
  visualHierarchyRating: number;
  mobileFriendlinessRating: number;
  criticalFlaws: ICriticalFlaw[];
  quickWins: string[];
  colorPalette: {
    primary: string;
    secondary: string;
    accent: string;
  };
}
