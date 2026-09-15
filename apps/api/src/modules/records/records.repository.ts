import { ApiException } from '../../common/errors/api.exception';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';
import {
  MEMBER_ACTIVITY_TYPES,
  type MemberActivityType,
  type RecordActivity,
} from './record-activity';

export interface DynamicRecord {
  id: string;
  objectId: string;
  recordNo: bigint;
  ownerMemberId: string | null;
  workflowStateKey: string | null;
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

export type RecordListPresenceFilter = {
  fieldKey: string;
  mode: 'EMPTY' | 'NOT_EMPTY';
};

export type RecordListFilter =
  | RecordListOptionFilter
  | RecordListDateFilter
  | RecordListNumericFilter
  | RecordListBooleanFilter
  | RecordListMemberFilter
  | RecordListTextFilter
  | RecordListPresenceFilter;

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

/**
 * §14 / §19: the accumulated Source Record changes a Transition applies once.
 * It is data, not a write: `prepareSourceRecordPatch` returns one without
 * touching the stored record, and `applyRecordPatch` / `applyTransition` are
 * the only places that persist it.
 */
export interface RecordSourcePatch {
  values: Record<string, unknown>;
  title: string;
  ownerMemberId: string | null;
  /** Next Workflow state; omitted to leave the current state unchanged. */
  workflowStateKey?: string;
}

/** §30: the Transition History row written together with the source patch. */
export interface SourceRecordPatchHistory {
  objectDefinitionId: string;
  objectPublicationId: string;
  transitionKey: string;
  transitionLabel: string;
  fromStateKey: string | null;
  fromStateLabel: string | null;
  toStateKey: string;
  toStateLabel: string;
  actorMemberId: string;
}

export interface ApplySourceRecordPatchStoreInput {
  recordId: string;
  expectedVersion: number;
  patch: RecordSourcePatch;
  history?: SourceRecordPatchHistory;
}

export interface RecordsStore {
  lockImportBatch(objectId: string, batchId: string): Promise<void>;
  findImportedRecordId(
    objectId: string,
    batchId: string,
    rowNumber: number,
  ): Promise<string | null>;
  saveImportedRecordId(
    objectId: string,
    batchId: string,
    rowNumber: number,
    recordId: string,
  ): Promise<void>;
  memberExists(memberId: string): Promise<boolean>;
  allocateRecordNo(objectId: string): Promise<bigint>;
  createRecord(record: DynamicRecord): Promise<DynamicRecord>;
  listRecords(query: RecordListQuery): Promise<{
    items: DynamicRecord[];
    total: number;
  }>;
  findRecord(objectId: string, recordId: string): Promise<DynamicRecord | null>;
  /**
   * Superseded by `applyRecordPatch` and no longer called by any production
   * path; kept because removing it is tracked as a separate cleanup.
   */
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
  listActivities(
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{ items: RecordActivity[]; total: number }>;
  createActivity(activity: {
    id: string;
    recordId: string;
    activityType: MemberActivityType;
    content: string;
    nextActionAt: string | null;
    actorMemberId: string;
    createdAt: string;
  }): Promise<RecordActivity>;
  listMemberNames(memberIds: string[]): Promise<Map<string, string>>;
  appendAudit(event: AuditEvent): Promise<void>;
  /**
   * §14 / §23: the ONE final Source Record write for an ORDINARY update. It
   * atomically writes values, title, owner, workflow state and `version + 1`
   * guarded by `expectedVersion`, so a caller that accumulates several changes
   * still moves the version exactly once. It returns null when the record is
   * gone or the version moved, so the caller can raise RECORD_VERSION_CONFLICT.
   *
   * It locks the ACTIVE member rows of the actor and of `patch.ownerMemberId`
   * first, which is why an ordinary update is rejected with OWNER_INVALID when
   * the record's CURRENT owner is no longer an ACTIVE member/user, and with
   * WORKSPACE_FORBIDDEN when the actor is not ACTIVE or changed role.
   */
  applyRecordPatch(
    input: ApplySourceRecordPatchStoreInput,
  ): Promise<DynamicRecord | null>;
  /**
   * §14 / §23: the ONE final Source Record write for a WORKFLOW TRANSITION.
   * Same statement and same guards as `applyRecordPatch`, deliberately WITHOUT
   * the ACTIVE-owner lock. See the implementation for why the two intents
   * differ; the difference is inherited from the pre-refactor store, not a new
   * policy decision.
   */
  applyTransition(
    input: ApplySourceRecordPatchStoreInput,
  ): Promise<DynamicRecord | null>;
  listTransitionHistory(
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{
    items: Array<{
      id: string;
      transitionKey: string;
      transitionLabel: string;
      fromStateKey: string | null;
      fromStateLabel: string | null;
      toStateKey: string;
      toStateLabel: string;
      actorMemberId: string;
      actorDisplayName: string | null;
      createdAt: string;
    }>;
    page: number;
    limit: number;
    total: number;
  }>;
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

  async lockImportBatch(objectId: string, batchId: string): Promise<void> {
    const key = `${this.context.tenantId}:${objectId}:${this.context.memberId}:${batchId}`;
    await this.transaction
      .$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  }

  async findImportedRecordId(
    objectId: string,
    batchId: string,
    rowNumber: number,
  ): Promise<string | null> {
    const rows = await this.transaction.$queryRaw<Array<{ recordId: string }>>`
      SELECT record_id AS "recordId" FROM record_import_rows
      WHERE tenant_id = ${this.context.tenantId}::uuid AND object_id = ${objectId}::uuid
        AND member_id = ${this.context.memberId}::uuid AND batch_id = ${batchId}::uuid AND row_number = ${rowNumber}
    `;
    return rows[0]?.recordId ?? null;
  }

  async saveImportedRecordId(
    objectId: string,
    batchId: string,
    rowNumber: number,
    recordId: string,
  ): Promise<void> {
    await this.transaction.$executeRaw`
      INSERT INTO record_import_rows (tenant_id, object_id, member_id, batch_id, row_number, record_id)
      VALUES (${this.context.tenantId}::uuid, ${objectId}::uuid, ${this.context.memberId}::uuid, ${batchId}::uuid, ${rowNumber}, ${recordId}::uuid)
    `;
  }

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

  private async lockActiveOwners(ownerId: string | null) {
    for (const id of [
      ...new Set([this.context.memberId, ...(ownerId ? [ownerId] : [])]),
    ].sort()) {
      const rows = await this.transaction.$queryRaw<
        Array<{ id: string; role: string }>
      >`SELECT m.id,m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id = ${this.context.tenantId}::uuid AND m.id = ${id}::uuid AND m.status = 'ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m`;
      if (!rows.length) throw new ApiException('OWNER_INVALID', 400);
      if (id === this.context.memberId && rows[0].role !== this.context.role)
        throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    }
  }

  async createRecord(record: DynamicRecord): Promise<DynamicRecord> {
    await this.lockActiveOwners(record.ownerMemberId);
    const created = await this.transaction.record.create({
      data: {
        id: record.id,
        tenantId: this.context.tenantId,
        objectId: record.objectId,
        recordNo: record.recordNo,
        ownerMemberId: record.ownerMemberId,
        statusKey: record.workflowStateKey,
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
          orderBy: [{ [query.sort]: query.direction }, { id: query.direction }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.transaction.record.count({ where }),
      ]);
      return { items: items.map(fromPrismaRecord), total };
    }

    const direction =
      query.direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const offset = (query.page - 1) * query.limit;
    const filterSql = listWhereSql(this.context.tenantId, query, true);
    const [rows, counted] = await Promise.all([
      this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT r.id
        FROM records r
        WHERE ${filterSql}
        ORDER BY ${fieldSortExpression(query.sort)} ${direction} NULLS LAST, r.id ${direction}
        OFFSET ${offset}
        LIMIT ${query.limit}
      `),
      this.transaction.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS count
        FROM records r
        WHERE ${filterSql}
      `),
    ]);
    const total = counted[0]?.count ?? 0;
    if (rows.length === 0) return { items: [], total };
    const records = await this.transaction.record.findMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
      items: rows.flatMap((row) => {
        const record = byId.get(row.id);
        return record ? [fromPrismaRecord(record)] : [];
      }),
      total,
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

  /**
   * Dead: superseded by `applyRecordPatch`, which carries the same
   * unconditional ACTIVE-owner lock plus the optional workflow-state and
   * history support. Kept only until the separate cleanup removes it.
   */
  async updateRecord(
    recordId: string,
    expectedVersion: number,
    input: {
      values: Record<string, unknown>;
      title: string;
      ownerMemberId: string | null;
    },
  ): Promise<DynamicRecord | null> {
    await this.lockActiveOwners(input.ownerMemberId);
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

  /**
   * ORDINARY-UPDATE intent. The ACTIVE-owner lock is UNCONDITIONAL and
   * deliberate: it preserves the exact semantics of the pre-refactor
   * `updateRecord`, which locked `input.ownerMemberId` before every write. An
   * ordinary update therefore fails with OWNER_INVALID when the record's
   * CURRENT owner is not an ACTIVE member/user, or with WORKSPACE_FORBIDDEN
   * when the ACTOR's member/user is no longer ACTIVE or its role moved. Do not
   * make it conditional on an owner change: `resolveUpdateOwner` keeps the
   * existing owner on an ordinary update, so a deactivated owner would
   * silently start being accepted here.
   *
   * Consequence for later tasks: reassigning a record away from a deactivated
   * owner cannot go through an ordinary update; it needs the explicit
   * ASSIGN_OWNER path, which takes the lock for the new owner itself.
   */
  async applyRecordPatch(
    input: ApplySourceRecordPatchStoreInput,
  ): Promise<DynamicRecord | null> {
    await this.lockActiveOwners(input.patch.ownerMemberId);
    return this.applyPatchBody(input);
  }

  /**
   * WORKFLOW-TRANSITION intent. This deliberately takes NO ACTIVE-owner lock:
   * the pre-refactor `applyWorkflowTransition` never called `lockActiveOwners`
   * and relied on `expectedVersion` alone, so a transition may advance a record
   * whose current owner has since been offboarded. That matters in this
   * product because the 离职交接 (offboarding handover) flow does not rewrite
   * every record, so records owned by deactivated members legitimately exist
   * and an admin must still be able to move them.
   *
   * The actor half of the lock would also be redundant on the HTTP path:
   * `workflow-runtime.controller.ts` applies `WorkspaceGuard`, which
   * re-resolves member and tenant status before the transition runs.
   *
   * This asymmetry is INHERITED from the pre-refactor code, NOT a new policy
   * decision. If the product later wants transitions to require an ACTIVE
   * owner too, that is a separate, deliberate change — do not consolidate
   * these two intents back into one method.
   */
  applyTransition(
    input: ApplySourceRecordPatchStoreInput,
  ): Promise<DynamicRecord | null> {
    return this.applyPatchBody(input);
  }

  /**
   * The shared write body of both intents: one `updateMany` guarded by
   * `expectedVersion`, the optional Transition History row, and the reload.
   * Keeping it here is what stops the two intents from drifting apart; only
   * the lock above them differs.
   */
  private async applyPatchBody(
    input: ApplySourceRecordPatchStoreInput,
  ): Promise<DynamicRecord | null> {
    const { patch, history } = input;
    const result = await this.transaction.record.updateMany({
      where: {
        id: input.recordId,
        tenantId: this.context.tenantId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data: {
        data: toPrismaJson(patch.values),
        title: patch.title,
        ownerMemberId: patch.ownerMemberId,
        ...(patch.workflowStateKey === undefined
          ? {}
          : { statusKey: patch.workflowStateKey }),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) return null;
    if (history) {
      await this.transaction.recordTransitionHistory.create({
        data: {
          tenantId: this.context.tenantId,
          objectDefinitionId: history.objectDefinitionId,
          recordId: input.recordId,
          objectPublicationId: history.objectPublicationId,
          transitionKey: history.transitionKey,
          transitionLabel: history.transitionLabel,
          fromStateKey: history.fromStateKey,
          fromStateLabel: history.fromStateLabel,
          toStateKey: history.toStateKey,
          toStateLabel: history.toStateLabel,
          actorMemberId: history.actorMemberId,
          recordVersionBefore: input.expectedVersion,
          recordVersionAfter: input.expectedVersion + 1,
        },
      });
    }
    const record = await this.transaction.record.findUnique({
      where: { id: input.recordId },
    });
    return record ? fromPrismaRecord(record) : null;
  }

  async listTransitionHistory(
    recordId: string,
    query: { page: number; limit: number },
  ) {
    const where = {
      tenantId: this.context.tenantId,
      recordId,
    };
    const [rows, total] = await Promise.all([
      this.transaction.recordTransitionHistory.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          actor: { include: { user: { select: { displayName: true } } } },
        },
      }),
      this.transaction.recordTransitionHistory.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        transitionKey: row.transitionKey,
        transitionLabel: row.transitionLabel,
        fromStateKey: row.fromStateKey,
        fromStateLabel: row.fromStateLabel,
        toStateKey: row.toStateKey,
        toStateLabel: row.toStateLabel,
        actorMemberId: row.actorMemberId,
        actorDisplayName: row.actor.user.displayName,
        createdAt: row.createdAt.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async listActivities(
    recordId: string,
    query: { page: number; limit: number },
  ): Promise<{ items: RecordActivity[]; total: number }> {
    const where = {
      tenantId: this.context.tenantId,
      recordId,
      activityType: { in: [...MEMBER_ACTIVITY_TYPES] },
    };
    const [items, total] = await Promise.all([
      this.transaction.recordActivity.findMany({
        where,
        include: { actor: { include: { user: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.transaction.recordActivity.count({ where }),
    ]);
    return { items: items.map(fromPrismaActivity), total };
  }

  async createActivity(activity: {
    id: string;
    recordId: string;
    activityType: MemberActivityType;
    content: string;
    nextActionAt: string | null;
    actorMemberId: string;
    createdAt: string;
  }): Promise<RecordActivity> {
    const created = await this.transaction.recordActivity.create({
      data: {
        id: activity.id,
        tenantId: this.context.tenantId,
        recordId: activity.recordId,
        activityType: activity.activityType,
        content: activity.content,
        nextActionAt: activity.nextActionAt
          ? new Date(activity.nextActionAt)
          : null,
        actorMemberId: activity.actorMemberId,
        metadata: {},
        createdAt: new Date(activity.createdAt),
      },
      include: { actor: { include: { user: true } } },
    });
    return fromPrismaActivity(created);
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

  async listMemberNames(memberIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(memberIds.filter(Boolean))];
    if (unique.length === 0) return new Map();
    const members = await this.transaction.tenantMember.findMany({
      where: {
        tenantId: this.context.tenantId,
        id: { in: unique },
      },
      select: {
        id: true,
        user: { select: { displayName: true } },
      },
    });
    return new Map(
      members.map((member) => [member.id, member.user.displayName]),
    );
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function fromPrismaActivity(activity: {
  id: string;
  recordId: string;
  activityType: string;
  content: string;
  nextActionAt: Date | null;
  actorMemberId: string | null;
  createdAt: Date;
  actor?: { user: { displayName: string } } | null;
}): RecordActivity {
  return {
    id: activity.id,
    recordId: activity.recordId,
    activityType: activity.activityType as MemberActivityType,
    content: activity.content,
    nextActionAt: activity.nextActionAt?.toISOString() ?? null,
    actorMemberId: activity.actorMemberId,
    actorDisplayName: activity.actor?.user.displayName ?? null,
    createdAt: activity.createdAt.toISOString(),
  };
}

function fromPrismaRecord(record: {
  id: string;
  objectId: string;
  recordNo: bigint;
  ownerMemberId: string | null;
  statusKey: string | null;
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
    workflowStateKey: record.statusKey,
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

function listFilterCondition(
  filter: RecordListFilter,
): Prisma.RecordWhereInput {
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
  if (filter.mode === 'EQUALS' || filter.mode === 'CONTAINS') {
    return {
      OR: filter.values.map((value) => ({
        data:
          filter.mode === 'CONTAINS'
            ? { path: [filter.fieldKey], array_contains: value }
            : { path: [filter.fieldKey], equals: value },
      })),
    };
  }
  return {
    AND: presenceSql(filter.fieldKey, filter.mode === 'EMPTY', false),
  } as Prisma.RecordWhereInput;
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

function listWhereSql(
  tenantId: string,
  query: RecordListQuery,
  qualified: boolean,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`${qualified ? Prisma.sql`r.tenant_id` : Prisma.sql`tenant_id`} = ${tenantId}::uuid`,
    Prisma.sql`${qualified ? Prisma.sql`r.object_id` : Prisma.sql`object_id`} = ${query.objectId}::uuid`,
    Prisma.sql`${qualified ? Prisma.sql`r.deleted_at` : Prisma.sql`deleted_at`} IS NULL`,
  ];
  if (query.ownerMemberId) {
    parts.push(
      Prisma.sql`${qualified ? Prisma.sql`r.owner_member_id` : Prisma.sql`owner_member_id`} = ${query.ownerMemberId}::uuid`,
    );
  }
  if (query.search) {
    parts.push(searchSql(query.search, query.searchFieldKeys, qualified));
  }
  for (const filter of query.filters) {
    parts.push(filterSql(filter, qualified));
  }
  return Prisma.join(parts, ' AND ');
}

function searchSql(
  search: string,
  searchFieldKeys: string[],
  qualified: boolean,
): Prisma.Sql {
  const pattern = `%${search}%`;
  const clauses = [
    Prisma.sql`${qualified ? Prisma.sql`r.title` : Prisma.sql`title`} ILIKE ${pattern}`,
    ...searchFieldKeys.map(
      (fieldKey) =>
        Prisma.sql`${jsonText(fieldKey, qualified)} ILIKE ${pattern}`,
    ),
  ];
  return Prisma.sql`(${Prisma.join(clauses, ' OR ')})`;
}

function filterSql(filter: RecordListFilter, qualified: boolean): Prisma.Sql {
  const text = jsonText(filter.fieldKey, qualified);
  const json = jsonValue(filter.fieldKey, qualified);
  if (filter.mode === 'DATE_RANGE') {
    const bounds: Prisma.Sql[] = [];
    if (filter.from) bounds.push(Prisma.sql`${text} >= ${filter.from}`);
    if (filter.to) bounds.push(Prisma.sql`${text} <= ${filter.to}`);
    return Prisma.join(bounds, ' AND ');
  }
  if (filter.mode === 'NUMBER_RANGE') {
    const bounds: Prisma.Sql[] = [
      Prisma.sql`${text} ~ '^-?[0-9]+([.][0-9]+)?$'`,
    ];
    if (filter.min !== undefined) {
      bounds.push(Prisma.sql`${text}::numeric >= ${filter.min}`);
    }
    if (filter.max !== undefined) {
      bounds.push(Prisma.sql`${text}::numeric <= ${filter.max}`);
    }
    return Prisma.join(bounds, ' AND ');
  }
  if (filter.mode === 'BOOLEAN_EQUALS') {
    return Prisma.sql`${text} = ${String(filter.value)}`;
  }
  if (filter.mode === 'MEMBER_EQUALS' || filter.mode === 'EQUALS') {
    return Prisma.sql`${text} IN (${Prisma.join(filter.values)})`;
  }
  if (filter.mode === 'CONTAINS') {
    if (filter.values.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          CASE WHEN jsonb_typeof(${json}) = 'array'
            THEN ${json}
            ELSE '[]'::jsonb
          END
        ) item(value)
        WHERE item.value IN (${Prisma.join(filter.values)})
      )
    `;
  }
  if (filter.mode === 'TEXT_CONTAINS') {
    return Prisma.sql`${text} ILIKE ${`%${filter.contains}%`}`;
  }
  return presenceSql(filter.fieldKey, filter.mode === 'EMPTY', qualified);
}

function presenceSql(
  fieldKey: string,
  empty: boolean,
  qualified: boolean,
): Prisma.Sql {
  const json = jsonValue(fieldKey, qualified);
  const text = jsonText(fieldKey, qualified);
  const predicate = Prisma.sql`(
    ${json} IS NULL
    OR ${json} = 'null'::jsonb
    OR (jsonb_typeof(${json}) = 'string' AND NULLIF(BTRIM(${text}), '') IS NULL)
    OR (jsonb_typeof(${json}) = 'array' AND jsonb_array_length(${json}) = 0)
  )`;
  return empty ? predicate : Prisma.sql`NOT ${predicate}`;
}

function jsonText(fieldKey: string, qualified: boolean): Prisma.Sql {
  return qualified
    ? Prisma.sql`r.data ->> ${fieldKey}`
    : Prisma.sql`data ->> ${fieldKey}`;
}

function jsonValue(fieldKey: string, qualified: boolean): Prisma.Sql {
  return qualified
    ? Prisma.sql`r.data -> ${fieldKey}`
    : Prisma.sql`data -> ${fieldKey}`;
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
