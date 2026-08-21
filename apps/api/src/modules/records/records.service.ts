import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { PublishedObjectService } from '../objects/published-object.service';
import {
  projectVisibleValues,
  RecordValueError,
  validateRecordMutation,
} from './record-value-engine';
import type {
  DynamicRecord,
  RecordListQuery,
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
      sort: 'updatedAt' | 'createdAt' | 'recordNo';
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
        ownerMemberId,
        sort: input.sort,
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
