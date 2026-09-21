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

let localLeadsCache: ILeadItem[] = [...initialMockLeads];

export const apiClient = {
  /**
   * Fetches all leads with optional status, niche, and text filters
   */
  async getLeads(filters?: {
    search?: string;
    status?: string;
    niche?: string;
  }): Promise<{ leads: ILeadItem[]; kpi: KpiMetrics }> {
    try {
      const params = new URLSearchParams();
      if (filters?.status && filters.status !== 'ALL') params.append('status', filters.status);
      if (filters?.niche && filters.niche !== 'ALL') params.append('niche', filters.niche);

      const res = await fetch(`http://localhost:3000/api/leads?${params.toString()}`, {
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
            url: string;
            niche?: NicheType;
            city?: string;
            contacts?: {
              city?: string;
              phone?: string;
            };
            score?: number;
            status: LeadStatus;
            auditId?: string;
            createdAt: string;
          }

          const serverLeads: ILeadItem[] = (data.data as IServerLead[]).map((l) => ({
            id: l._id || l.id || `lead-${Math.random()}`,
            businessName: l.businessName || l.domain || 'Бизнес',
            domain: l.domain || new URL(l.url).hostname,
            originalUrl: l.url,
            niche: l.niche || 'other',
            city: l.city || l.contacts?.city,
            phone: l.contacts?.phone,
            totalScore: l.score,
            status: l.status,
            auditId: l.auditId,
            createdAt: l.createdAt,
          }));

          // Deduplicate by URL/domain
          const existingUrls = new Set(serverLeads.map((s) => s.originalUrl));
          const uniqueLocal = localLeadsCache.filter((l) => !existingUrls.has(l.originalUrl));
          localLeadsCache = [...serverLeads, ...uniqueLocal];
        }
      }
    } catch {
      // Backend not running, use mock dataset
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
    const contactEmail = validated.contactEmail || `info@${domain}`;

    let createdId = `lead-${Date.now()}`;
    let auditId = `audit-${Date.now()}`;

    try {
      const res = await fetch('http://localhost:3000/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName,
          originalUrl: targetUrl,
          contactEmail,
          niche: validated.niche || 'other',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          createdId = data.data._id || createdId;
          auditId = data.data.auditId || auditId;
        }
      }
    } catch {
      // Fallback in case backend is offline
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
};
