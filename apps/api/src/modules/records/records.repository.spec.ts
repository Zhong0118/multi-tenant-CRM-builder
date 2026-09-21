import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditService } from '../audit/audit.service';
import {
  PrismaRecordsRepository,
  type RecordAggregateQuery,
  type SourceRecordPatchHistory,
} from './records.repository';

// `@crm/database` ships ESM that Jest does not transform. Write-intent tests
// only need Prisma as a type namespace; aggregate SQL tests use the same
// parameterized fragment helper as `dashboards.repository.spec.ts`.
jest.mock('@crm/database', () => {
  type Sql = { sql: string; values: unknown[] };
  const fragment = (sql: string, values: unknown[] = []): Sql => ({
    sql,
    values,
  });
  const isSql = (value: unknown): value is Sql =>
    value !== null &&
    typeof value === 'object' &&
    'sql' in value &&
    'values' in value;
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? '';
    const bound: unknown[] = [];
    values.forEach((value, index) => {
      if (isSql(value)) {
        text += value.sql;
        bound.push(...value.values);
      } else {
        text += '?';
        bound.push(value);
      }
      text += strings[index + 1] ?? '';
    });
    return fragment(text, bound);
  };
  const join = (values: unknown[], separator = ', ') => {
    const parts = values.map((value) =>
      isSql(value) ? value : fragment('?', [value]),
    );
    return fragment(
      parts.map((part) => part.sql).join(separator),
      parts.flatMap((part) => part.values),
    );
  };
  return { Prisma: { sql, join, empty: fragment('') } };
});

const OBJECT_ID = 'object-leads';
const RECORD_ID = 'record-1';
const OWNER_MEMBER_ID = 'member-owner';

const actor: TenantContext = {
  userId: 'user-actor',
  tenantId: 'tenant-a',
  tenantCode: 'baijie',
  memberId: 'member-actor',
  role: 'TENANT_ADMIN',
};

interface MemberRow {
  id: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
  userStatus: 'ACTIVE' | 'INACTIVE';
}

interface RecordRow {
  id: string;
  objectId: string;
  recordNo: bigint;
  ownerMemberId: string | null;
  statusKey: string | null;
  title: string;
  data: Record<string, unknown>;
  version: number;
  createdByMemberId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function memberRow(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    id: actor.memberId,
    role: actor.role,
    status: 'ACTIVE',
    userStatus: 'ACTIVE',
    ...overrides,
  };
}

function recordRow(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: RECORD_ID,
    objectId: OBJECT_ID,
    recordNo: 1n,
    ownerMemberId: OWNER_MEMBER_ID,
    statusKey: 'new',
    title: '张三',
    data: { name: '张三' },
    version: 3,
    createdByMemberId: actor.memberId,
    createdAt: new Date('2026-08-21T10:00:00.000Z'),
    updatedAt: new Date('2026-08-21T10:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * The real `PrismaRecordsStore` over a fake transaction client. The member
 * lookup mirrors the ACTIVE-member rule of `lockActiveOwners`' SQL
 * (`m.status = 'ACTIVE' AND u.status = 'ACTIVE' FOR UPDATE OF m`), so a skipped
 * lock is observable as a write that should not have happened.
 */
function createRepository(members: MemberRow[], record: RecordRow) {
  const lockedMemberIds: string[] = [];
  const updates: Array<{ ownerMemberId: string | null }> = [];
  const historyWrites: Array<{ transitionKey: string }> = [];

  const $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (!sql.includes('FOR UPDATE OF m')) {
      throw new Error(
        `Unexpected raw query in records.repository.spec: ${sql}`,
      );
    }
    // `lockActiveOwners` interpolates (tenantId, memberId) in that order.
    const memberId = String(values[1]);
    lockedMemberIds.push(memberId);
    const member = members.find((candidate) => candidate.id === memberId);
    if (
      member &&
      member.status === 'ACTIVE' &&
      member.userStatus === 'ACTIVE'
    ) {
      return Promise.resolve([{ id: member.id, role: member.role }]);
    }
    return Promise.resolve([]);
  };

  const transaction = {
    $queryRawUnsafe: () => Promise.resolve([]),
    $queryRaw,
    record: {
      updateMany: (args: {
        where: { id: string; version: number };
        data: {
          data: Record<string, unknown>;
          title: string;
          ownerMemberId: string | null;
          statusKey?: string;
        };
      }) => {
        if (
          args.where.id !== record.id ||
          args.where.version !== record.version ||
          record.deletedAt !== null
        ) {
          return Promise.resolve({ count: 0 });
        }
        updates.push({ ownerMemberId: args.data.ownerMemberId });
        record.data = args.data.data;
        record.title = args.data.title;
        record.ownerMemberId = args.data.ownerMemberId;
        if (args.data.statusKey !== undefined) {
          record.statusKey = args.data.statusKey;
        }
        record.version += 1;
        return Promise.resolve({ count: 1 });
      },
      findUnique: () => Promise.resolve(record),
    },
    recordTransitionHistory: {
      create: (args: { data: { transitionKey: string } }) => {
        historyWrites.push({ transitionKey: args.data.transitionKey });
        return Promise.resolve({});
      },
    },
  };

  const database = {
    transaction: (work: (client: unknown) => unknown) => work(transaction),
  } as unknown as DatabaseService;

  return {
    repository: new PrismaRecordsRepository(
      new DatabaseContextRunner(database),
      {} as AuditService,
    ),
    record,
    lockedMemberIds,
    updates,
    historyWrites,
  };
}

function ordinaryUpdate(ownerMemberId: string | null) {
  return {
    recordId: RECORD_ID,
    expectedVersion: 3,
    patch: {
      values: { name: '李四' },
      title: '李四',
      ownerMemberId,
    },
  };
}

function transitionHistory(): SourceRecordPatchHistory {
  return {
    objectDefinitionId: OBJECT_ID,
    objectPublicationId: 'publication-1',
    transitionKey: 'convert',
    transitionLabel: '转化',
    fromStateKey: 'new',
    fromStateLabel: '新建',
    toStateKey: 'converted',
    toStateLabel: '已转化',
    actorMemberId: actor.memberId,
  };
}

/**
 * One transition-shaped input handed to BOTH intents: they take the very same
 * `ApplySourceRecordPatchStoreInput`, so only the method name may decide the
 * owner policy.
 */
function patchOwnedBy(ownerMemberId: string | null) {
  return {
    recordId: RECORD_ID,
    expectedVersion: 3,
    patch: {
      values: { name: '张三' },
      title: '张三',
      ownerMemberId,
      workflowStateKey: 'converted',
    },
    history: transitionHistory(),
  };
}

/**
 * The tripwire for the two write intents. Each case uses the SAME fixture — a
 * record whose current owner is a deactivated member — and the two intents must
 * disagree about it. Consolidating them back into one method therefore has to
 * break exactly one of the two:
 *
 * - lock added to the transition intent → the first case fails
 *   (`lockedMemberIds` no longer `[]`, and it throws OWNER_INVALID);
 * - lock removed from the ordinary-update intent → the second case fails
 *   (the update is applied instead of rejecting OWNER_INVALID).
 */
describe('PrismaRecordsRepository transition vs ordinary-update owner policy', () => {
  it('applyTransition advances a record whose current owner has been deactivated', async () => {
    const { repository, record, lockedMemberIds, updates, historyWrites } =
      createRepository(
        [
          memberRow(),
          memberRow({
            id: OWNER_MEMBER_ID,
            role: 'EMPLOYEE',
            userStatus: 'INACTIVE',
          }),
        ],
        recordRow(),
      );

    const updated = await repository.withTenant(actor, (store) =>
      store.applyTransition(patchOwnedBy(OWNER_MEMBER_ID)),
    );

    // No ACTIVE-owner lock at all, matching the base `applyWorkflowTransition`.
    expect(lockedMemberIds).toEqual([]);
    // The shared write body still runs: one update plus the history row.
    expect(updates).toEqual([{ ownerMemberId: OWNER_MEMBER_ID }]);
    expect(historyWrites).toEqual([{ transitionKey: 'convert' }]);
    expect(updated).toMatchObject({
      version: 4,
      workflowStateKey: 'converted',
    });
    expect(record.version).toBe(4);
  });

  it('applyRecordPatch rejects the SAME deactivated owner with OWNER_INVALID', async () => {
    const { repository, record, updates } = createRepository(
      [
        memberRow(),
        memberRow({
          id: OWNER_MEMBER_ID,
          role: 'EMPLOYEE',
          userStatus: 'INACTIVE',
        }),
      ],
      recordRow(),
    );

    await expect(
      repository.withTenant(actor, (store) =>
        store.applyRecordPatch(patchOwnedBy(OWNER_MEMBER_ID)),
      ),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID', status: 400 });

    expect(updates).toEqual([]);
    expect(record.version).toBe(3);
  });
});

describe('PrismaRecordsRepository.applyRecordPatch active-owner lock', () => {
  it('rejects an update whose unchanged owner is no longer an ACTIVE member', async () => {
    // `updateRecord` locked the owner unconditionally, so an ordinary update of
    // a record whose current owner was deactivated failed with OWNER_INVALID.
    // Ownership is NOT changing here; the lock must still run.
    const { repository, record, updates } = createRepository(
      [
        memberRow(),
        memberRow({
          id: OWNER_MEMBER_ID,
          role: 'EMPLOYEE',
          userStatus: 'INACTIVE',
        }),
      ],
      recordRow(),
    );

    await expect(
      repository.withTenant(actor, (store) =>
        store.applyRecordPatch(ordinaryUpdate(OWNER_MEMBER_ID)),
      ),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID', status: 400 });

    expect(updates).toEqual([]);
    expect(record.version).toBe(3);
    expect(record.title).toBe('张三');
  });

  it('rejects an update when the acting member is no longer ACTIVE', async () => {
    const { repository, record, updates } = createRepository(
      [
        memberRow({ userStatus: 'INACTIVE' }),
        memberRow({ id: OWNER_MEMBER_ID, role: 'EMPLOYEE' }),
      ],
      recordRow(),
    );

    await expect(
      repository.withTenant(actor, (store) =>
        store.applyRecordPatch(ordinaryUpdate(OWNER_MEMBER_ID)),
      ),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID', status: 400 });

    expect(updates).toEqual([]);
    expect(record.version).toBe(3);
  });

  it('rejects an update when the acting member role no longer matches the context', async () => {
    const { repository, record, updates } = createRepository(
      [
        memberRow({ role: 'EMPLOYEE' }),
        memberRow({ id: OWNER_MEMBER_ID, role: 'EMPLOYEE' }),
      ],
      recordRow(),
    );

    await expect(
      repository.withTenant(actor, (store) =>
        store.applyRecordPatch(ordinaryUpdate(OWNER_MEMBER_ID)),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_FORBIDDEN', status: 403 });

    expect(updates).toEqual([]);
    expect(record.version).toBe(3);
  });

  it('applies an update when the actor and the unchanged owner are ACTIVE members', async () => {
    const { repository, record, lockedMemberIds, updates } = createRepository(
      [memberRow(), memberRow({ id: OWNER_MEMBER_ID, role: 'EMPLOYEE' })],
      recordRow(),
    );

    const updated = await repository.withTenant(actor, (store) =>
      store.applyRecordPatch(ordinaryUpdate(OWNER_MEMBER_ID)),
    );

    expect(lockedMemberIds).toContain(OWNER_MEMBER_ID);
    expect(updates).toEqual([{ ownerMemberId: OWNER_MEMBER_ID }]);
    expect(updated).toMatchObject({
      id: RECORD_ID,
      ownerMemberId: OWNER_MEMBER_ID,
      title: '李四',
      version: 4,
    });
    expect(record.version).toBe(4);
  });

  it('still locks the new owner when ownership actually changes', async () => {
    const nextOwnerId = 'member-next';
    const { repository, record, updates } = createRepository(
      [
        memberRow(),
        memberRow({ id: OWNER_MEMBER_ID, role: 'EMPLOYEE' }),
        memberRow({ id: nextOwnerId, role: 'EMPLOYEE', status: 'INACTIVE' }),
      ],
      recordRow(),
    );

    await expect(
      repository.withTenant(actor, (store) =>
        store.applyRecordPatch(ordinaryUpdate(nextOwnerId)),
      ),
    ).rejects.toMatchObject({ code: 'OWNER_INVALID', status: 400 });

    expect(updates).toEqual([]);
    expect(record.version).toBe(3);
    expect(record.ownerMemberId).toBe(OWNER_MEMBER_ID);
  });
});

describe('PrismaRecordsStore.aggregateRecords', () => {
  function aggregateQuery(
    overrides: Partial<RecordAggregateQuery> = {},
  ): RecordAggregateQuery {
    return {
      objectId: OBJECT_ID,
      ownerMemberId: OWNER_MEMBER_ID,
      filters: [
        {
          fieldKey: 'lead_status',
          mode: 'EQUALS',
          values: ["new' OR 1=1 --"],
        },
      ],
      aggregation: 'SUM',
      valueFieldKey: 'quote',
      groupByFieldKey: 'lead_status',
      limit: 20,
      ...overrides,
    };
  }

  function aggregateRepository() {
    const queries: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRawUnsafe: () => Promise.resolve([]),
      $queryRaw: (query: { sql: string; values: unknown[] }) => {
        queries.push(query);
        if (query.sql.includes('GROUP BY')) {
          return Promise.resolve([
            { key: 'new', value: '10.50', count: 2 },
            { key: null, value: '1.00', count: 1 },
          ]);
        }
        return Promise.resolve([{ value: '11.50' }]);
      },
    };
    const database = {
      transaction: (work: (client: unknown) => unknown) => work(transaction),
    } as unknown as DatabaseService;
    return {
      queries,
      repository: new PrismaRecordsRepository(
        new DatabaseContextRunner(database),
        {} as AuditService,
      ),
    };
  }

  it('parameterizes tenant, owner, deleted, and numeric CASE fragments', async () => {
    const { repository, queries } = aggregateRepository();

    await expect(
      repository.withTenant(actor, (store) =>
        store.aggregateRecords(aggregateQuery()),
      ),
    ).resolves.toEqual({
      value: '11.50',
      groups: [
        { key: 'new', value: '10.50', count: 2 },
        { key: null, value: '1.00', count: 1 },
      ],
    });

    const sql = queries.map((query) => query.sql).join('\n');
    const values = queries.flatMap((query) => query.values);
    expect(sql).toMatch(/r\.tenant_id = .*::uuid/);
    expect(sql).toMatch(/r\.object_id = .*::uuid/);
    expect(sql).toMatch(/r\.deleted_at IS NULL/);
    expect(sql).toMatch(/r\.owner_member_id = .*::uuid/);
    expect(sql).toContain(
      "WHEN r.data ->> ? ~ '^-?[0-9]+([.][0-9]+)?$'",
    );
    expect(sql).toContain('THEN (r.data ->> ?)::numeric');
    expect(sql).toMatch(/ORDER BY count DESC/);
    expect(sql).toMatch(/LIMIT \?/);
    expect(sql).not.toContain("new' OR 1=1 --");
    expect(values).toEqual(
      expect.arrayContaining([
        actor.tenantId,
        OBJECT_ID,
        OWNER_MEMBER_ID,
        'quote',
        'lead_status',
        "new' OR 1=1 --",
        20,
      ]),
    );
  });

  it('counts without a value field and still reuses the read predicate', async () => {
    const { repository, queries } = aggregateRepository();

    await repository.withTenant(actor, (store) =>
      store.aggregateRecords(
        aggregateQuery({
          aggregation: 'COUNT',
          valueFieldKey: undefined,
          groupByFieldKey: undefined,
        }),
      ),
    );

    expect(queries[0]?.sql).toMatch(/COUNT\(\*\)/);
    expect(queries[0]?.sql).toMatch(/r\.deleted_at IS NULL/);
    expect(queries[0]?.sql).not.toMatch(/GROUP BY/);
  });
});
