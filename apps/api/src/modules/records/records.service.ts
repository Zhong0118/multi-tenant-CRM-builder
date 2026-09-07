import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import { isSearchableFieldType } from '../objects/object-schema';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { PublishedObjectService } from '../objects/published-object.service';
import {
  projectVisibleValues,
  RecordValueError,
  validateRecordMutation,
} from './record-value-engine';
import {
  MEMBER_ACTIVITY_TYPES,
  type MemberActivityType,
  type RecordActivity,
} from './record-activity';
import type {
  DynamicRecord,
  RecordListFieldSort,
  RecordListFilter,
  RecordListQuery,
  RecordListSystemSort,
  RecordsRepository,
  RecordsStore,
} from './records.repository';

export const RECORDS_REPOSITORY = Symbol('RECORDS_REPOSITORY');
export const RECORDS_CLOCK = Symbol('RECORDS_CLOCK');
export const RECORDS_ID_GENERATOR = Symbol('RECORDS_ID_GENERATOR');

interface RequestMeta {
  requestId: string;
  ip?: string;
}

export interface RecordResponse {
  id: string;
  recordNo: string;
  ownerMemberId: string | null;
  title: string;
  values: Record<string, unknown>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecordPageResponse {
  items: RecordResponse[];
  page: number;
  limit: number;
  total: number;
}

export interface RecordActivityResponse {
  id: string;
  activityType: MemberActivityType;
  content: string;
  nextActionAt: string | null;
  actorMemberId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}

export interface RecordActivityPageResponse {
  items: RecordActivityResponse[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class RecordsService {
  constructor(
    @Inject(RECORDS_REPOSITORY)
    private readonly repository: RecordsRepository,
    private readonly publishedObjects: PublishedObjectService,
    @Inject(RECORDS_CLOCK) private readonly clock: () => Date,
    @Inject(RECORDS_ID_GENERATOR) private readonly idGenerator: () => string,
  ) {}

  async list(
    context: TenantContext,
    objectCode: string,
    input: {
      page: number;
      limit: number;
      search?: string;
      ownerMemberId?: string;
      filters?: string;
      sort: string;
      direction: 'asc' | 'desc';
    },
  ): Promise<RecordPageResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    const page = Math.max(1, Math.trunc(input.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
    return this.repository.withTenant(context, async (store) => {
      const ownerMemberId = await resolveListOwner(
        context,
        resolved,
        store,
        input.ownerMemberId,
      );
      const query: RecordListQuery = {
        objectId: resolved.schema.object.id,
        page,
        limit,
        search: input.search?.trim() || undefined,
        searchFieldKeys: searchableFieldKeys(resolved),
        ownerMemberId,
        filters: parseListFilters(input.filters, resolved, this.clock()),
        sort: parseListSort(input.sort, resolved),
        direction: input.direction,
      };
      const result = await store.listRecords(query);
      return {
        items: result.items.map((record) => projectRecord(record, resolved)),
        page,
        limit,
        total: result.total,
      };
    });
  }

  async create(
    context: TenantContext,
    objectCode: string,
    input: {
      values: Record<string, unknown>;
      ownerMemberId?: string | null;
    },
    meta: RequestMeta,
  ): Promise<RecordResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.repository.withTenant(context, async (store) => {
      const ownerMemberId = await resolveCreateOwner(
        context,
        store,
        input.ownerMemberId,
      );
      const normalized = await validateMutation({
        mode: 'CREATE',
        resolved,
        submitted: input.values,
        memberExists: (memberId) => store.memberExists(memberId),
      });
      const now = this.clock().toISOString();
      const record: DynamicRecord = {
        id: this.idGenerator(),
        objectId: resolved.schema.object.id,
        recordNo: await store.allocateRecordNo(resolved.schema.object.id),
        ownerMemberId,
        title: normalized.title,
        values: normalized.values,
        version: 1,
        createdByMemberId: context.memberId,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const created = await store.createRecord(record);
      await store.appendAudit(
        recordAudit(context, meta, 'record.created', created, undefined),
      );
      return projectRecord(created, resolved);
    });
  }

  async detail(
    context: TenantContext,
    objectCode: string,
    recordId: string,
  ): Promise<RecordResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.repository.withTenant(context, async (store) => {
      const record = await requireVisibleRecord(
        store,
        resolved,
        context,
        recordId,
        'READ',
      );
      return projectRecord(record, resolved);
    });
  }

  async update(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    input: {
      version: number;
      values?: Record<string, unknown>;
      ownerMemberId?: string | null;
    },
    meta: RequestMeta,
  ): Promise<RecordResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return this.repository.withTenant(context, async (store) => {
      const current = await requireVisibleRecord(
        store,
        resolved,
        context,
        recordId,
        'UPDATE',
      );
      if (current.version !== input.version) {
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      }
      const ownerMemberId = await resolveUpdateOwner(
        context,
        store,
        current.ownerMemberId,
        input.ownerMemberId,
      );
      const normalized = await validateMutation({
        mode: 'UPDATE',
        resolved,
        submitted: input.values ?? {},
        current: current.values,
        memberExists: (memberId) => store.memberExists(memberId),
      });
      const updated = await store.updateRecord(recordId, input.version, {
        values: normalized.values,
        title: normalized.title,
        ownerMemberId,
      });
      if (!updated) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      await store.appendAudit(
        recordAudit(context, meta, 'record.updated', updated, current),
      );
      return projectRecord(updated, resolved);
    });
  }

  async remove(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    input: { version: number },
    meta: RequestMeta,
  ): Promise<{ accepted: true }> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    if (context.role !== 'TENANT_ADMIN' || !resolved.access.canDelete) {
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    }
    return this.repository.withTenant(context, async (store) => {
      const current = await requireVisibleRecord(
        store,
        resolved,
        context,
        recordId,
        'READ',
      );
      if (current.version !== input.version) {
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      }
      const deletedAt = this.clock().toISOString();
      const deleted = await store.softDeleteRecord(
        recordId,
        input.version,
        deletedAt,
      );
      if (!deleted) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      await store.appendAudit(
        recordAudit(
          context,
          meta,
          'record.deleted',
          { ...current, deletedAt, version: current.version + 1 },
          current,
        ),
      );
      return { accepted: true };
    });
  }

  async listActivities(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    input: { page: number; limit: number },
  ): Promise<RecordActivityPageResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    const page = Math.max(1, Math.trunc(input.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
    return this.repository.withTenant(context, async (store) => {
      await requireVisibleRecord(store, resolved, context, recordId, 'READ');
      const result = await store.listActivities(recordId, { page, limit });
      return {
        items: result.items.map(projectActivity),
        page,
        limit,
        total: result.total,
      };
    });
  }

  async createActivity(
    context: TenantContext,
    objectCode: string,
    recordId: string,
    input: {
      activityType: MemberActivityType;
      content: string;
      nextActionAt?: string | null;
    },
    meta: RequestMeta,
  ): Promise<RecordActivityResponse> {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    const content = input.content.trim();
    if (content.length === 0) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { content: ['请填写跟进内容。'] },
      });
    }
    if (content.length > 4000) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { content: ['跟进内容不能超过 4000 字。'] },
      });
    }
    if (!MEMBER_ACTIVITY_TYPES.includes(input.activityType)) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        fieldErrors: { activityType: ['不支持该跟进类型。'] },
      });
    }
    return this.repository.withTenant(context, async (store) => {
      await requireVisibleRecord(store, resolved, context, recordId, 'UPDATE');
      const created = await store.createActivity({
        id: this.idGenerator(),
        recordId,
        activityType: input.activityType,
        content,
        nextActionAt: input.nextActionAt ?? null,
        actorMemberId: context.memberId,
        createdAt: this.clock().toISOString(),
      });
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'record.activity_created',
        resourceType: 'record_activity',
        resourceId: created.id,
        after: {
          recordId,
          activityType: created.activityType,
          nextActionAt: created.nextActionAt,
        },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return projectActivity(created);
    });
  }
}

async function resolveCreateOwner(
  context: TenantContext,
  store: RecordsStore,
  requested: string | null | undefined,
): Promise<string | null> {
  if (context.role === 'EMPLOYEE') return context.memberId;
  if (requested === undefined || requested === null) return null;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

async function resolveUpdateOwner(
  context: TenantContext,
  store: RecordsStore,
  current: string | null,
  requested: string | null | undefined,
): Promise<string | null> {
  if (context.role === 'EMPLOYEE') return context.memberId;
  if (requested === undefined) return current;
  if (requested === null) return null;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

function searchableFieldKeys(resolved: ResolvedObjectSchema): string[] {
  const titleFieldKey = resolved.schema.object.titleFieldKey;
  const extras =
    resolved.visibleSchema.defaultView.searchFieldKeys ??
    resolved.visibleSchema.defaultView.columnFieldKeys;
  return [
    ...new Set(
      resolved.visibleSchema.fields
        .filter(
          (field) =>
            isSearchableFieldType(field.type) &&
            extras.includes(field.fieldKey) &&
            field.fieldKey !== titleFieldKey,
        )
        .map((field) => field.fieldKey),
    ),
  ];
}

function parseListFilters(
  serialized: string | undefined,
  resolved: ResolvedObjectSchema,
  now: Date,
): RecordListFilter[] {
  if (!serialized) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw invalidRecordFilter();
  }
  if (!isPlainObject(parsed)) throw invalidRecordFilter();
  const entries = Object.entries(parsed);
  if (entries.length > 8) throw invalidRecordFilter();

  const visibleFields = new Map(
    resolved.visibleSchema.fields.map((field) => [field.fieldKey, field]),
  );
  const filters: RecordListFilter[] = [];
  for (const [fieldKey, rawValue] of entries) {
    const field = visibleFields.get(fieldKey);
    if (!field) throw invalidRecordFilter();
    if (isPresenceFilterValue(rawValue)) {
      filters.push(parsePresenceFilter(field.fieldKey, rawValue));
      continue;
    }
    if (field.type === 'SINGLE_SELECT' || field.type === 'MULTI_SELECT') {
      filters.push(parseOptionFilter(field, rawValue));
      continue;
    }
    if (field.type === 'DATE' || field.type === 'DATETIME') {
      filters.push(parseDateFilter(field.fieldKey, rawValue, field.type, now));
      continue;
    }
    if (field.type === 'NUMBER' || field.type === 'MONEY') {
      filters.push(parseNumericFilter(field.fieldKey, rawValue));
      continue;
    }
    if (field.type === 'BOOLEAN') {
      filters.push(parseBooleanFilter(field.fieldKey, rawValue));
      continue;
    }
    if (field.type === 'MEMBER') {
      filters.push(parseMemberFilter(field.fieldKey, rawValue));
      continue;
    }
    if (isSearchableFieldType(field.type)) {
      filters.push(parseTextContainsFilter(field.fieldKey, rawValue));
      continue;
    }
    throw invalidRecordFilter();
  }
  return filters;
}

function parseOptionFilter(
  field: ResolvedObjectSchema['visibleSchema']['fields'][number],
  rawValues: unknown,
): RecordListFilter {
  if (
    !Array.isArray(rawValues) ||
    rawValues.length === 0 ||
    rawValues.length > 20 ||
    rawValues.some(
      (value) =>
        typeof value !== 'string' || value.length === 0 || value.length > 100,
    )
  ) {
    throw invalidRecordFilter();
  }
  const optionKeys = new Set(
    Array.isArray(field.config.options)
      ? field.config.options.flatMap((option) => {
          if (!isPlainObject(option) || typeof option.key !== 'string') {
            return [];
          }
          return [option.key];
        })
      : [],
  );
  const values = [...new Set(rawValues as string[])];
  if (values.some((value) => !optionKeys.has(value))) {
    throw invalidRecordFilter();
  }
  return {
    fieldKey: field.fieldKey,
    mode: field.type === 'MULTI_SELECT' ? 'CONTAINS' : 'EQUALS',
    values,
  };
}

const RELATIVE_DATE_PRESETS = new Set([
  'today',
  'this_week',
  'this_month',
  'past_7_days',
  'past_30_days',
]);

function parseDateFilter(
  fieldKey: string,
  rawValue: unknown,
  type: 'DATE' | 'DATETIME',
  now: Date,
): RecordListFilter {
  if (!isPlainObject(rawValue)) throw invalidRecordFilter();
  if (typeof rawValue.relative === 'string') {
    if (
      !RELATIVE_DATE_PRESETS.has(rawValue.relative) ||
      rawValue.from !== undefined ||
      rawValue.to !== undefined
    ) {
      throw invalidRecordFilter();
    }
    const range = relativeDateRange(rawValue.relative, now);
    return dateRangeFilter(fieldKey, range.from, range.to, type);
  }
  const from = optionalDateBound(rawValue.from);
  const to = optionalDateBound(rawValue.to);
  if (!from && !to) throw invalidRecordFilter();
  if (from && to && from > to) throw invalidRecordFilter();
  return dateRangeFilter(fieldKey, from, to, type);
}

function dateRangeFilter(
  fieldKey: string,
  from: string | undefined,
  to: string | undefined,
  type: 'DATE' | 'DATETIME',
): RecordListFilter {
  return {
    fieldKey,
    mode: 'DATE_RANGE',
    ...(from ? { from } : {}),
    ...(to ? { to: type === 'DATETIME' ? `${to}T23:59:59.999Z` : to } : {}),
  };
}

function relativeDateRange(
  preset: string,
  now: Date,
): { from: string; to: string } {
  const today = utcDateString(now);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'past_7_days') {
    return { from: utcDateString(addUtcDays(now, -6)), to: today };
  }
  if (preset === 'past_30_days') {
    return { from: utcDateString(addUtcDays(now, -29)), to: today };
  }
  if (preset === 'this_week') {
    const monday = addUtcDays(now, -((now.getUTCDay() + 6) % 7));
    return {
      from: utcDateString(monday),
      to: utcDateString(addUtcDays(monday, 6)),
    };
  }
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  return { from: utcDateString(monthStart), to: utcDateString(monthEnd) };
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isPresenceFilterValue(
  value: unknown,
): value is { presence: 'empty' | 'not_empty' } {
  return (
    isPlainObject(value) &&
    (value.presence === 'empty' || value.presence === 'not_empty')
  );
}

function parsePresenceFilter(
  fieldKey: string,
  rawValue: { presence: 'empty' | 'not_empty' },
): RecordListFilter {
  return {
    fieldKey,
    mode: rawValue.presence === 'empty' ? 'EMPTY' : 'NOT_EMPTY',
  };
}

function parseNumericFilter(
  fieldKey: string,
  rawValue: unknown,
): RecordListFilter {
  if (!isPlainObject(rawValue)) throw invalidRecordFilter();
  const min = optionalNumericBound(rawValue.min);
  const max = optionalNumericBound(rawValue.max);
  if (min === undefined && max === undefined) throw invalidRecordFilter();
  if (min !== undefined && max !== undefined && min > max) {
    throw invalidRecordFilter();
  }
  return {
    fieldKey,
    mode: 'NUMBER_RANGE',
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
}

function parseBooleanFilter(
  fieldKey: string,
  rawValue: unknown,
): RecordListFilter {
  if (typeof rawValue !== 'boolean') throw invalidRecordFilter();
  return { fieldKey, mode: 'BOOLEAN_EQUALS', value: rawValue };
}

const MEMBER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMemberFilter(
  fieldKey: string,
  rawValues: unknown,
): RecordListFilter {
  if (
    !Array.isArray(rawValues) ||
    rawValues.length === 0 ||
    rawValues.length > 20 ||
    rawValues.some((value) => typeof value !== 'string' || !MEMBER_ID.test(value))
  ) {
    throw invalidRecordFilter();
  }
  return {
    fieldKey,
    mode: 'MEMBER_EQUALS',
    values: [...new Set(rawValues as string[])],
  };
}

function parseTextContainsFilter(
  fieldKey: string,
  rawValue: unknown,
): RecordListFilter {
  if (!isPlainObject(rawValue) || typeof rawValue.contains !== 'string') {
    throw invalidRecordFilter();
  }
  const contains = rawValue.contains.trim();
  if (contains.length === 0 || contains.length > 100) {
    throw invalidRecordFilter();
  }
  return { fieldKey, mode: 'TEXT_CONTAINS', contains };
}

const SYSTEM_SORTS = new Set<RecordListSystemSort>([
  'updatedAt',
  'createdAt',
  'recordNo',
]);
const SORTABLE_FIELD_KINDS: Record<
  string,
  RecordListFieldSort['kind']
> = {
  TEXT: 'TEXT',
  PHONE: 'TEXT',
  EMAIL: 'TEXT',
  NUMBER: 'NUMBER',
  MONEY: 'NUMBER',
  DATE: 'DATE',
  DATETIME: 'DATE',
  SINGLE_SELECT: 'OPTION',
};

function parseListSort(
  sort: string,
  resolved: ResolvedObjectSchema,
): RecordListQuery['sort'] {
  if (SYSTEM_SORTS.has(sort as RecordListSystemSort)) {
    return sort as RecordListSystemSort;
  }
  const field = resolved.visibleSchema.fields.find(
    (candidate) => candidate.fieldKey === sort,
  );
  const kind = field ? SORTABLE_FIELD_KINDS[field.type] : undefined;
  if (!field || !kind) {
    throw new ApiException('RECORD_SORT_INVALID', 400, {
      fieldErrors: { sort: ['请选择当前业务表中可排序的字段。'] },
    });
  }
  if (kind !== 'OPTION') return { fieldKey: field.fieldKey, kind };
  const optionKeys = Array.isArray(field.config.options)
    ? field.config.options.flatMap((option) => {
        if (!isPlainObject(option) || typeof option.key !== 'string') return [];
        return [option.key];
      })
    : [];
  return { fieldKey: field.fieldKey, kind, optionKeys };
}

function optionalDateBound(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidRecordFilter();
  }
  return value;
}

function optionalNumericBound(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidRecordFilter();
  }
  return value;
}

function invalidRecordFilter(): ApiException {
  return new ApiException('RECORD_FILTER_INVALID', 400, {
    fieldErrors: { filters: ['请选择当前业务表中可见的选项。'] },
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function resolveListOwner(
  context: TenantContext,
  resolved: ResolvedObjectSchema,
  store: RecordsStore,
  requested: string | undefined,
): Promise<string | undefined> {
  if (resolved.access.readScope === 'OWN') return context.memberId;
  if (resolved.access.readScope === 'NONE') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
  if (context.role !== 'TENANT_ADMIN' || !requested) return undefined;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

async function requireVisibleRecord(
  store: RecordsStore,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  recordId: string,
  action: 'READ' | 'UPDATE',
): Promise<DynamicRecord> {
  const accessAllowed =
    action === 'READ' ? resolved.access.canRead : resolved.access.canUpdate;
  const scope =
    action === 'READ' ? resolved.access.readScope : resolved.access.updateScope;
  if (!accessAllowed || scope === 'NONE') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
  const record = await store.findRecord(resolved.schema.object.id, recordId);
  if (
    !record ||
    (scope === 'OWN' && record.ownerMemberId !== context.memberId)
  ) {
    throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  return record;
}

async function validateMutation(input: {
  mode: 'CREATE' | 'UPDATE';
  resolved: ResolvedObjectSchema;
  submitted: Record<string, unknown>;
  current?: Record<string, unknown>;
  memberExists: (id: string) => Promise<boolean>;
}) {
  try {
    return await validateRecordMutation({
      mode: input.mode,
      schema: input.resolved.schema,
      access: input.resolved.access,
      submitted: input.submitted,
      current: input.current,
      memberExists: input.memberExists,
    });
  } catch (error) {
    if (error instanceof RecordValueError) {
      const status =
        error.code === 'OBJECT_ACTION_FORBIDDEN' ||
        error.code === 'FIELD_READ_ONLY' ||
        error.code === 'FIELD_HIDDEN'
          ? 403
          : 400;
      throw new ApiException(error.code, status, {
        fieldErrors: error.fieldKey
          ? { [error.fieldKey]: [error.message] }
          : undefined,
      });
    }
    throw error;
  }
}

function projectActivity(activity: RecordActivity): RecordActivityResponse {
  return {
    id: activity.id,
    activityType: activity.activityType,
    content: activity.content,
    nextActionAt: activity.nextActionAt,
    actorMemberId: activity.actorMemberId,
    actorDisplayName: activity.actorDisplayName,
    createdAt: activity.createdAt,
  };
}

function projectRecord(
  record: DynamicRecord,
  resolved: ResolvedObjectSchema,
): RecordResponse {
  return {
    id: record.id,
    recordNo: record.recordNo.toString(),
    ownerMemberId: record.ownerMemberId,
    title: record.title,
    values: projectVisibleValues(
      resolved.schema,
      resolved.access,
      record.values,
    ),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recordAudit(
  context: TenantContext,
  meta: RequestMeta,
  action: string,
  after: DynamicRecord,
  before: DynamicRecord | undefined,
): AuditEvent {
  return {
    tenantId: context.tenantId,
    actorType: 'USER',
    actorId: context.userId,
    action,
    resourceType: 'record',
    resourceId: after.id,
    before: before ? auditRecord(before) : undefined,
    after: auditRecord(after),
    requestId: meta.requestId,
    ip: meta.ip,
  };
}

function auditRecord(record: DynamicRecord): Record<string, unknown> {
  return {
    objectId: record.objectId,
    recordNo: record.recordNo.toString(),
    ownerMemberId: record.ownerMemberId,
    title: record.title,
    values: record.values,
    version: record.version,
    deletedAt: record.deletedAt,
  };
}
