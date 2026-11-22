import { Types, type Aggregate, type Query, type Document, type Model } from 'mongoose';
import { AnalyticsEvent, type IAnalyticsEventDocument } from '../models/AnalyticsEvent.model.js';
import { EmailCampaign, type IEmailCampaignDocument } from '../models/EmailCampaign.model.js';
import { Lead, type ILeadDocument } from '../models/Lead.model.js';
import { MvpProject, type IMvpProjectDocument } from '../models/MvpProject.model.js';

// REV-209: the one place the API reads and writes tenant-owned data (leads, MVPs, campaigns, events). Every operation
// here adds the studio, so a route cannot forget it; `tenant-guard.spec.ts` fails when code outside this folder
// queries those four models directly. Audits and businesses are shared on purpose and are reached through leads.

/** A filter, update or document tried to name the studio itself, or an operation could leave the scope */
export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

type Plain = Record<string, unknown>;
export type TenantId = Types.ObjectId | string | null | undefined;

/** The studio as an ObjectId, or undefined for the legacy bucket: records made before the migration that have none */
function toTenantObjectId(tenantId: TenantId): Types.ObjectId | undefined {
  if (tenantId === null || tenantId === undefined) return undefined;
  if (tenantId instanceof Types.ObjectId) return tenantId;
  if (typeof tenantId === 'string' && /^[0-9a-f]{24}$/i.test(tenantId)) return new Types.ObjectId(tenantId);
  throw new TenantScopeError('The studio is not a valid id');
}

const isPlain = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value));

/** Whether a filter, at any depth, names `tenantId`: a request value must never widen or move the scope */
function namesTenant(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(namesTenant);
  if (!isPlain(value)) return false;
  return Object.entries(value).some(([key, inner]) => key === 'tenantId' || namesTenant(inner));
}

const matchOf = (tenant: Types.ObjectId | undefined): Plain => (tenant ? { tenantId: tenant } : { tenantId: null });

/** `filter` restricted to the studio's records (or, with no studio, to the records that have none) */
export function scopedFilter(tenantId: TenantId, filter?: Plain): Plain {
  const match = matchOf(toTenantObjectId(tenantId));
  if (namesTenant(filter)) throw new TenantScopeError('A filter must not name tenantId: the scope adds it');
  return filter && Object.keys(filter).length > 0 ? { $and: [match, filter] } : match;
}

/** The update, refused when it would move a record to another studio; an upsert stamps the studio on what it inserts */
export function scopedUpdate(tenantId: TenantId, update: Plain, options: { upsert?: boolean } = {}): Plain {
  const tenant = toTenantObjectId(tenantId);
  if (Array.isArray(update)) throw new TenantScopeError('A pipeline update is not allowed in a scope');
  for (const [key, value] of Object.entries(update)) {
    if (key === 'tenantId' || namesTenant(value)) throw new TenantScopeError('An update must not change tenantId');
    if (key === '$rename' && isPlain(value) && Object.values(value).includes('tenantId')) {
      throw new TenantScopeError('An update must not change tenantId');
    }
  }
  if (!options.upsert || !tenant) return { ...update };
  const onInsert = isPlain(update['$setOnInsert']) ? update['$setOnInsert'] : {};
  return { ...update, $setOnInsert: { ...onInsert, tenantId: tenant } };
}

/** The document with the studio on it; a document that names another studio is refused */
export function stampTenant<T extends Plain>(tenantId: TenantId, doc: T): T & { tenantId?: Types.ObjectId } {
  const tenant = toTenantObjectId(tenantId);
  const named = doc['tenantId'] === undefined ? undefined : toTenantObjectId(doc['tenantId'] as TenantId);
  if (doc['tenantId'] !== undefined && String(named) !== String(tenant)) {
    throw new TenantScopeError('A document must not name another studio');
  }
  return tenant ? { ...doc, tenantId: tenant } : { ...doc };
}

const ESCAPING_STAGES = ['$lookup', '$unionWith', '$merge', '$out', '$graphLookup'];

/** The pipeline behind a studio match; stages that read or write other collections, or name the studio, are refused */
export function scopedPipeline(tenantId: TenantId, pipeline: Plain[]): Plain[] {
  const match = matchOf(toTenantObjectId(tenantId));
  for (const stage of pipeline) {
    if (Object.keys(stage).some((key) => ESCAPING_STAGES.includes(key))) {
      throw new TenantScopeError('This pipeline stage can leave the scope');
    }
    if (namesTenant(stage)) throw new TenantScopeError('A pipeline must not name tenantId: the scope adds it');
  }
  return [{ $match: match }, ...pipeline];
}

type Filter = Plain;

/** One tenant-owned collection as the API sees it: every operation behind the studio, no way to name the studio */
export interface Repository<D extends Document> {
  findById(id: unknown, projection?: Plain | string, options?: Plain): Query<D | null, D, {}, D, 'findOne'>;
  findOne(filter: Filter, projection?: Plain | string, options?: Plain): Query<D | null, D, {}, D, 'findOne'>;
  find(filter?: Filter, projection?: Plain | string, options?: Plain): Query<D[], D, {}, D, 'find'>;
  countDocuments(filter?: Filter): ReturnType<Model<D>['countDocuments']>;
  exists(filter: Filter): ReturnType<Model<D>['exists']>;
  aggregate<R = unknown>(pipeline: Plain[]): Aggregate<R[]>;
  updateOne(filter: Filter, update: Plain, options?: { upsert?: boolean } & Plain): ReturnType<Model<D>['updateOne']>;
  updateMany(filter: Filter, update: Plain, options?: Plain): ReturnType<Model<D>['updateMany']>;
  findOneAndUpdate(filter: Filter, update: Plain, options?: { upsert?: boolean } & Plain): Query<D | null, D, {}, D, 'findOneAndUpdate'>;
  deleteOne(filter: Filter): ReturnType<Model<D>['deleteOne']>;
  create(doc: Plain): Promise<D>;
}

function repository<D extends Document>(model: Model<D>, tenantId: TenantId): Repository<D> {
  return {
    findById: (id: unknown, projection?: Plain | string, options?: Plain) =>
      model.findOne(scopedFilter(tenantId, { _id: id }) as never, projection as never, options as never) as never,
    findOne: (filter: Filter, projection?: Plain | string, options?: Plain) =>
      model.findOne(scopedFilter(tenantId, filter) as never, projection as never, options as never) as never,
    find: (filter: Filter = {}, projection?: Plain | string, options?: Plain) =>
      model.find(scopedFilter(tenantId, filter) as never, projection as never, options as never) as never,
    countDocuments: (filter: Filter = {}) => model.countDocuments(scopedFilter(tenantId, filter) as never),
    exists: (filter: Filter) => model.exists(scopedFilter(tenantId, filter) as never),
    aggregate: <R = unknown>(pipeline: Plain[]) => model.aggregate<R>(scopedPipeline(tenantId, pipeline) as never),
    updateOne: (filter: Filter, update: Plain, options: { upsert?: boolean } & Plain = {}) =>
      model.updateOne(scopedFilter(tenantId, filter) as never, scopedUpdate(tenantId, update, options) as never, options as never),
    updateMany: (filter: Filter, update: Plain, options: Plain = {}) =>
      model.updateMany(scopedFilter(tenantId, filter) as never, scopedUpdate(tenantId, update) as never, options as never),
    findOneAndUpdate: (filter: Filter, update: Plain, options: { upsert?: boolean } & Plain = {}) =>
      model.findOneAndUpdate(scopedFilter(tenantId, filter) as never, scopedUpdate(tenantId, update, options) as never, options as never) as never,
    deleteOne: (filter: Filter) => model.deleteOne(scopedFilter(tenantId, filter) as never),
    create: (doc: Plain) => model.create(stampTenant(tenantId, doc) as never) as unknown as Promise<D>,
  };
}

/** The studio of a signed-in request as the string a queue payload carries (REV-210); a scope without one cannot queue work */
export function tenantIdOf(scope: { tenantId: Types.ObjectId | undefined }): string {
  if (!scope.tenantId) throw new TenantScopeError('A job needs a studio: this scope has none');
  return scope.tenantId.toString();
}

export interface TenantScope {
  /** The studio, or undefined for the legacy bucket (records without one, reached only through public secrets) */
  tenantId: Types.ObjectId | undefined;
  leads: Repository<ILeadDocument>;
  mvps: Repository<IMvpProjectDocument>;
  campaigns: Repository<IEmailCampaignDocument>;
  events: Repository<IAnalyticsEventDocument>;
}

/** The data of one studio. Routes get it from `req.tenant`; the public routes build it from the campaign they found */
export function scopeFor(tenantId: TenantId): TenantScope {
  const tenant = toTenantObjectId(tenantId);
  return {
    tenantId: tenant,
    leads: repository(Lead, tenant),
    mvps: repository(MvpProject, tenant),
    campaigns: repository(EmailCampaign, tenant),
    events: repository(AnalyticsEvent, tenant),
  };
}

/**
 * The few lookups that start from a secret the caller holds instead of a studio: the tracking token of a campaign and
 * the preview slug or id of an MVP. They are the only unscoped reads of tenant-owned data in the API; what they find
 * names the studio (`scopeFor(record.tenantId)`), and everything after is scoped to it.
 */
export const bySecret = {
  campaignByToken: (token: string) => EmailCampaign.findOne({ trackingToken: token }),
  mvpBySlug: (slug: string) => MvpProject.findOne({ previewSlug: slug }),
  mvpById: (id: string) => MvpProject.findById(id),
};
