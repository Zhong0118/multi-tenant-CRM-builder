import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@crm/database';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
// Static and extensionless, like `../src/bootstrap` above: `apps/api` is
// CommonJS (no `"type": "module"`), so a static relative import resolves by the
// CJS rules `nodenext` applies here. A dynamic `import()` of the same path is
// resolved as ESM instead, which demands a `.js` extension that ts-jest's
// resolver does not map back to the `.ts` source (test/jest-e2e.json has no
// `moduleNameMapper`).
import { isWriteConflict } from '../src/infrastructure/database/write-conflict';
import { hashSessionToken } from '../src/modules/auth/session.service';

/**
 * Task 10 — Action Engine V1 proof against a REAL PostgreSQL.
 *
 * Tasks 0–9 proved the Action Engine against in-process harnesses: Task 9's
 * reviewer recorded that its service-layer harness only MODELS rollback and
 * that no real deadlock can be exercised without live PostgreSQL. This suite
 * therefore drives the real HTTP path (`WorkflowRuntimeController` →
 * `WorkflowRuntimeService` → Action Engine → the Task 4/5/6 commands) against
 * the isolated test database on 5433 through the `crm_app` role, so RLS, the
 * row locks and the driver's real error shapes are all in play.
 *
 * What this file proves, and where each claim comes from:
 *
 * - T10a  §4 / §23       — all-or-nothing rollback when a later Action fails.
 * - T10b  §29/§32/§36    — a REAL PostgreSQL `40P01` produced by this driver
 *                          stack is classified retryable; the bounded retry
 *                          absorbs an in-service deadlock and still commits
 *                          exactly once; two concurrent Transitions never
 *                          surface a raw 500 and never partially commit.
 * - T10c  §29            — same record + same expectedVersion + same transition:
 *                          exactly one success, one `RECORD_VERSION_CONFLICT`,
 *                          exactly one downstream row set.
 * - T10d  §37 / §46.3    — no Action may resolve or act on another tenant's
 *                          object or record (first real RLS proof of this path).
 * - T10e  §5 / §18 / §20 — a Member Override that removes the target create
 *                          permission rolls the whole Transition back.
 * - T10f  §23 / §36      — an unreadable / hidden Source Record is denied on
 *                          the execute path with zero side effects.
 */

const origin = 'http://localhost:3000';
const tenantCode = 'e2e-action-engine';
const foreignTenantCode = 'e2e-action-engine-foreign';
const phones = {
  admin: '+8613988814001',
  actorA: '+8613988814002',
  actorB: '+8613988814003',
  foreign: '+8613988814004',
};

const EXECUTE_AUDIT_ACTIONS = [
  'record.created',
  'record.relation_added',
  'follow_up.created',
  'record.updated',
  'record.owner_assigned',
  'record.transition_executed',
  'record.workflow_started',
];

type FieldAccess = 'EDIT' | 'READ_ONLY' | 'HIDDEN';
type Scope = 'ALL' | 'OWN' | 'NONE';

interface FieldSpec {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  access?: FieldAccess;
}

interface AccessSpec {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  readScope: Scope;
  updateScope: Scope;
}

interface Actor {
  userId: string;
  memberId: string;
  cookie: string;
}

interface Fixture {
  tenantId: string;
  foreignTenantId: string;
  adminMemberId: string;
  actorA: Actor;
  actorB: Actor;
  foreignMemberId: string;
  foreignRecordId: string;
  objects: Record<string, string>;
  records: Record<string, { id: string; version: number }>;
}

interface ExecuteInput {
  objectCode: string;
  recordId: string;
  transitionKey: string;
  cookie: string;
  expectedVersion: number;
}

interface RealError {
  status: 'fulfilled' | 'rejected';
  originalCode?: string | null;
  error?: unknown;
}

jest.setTimeout(180_000);

/** The execute route is a POST: a committed Transition answers 201 Created. */
const OK = 201;

describe('Action Engine V1 atomicity and tenant safety (e2e, real PostgreSQL)', () => {
  let app: INestApplication<App>;
  let adminDatabase: PrismaClient;
  let runtimeDatabase: PrismaClient;
  let fixture: Fixture;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = '123456';
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
    const { createDatabaseClient } = await import('@crm/database');
    adminDatabase = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
    );
    runtimeDatabase = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_URL'),
    );
    app = (await createApp()) as INestApplication<App>;
  });

  beforeEach(async () => {
    await cleanup(adminDatabase);
    fixture = await provision(adminDatabase);
  });

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app?.close();
    await Promise.allSettled([
      adminDatabase?.$disconnect(),
      runtimeDatabase?.$disconnect(),
    ]);
  });

  // ---------------------------------------------------------------------------
  // T10a — real all-or-nothing rollback (§4, §23 steps 9–17)
  // ---------------------------------------------------------------------------

  it('T10a rolls the whole Transition back when a later Action fails', async () => {
    const record = fixture.records.dealRollback;
    const before = await snapshotSource(record.id);

    const response = await execute({
      objectCode: 'deals',
      recordId: record.id,
      transitionKey: 'close-won',
      cookie: fixture.actorA.cookie,
      expectedVersion: record.version,
    });

    // The failing Action is not silently ignored: the whole Transition fails.
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'ACTION_EXECUTION_FAILED' });

    // Zero Action-created data survives — asserted against the real tables.
    //
    // `invoices` is deliberately NOT asserted: it is the object the FAILING
    // Action targets and the actor is seeded `canCreate: false` there, so
    // `invoices === 0` would hold under any behaviour whatsoever and is not
    // rollback evidence. Every count below is a target this actor CAN create
    // into, so a partial commit would flip it from 0 to 1.
    //
    // Logged as one line so a mutation that commits the Transition while still
    // answering 403 makes every committed count visible in the same run, even
    // though Jest aborts the test at the first failing `expect` (see §10 of
    // `.superpowers/sdd/task-10-report.md`).
    console.log(
      `[T10a] counts tasks=${await countRecords(fixture.objects.tasks)} notes=${await countRecords(fixture.objects.notes)} relations=${await countRelations()} followUps=${await countFollowUps()}`,
    );
    expect(await countRecords(fixture.objects.tasks)).toBe(0);
    expect(await countRecords(fixture.objects.notes)).toBe(0);
    expect(await countRelations()).toBe(0);
    expect(await countFollowUps()).toBe(0);

    // The Source Record did not move: same state, version, values and owner.
    expect(await snapshotSource(record.id)).toEqual(before);

    // No Transition History row and no successful-looking audit.
    expect(await countHistory(record.id)).toBe(0);
    expect(await successfulAudits()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T10e — Member Override removing the target create permission (§5, §18)
  // ---------------------------------------------------------------------------

  it('T10e rolls back when a Member Override removes the target create permission', async () => {
    const record = fixture.records.caseForOverride;
    const before = await snapshotSource(record.id);

    // Control first: the same Action sequence succeeds for actorB, who has no
    // override — so the denial below is the override, not the Action shape.
    await adminDatabase.objectPermission.create({
      data: {
        tenantId: fixture.tenantId,
        objectId: fixture.objects.receipts,
        subjectType: 'MEMBER',
        subjectMemberId: fixture.actorB.memberId,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'ALL',
        updateScope: 'ALL',
      },
    });
    await adminDatabase.objectPermission.create({
      data: {
        tenantId: fixture.tenantId,
        objectId: fixture.objects.receipts,
        subjectType: 'MEMBER',
        subjectMemberId: fixture.actorA.memberId,
        canCreate: false,
        canRead: true,
        canUpdate: false,
        canDelete: false,
        readScope: 'ALL',
        updateScope: 'NONE',
      },
    });

    const controlRecord = await createRecord(adminDatabase, fixture.tenantId, {
      objectId: fixture.objects.cases,
      ownerMemberId: fixture.actorB.memberId,
      title: 'Override 对照工单',
      values: { name: 'Override 对照工单' },
      statusKey: 'open',
      recordNo: 2,
    });
    const control = await execute({
      objectCode: 'cases',
      recordId: controlRecord.id,
      transitionKey: 'approve',
      cookie: fixture.actorB.cookie,
      expectedVersion: 1,
    });
    expect(control.status).toBe(OK);
    expect(await countRecords(fixture.objects.receipts)).toBe(1);

    // Now the overridden actor: the source Transition is permitted (this actor
    // may update `cases`), but the target create is denied by the override.
    const response = await execute({
      objectCode: 'cases',
      recordId: record.id,
      transitionKey: 'approve',
      cookie: fixture.actorA.cookie,
      expectedVersion: record.version,
    });
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'ACTION_EXECUTION_FAILED' });

    // Only the control's receipt exists: the overridden Transition created
    // nothing, wrote no follow-up and left its source untouched.
    expect(await countRecords(fixture.objects.receipts)).toBe(1);
    expect(await countFollowUpsFor(record.id)).toBe(0);
    expect(await snapshotSource(record.id)).toEqual(before);
    expect(await countHistory(record.id)).toBe(0);
    expect(await successfulAudits()).toEqual([
      'follow_up.created',
      'record.created',
      'record.transition_executed',
    ]);
  });

  // ---------------------------------------------------------------------------
  // T10d — RLS / cross-tenant (§37, §46.3)
  // ---------------------------------------------------------------------------

  it('T10d forbids resolving or acting on another tenant object or record', async () => {
    const foreignBefore = await countRecordsForTenant(
      fixture.foreignTenantId,
      fixture.objects['foreign-shared-report'],
    );
    // `foreign-secrets` is the object the failing Action of `escalate` targets:
    // it is the one table a leaked cross-tenant write would land in.
    const foreignSecretsBefore = await countRecordsForTenant(
      fixture.foreignTenantId,
      fixture.objects['foreign-secrets'],
    );
    expect(foreignSecretsBefore).toBe(1); // fixture seeds exactly one such row
    const escalateBefore = await snapshotSource(fixture.records.dealEscalate.id);
    const foreignRecordBefore = await snapshotSource(fixture.foreignRecordId);

    // (1) An Action may not resolve an object that exists only in the other
    // tenant: the local lookup must not fall through to a foreign publication.
    const escalate = await execute({
      objectCode: 'deals',
      recordId: fixture.records.dealEscalate.id,
      transitionKey: 'escalate',
      cookie: fixture.actorA.cookie,
      expectedVersion: fixture.records.dealEscalate.version,
    });
    expect(escalate.status).toBe(404);
    expect(escalate.body).toMatchObject({ code: 'ACTION_EXECUTION_FAILED' });
    // The first Action of that Transition would have created a task: it must
    // not survive the failure of the second.
    expect(await countRecords(fixture.objects.tasks)).toBe(0);
    expect(await snapshotSource(fixture.records.dealEscalate.id)).toEqual(
      escalateBefore,
    );
    expect(await countHistory(fixture.records.dealEscalate.id)).toBe(0);
    // The failing Action would have written into the OTHER tenant's
    // `foreign-secrets`: that table is asserted unchanged, in that tenant.
    expect(
      await countRecordsForTenant(
        fixture.foreignTenantId,
        fixture.objects['foreign-secrets'],
      ),
    ).toBe(foreignSecretsBefore);

    // (2) The same object CODE in both tenants stays tenant-scoped: the created
    // record belongs to this tenant and the foreign one is untouched.
    const shared = await execute({
      objectCode: 'deals',
      recordId: fixture.records.dealShare.id,
      transitionKey: 'share',
      cookie: fixture.actorA.cookie,
      expectedVersion: fixture.records.dealShare.version,
    });
    expect(shared.status).toBe(OK);
    const created = await adminDatabase.record.findMany({
      where: { objectId: fixture.objects['shared-report'] },
      select: { tenantId: true },
    });
    expect(created).toEqual([{ tenantId: fixture.tenantId }]);
    expect(
      await countRecordsForTenant(
        fixture.foreignTenantId,
        fixture.objects['foreign-shared-report'],
      ),
    ).toBe(foreignBefore);

    // (3) Pointing the execute path at the OTHER tenant's record id must not
    // reach it.
    //
    // WHAT THIS PROVES, EXACTLY: the execute path answers 404 RECORD_NOT_FOUND
    // for a foreign record id and writes nothing to that tenant's tables.
    //
    // WHAT IT DOES NOT PROVE: it does NOT isolate the `tenant_id` predicate of
    // `lockRecord` (`records.repository.ts`). The request's `objectCode`
    // (`shared-report`) resolves to the LOCAL publication, so the foreign row is
    // already rejected by the `object_id` predicate (its `object_id` is the
    // FOREIGN object's id); and because RLS on `records` is
    // `tenant_id = current_setting('app.tenant_id')` — set from the same context
    // the query scopes by — the row is invisible to `crm_app` regardless. A
    // source lock without the tenant predicate would still produce this 404, so
    // this assertion is NOT mutation-checked for tenant scoping (see §10 of the
    // report). What it does pin is that no cross-tenant record id is reachable
    // and that the attempt leaves the foreign record byte-identical.
    const crossRecord = await execute({
      objectCode: 'shared-report',
      recordId: fixture.foreignRecordId,
      transitionKey: 'publish',
      cookie: fixture.actorA.cookie,
      expectedVersion: 1,
    });
    expect(crossRecord.status).toBe(404);
    expect(crossRecord.body).toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(await snapshotSource(fixture.foreignRecordId)).toEqual(
      foreignRecordBefore,
    );

    // (4) RLS is the backstop underneath all of this: the runtime role sees
    // exactly one tenant's rows, never the other tenant's, and a cross-tenant
    // write touches nothing.
    expect(
      await runtimeRecordCount(fixture.tenantId, fixture.actorA.userId),
    ).toBe(await countRecordsForTenantAll(fixture.tenantId));
    expect(
      await runtimeRecordCount(fixture.foreignTenantId, fixture.actorA.userId),
    ).toBe(await countRecordsForTenantAll(fixture.foreignTenantId));
    expect(
      await runtimeCrossTenantUpdate(
        fixture.tenantId,
        fixture.actorA.userId,
        fixture.foreignRecordId,
      ),
    ).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // T10c — stale-version concurrency (§29)
  // ---------------------------------------------------------------------------

  it('T10c lets exactly one of two same-version Transitions win', async () => {
    const record = fixture.records.orderRecord;

    const [first, second] = await Promise.all([
      execute({
        objectCode: 'orders',
        recordId: record.id,
        transitionKey: 'confirm',
        cookie: fixture.actorA.cookie,
        expectedVersion: record.version,
      }),
      execute({
        objectCode: 'orders',
        recordId: record.id,
        transitionKey: 'confirm',
        cookie: fixture.actorA.cookie,
        expectedVersion: record.version,
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([OK, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body).toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });

    // Exactly ONE downstream set exists.
    expect(await countRecords(fixture.objects.tasks)).toBe(1);
    expect(await countFollowUpsFor(record.id)).toBe(1);
    expect(await countHistory(record.id)).toBe(1);
    const after = await snapshotSource(record.id);
    expect(after.version).toBe(record.version + 1);
    expect(after.statusKey).toBe('confirmed');
    await expectExactlyOneExecution();
  });

  // ---------------------------------------------------------------------------
  // T10f — unreadable / hidden source on the execute path (§23, §36)
  // ---------------------------------------------------------------------------

  it('T10f denies an unreadable or hidden Source Record with no side effects', async () => {
    // (a) The object is not readable for the actor at all (canRead = false).
    const unreadable = fixture.records.vaultRecord;
    const unreadableResponse = await execute({
      objectCode: 'vaults',
      recordId: unreadable.id,
      transitionKey: 'unlock',
      cookie: fixture.actorA.cookie,
      expectedVersion: unreadable.version,
    });
    expect(unreadableResponse.status).toBe(403);
    expect(unreadableResponse.body).toMatchObject({
      code: 'OBJECT_ACTION_FORBIDDEN',
    });
    expect(await snapshotSource(unreadable.id)).toMatchObject({
      version: unreadable.version,
      statusKey: 'locked',
    });
    expect(await countHistory(unreadable.id)).toBe(0);
    expect(await successfulAudits()).toEqual([]);

    // (b) The object is readable but OWN-scoped and the record belongs to
    // somebody else: the source lock carries the owner predicate, so the record
    // is not found and nothing is written.
    const hidden = fixture.records.ledgerRecord;
    const hiddenResponse = await execute({
      objectCode: 'ledgers',
      recordId: hidden.id,
      transitionKey: 'settle',
      cookie: fixture.actorA.cookie,
      expectedVersion: hidden.version,
    });
    expect(hiddenResponse.status).toBe(404);
    expect(hiddenResponse.body).toMatchObject({ code: 'RECORD_NOT_FOUND' });
    expect(await snapshotSource(hidden.id)).toMatchObject({
      version: hidden.version,
      statusKey: 'open',
    });
    expect(await countHistory(hidden.id)).toBe(0);
    expect(await countRecords(fixture.objects.tasks)).toBe(0);
    expect(await successfulAudits()).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // T10b (i) — the REAL driver error shape (§32, §36)
  // ---------------------------------------------------------------------------

  it('T10b-i classifies a REAL PostgreSQL 40P01 deadlock as retryable', async () => {
    const { realDeadlock, survivor } = await forceRealDeadlock();
    let realOtherCode = 'unknown';

    // The genuine shape, straight from @prisma/adapter-pg: P2010 with the
    // SQLSTATE in meta.driverAdapterError.cause.originalCode and NO meta.code
    // — the fact Task 9 could only model.
    expect(readOriginalCode(realDeadlock)).toBe('40P01');
    expect(realDeadlock).toMatchObject({ code: 'P2010' });
    const meta = (realDeadlock as { meta?: Record<string, unknown> }).meta;
    expect(meta).toBeDefined();
    expect(Object.keys(meta ?? {})).toEqual(['driverAdapterError']);
    expect(meta).not.toHaveProperty('code');
    expect(
      (meta?.driverAdapterError as { cause?: { originalCode?: string } }).cause
        ?.originalCode,
    ).toBe('40P01');

    // The other connection survived the same cycle, so exactly one transaction
    // was aborted: this is a real deadlock, not two independent failures.
    expect(survivor.status).toBe('fulfilled');

    // …and the predicate the retry loop uses accepts it.
    expect(isWriteConflict(realDeadlock)).toBe(true);

    // Negative control: a REAL non-retryable server error from the same stack
    // (undefined table, 42P01) must NOT be treated as a write conflict — so the
    // predicate keys on the SQLSTATE, not on "any P2010".
    const realOther = await captureRealServerError();
    realOtherCode = realOther.originalCode ?? 'unknown';
    expect(realOther.originalCode).toBe('42P01');
    expect(isWriteConflict(realOther.error)).toBe(false);

    // Verbatim evidence for the report.
    console.log(
      `[T10b-i raw] ${JSON.stringify({
        code: (realDeadlock as { code?: string }).code,
        metaKeys: Object.keys(meta ?? {}),
        metaCode: (meta as { code?: string } | undefined)?.code ?? null,
        driverOriginalCode: readOriginalCode(realDeadlock),
        isWriteConflict: isWriteConflict(realDeadlock),
        negativeControlCode: realOtherCode,
      })}`,
    );
  });

  it('T10b-i absorbs a REAL in-service deadlock in the bounded retry and commits exactly once', async () => {
    const record = fixture.records.handoffRecord;
    const deadlocksBefore = await deadlockCount();

    // The blocker holds the Source Record row first. The Transition transaction
    // then takes the actor-membership lock and blocks on the record row; when
    // the blocker asks for that same membership row the two transactions form a
    // real lock cycle and PostgreSQL aborts one of them.
    //
    // The blocker raises its own `deadlock_timeout` so the SERVICE transaction
    // is the one whose wait times out — i.e. the one PostgreSQL aborts with
    // 40P01. That puts the REAL error through the real
    // `WorkflowRuntimeService.execute` retry loop.
    const { createDatabaseClient } = await import('@crm/database');
    const blocker = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
    );
    const run: { http?: Promise<request.Response>; blockerSecond: string } = {
      blockerSecond: 'pending',
    };

    try {
      await blocker.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL deadlock_timeout = '30s'");
          await tx.$queryRawUnsafe(
            'SELECT id FROM records WHERE id = $1::uuid FOR UPDATE',
            record.id,
          );

          // Start the real HTTP Transition; it locks the actor membership row
          // and then blocks on the record row this transaction holds.
          run.http = (async () =>
            execute({
              objectCode: 'handoffs',
              recordId: record.id,
              transitionKey: 'hand-off',
              cookie: fixture.actorA.cookie,
              expectedVersion: record.version,
            }))();

          const waiting = await waitForLockWaiter(20_000);
          expect(waiting).toBe(true);

          try {
            await tx.$queryRawUnsafe(
              'SELECT id FROM tenant_members WHERE id = $1::uuid FOR UPDATE',
              fixture.actorA.memberId,
            );
            run.blockerSecond = 'granted';
          } catch (error) {
            run.blockerSecond = describeError(error);
            throw error;
          }
        },
        { maxWait: 30_000, timeout: 60_000 },
      );
    } catch (error) {
      if (run.blockerSecond === 'pending') {
        run.blockerSecond = describeError(error);
      }
    }

    const response = await (run.http ?? Promise.reject(new Error('no request')));
    const deadlocksAfter = await deadlockCount();
    console.log(
      `[T10b-i in-service] blockerSecond=${run.blockerSecond} status=${response.status} deadlocks ${deadlocksBefore} -> ${deadlocksAfter}`,
    );

    // A real deadlock happened, and the membership request was GRANTED — only
    // possible because the SERVICE transaction was the aborted one. Its retry
    // then committed the whole Transition exactly once.
    expect(deadlocksAfter).toBeGreaterThan(deadlocksBefore);
    expect(run.blockerSecond).toBe('granted');
    expect(response.status).toBe(OK);
    expect(await countHistory(record.id)).toBe(1);
    expect((await snapshotSource(record.id)).version).toBe(record.version + 1);
    expect(await countRecords(fixture.objects.tasks)).toBe(1);
    expect(await countFollowUpsFor(record.id)).toBe(1);
    await expectExactlyOneExecution();

    await blocker.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // T10b (ii) — two concurrent Transitions across two connections
  // ---------------------------------------------------------------------------

  it('T10b-ii serializes two concurrent Transitions on one record: one success, one clean conflict, never a 500', async () => {
    const record = fixture.records.handoffRecord; // owned by actorB
    const deadlocksBefore = await deadlockCount();

    // Both requests target the SAME record with the same expectedVersion but a
    // DIFFERENT actor. The transition assigns its follow-up to the record owner
    // (`SOURCE_OWNER`), so actorA's transaction locks membership A and then
    // wants B while actorB's locks B and then wants A — a real membership lock
    // inversion. Both first lock the shared record row, so only one can commit.
    const [first, second] = await Promise.all([
      execute({
        objectCode: 'handoffs',
        recordId: record.id,
        transitionKey: 'hand-off',
        cookie: fixture.actorA.cookie,
        expectedVersion: record.version,
      }),
      execute({
        objectCode: 'handoffs',
        recordId: record.id,
        transitionKey: 'hand-off',
        cookie: fixture.actorB.cookie,
        expectedVersion: record.version,
      }),
    ]);
    const deadlocksAfter = await deadlockCount();

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([OK, 409]);
    const conflict = first.status === 409 ? first : second;
    // The loser either lost the version race directly or was the deadlock
    // victim whose retry hit the moved version — both are the same clean domain
    // conflict, never a raw driver error.
    expect(conflict.body).toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });

    // No partial commit: one downstream set, one history row, version +1.
    expect(await countRecords(fixture.objects.tasks)).toBe(1);
    expect(await countFollowUpsFor(record.id)).toBe(1);
    expect(await countHistory(record.id)).toBe(1);
    expect((await snapshotSource(record.id)).version).toBe(record.version + 1);
    await expectExactlyOneExecution();

    // Evidence for the report: was the clean 409 produced by a retry after a
    // real deadlock, or by the plain version race?
    console.log(
      `[T10b-ii same-record] statuses=${JSON.stringify([first.status, second.status])} deadlocks ${deadlocksBefore} -> ${deadlocksAfter}`,
    );
  });

  it('T10b-ii runs two concurrent Transitions on records A and B without a raw 500 or a partial commit', async () => {
    const recordA = fixture.records.pickupA; // owned by actorB, driven by actorA
    const recordB = fixture.records.pickupB; // owned by actorA, driven by actorB
    const deadlocksBefore = await deadlockCount();

    const [first, second] = await Promise.all([
      execute({
        objectCode: 'pickups',
        recordId: recordA.id,
        transitionKey: 'pick-up',
        cookie: fixture.actorA.cookie,
        expectedVersion: recordA.version,
      }),
      execute({
        objectCode: 'pickups',
        recordId: recordB.id,
        transitionKey: 'pick-up',
        cookie: fixture.actorB.cookie,
        expectedVersion: recordB.version,
      }),
    ]);
    const deadlocksAfter = await deadlockCount();

    expect([first.status, second.status]).not.toContain(500);
    for (const response of [first, second]) {
      expect([OK, 409]).toContain(response.status);
      if (response.status === 409) {
        expect(response.body).toMatchObject({
          code: 'RECORD_VERSION_CONFLICT',
        });
      }
    }

    // Per-record consistency: a committed Transition left exactly one full set;
    // a conflicted one left nothing at all. Counts are compared with the number
    // of committed Transitions, not with a loop index, because the two
    // transactions may commit in either order.
    const outcomes = [
      { response: first, record: recordA },
      { response: second, record: recordB },
    ];
    const successes = outcomes.filter(
      ({ response }) => response.status === OK,
    ).length;
    expect(successes).toBeGreaterThanOrEqual(1);
    expect(await countRecords(fixture.objects.tasks)).toBe(successes);
    for (const { response, record } of outcomes) {
      const after = await snapshotSource(record.id);
      if (response.status === OK) {
        expect(after.version).toBe(record.version + 1);
        expect(after.statusKey).toBe('picked');
        expect(await countHistory(record.id)).toBe(1);
        expect(await countFollowUpsFor(record.id)).toBe(1);
      } else {
        expect(after.version).toBe(record.version);
        expect(after.statusKey).toBe('open');
        expect(await countHistory(record.id)).toBe(0);
        expect(await countFollowUpsFor(record.id)).toBe(0);
      }
    }

    // This case must not pass vacuously: the SOURCE_OWNER assignee is what makes
    // actorA's transaction hold membership A and want B while actorB's holds B
    // and wants A, i.e. what makes this a deadlock-retry test instead of two
    // independent successes. If the lock inversion ever stops happening, this
    // assertion fails loudly rather than the case quietly degrading.
    expect(deadlocksAfter).toBeGreaterThan(deadlocksBefore);

    console.log(
      `[T10b-ii A/B] statuses=${JSON.stringify([first.status, second.status])} deadlocks ${deadlocksBefore} -> ${deadlocksAfter}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Helpers that talk to the app / the database
  // ---------------------------------------------------------------------------

  function execute(input: ExecuteInput): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(
        `/api/v1/workspaces/${tenantCode}/objects/${input.objectCode}/records/${input.recordId}/workflow/transitions/${input.transitionKey}`,
      )
      .set('Origin', origin)
      .set('Cookie', input.cookie)
      .send({ expectedVersion: input.expectedVersion });
  }

  function snapshotSource(recordId: string) {
    return adminDatabase.record.findFirstOrThrow({
      where: { id: recordId },
      select: {
        version: true,
        statusKey: true,
        title: true,
        ownerMemberId: true,
        data: true,
        deletedAt: true,
      },
    });
  }

  function countRecords(objectId: string): Promise<number> {
    return adminDatabase.record.count({
      where: { tenantId: fixture.tenantId, objectId, deletedAt: null },
    });
  }

  function countRecordsForTenantAll(tenantId: string): Promise<number> {
    return adminDatabase.record.count({ where: { tenantId, deletedAt: null } });
  }

  function countRecordsForTenant(
    tenantId: string,
    objectId: string,
  ): Promise<number> {
    return adminDatabase.record.count({
      where: { tenantId, objectId, deletedAt: null },
    });
  }

  async function countRelations(): Promise<number> {
    const rows = await adminDatabase.$queryRawUnsafe<Array<{ count: number }>>(
      'SELECT count(*)::int AS count FROM record_relations WHERE tenant_id = $1::uuid',
      fixture.tenantId,
    );
    return Number(rows[0]?.count ?? 0);
  }

  function countFollowUps(): Promise<number> {
    return adminDatabase.recordFollowUp.count({
      where: { tenantId: fixture.tenantId },
    });
  }

  function countFollowUpsFor(recordId: string): Promise<number> {
    return adminDatabase.recordFollowUp.count({
      where: { tenantId: fixture.tenantId, recordId },
    });
  }

  function countHistory(recordId: string): Promise<number> {
    return adminDatabase.recordTransitionHistory.count({
      where: { tenantId: fixture.tenantId, recordId },
    });
  }

  async function successfulAudits(recordId?: string): Promise<string[]> {
    const rows = await adminDatabase.auditLog.findMany({
      where: {
        tenantId: fixture.tenantId,
        action: { in: EXECUTE_AUDIT_ACTIONS },
        ...(recordId ? { resourceId: recordId } : {}),
      },
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map(({ action }) => action);
  }

  /**
   * Every Action-Engine audit of this tenant, with the execution id it carries.
   * ONE committed Transition must produce exactly one `record.created`, one
   * `follow_up.created` and one `record.transition_executed`, all sharing ONE
   * `workflowExecutionId` — so a retry that committed twice, or a partial
   * commit, cannot pass.
   */
  async function executionAudits(): Promise<
    Array<{ action: string; executionId: string | null }>
  > {
    const rows = await adminDatabase.auditLog.findMany({
      where: {
        tenantId: fixture.tenantId,
        action: { in: EXECUTE_AUDIT_ACTIONS },
      },
      select: { action: true, after: true },
      orderBy: { action: 'asc' },
    });
    return rows.map(({ action, after }) => ({
      action,
      executionId:
        ((after ?? {}) as { workflowExecutionId?: string })
          .workflowExecutionId ?? null,
    }));
  }

  async function expectExactlyOneExecution(): Promise<void> {
    const audits = await executionAudits();
    expect(audits.map(({ action }) => action)).toEqual([
      'follow_up.created',
      'record.created',
      'record.transition_executed',
    ]);
    const executionIds = new Set(audits.map(({ executionId }) => executionId));
    expect(executionIds.size).toBe(1);
    expect([...executionIds][0]).not.toBeNull();
  }

  async function runtimeRecordCount(
    tenantId: string,
    userId: string,
  ): Promise<number> {
    const rows = await withRuntimeSettings(tenantId, userId, (tx) =>
      tx.$queryRawUnsafe<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM records WHERE deleted_at IS NULL',
      ),
    );
    return Number(rows[0]?.count ?? 0);
  }

  async function runtimeCrossTenantUpdate(
    tenantId: string,
    userId: string,
    foreignRecordId: string,
  ): Promise<number> {
    return withRuntimeSettings(tenantId, userId, async (tx) => {
      const affected = await tx.$executeRawUnsafe(
        'UPDATE records SET title = title WHERE id = $1::uuid',
        foreignRecordId,
      );
      return Number(affected);
    });
  }

  function withRuntimeSettings<T>(
    tenantId: string,
    userId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return runtimeDatabase.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        "SELECT set_config('app.user_id', $1, true)",
        userId,
      );
      await tx.$queryRawUnsafe(
        "SELECT set_config('app.tenant_id', $1, true)",
        tenantId,
      );
      return work(tx);
    });
  }

  async function deadlockCount(): Promise<number> {
    const rows = await adminDatabase.$queryRawUnsafe<
      Array<{ deadlocks: bigint }>
    >(
      'SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()',
    );
    return Number(rows[0]?.deadlocks ?? 0);
  }

  async function waitForLockWaiter(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await adminDatabase.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND pid <> pg_backend_pid()`,
      );
      if (Number(rows[0]?.count ?? 0) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async function forceRealDeadlock(): Promise<{
    realDeadlock: unknown;
    survivor: RealError;
  }> {
    const first = fixture.actorA.memberId;
    const second = fixture.actorB.memberId;
    const userId = fixture.actorA.userId;
    const tenantId = fixture.tenantId;

    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    const firstReady = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondReady = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const lockMembership = (
      memberId: string,
      signal: () => void,
      waitFor: Promise<void>,
      otherMemberId: string,
    ) =>
      runtimeDatabase.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          "SELECT set_config('app.user_id', $1, true)",
          userId,
        );
        await tx.$queryRawUnsafe(
          "SELECT set_config('app.tenant_id', $1, true)",
          tenantId,
        );
        await tx.$queryRawUnsafe(
          'SELECT id FROM tenant_members WHERE id = $1::uuid FOR UPDATE',
          memberId,
        );
        signal();
        await waitFor;
        await tx.$queryRawUnsafe(
          'SELECT id FROM tenant_members WHERE id = $1::uuid FOR UPDATE',
          otherMemberId,
        );
      });

    const settled = await Promise.allSettled([
      lockMembership(first, releaseFirst, secondReady, second),
      lockMembership(second, releaseSecond, firstReady, first),
    ]);

    const parts: RealError[] = settled.map((result) =>
      result.status === 'fulfilled'
        ? { status: 'fulfilled' as const }
        : {
            status: 'rejected' as const,
            error: result.reason,
            originalCode: readOriginalCode(result.reason),
          },
    );
    const survivor = parts.find((part) => part.status === 'fulfilled');
    const victim = parts.find((part) => part.status === 'rejected');
    if (!survivor || !victim) {
      throw new Error(
        `expected exactly one deadlock victim, got ${JSON.stringify(
          parts.map((part) => part.status),
        )}`,
      );
    }
    return { realDeadlock: victim.error, survivor };
  }

  async function captureRealServerError(): Promise<RealError> {
    try {
      await runtimeDatabase.$queryRawUnsafe(
        'SELECT 1 FROM this_table_does_not_exist_for_task_10',
      );
      throw new Error('expected the undefined table to fail');
    } catch (error) {
      return {
        status: 'rejected',
        error,
        originalCode: readOriginalCode(error),
      };
    }
  }
});

// -----------------------------------------------------------------------------
// Fixture provisioning — real rows, real publications, no production code
// -----------------------------------------------------------------------------

function publishedField(id: string, spec: FieldSpec, sortOrder: number) {
  return {
    id,
    fieldKey: spec.key,
    label: spec.label,
    type: spec.type ?? 'TEXT',
    required: spec.required ?? false,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder,
    isSystem: false,
  };
}

async function provision(database: PrismaClient): Promise<Fixture> {
  const now = new Date();
  const tenant = await database.tenant.create({
    data: {
      id: randomUUID(),
      name: '动作引擎测试公司',
      code: tenantCode,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });
  const foreignTenant = await database.tenant.create({
    data: {
      id: randomUUID(),
      name: '动作引擎外部公司',
      code: foreignTenantCode,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });

  const [adminUser, actorAUser, actorBUser, foreignUser] = await Promise.all(
    [
      { phone: phones.admin, name: '引擎管理员' },
      { phone: phones.actorA, name: '引擎员工 A' },
      { phone: phones.actorB, name: '引擎员工 B' },
      { phone: phones.foreign, name: '外部租户管理员' },
    ].map(({ phone, name }) =>
      database.user.create({
        data: {
          id: randomUUID(),
          displayName: name,
          phone,
          phoneVerifiedAt: now,
          passwordHash: 'not-used-by-direct-session-fixture',
          status: 'ACTIVE',
        },
      }),
    ),
  );

  const adminMember = await database.tenantMember.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: adminUser.id,
      role: 'TENANT_ADMIN',
      status: 'ACTIVE',
      joinedAt: now,
    },
  });
  const actorAMember = await database.tenantMember.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: actorAUser.id,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      joinedAt: now,
    },
  });
  const actorBMember = await database.tenantMember.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: actorBUser.id,
      role: 'EMPLOYEE',
      status: 'ACTIVE',
      joinedAt: now,
    },
  });
  const foreignMember = await database.tenantMember.create({
    data: {
      id: randomUUID(),
      tenantId: foreignTenant.id,
      userId: foreignUser.id,
      role: 'TENANT_ADMIN',
      status: 'ACTIVE',
      joinedAt: now,
    },
  });

  const tokens = {
    actorA: 'e2e-action-engine-actor-a',
    actorB: 'e2e-action-engine-actor-b',
  };
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  await Promise.all(
    [
      { userId: actorAUser.id, token: tokens.actorA },
      { userId: actorBUser.id, token: tokens.actorB },
    ].map(({ userId, token }) =>
      database.session.create({
        data: {
          id: randomUUID(),
          userId,
          tokenHash: hashSessionToken(token),
          expiresAt,
        },
      }),
    ),
  );
  const actorA: Actor = {
    userId: actorAUser.id,
    memberId: actorAMember.id,
    cookie: `crm_session=${tokens.actorA}`,
  };
  const actorB: Actor = {
    userId: actorBUser.id,
    memberId: actorBMember.id,
    cookie: `crm_session=${tokens.actorB}`,
  };

  const fullAccess: AccessSpec = {
    canCreate: true,
    canRead: true,
    canUpdate: true,
    readScope: 'ALL',
    updateScope: 'ALL',
  };

  const objects: Record<string, string> = {};
  const createObject = async (
    tenantId: string,
    publisherMemberId: string,
    code: string,
    name: string,
    fields: FieldSpec[],
    access: AccessSpec,
    workflow?: unknown,
  ) => {
    const object = await database.objectDefinition.create({
      data: {
        id: randomUUID(),
        tenantId,
        name,
        code,
        titleFieldKey: 'name',
        status: 'ACTIVE',
        version: 1,
        sortOrder: 0,
      },
    });
    const publicationId = randomUUID();
    const configuration = {
      publication: {
        id: publicationId,
        number: 1,
        sourceDraftVersion: 1,
        publishedAt: now.toISOString(),
      },
      object: {
        id: object.id,
        code,
        name,
        description: null,
        titleFieldKey: 'name',
        icon: null,
        sortOrder: 0,
      },
      fields: fields.map((field, index) =>
        publishedField(randomUUID(), field, index * 10),
      ),
      defaultView: {
        code: 'default',
        name: '全部',
        columnFieldKeys: fields.map((field) => field.key),
        sort: { field: 'updatedAt', direction: 'desc' },
      },
      employeeAccess: {
        canCreate: access.canCreate,
        canRead: access.canRead,
        canUpdate: access.canUpdate,
        canDelete: false,
        readScope: access.readScope,
        updateScope: access.updateScope,
        fields: Object.fromEntries(
          fields.map((field) => [field.key, field.access ?? 'EDIT']),
        ),
      },
      ...(workflow ? { workflow } : {}),
    };
    await database.objectPublication.create({
      data: {
        id: publicationId,
        tenantId,
        objectId: object.id,
        publicationNo: 1,
        sourceDraftVersion: 1,
        configuration,
        changeSummary: {},
        publishedByMemberId: publisherMemberId,
        publishedAt: now,
      },
    });
    await database.objectDefinition.update({
      where: { id: object.id },
      data: { activePublicationId: publicationId, publishedAt: now },
    });
    return object.id;
  };

  const nameField: FieldSpec = {
    key: 'name',
    label: '名称',
    type: 'TEXT',
    required: true,
    access: 'EDIT',
  };
  const publishWorkflow = {
    initialStateKey: 'open',
    states: [
      { key: 'open', label: '草稿', sortOrder: 10, isTerminal: false },
      { key: 'published', label: '已发布', sortOrder: 20, isTerminal: true },
    ],
    transitions: [
      {
        key: 'publish',
        label: '发布',
        fromStateKey: 'open',
        toStateKey: 'published',
        allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
        requiredFieldKeys: [],
        actions: [],
      },
    ],
  };

  // ---- targets -------------------------------------------------------------
  objects.tasks = await createObject(
    tenant.id,
    adminMember.id,
    'tasks',
    '任务',
    [nameField],
    fullAccess,
  );
  objects.notes = await createObject(
    tenant.id,
    adminMember.id,
    'notes',
    '备注',
    [nameField],
    fullAccess,
  );
  objects.invoices = await createObject(
    tenant.id,
    adminMember.id,
    'invoices',
    '发票',
    [nameField],
    {
      canCreate: false,
      canRead: true,
      canUpdate: false,
      readScope: 'ALL',
      updateScope: 'NONE',
    },
  );
  objects.receipts = await createObject(
    tenant.id,
    adminMember.id,
    'receipts',
    '回执',
    [nameField],
    fullAccess,
  );
  objects['shared-report'] = await createObject(
    tenant.id,
    adminMember.id,
    'shared-report',
    '共享报表',
    [nameField],
    fullAccess,
    publishWorkflow,
  );

  // ---- sources -------------------------------------------------------------
  objects.deals = await createObject(
    tenant.id,
    adminMember.id,
    'deals',
    '商机',
    [nameField, { key: 'stage', label: '阶段', type: 'TEXT', access: 'EDIT' }],
    fullAccess,
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '进行中', sortOrder: 10, isTerminal: false },
        { key: 'won', label: '赢单', sortOrder: 20, isTerminal: true },
        { key: 'escalated', label: '升级', sortOrder: 30, isTerminal: true },
        { key: 'shared', label: '已共享', sortOrder: 40, isTerminal: true },
      ],
      transitions: [
        {
          key: 'close-won',
          label: '标记赢单',
          fromStateKey: 'open',
          toStateKey: 'won',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'create-note',
              type: 'CREATE_RECORD',
              targetObjectCode: 'notes',
              values: { name: { source: 'LITERAL', value: '动作引擎备注' } },
            },
            {
              key: 'relate-task',
              type: 'CREATE_RELATION',
              left: { source: 'SOURCE_RECORD' },
              right: {
                source: 'ACTION_OUTPUT',
                actionKey: 'create-task',
                property: 'recordId',
              },
            },
            {
              key: 'follow-task',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: '跟进赢单客户' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 3 },
              assignee: { source: 'ACTOR' },
            },
            {
              key: 'mark-stage',
              type: 'UPDATE_RECORD',
              target: 'SOURCE_RECORD',
              values: { stage: { source: 'LITERAL', value: 'won' } },
            },
            {
              key: 'create-invoice',
              type: 'CREATE_RECORD',
              targetObjectCode: 'invoices',
              values: { name: { source: 'LITERAL', value: '发票' } },
            },
          ],
        },
        {
          key: 'escalate',
          label: '升级',
          fromStateKey: 'open',
          toStateKey: 'escalated',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'create-foreign',
              type: 'CREATE_RECORD',
              targetObjectCode: 'foreign-secrets',
              values: { name: { source: 'LITERAL', value: '外部数据' } },
            },
          ],
        },
        {
          key: 'share',
          label: '共享',
          fromStateKey: 'open',
          toStateKey: 'shared',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-shared',
              type: 'CREATE_RECORD',
              targetObjectCode: 'shared-report',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
          ],
        },
      ],
    },
  );

  objects.cases = await createObject(
    tenant.id,
    adminMember.id,
    'cases',
    '工单',
    [nameField],
    fullAccess,
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '待处理', sortOrder: 10, isTerminal: false },
        { key: 'approved', label: '已批准', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'approve',
          label: '批准',
          fromStateKey: 'open',
          toStateKey: 'approved',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-receipt',
              type: 'CREATE_RECORD',
              targetObjectCode: 'receipts',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'follow-case',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: '回访工单' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 1 },
              assignee: { source: 'ACTOR' },
            },
          ],
        },
      ],
    },
  );

  objects.orders = await createObject(
    tenant.id,
    adminMember.id,
    'orders',
    '订单',
    [nameField],
    fullAccess,
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '待确认', sortOrder: 10, isTerminal: false },
        { key: 'confirmed', label: '已确认', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'confirm',
          label: '确认',
          fromStateKey: 'open',
          toStateKey: 'confirmed',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'follow-order',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: '确认后跟进' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 2 },
              assignee: { source: 'ACTOR' },
            },
          ],
        },
      ],
    },
  );

  objects.handoffs = await createObject(
    tenant.id,
    adminMember.id,
    'handoffs',
    '交接单',
    [nameField],
    fullAccess,
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '待交接', sortOrder: 10, isTerminal: false },
        { key: 'done', label: '已交接', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'hand-off',
          label: '交接',
          fromStateKey: 'open',
          toStateKey: 'done',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'follow-owner',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: '交接跟进' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 1 },
              // The follow-up goes to the RECORD OWNER, not the actor — that is
              // what makes two different actors lock each other's membership.
              assignee: { source: 'SOURCE_OWNER' },
            },
          ],
        },
      ],
    },
  );

  objects.pickups = await createObject(
    tenant.id,
    adminMember.id,
    'pickups',
    '领取单',
    [nameField],
    fullAccess,
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '待领取', sortOrder: 10, isTerminal: false },
        { key: 'picked', label: '已领取', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'pick-up',
          label: '领取',
          fromStateKey: 'open',
          toStateKey: 'picked',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
            {
              key: 'follow-owner',
              type: 'CREATE_FOLLOW_UP',
              target: { source: 'SOURCE_RECORD' },
              title: { source: 'LITERAL', value: '领取跟进' },
              dueAt: { source: 'NOW_PLUS_DAYS', days: 1 },
              assignee: { source: 'SOURCE_OWNER' },
            },
          ],
        },
      ],
    },
  );

  objects.vaults = await createObject(
    tenant.id,
    adminMember.id,
    'vaults',
    '保险柜',
    [nameField],
    {
      canCreate: false,
      canRead: false,
      canUpdate: true,
      readScope: 'NONE',
      updateScope: 'ALL',
    },
    {
      initialStateKey: 'locked',
      states: [
        { key: 'locked', label: '锁定', sortOrder: 10, isTerminal: false },
        { key: 'unlocked', label: '解锁', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'unlock',
          label: '解锁',
          fromStateKey: 'locked',
          toStateKey: 'unlocked',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
          ],
        },
      ],
    },
  );

  objects.ledgers = await createObject(
    tenant.id,
    adminMember.id,
    'ledgers',
    '台账',
    [nameField],
    {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      readScope: 'OWN',
      updateScope: 'OWN',
    },
    {
      initialStateKey: 'open',
      states: [
        { key: 'open', label: '待结算', sortOrder: 10, isTerminal: false },
        { key: 'settled', label: '已结算', sortOrder: 20, isTerminal: true },
      ],
      transitions: [
        {
          key: 'settle',
          label: '结算',
          fromStateKey: 'open',
          toStateKey: 'settled',
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          requiredFieldKeys: [],
          actions: [
            {
              key: 'create-task',
              type: 'CREATE_RECORD',
              targetObjectCode: 'tasks',
              values: { name: { source: 'SOURCE_META', property: 'title' } },
            },
          ],
        },
      ],
    },
  );

  // ---- the other tenant ----------------------------------------------------
  objects['foreign-shared-report'] = await createObject(
    foreignTenant.id,
    foreignMember.id,
    'shared-report',
    '共享报表（外部）',
    [nameField],
    fullAccess,
    publishWorkflow,
  );
  objects['foreign-secrets'] = await createObject(
    foreignTenant.id,
    foreignMember.id,
    'foreign-secrets',
    '外部机密',
    [nameField],
    fullAccess,
  );

  // ---- records -------------------------------------------------------------
  const createRecordIn = (
    ownerTenantId: string,
    objectId: string,
    ownerMemberId: string | null,
    title: string,
    statusKey: string | null,
    recordNo: number,
  ) =>
    createRecord(database, ownerTenantId, {
      objectId,
      ownerMemberId,
      title,
      values: { name: title },
      statusKey,
      recordNo,
    });

  const [
    dealRollback,
    dealEscalate,
    dealShare,
    caseForOverride,
    vaultRecord,
    ledgerRecord,
    orderRecord,
    handoffRecord,
    pickupA,
    pickupB,
    foreignRecord,
    foreignSecretRecord,
  ] = await Promise.all([
    createRecordIn(tenant.id, objects.deals, actorA.memberId, '回滚商机', 'open', 1),
    createRecordIn(tenant.id, objects.deals, actorA.memberId, '跨租户商机', 'open', 2),
    createRecordIn(tenant.id, objects.deals, actorA.memberId, '共享商机', 'open', 3),
    createRecordIn(tenant.id, objects.cases, actorA.memberId, '覆盖工单', 'open', 1),
    createRecordIn(
      tenant.id,
      objects.vaults,
      actorA.memberId,
      '机密保险柜',
      'locked',
      1,
    ),
    createRecordIn(tenant.id, objects.ledgers, actorB.memberId, '他人台账', 'open', 1),
    createRecordIn(tenant.id, objects.orders, actorA.memberId, '并发订单', 'open', 1),
    createRecordIn(tenant.id, objects.handoffs, actorB.memberId, '交接单', 'open', 1),
    createRecordIn(tenant.id, objects.pickups, actorB.memberId, '领取单 A', 'open', 1),
    createRecordIn(tenant.id, objects.pickups, actorA.memberId, '领取单 B', 'open', 2),
    createRecordIn(
      foreignTenant.id,
      objects['foreign-shared-report'],
      foreignMember.id,
      '外部报表',
      'open',
      1,
    ),
    createRecordIn(
      foreignTenant.id,
      objects['foreign-secrets'],
      foreignMember.id,
      '外部机密记录',
      null,
      1,
    ),
  ]);

  return {
    tenantId: tenant.id,
    foreignTenantId: foreignTenant.id,
    adminMemberId: adminMember.id,
    actorA,
    actorB,
    foreignMemberId: foreignMember.id,
    foreignRecordId: foreignRecord.id,
    objects,
    records: {
      dealRollback,
      dealEscalate,
      dealShare,
      caseForOverride,
      vaultRecord,
      ledgerRecord,
      orderRecord,
      handoffRecord,
      pickupA,
      pickupB,
      foreignSecretRecord,
    },
  };
}

async function createRecord(
  database: PrismaClient,
  tenantId: string,
  input: {
    objectId: string;
    ownerMemberId: string | null;
    title: string;
    values: Record<string, unknown>;
    statusKey: string | null;
    recordNo: number;
  },
): Promise<{ id: string; version: number }> {
  return database.record.create({
    data: {
      id: randomUUID(),
      tenantId,
      objectId: input.objectId,
      recordNo: BigInt(input.recordNo),
      ownerMemberId: input.ownerMemberId,
      statusKey: input.statusKey,
      title: input.title,
      data: toPrismaJson(input.values),
      source: 'MANUAL',
      version: 1,
      createdByMemberId: input.ownerMemberId,
    },
    select: { id: true, version: true },
  });
}

/**
 * The write-side counterpart of the reads this suite does through the API.
 *
 * `input.values` is a plain `Record<string, unknown>`, which Prisma's generated
 * `Json` write type (`InputJsonValue`) does not accept structurally. Production
 * code writes this very column with a narrow assertion —
 * `records.repository.ts`'s `toPrismaJson` — rather than a JSON round-trip, so
 * the value handed to the driver stays identical to the one the fixture built
 * (a round-trip would drop `undefined` members and reformat dates). The
 * assertion is the same one the repository makes, for the same reason: these
 * values were validated by the API before they ever reached the column.
 */
function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function readOriginalCode(error: unknown): string | null {
  const meta = (error as { meta?: Record<string, unknown> } | null)?.meta;
  const driver = meta?.driverAdapterError as
    | { cause?: { originalCode?: string } }
    | undefined;
  return driver?.cause?.originalCode ?? null;
}

function describeError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  return `${code ?? 'unknown'}:${readOriginalCode(error) ?? ''}`;
}

async function cleanup(database: PrismaClient): Promise<void> {
  const tenants = await database.tenant.findMany({
    where: { code: { in: [tenantCode, foreignTenantCode] } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const users = await database.user.findMany({
    where: { phone: { in: Object.values(phones) } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  if (tenantIds.length > 0) {
    await database.auditLog.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordTransitionHistory.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordFollowUp.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.$executeRawUnsafe(
      `DELETE FROM record_relations WHERE tenant_id = ANY($1::uuid[])`,
      tenantIds,
    );
    await database.record.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordCounter.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectWorkflowDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await database.objectPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.fieldPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.viewDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.fieldDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenantMember.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
  await database.session.deleteMany({ where: { userId: { in: userIds } } });
  await database.verificationChallenge.deleteMany({
    where: { phone: { in: Object.values(phones) } },
  });
  await database.user.deleteMany({ where: { id: { in: userIds } } });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
