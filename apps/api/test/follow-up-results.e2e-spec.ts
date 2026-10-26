import request from 'supertest';
import type { Prisma } from '@crm/database';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';

interface Task {
  id: string;
  version: number;
  status: string;
  completionResult: null | {
    activityId: string;
    activityType: string;
    content: string;
    outcome: string | null;
    actorDisplayName: string | null;
    completedAt: string;
  };
}
const body = <T>(response: { body: unknown }) => response.body as T;
jest.setTimeout(120_000);

describe('follow-up completion results HTTP', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const objectPath = () => `${base()}/objects/${f.object.code}`;
  const state = () =>
    h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
  const patch = (
    task: Task,
    input: object,
    actor: CriticalActor = f.employee,
  ) =>
    request(h.app.getHttpServer())
      .patch(`${base()}/follow-ups/${task.id}`)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ version: task.version, ...input });
  const result = {
    activityType: 'CALL',
    content: '  客户已接通，明日回访  ',
    outcome: 'CONNECTED',
  };
  const complete = (task: Task, completionResult: object = result) =>
    patch(task, { status: 'DONE', completionResult });
  const activities = () =>
    h.adminDatabase.recordActivity.findMany({
      where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
    });
  async function task() {
    return body<Task>(
      await request(h.app.getHttpServer())
        .post(`${base()}/follow-ups`)
        .set('Cookie', f.employee.cookie)
        .set('Origin', 'http://localhost:3000')
        .send({
          objectCode: f.object.code,
          recordId: f.ownedRecord.id,
          title: '联系客户',
          dueAt: new Date(Date.now() + 86400_000).toISOString(),
        })
        .expect(201),
    );
  }
  async function stage(
    poolStage: 'PENDING_CONTACT' | 'FOLLOWING' | 'PROTECTED',
    expired = false,
  ) {
    const config = body<{ version: number }>(
      await request(h.app.getHttpServer())
        .get(`${objectPath()}/pool-config`)
        .set('Cookie', f.admin.cookie)
        .expect(200),
    );
    await request(h.app.getHttpServer())
      .patch(`${objectPath()}/pool-config`)
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        enabled: true,
        lifecycleEnabled: true,
        ownershipTtlHours: null,
        contactTtlHours: 24,
        followUpTtlHours: 720,
        version: config.version,
      })
      .expect(200);
    return h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage,
        poolOrigin: 'LEAD_POOL',
        poolClaimedAt: new Date(),
        poolProtectedAt: poolStage === 'PROTECTED' ? new Date() : null,
        ownershipExpiresAt:
          poolStage === 'PROTECTED'
            ? null
            : new Date(Date.now() + (expired ? -1000 : 3600_000)),
      },
    });
  }
  async function completeBehindTransaction(
    pending: Task,
    mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
    actor: CriticalActor = f.employee,
  ) {
    let release!: () => void;
    let ready!: (pid: number) => void;
    let fail!: (error: unknown) => void;
    const unlocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<number>((resolve, reject) => {
      ready = resolve;
      fail = reject;
    });
    const holder = h.adminDatabase
      .$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pg_backend_pid() AS pid`;
        await mutate(tx);
        ready(pid);
        await unlocked;
      })
      .catch((error: unknown) => {
        fail(error);
        throw error;
      });
    const pid = await locked;
    const response = patch(
      pending,
      {
        status: 'DONE',
        completionResult: { activityType: 'NOTE', content: '等待锁后补写' },
      },
      actor,
    ).then((value) => value);
    try {
      let blocked = false;
      const deadline = Date.now() + 2000;
      while (!blocked && Date.now() < deadline) {
        [{ blocked }] = await h.adminDatabase.$queryRaw<
          Array<{ blocked: boolean }>
        >`
          SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
            AND ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    } finally {
      release();
      await holder;
    }
    return response;
  }
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('persists the normalized result and returns the linked activity after refresh', async () => {
    const pending = await task();
    expect(pending.completionResult).toBeNull();
    const completed = body<Task>(await complete(pending).expect(200));
    expect(completed).toMatchObject({
      status: 'DONE',
      version: 2,
      completionResult: {
        activityType: 'CALL',
        content: '客户已接通，明日回访',
        outcome: 'CONNECTED',
        actorDisplayName: 'Critical Employee',
      },
    });
    expect(completed.completionResult!.completedAt).toEqual(expect.any(String));
    const written = await activities();
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe(completed.completionResult!.activityId);
    const refreshed = body<{ items: Task[] }>(
      await request(h.app.getHttpServer())
        .get(`${base()}/follow-ups?status=DONE&recordId=${f.ownedRecord.id}`)
        .set('Cookie', f.employee.cookie)
        .expect(200),
    );
    expect(refreshed.items).toEqual([completed]);
    const timeline = body<{ items: Array<{ id: string; content: string }> }>(
      await request(h.app.getHttpServer())
        .get(`${objectPath()}/records/${f.ownedRecord.id}/activities`)
        .set('Cookie', f.employee.cookie)
        .expect(200),
    );
    expect(timeline.items).toContainEqual(
      expect.objectContaining({
        id: written[0].id,
        content: '客户已接通，明日回访',
      }),
    );
  });

  it('keeps legacy completion valid without activity or lease renewal', async () => {
    const before = await stage('FOLLOWING');
    const completed = body<Task>(
      await patch(await task(), { status: 'DONE' }).expect(200),
    );
    expect(completed.completionResult).toBeNull();
    expect(await activities()).toHaveLength(0);
    expect(await state()).toEqual(before);
  });

  it('advances pending contact only through an explicit successful contact result', async () => {
    await stage('PENDING_CONTACT');
    await complete(await task()).expect(200);
    const after = await state();
    expect(after.poolStage).toBe('FOLLOWING');
    expect(after.ownershipExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      719 * 3600_000,
    );
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          resourceId: f.ownedRecord.id,
          action: 'record.ownership_confirm_contact',
        },
      }),
    ).toBe(1);
  });

  it.each([
    { activityType: 'NOTE', content: '整理资料' },
    { activityType: 'CALL', content: '无人接听', outcome: 'NOT_REACHED' },
  ])(
    'does not convert pending contact for $activityType / $outcome',
    async (completionResult) => {
      const before = await stage('PENDING_CONTACT');
      const completed = body<Task>(
        await complete(await task(), completionResult).expect(200),
      );
      expect(completed.completionResult!.outcome).toBe(
        completionResult.outcome ?? null,
      );
      expect(await state()).toEqual(before);
    },
  );

  it.each(['PENDING_CONTACT', 'FOLLOWING'] as const)(
    'rolls back completion and result on an expired %s lease',
    async (poolStage) => {
      const before = await stage(poolStage, true);
      const pending = await task();
      await complete(pending, {
        activityType: 'NOTE',
        content: '到期后不能补写',
      }).expect(409);
      expect(await activities()).toHaveLength(0);
      expect(await state()).toEqual(before);
      expect(
        await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
          where: { id: pending.id },
        }),
      ).toMatchObject({ status: 'OPEN', version: 1, completedAt: null });
      expect(
        await h.adminDatabase.auditLog.count({
          where: {
            tenantId: f.tenantA.id,
            resourceId: pending.id,
            action: 'follow_up.completed',
          },
        }),
      ).toBe(0);
    },
  );

  it('leaves protected records protected without adding an expiry', async () => {
    const before = await stage('PROTECTED');
    await complete(await task()).expect(200);
    expect(await state()).toEqual(before);
  });

  it.each(['follow-up', 'activity'])(
    'serializes administrator %s with the owner confirming contact without a deadlock',
    async (entry) => {
      const record = await stage('PENDING_CONTACT');
      const pending = await task();
      let release!: () => void;
      let ready!: () => void;
      const unlocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const holder = h.adminDatabase.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM object_definitions WHERE id = ${f.object.id}::uuid FOR NO KEY UPDATE`;
        ready();
        await unlocked;
      });
      const waitForBlockedWrites = async (count: number) => {
        const deadline = Date.now() + 2000;
        let blocked = 0;
        while (blocked < count && Date.now() < deadline) {
          [{ blocked }] = await h.adminDatabase.$queryRaw<
            Array<{ blocked: number }>
          >`
          SELECT count(*)::int AS blocked FROM pg_stat_activity
          WHERE datname = current_database() AND usename = 'crm_app'
            AND cardinality(pg_blocking_pids(pid)) > 0`;
          if (blocked < count)
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBeGreaterThanOrEqual(count);
      };
      await locked;
      const completing = (
        entry === 'follow-up'
          ? patch(
              pending,
              { status: 'DONE', completionResult: result },
              f.admin,
            )
          : request(h.app.getHttpServer())
              .post(`${objectPath()}/records/${record.id}/activities`)
              .set('Cookie', f.admin.cookie)
              .set('Origin', 'http://localhost:3000')
              .send(result)
      ).then((value) => value);
      let confirming: Promise<request.Response> | undefined;
      try {
        await waitForBlockedWrites(1);
        confirming = request(h.app.getHttpServer())
          .post(`${objectPath()}/records/${record.id}/ownership`)
          .set('Cookie', f.employee.cookie)
          .set('Origin', 'http://localhost:3000')
          .send({ action: 'CONFIRM_CONTACT', version: record.version })
          .then((value) => value);
        await waitForBlockedWrites(2);
      } finally {
        release();
        await holder;
      }
      const attempts = await Promise.all([completing, confirming]);
      expect(attempts.map((value) => value.status)).toEqual([
        entry === 'follow-up' ? 200 : 201,
        409,
      ]);
      expect(await activities()).toHaveLength(1);
    },
  );

  it('rejects an owner change after observing and locking the previous owner', async () => {
    const pending = await task();
    const response = await completeBehindTransaction(
      pending,
      async (tx) => {
        await tx.record.update({
          where: { id: f.ownedRecord.id },
          data: { ownerMemberId: f.otherEmployee.memberId },
        });
      },
      f.admin,
    );
    expect(response.status).toBe(409);
    expect(await activities()).toHaveLength(0);
    expect(
      await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    ).toMatchObject({ status: 'OPEN', version: 1 });
  });

  it('lets an administrator record a result on a disabled owner’s historical private record', async () => {
    const pending = await task();
    await h.adminDatabase.tenantMember.update({
      where: { id: f.employee.memberId },
      data: { status: 'DISABLED' },
    });
    const completed = body<Task>(
      await patch(
        pending,
        {
          status: 'DONE',
          completionResult: {
            activityType: 'NOTE',
            content: '管理员补充历史跟进',
          },
        },
        f.admin,
      ).expect(200),
    );
    expect(completed.completionResult!.actorDisplayName).toBe('Critical Admin');
  });

  it('creates one activity, contact transition and completion under concurrent duplicate submission', async () => {
    await stage('PENDING_CONTACT');
    const pending = await task();
    const attempts = await Promise.all([complete(pending), complete(pending)]);
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 409]);
    await complete(pending).expect(409);
    expect(await activities()).toHaveLength(1);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          action: 'follow_up.completed',
          resourceId: pending.id,
        },
      }),
    ).toBe(1);
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          action: 'record.ownership_confirm_contact',
          resourceId: f.ownedRecord.id,
        },
      }),
    ).toBe(1);
    expect(
      await h.adminDatabase.recordFollowUp.count({
        where: { id: pending.id, status: 'DONE' },
      }),
    ).toBe(1);
    const team = body<{
      members: Array<{
        memberId: string;
        calls: number;
        connectedCalls: number;
        contactsConfirmed: number;
        followUpsDone: number;
      }>;
    }>(
      await request(h.app.getHttpServer())
        .get(`${base()}/team-activity?preset=today`)
        .set('Cookie', f.admin.cookie)
        .expect(200),
    );
    expect(
      team.members.find((member) => member.memberId === f.employee.memberId),
    ).toMatchObject({
      calls: 1,
      connectedCalls: 1,
      contactsConfirmed: 1,
      followUpsDone: 1,
    });
  });

  it('rechecks an expired contact lease after waiting for its record lock', async () => {
    await stage('PENDING_CONTACT');
    const pending = await task();
    const response = await completeBehindTransaction(pending, async (tx) => {
      await tx.record.update({
        where: { id: f.ownedRecord.id },
        data: { ownershipExpiresAt: new Date(Date.now() - 1000) },
      });
    });
    expect(response.status).toBe(409);
    expect(await activities()).toHaveLength(0);
    expect(
      await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    ).toMatchObject({ status: 'OPEN', version: 1 });
  });

  it('rechecks permissions after waiting for a concurrent permission change', async () => {
    const pending = await task();
    const response = await completeBehindTransaction(pending, async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${f.tenantA.id} || ':object-configuration', 0))::text`;
      await tx.objectPermission.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          subjectType: 'MEMBER',
          subjectMemberId: f.employee.memberId,
          canRead: true,
          canUpdate: false,
          readScope: 'OWN',
          updateScope: 'NONE',
        },
      });
    });
    expect(response.status).toBe(403);
    expect(await activities()).toHaveLength(0);
    expect(
      await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    ).toMatchObject({ status: 'OPEN', version: 1 });
  });

  it('rejects other assignees and cross-tenant sessions without writing a result', async () => {
    const pending = await task();
    await patch(
      pending,
      { status: 'DONE', completionResult: result },
      f.otherEmployee,
    ).expect(404);
    await patch(
      pending,
      { status: 'DONE', completionResult: result },
      f.tenantBAdmin,
    ).expect(403);
    expect(await activities()).toHaveLength(0);
  });

  it('constrains result links to one task on the same tenant and record', async () => {
    const pending = await task();
    const otherTenantRecord = await h.adminDatabase.record.findFirstOrThrow({
      where: { tenantId: f.tenantB.id },
    });
    for (const target of [
      {
        tenantId: f.tenantA.id,
        recordId: f.otherRecord.id,
        actorMemberId: f.otherEmployee.memberId,
      },
      {
        tenantId: f.tenantB.id,
        recordId: otherTenantRecord.id,
        actorMemberId: f.tenantBAdmin.memberId,
      },
    ]) {
      const activity = await h.adminDatabase.recordActivity.create({
        data: {
          ...target,
          activityType: 'NOTE',
          content: '不能关联其他记录的结果',
        },
      });
      await expect(
        h.adminDatabase.recordFollowUp.update({
          where: { id: pending.id },
          data: {
            status: 'DONE',
            completedAt: new Date(),
            completionActivityId: activity.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    }
    const completed = body<Task>(await complete(pending).expect(200));
    const second = await task();
    await expect(
      h.adminDatabase.recordFollowUp.update({
        where: { id: second.id },
        data: {
          status: 'DONE',
          completedAt: new Date(),
          completionActivityId: completed.completionResult!.activityId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a result when the actor loses table update permission', async () => {
    const pending = await task();
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canRead: true,
        canUpdate: false,
        readScope: 'OWN',
        updateScope: 'NONE',
      },
    });
    await complete(pending).expect(403);
    expect(await activities()).toHaveLength(0);
  });

  it.each([
    { activityType: 'NOTE', content: '   ' },
    { activityType: 'NOTE', content: 'x'.repeat(4001) },
    { activityType: 'NOTE', content: '备忘', outcome: 'CONNECTED' },
    { activityType: 'CALL', content: '电话', outcome: 'WECHAT_ADDED' },
    { activityType: 'MEETING', content: '会议', outcome: 'NOT_REACHED' },
    { activityType: 'INVALID', content: '非法类型' },
    { activityType: 'CALL', content: 123 },
    { activityType: 'CALL', content: 'test', outcome: 'INVALID' },
  ])(
    'rejects invalid completion result %# atomically',
    async (completionResult) => {
      const pending = await task();
      await complete(pending, completionResult).expect(400);
      expect(await activities()).toHaveLength(0);
      expect(
        await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
          where: { id: pending.id },
        }),
      ).toMatchObject({ status: 'OPEN', version: 1 });
    },
  );

  it.each([
    null,
    [],
    'result',
    123,
    {},
    { content: 'missing type' },
    { activityType: 'NOTE', content: null },
  ])(
    'rejects malformed nested completion result %# without a server error',
    async (completionResult) => {
      await patch(await task(), { status: 'DONE', completionResult }).expect(
        400,
      );
      expect(await activities()).toHaveLength(0);
    },
  );

  it.each([
    { status: 'CANCELLED' },
    { dueAt: '2026-12-01T00:00:00Z' },
    { status: 'DONE', dueAt: '2026-12-01T00:00:00Z' },
  ])(
    'rejects completion results combined with another operation %#',
    async (operation) => {
      await patch(await task(), {
        ...operation,
        completionResult: result,
      }).expect(400);
      expect(await activities()).toHaveLength(0);
    },
  );
});
