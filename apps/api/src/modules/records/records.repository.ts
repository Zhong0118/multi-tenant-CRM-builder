import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';

export interface DynamicRecord {
  id: string;
  objectId: string;
  recordNo: bigint;
  ownerMemberId: string | null;
  title: string;
  values: Record<string, unknown>;
  version: number;
  createdByMemberId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type RecordListOptionFilter = {
  fieldKey: string;
  mode: 'EQUALS' | 'CONTAINS';
  values: string[];
};

export type RecordListDateFilter = {
  fieldKey: string;
  mode: 'DATE_RANGE';
  from?: string;
  to?: string;
};

export type RecordListNumericFilter = {
  fieldKey: string;
  mode: 'NUMBER_RANGE';
  min?: number;
  max?: number;
};

export type RecordListBooleanFilter = {
  fieldKey: string;
  mode: 'BOOLEAN_EQUALS';
  value: boolean;
};

export type RecordListMemberFilter = {
  fieldKey: string;
  mode: 'MEMBER_EQUALS';
  values: string[];
};

export type RecordListTextFilter = {
  fieldKey: string;
  mode: 'TEXT_CONTAINS';
  contains: string;
};

export type RecordListFilter =
  | RecordListOptionFilter
  | RecordListDateFilter
  | RecordListNumericFilter
  | RecordListBooleanFilter
  | RecordListMemberFilter
  | RecordListTextFilter;

export type RecordListSystemSort = 'updatedAt' | 'createdAt' | 'recordNo';
export type RecordListFieldSortKind = 'TEXT' | 'NUMBER' | 'DATE' | 'OPTION';

export type RecordListFieldSort = {
  fieldKey: string;
  kind: RecordListFieldSortKind;
  optionKeys?: string[];
};

export interface RecordListQuery {
  objectId: string;
  page: number;
  limit: number;
  search?: string;
  searchFieldKeys: string[];
  ownerMemberId?: string;
  filters: RecordListFilter[];
  sort: RecordListSystemSort | RecordListFieldSort;
  direction: 'asc' | 'desc';
}

export interface RecordsStore {
  memberExists(memberId: string): Promise<boolean>;
  allocateRecordNo(objectId: string): Promise<bigint>;
  createRecord(record: DynamicRecord): Promise<DynamicRecord>;
  listRecords(query: RecordListQuery): Promise<{
    items: DynamicRecord[];
    total: number;
  }>;
  findRecord(objectId: string, recordId: string): Promise<DynamicRecord | null>;
  updateRecord(
    recordId: string,
    expectedVersion: number,
    input: {
      values: Record<string, unknown>;
      title: string;
      ownerMemberId: string | null;
    },
  ): Promise<DynamicRecord | null>;
  softDeleteRecord(
    recordId: string,
    expectedVersion: number,
    deletedAt: string,
  ): Promise<boolean>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface RecordsRepository {
  withTenant<T>(
    context: TenantContext,
    work: (store: RecordsStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrismaRecordsRepository implements RecordsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  withTenant<T>(
    context: TenantContext,
    work: (store: RecordsStore) => Promise<T>,
  ): Promise<T> {
    return this.runner.withTenant(context, (transaction) =>
      work(new PrismaRecordsStore(transaction, this.audit, context)),
    );
  }
}

class PrismaRecordsStore implements RecordsStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
    private readonly context: TenantContext,
  ) {}

  async memberExists(memberId: string): Promise<boolean> {
    const member = await this.transaction.tenantMember.findFirst({
      where: {
        id: memberId,
        tenantId: this.context.tenantId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return member !== null;
  }

  async allocateRecordNo(objectId: string): Promise<bigint> {
    const rows = await this.transaction.$queryRaw<Array<{ recordNo: bigint }>>`
      INSERT INTO record_counters (tenant_id, object_id, next_record_no)
      VALUES (${this.context.tenantId}::uuid, ${objectId}::uuid, 2)
      ON CONFLICT (tenant_id, object_id)
      DO UPDATE SET next_record_no = record_counters.next_record_no + 1
      RETURNING next_record_no - 1 AS "recordNo"
    `;
    const recordNo = rows[0]?.recordNo;
    if (recordNo === undefined)
      throw new Error('Record counter did not return');
    return recordNo;
  }

  async createRecord(record: DynamicRecord): Promise<DynamicRecord> {
    const created = await this.transaction.record.create({
      data: {
        id: record.id,
        tenantId: this.context.tenantId,
        objectId: record.objectId,
        recordNo: record.recordNo,
        ownerMemberId: record.ownerMemberId,
        statusKey: null,
        title: record.title,
        data: toPrismaJson(record.values),
        source: 'MANUAL',
        createdByMemberId: record.createdByMemberId,
        version: record.version,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.updatedAt),
      },
    });
    return fromPrismaRecord(created);
  }

  async listRecords(query: RecordListQuery): Promise<{
    items: DynamicRecord[];
    total: number;
  }> {
    const where: Prisma.RecordWhereInput = {
      tenantId: this.context.tenantId,
      objectId: query.objectId,
      deletedAt: null,
      ownerMemberId: query.ownerMemberId,
      AND: [
        ...searchConditions(query.search, query.searchFieldKeys),
        ...query.filters.map(listFilterCondition),
      ],
    };
    if (typeof query.sort === 'string') {
      const [items, total] = await Promise.all([
        this.transaction.record.findMany({
          where,
          orderBy: [
            { [query.sort]: query.direction },
            { id: query.direction },
          ],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.transaction.record.count({ where }),
      ]);
      return { items: items.map(fromPrismaRecord), total };
    }

    const direction = query.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (query.page - 1) * query.limit;
    const [rows, counted] = await Promise.all([
      this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT r.id
        FROM records r
        WHERE r.tenant_id = ${this.context.tenantId}::uuid
          AND r.object_id = ${query.objectId}::uuid
          AND r.deleted_at IS NULL
          ${query.ownerMemberId ? Prisma.sql`AND r.owner_member_id = ${query.ownerMemberId}::uuid` : Prisma.empty}
        ORDER BY ${fieldSortExpression(query.sort)} ${direction} NULLS LAST, r.id ${direction}
        OFFSET ${offset}
        LIMIT ${query.limit}
      `),
      this.transaction.record.count({ where }),
    ]);
    if (rows.length === 0) return { items: [], total: counted };
    const records = await this.transaction.record.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
      items: rows.flatMap((row) => {
        const record = byId.get(row.id);
        return record ? [fromPrismaRecord(record)] : [];
      }),
      total: counted,
    };
  }

  async findRecord(
    objectId: string,
    recordId: string,
  ): Promise<DynamicRecord | null> {
    const record = await this.transaction.record.findFirst({
      where: {
        id: recordId,
        tenantId: this.context.tenantId,
        objectId,
        deletedAt: null,
      },
    });
    return record ? fromPrismaRecord(record) : null;
  }

  async updateRecord(
    recordId: string,
    expectedVersion: number,
    input: {
      values: Record<string, unknown>;
      title: string;
      ownerMemberId: string | null;
    },
  ): Promise<DynamicRecord | null> {
    const result = await this.transaction.record.updateMany({
      where: {
        id: recordId,
        tenantId: this.context.tenantId,
        version: expectedVersion,
        deletedAt: null,
      },
      data: {
        data: toPrismaJson(input.values),
        title: input.title,
        ownerMemberId: input.ownerMemberId,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) return null;
    const record = await this.transaction.record.findUnique({
      where: { id: recordId },
    });
    return record ? fromPrismaRecord(record) : null;
  }

  async softDeleteRecord(
    recordId: string,
    expectedVersion: number,
    deletedAt: string,
  ): Promise<boolean> {
    const result = await this.transaction.record.updateMany({
      where: {
        id: recordId,
        tenantId: this.context.tenantId,
        version: expectedVersion,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(deletedAt),
        version: { increment: 1 },
      },
    });
    return result.count === 1;
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function fromPrismaRecord(record: {
  id: string;
  objectId: string;
  recordNo: bigint;
  ownerMemberId: string | null;
  title: string;
  data: Prisma.JsonValue;
  version: number;
  createdByMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): DynamicRecord {
  return {
    id: record.id,
    objectId: record.objectId,
    recordNo: record.recordNo,
    ownerMemberId: record.ownerMemberId,
    title: record.title,
    values: jsonRecord(record.data),
    version: record.version,
    createdByMemberId: record.createdByMemberId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString() ?? null,
  };
}

function searchConditions(
  search: string | undefined,
  searchFieldKeys: string[],
): Prisma.RecordWhereInput[] {
  if (!search) return [];
  return [
    {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        ...searchFieldKeys.map((fieldKey) => ({
          data: {
            path: [fieldKey],
            string_contains: search,
            mode: 'insensitive' as const,
          },
        })),
      ],
    },
  ];
}

function listFilterCondition(filter: RecordListFilter): Prisma.RecordWhereInput {
  if (filter.mode === 'DATE_RANGE') {
    const bounds: Prisma.JsonFilter[] = [];
    if (filter.from) {
      bounds.push({ path: [filter.fieldKey], gte: filter.from });
    }
    if (filter.to) {
      bounds.push({ path: [filter.fieldKey], lte: filter.to });
    }
    return { AND: bounds.map((bound) => ({ data: bound })) };
  }
  if (filter.mode === 'NUMBER_RANGE') {
    return numericRangeCondition(filter);
  }
  if (filter.mode === 'BOOLEAN_EQUALS') {
    return {
      data: { path: [filter.fieldKey], equals: filter.value },
    };
  }
  if (filter.mode === 'MEMBER_EQUALS') {
    return {
      OR: filter.values.map((value) => ({
        data: { path: [filter.fieldKey], equals: value },
      })),
    };
  }
  if (filter.mode === 'TEXT_CONTAINS') {
    return {
      data: {
        path: [filter.fieldKey],
        string_contains: filter.contains,
        mode: 'insensitive',
      },
    };
  }
  return {
    OR: filter.values.map((value) => ({
      data:
        filter.mode === 'CONTAINS'
          ? { path: [filter.fieldKey], array_contains: value }
          : { path: [filter.fieldKey], equals: value },
    })),
  };
}

/**
 * NUMBER is a JSON number; MONEY is a scaled decimal string. Both are read as
 * text and compared numerically so a money value is never ordered as a string.
 * Prisma's JsonFilter gte/lte cannot express that cast, so the predicate is
 * injected as a parameterized SQL fragment the way dashboard metrics do.
 */
function numericRangeCondition(
  filter: RecordListNumericFilter,
): Prisma.RecordWhereInput {
  const value = Prisma.sql`data ->> ${filter.fieldKey}`;
  const bounds: Prisma.Sql[] = [
    Prisma.sql`${value} ~ '^-?[0-9]+([.][0-9]+)?$'`,
  ];
  if (filter.min !== undefined) {
    bounds.push(Prisma.sql`${value}::numeric >= ${filter.min}`);
  }
  if (filter.max !== undefined) {
    bounds.push(Prisma.sql`${value}::numeric <= ${filter.max}`);
  }
  return {
    AND: Prisma.join(bounds, ' AND '),
  } as Prisma.RecordWhereInput;
}

function fieldSortExpression(sort: RecordListFieldSort): Prisma.Sql {
  const value = Prisma.sql`r.data ->> ${sort.fieldKey}`;
  if (sort.kind === 'NUMBER') {
    return Prisma.sql`
      CASE
        WHEN ${value} ~ '^-?[0-9]+([.][0-9]+)?$' THEN ${value}::numeric
        ELSE NULL
      END
    `;
  }
  if (sort.kind === 'DATE') {
    return Prisma.sql`
      CASE
        WHEN ${value} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN ${value}
        ELSE NULL
      END
    `;
  }
  if (sort.kind === 'OPTION' && sort.optionKeys && sort.optionKeys.length > 0) {
    return Prisma.sql`
      CASE ${value}
        ${Prisma.join(
          sort.optionKeys.map(
            (key, index) => Prisma.sql`WHEN ${key} THEN ${index}`,
          ),
          ' ',
        )}
        ELSE ${sort.optionKeys.length}
      END
    `;
  }
  return value;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
