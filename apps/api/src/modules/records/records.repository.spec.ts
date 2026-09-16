import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditService } from '../audit/audit.service';
import {
  PrismaRecordsRepository,
  type SourceRecordPatchHistory,
} from './records.repository';

// `@crm/database` ships ESM that Jest does not transform. This spec exercises
// `applyRecordPatch` / `applyTransition`, which use `Prisma` only as a type
// namespace, so a bare stub is enough. (Same approach as
// `dashboards.repository.spec.ts`.)
jest.mock('@crm/database', () => ({ Prisma: {} }));

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
