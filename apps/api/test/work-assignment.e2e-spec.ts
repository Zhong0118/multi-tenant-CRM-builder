import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

const origin = 'http://localhost:3000';
const json = <T>(response: { body: unknown }) => response.body as T;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
jest.setTimeout(120_000);

/**
 * Handing work to another member, checked where it commits. The tests hold
 * the recipient's member row in a separate transaction so the request is
 * parked inside its own transaction, change what the recipient may do, and
 * only then let the request continue: a check made before the transaction
 * opened would have let the assignment through.
 */
describe('assigning work to members (HTTP + PostgreSQL)', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const send = (
    method: 'post' | 'patch' | 'put',
    path: string,
    body: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      [method](base() + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(body);

  /** Runs `request` while the recipient's member row is held, then `change`s. */
  async function parkedBehind(
    memberId: string,
    start: () => PromiseLike<request.Response>,
    change: (
      tx: Parameters<
        Parameters<CriticalHarness['adminDatabase']['$transaction']>[0]
      >[0],
    ) => Promise<unknown>,
  ) {
    let pending!: Promise<request.Response>;
    await h.adminDatabase.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${memberId}::uuid FOR UPDATE`;
        pending = Promise.resolve(start());
        await pause(600);
        await change(tx);
      },
      { timeout: 20_000 },
    );
    return pending;
  }

  beforeAll(async () => {
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('refuses a record follow-up for a member whose table access was revoked after the request started', async () => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const body = {
      objectCode: f.object.code,
      recordId: f.ownedRecord.id,
      title: '回访',
      dueAt,
      assigneeMemberId: f.employee.memberId,
    };
    const refused = await parkedBehind(
      f.employee.memberId,
      () => send('post', '/follow-ups', body),
      (tx) =>
        tx.objectPermission.create({
          data: {
            tenantId: f.tenantA.id,
            objectId: f.object.id,
            subjectType: 'MEMBER',
            subjectMemberId: f.employee.memberId,
            canCreate: false,
            canRead: false,
            canUpdate: false,
            readScope: 'NONE',
            updateScope: 'NONE',
          },
        }),
    );
    expect(refused.status).toBe(400);
    expect(
      await h.adminDatabase.recordFollowUp.count({
        where: { tenantId: f.tenantA.id, title: '回访' },
      }),
    ).toBe(0);

    // With access restored the same assignment goes through.
    await h.adminDatabase.objectPermission.deleteMany({
      where: { subjectMemberId: f.employee.memberId },
    });
    const created = await send('post', '/follow-ups', body).expect(201);
    expect(json<{ assigneeMemberId: string }>(created).assigneeMemberId).toBe(
      f.employee.memberId,
    );
  });

  const get = (path: string, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer())
      .get(base() + path)
      .set('Cookie', actor.cookie);
  interface Task {
    id: string;
    version: number;
    status: string;
    result: string;
    assigneeMemberId: string;
    overdue: boolean;
  }
  const due = (hours: number) =>
    new Date(Date.now() + hours * 3600_000).toISOString();

  it('closes the task loop: assign, see, complete with a result, review', async () => {
    const assigned = json<Task>(
      await send('post', '/work-tasks', {
        title: '整理本周报价单',
        notes: '按客户分组',
        dueAt: due(8),
        assigneeMemberId: f.employee.memberId,
      }).expect(201),
    );

    const mine = json<{ items: Task[] }>(
      await get('/work-tasks', f.employee).expect(200),
    );
    expect(mine.items.map((task) => task.id)).toEqual([assigned.id]);
    // Nobody else sees it, and the employee cannot browse the team's tasks.
    expect(
      json<{ items: Task[] }>(await get('/work-tasks', f.otherEmployee)).items,
    ).toEqual([]);
    await get('/work-tasks?scope=team', f.employee).expect(403);

    // The assignee completes it; the plan stays the assigner's.
    await send(
      'patch',
      `/work-tasks/${assigned.id}`,
      { version: assigned.version, title: '改个标题' },
      f.employee,
    ).expect(403);
    await send(
      'patch',
      `/work-tasks/${assigned.id}`,
      { version: assigned.version, status: 'DONE', result: '已发给 3 家客户' },
      f.otherEmployee,
    ).expect(404);
    const done = json<Task>(
      await send(
        'patch',
        `/work-tasks/${assigned.id}`,
        {
          version: assigned.version,
          status: 'DONE',
          result: '已发给 3 家客户',
        },
        f.employee,
      ).expect(200),
    );
    expect(done).toMatchObject({ status: 'DONE', result: '已发给 3 家客户' });
    await send(
      'patch',
      `/work-tasks/${assigned.id}`,
      { version: assigned.version, status: 'OPEN' },
      f.employee,
    ).expect(409);

    // The administrator reviews it with the team's tasks and in 团队动态.
    const team = json<{ items: Task[] }>(
      await get(
        `/work-tasks?scope=team&assigneeMemberId=${f.employee.memberId}`,
      ).expect(200),
    );
    expect(team.items[0]).toMatchObject({ id: assigned.id, status: 'DONE' });
    const activity = json<{
      members: Array<{ memberId: string; tasksDone: number }>;
    }>(await get('/team-activity?preset=today').expect(200));
    expect(
      activity.members.find((m) => m.memberId === f.employee.memberId)
        ?.tasksDone,
    ).toBe(1);

    // Employees plan their own work but cannot hand work to others.
    await send(
      'post',
      '/work-tasks',
      { title: '越权安排', dueAt: due(2), assigneeMemberId: f.admin.memberId },
      f.employee,
    ).expect(403);
    const own = json<Task>(
      await send(
        'post',
        '/work-tasks',
        { title: '自己的计划', dueAt: due(2) },
        f.employee,
      ).expect(201),
    );
    await send(
      'patch',
      `/work-tasks/${own.id}`,
      { version: own.version, title: '自己的计划（改）' },
      f.employee,
    ).expect(200);
    await send(
      'patch',
      `/work-tasks/${own.id}`,
      {
        version: own.version + 1,
        assigneeMemberId: f.otherEmployee.memberId,
      },
      f.employee,
    ).expect(403);

    // Another company cannot reach these tasks at all.
    await request(h.app.getHttpServer())
      .get(`${base()}/work-tasks?scope=team`)
      .set('Cookie', f.tenantBAdmin.cookie)
      .expect(403);
  });

  it('transfers open work of both kinds before offboarding and preserves completed history', async () => {
    const memberPath = `/members/${f.employee.memberId}`;
    // Leave only general tasks first: these alone must prevent direct disable.
    await h.adminDatabase.record.updateMany({
      where: { tenantId: f.tenantA.id, ownerMemberId: f.employee.memberId },
      data: { ownerMemberId: f.admin.memberId },
    });
    const tasks: Task[] = [];
    for (const status of ['OPEN', 'DONE', 'CANCELLED']) {
      const created = json<Task>(
        await send('post', '/work-tasks', {
          title: `Offboarding ${status}`,
          dueAt: due(4),
          assigneeMemberId: f.employee.memberId,
        }).expect(201),
      );
      tasks.push(
        status === 'OPEN'
          ? created
          : json<Task>(
              await send('patch', `/work-tasks/${created.id}`, {
                version: created.version,
                status,
                result: status === 'DONE' ? 'Delivered' : '',
              }).expect(200),
            ),
      );
    }
    await get(`${memberPath}/offboarding`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ records: 0, openTasks: 1 });
      });
    await send('patch', memberPath, { status: 'DISABLED' }).expect(409);
    const historyBefore = await h.adminDatabase.workTask.findMany({
      where: { id: { in: tasks.slice(1).map((task) => task.id) } },
      orderBy: { id: 'asc' },
    });
    const followUps = [];
    for (const status of ['OPEN', 'DONE', 'CANCELLED']) {
      followUps.push(
        await h.adminDatabase.recordFollowUp.create({
          data: {
            tenantId: f.tenantA.id,
            recordId: f.ownedRecord.id,
            assigneeMemberId: f.employee.memberId,
            title: `Legacy ${status}`,
            dueAt: new Date(due(4)),
            status,
          },
        }),
      );
    }
    const foreignTask = await h.adminDatabase.workTask.create({
      data: {
        tenantId: f.tenantB.id,
        assigneeMemberId: f.tenantBAdmin.memberId,
        createdByMemberId: f.tenantBAdmin.memberId,
        title: 'Other tenant',
        dueAt: new Date(due(4)),
      },
    });
    await get(`${memberPath}/offboarding`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ records: 0, openTasks: 2 });
      });
    await send('post', `${memberPath}/offboarding`, {
      recipientMemberId: f.admin.memberId,
    })
      .expect(201)
      .expect({ records: 0, openTasks: 2 });
    expect(
      await h.adminDatabase.workTask.findUniqueOrThrow({
        where: { id: tasks[0].id },
      }),
    ).toMatchObject({
      assigneeMemberId: f.admin.memberId,
      version: tasks[0].version + 1,
      status: 'OPEN',
      createdByMemberId: f.admin.memberId,
    });
    expect(
      await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
        where: { id: followUps[0].id },
      }),
    ).toMatchObject({
      assigneeMemberId: f.admin.memberId,
      version: 2,
      status: 'OPEN',
    });
    expect(
      await h.adminDatabase.workTask.findMany({
        where: { id: { in: tasks.slice(1).map((task) => task.id) } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(historyBefore);
    for (const history of followUps.slice(1))
      expect(
        await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
          where: { id: history.id },
        }),
      ).toEqual(history);
    expect(
      await h.adminDatabase.workTask.findUniqueOrThrow({
        where: { id: foreignTask.id },
      }),
    ).toEqual(foreignTask);
    expect(
      await h.adminDatabase.auditLog.findFirstOrThrow({
        where: {
          tenantId: f.tenantA.id,
          action: 'membership.offboarded',
          resourceId: f.employee.memberId,
        },
      }),
    ).toMatchObject({
      after: {
        recipientMemberId: f.admin.memberId,
        records: 0,
        openTasks: 2,
        status: 'DISABLED',
      },
    });
    await get('/work-tasks', f.employee).expect(403);
    // An administrator holding the old version must reload the transferred task.
    await send('patch', `/work-tasks/${tasks[0].id}`, {
      version: tasks[0].version,
      status: 'DONE',
    }).expect(409);
  });

  it('rechecks the recipient and the actor where the task commits', async () => {
    const disabled = await parkedBehind(
      f.otherEmployee.memberId,
      () =>
        send('post', '/work-tasks', {
          title: '交给离职成员',
          dueAt: due(4),
          assigneeMemberId: f.otherEmployee.memberId,
        }),
      (tx) =>
        tx.tenantMember.update({
          where: { id: f.otherEmployee.memberId },
          data: { status: 'DISABLED' },
        }),
    );
    expect(disabled.status).toBe(400);

    const demoted = await parkedBehind(
      f.admin.memberId,
      () =>
        send('post', '/work-tasks', {
          title: '降级后安排',
          dueAt: due(4),
          assigneeMemberId: f.employee.memberId,
        }),
      (tx) =>
        tx.tenantMember.update({
          where: { id: f.admin.memberId },
          data: { role: 'EMPLOYEE' },
        }),
    );
    expect(demoted.status).toBe(403);
    expect(
      await h.adminDatabase.workTask.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
  });

  it.each(['2026-02-29', '2026-02-30', '2026-04-31', '0000-01-01'])(
    'rejects nonexistent daily-report date %s on reads and writes',
    async (workDate) => {
      await get(`/daily-reports/${workDate}/mine`, f.employee).expect(400);
      await get(`/daily-reports/${workDate}`).expect(400);
      await send(
        'put',
        `/daily-reports/${workDate}/mine`,
        {
          version: 0,
          plans: '',
          completed: '回访客户',
          problems: '',
          nextSteps: '',
        },
        f.employee,
      ).expect(400);
    },
  );

  it('keeps one editable report per member and day, never in the future', async () => {
    await get('/daily-reports/2024-02-29/mine', f.employee).expect(200);
    const view = json<{ today: string; report: null; canEdit: boolean }>(
      await get(`/daily-reports/${todayInCompany()}/mine`, f.employee).expect(
        200,
      ),
    );
    expect(view).toMatchObject({ report: null, canEdit: true });
    const today = view.today;
    const sections = {
      plans: '跟进 5 家',
      completed: '完成 3 家回访',
      problems: '报价审批慢',
      nextSteps: '周五前出合同',
    };
    // Two first saves at once: one report, the other told to reload.
    const firsts = await Promise.all([
      send(
        'put',
        `/daily-reports/${today}/mine`,
        { version: 0, ...sections },
        f.employee,
      ),
      send(
        'put',
        `/daily-reports/${today}/mine`,
        { version: 0, ...sections },
        f.employee,
      ),
    ]);
    expect(firsts.map((r) => r.status).sort()).toEqual([200, 409]);
    const saved = json<{ version: number }>(
      firsts.find((r) => r.status === 200)!,
    );
    const edited = json<{ version: number; problems: string }>(
      await send(
        'put',
        `/daily-reports/${today}/mine`,
        { version: saved.version, ...sections, problems: '' },
        f.employee,
      ).expect(200),
    );
    expect(edited).toMatchObject({ version: 2, problems: '' });
    await send(
      'put',
      `/daily-reports/${today}/mine`,
      { version: saved.version, ...sections },
      f.employee,
    ).expect(409);

    const tomorrow = new Date(`${today}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await send(
      'put',
      `/daily-reports/${tomorrow.toISOString().slice(0, 10)}/mine`,
      { version: 0, ...sections },
      f.employee,
    ).expect(400);

    // Administrators read everyone's; employees only their own.
    const list = json<{
      items: Array<{ memberId: string; report: { completed: string } | null }>;
    }>(await get(`/daily-reports/${today}`).expect(200));
    expect(
      list.items.find((item) => item.memberId === f.employee.memberId)?.report
        ?.completed,
    ).toBe('完成 3 家回访');
    await get(`/daily-reports/${today}`, f.employee).expect(403);
    await get(
      `/daily-reports/${today}/members/${f.employee.memberId}`,
      f.otherEmployee,
    ).expect(403);
    await get(`/daily-reports/${today}/members/${f.employee.memberId}`).expect(
      200,
    );
    await h.adminDatabase.dailyReport.deleteMany({
      where: { tenantId: f.tenantA.id },
    });
  });

  it('counts by company calendar days, once per WeChat contact, and only customer tables as customers', async () => {
    await h.adminDatabase.tenant.update({
      where: { id: f.tenantA.id },
      data: { timezone: 'Asia/Shanghai' },
    });
    const poolConfig = json<{ version: number }>(
      await get(`/objects/${f.object.code}/pool-config`).expect(200),
    );
    await send('patch', `/objects/${f.object.code}/pool-config`, {
      enabled: true,
      lifecycleEnabled: false,
      ownershipTtlHours: null,
      version: poolConfig.version,
    }).expect(200);
    const log = (
      recordId: string,
      at: string,
      activityType: 'CALL' | 'MESSAGE' | 'NOTE',
      resultKey: string | null = null,
    ) =>
      h.adminDatabase.recordActivity.create({
        data: {
          tenantId: f.tenantA.id,
          recordId,
          activityType,
          content: 'e2e',
          resultKey,
          actorMemberId: f.employee.memberId,
          createdAt: new Date(at),
        },
      });
    // 2026-10-22 in Shanghai is 2026-10-21T16:00Z .. 2026-10-22T16:00Z.
    await log(f.ownedRecord.id, '2026-10-21T15:59:00Z', 'CALL', 'CONNECTED'); // 21st
    await log(f.ownedRecord.id, '2026-10-21T16:01:00Z', 'CALL', 'NOT_REACHED');
    await log(f.ownedRecord.id, '2026-10-22T03:00:00Z', 'CALL', 'CONNECTED');
    await log(f.ownedRecord.id, '2026-10-22T04:00:00Z', 'NOTE');
    // First WeChat add for this customer is on the 21st; later ones are not new.
    await log(
      f.ownedRecord.id,
      '2026-10-21T10:00:00Z',
      'MESSAGE',
      'WECHAT_ADDED',
    );
    await log(
      f.ownedRecord.id,
      '2026-10-22T05:00:00Z',
      'MESSAGE',
      'WECHAT_ADDED',
    );
    await log(
      f.workflowRecord.id,
      '2026-10-22T06:00:00Z',
      'MESSAGE',
      'WECHAT_ADDED',
    );
    await log(
      f.workflowRecord.id,
      '2026-10-22T07:00:00Z',
      'MESSAGE',
      'WECHAT_ADDED',
    );
    // A record of a table without the customer pool is not a customer.
    await log(f.rollbackRecord.id, '2026-10-22T08:00:00Z', 'CALL', 'CONNECTED');

    const day = json<{
      from: string;
      members: Array<Record<string, number | string>>;
    }>(await get('/team-activity?from=2026-10-22&to=2026-10-22').expect(200));
    expect(day.from).toBe('2026-10-22');
    const employee = day.members.find(
      (m) => m.memberId === f.employee.memberId,
    )!;
    expect(employee).toMatchObject({
      calls: 3,
      connectedCalls: 2,
      messages: 3,
      wechatAdded: 1,
      notes: 1,
      customersFollowed: 2,
    });
    const previous = json<{ members: Array<Record<string, number | string>> }>(
      await get('/team-activity?from=2026-10-21&to=2026-10-21').expect(200),
    ).members.find((m) => m.memberId === f.employee.memberId)!;
    expect(previous).toMatchObject({ calls: 1, wechatAdded: 1, messages: 1 });
  });
});

function todayInCompany() {
  // Asia/Shanghai is UTC+8 with no daylight saving.
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
