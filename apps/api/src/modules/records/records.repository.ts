import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

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

export interface RecordListQuery {
  objectId: string;
  page: number;
  limit: number;
  search?: string;
  searchFieldKeys: string[];
  ownerMemberId?: string;
  filters: RecordListOptionFilter[];
  sort: 'updatedAt' | 'createdAt' | 'recordNo';
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
        ...query.filters.map(optionFilterCondition),
      ],
    };
    const orderBy: Prisma.RecordOrderByWithRelationInput[] = [
      { [query.sort]: query.direction },
      { id: query.direction },
    ];
    const [items, total] = await Promise.all([
      this.transaction.record.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.transaction.record.count({ where }),
    ]);
    return { items: items.map(fromPrismaRecord), total };
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

function optionFilterCondition(
  filter: RecordListOptionFilter,
): Prisma.RecordWhereInput {
  return {
    OR: filter.values.map((value) => ({
      data:
        filter.mode === 'CONTAINS'
          ? { path: [filter.fieldKey], array_contains: value }
          : { path: [filter.fieldKey], equals: value },
    })),
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}
