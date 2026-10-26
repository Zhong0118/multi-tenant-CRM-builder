import request from 'supertest';
import type {
  WorkGoalSettingsDto,
  WorkGoalDto,
  WorkGoalProgressDto,
} from '../src/modules/work/dto/work-goals.dto';
import type { NotificationPageDto } from '../src/modules/notifications/notifications.dto';
const json = <T>(response: { body: unknown }) => response.body as T;
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
jest.setTimeout(120_000);
describe('employee work goals (HTTP + PostgreSQL)', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/work-goals`;
  const get = (path: string, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer())
      .get(base() + path)
      .set('Cookie', actor.cookie);
  const save = (metric: string, body: object, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer())
      .put(base() + '/' + metric)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .send(body);
  const input = () => ({
    expectedVersion: 0,
    target: 2,
    remindAt: '00:00',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    audience: 'SELECTED_MEMBERS',
    memberIds: [f.employee.memberId],
    enabled: true,
  });
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
  it('admin config creates stable rules with versions, active employee audience, and audit', async () => {
    const settings = await get('/settings').expect(200);
    expect(json<WorkGoalSettingsDto>(settings)).toMatchObject({
      timezone: 'Asia/Shanghai',
      rules: [],
    });
    expect(
      json<WorkGoalSettingsDto>(settings)
        .members.map((m: { id: string }) => m.id)
        .sort(),
    ).toEqual([f.employee.memberId, f.otherEmployee.memberId].sort());
    const created = await save('calls', input()).expect(200);
    expect(json<WorkGoalDto>(created)).toMatchObject({
      metric: 'calls',
      target: 2,
      version: 1,
      memberIds: [f.employee.memberId],
    });
    await save('calls', input()).expect(409);
    const updated = await save('calls', {
      ...input(),
      expectedVersion: 1,
      target: 3,
    }).expect(200);
    expect(json<WorkGoalDto>(updated).id).toBe(json<WorkGoalDto>(created).id);
    expect(json<WorkGoalDto>(updated).version).toBe(2);
    expect(
      await h.adminDatabase.auditLog.count({
        where: { tenantId: f.tenantA.id, action: 'work_goal.saved' },
      }),
    ).toBe(2);
  });
  it('employees cannot configure or see team; recipient and tenant validation is strict', async () => {
    await get('/settings', f.employee).expect(403);
    await save('calls', input(), f.employee).expect(403);
    await get('/progress?scope=team', f.employee).expect(403);
    await save('calls', {
      ...input(),
      memberIds: [f.tenantBAdmin.memberId],
    }).expect(400);
    await save('calls', { ...input(), memberIds: [f.admin.memberId] }).expect(
      400,
    );
    for (const patch of [
      { target: 0 },
      { target: 100001 },
      { target: 1.5 },
      { remindAt: '25:00' },
      { weekdays: [] },
      { weekdays: [0] },
      { memberIds: [] },
      { expectedVersion: -1 },
    ])
      await save('calls', { ...input(), ...patch }).expect(400);
    await save('invented', input()).expect(400);
    await get(
      '/progress?memberId=' + f.otherEmployee.memberId,
      f.employee,
    ).expect(400);
  });
  it('serializes concurrent creation and applies ALL_EMPLOYEES dynamically', async () => {
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { status: 'DISABLED' },
    });
    const body = { ...input(), audience: 'ALL_EMPLOYEES', memberIds: [] };
    const concurrent = await Promise.all([
      save('calls', body),
      save('calls', body),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      json<WorkGoalProgressDto>(await get('/progress?scope=team').expect(200))
        .items,
    ).toHaveLength(1);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { status: 'ACTIVE' },
    });
    expect(
      json<WorkGoalProgressDto>(await get('/progress?scope=team').expect(200))
        .items,
    ).toHaveLength(2);
    await h.adminDatabase.user.update({
      where: { id: f.otherEmployee.userId },
      data: { status: 'DISABLED' },
    });
    expect(
      json<WorkGoalSettingsDto>(await get('/settings').expect(200)).members.map(
        (m) => m.id,
      ),
    ).toEqual([f.employee.memberId]);
    expect(
      json<WorkGoalProgressDto>(await get('/progress?scope=team').expect(200))
        .items,
    ).toHaveLength(1);
    await save('tasksDone', {
      ...input(),
      memberIds: [f.otherEmployee.memberId],
    }).expect(400);
  });
  it.each(['member', 'account'] as const)(
    'can stop an existing selection after %s disable without accepting inactive recipients elsewhere',
    async (disabled) => {
      const memberIds = [f.employee.memberId, f.otherEmployee.memberId];
      const original = { ...input(), memberIds };
      const created = json<WorkGoalDto>(
        await save('calls', original).expect(200),
      );
      await save('tasksDone', {
        ...input(),
        audience: 'ALL_EMPLOYEES',
        memberIds: [],
      }).expect(200);
      if (disabled === 'member') {
        await h.adminDatabase.tenantMember.update({
          where: { id: f.employee.memberId },
          data: { status: 'DISABLED' },
        });
      } else {
        await h.adminDatabase.user.update({
          where: { id: f.employee.userId },
          data: { status: 'DISABLED' },
        });
      }
      expect(
        json<WorkGoalSettingsDto>(
          await get('/settings').expect(200),
        ).members.map((m) => m.id),
      ).not.toContain(f.employee.memberId);
      const stopped = json<WorkGoalDto>(
        await save('calls', {
          ...original,
          expectedVersion: 1,
          enabled: false,
          memberIds: [...memberIds].reverse(),
        }).expect(200),
      );
      expect(stopped).toEqual({ ...created, version: 2, enabled: false });
      await save('calls', {
        ...original,
        expectedVersion: 1,
        enabled: false,
      }).expect(409);
      await save('calls', { ...original, expectedVersion: 2 }).expect(400);
      // Stop-only preservation cannot be used for new rules, changed sets or audiences.
      await save('connectedCalls', { ...original, enabled: false }).expect(400);
      await save('calls', {
        ...input(),
        expectedVersion: 2,
        enabled: false,
      }).expect(400);
      await save('tasksDone', {
        ...original,
        expectedVersion: 1,
        enabled: false,
      }).expect(400);
      await save('calls', {
        ...original,
        expectedVersion: 2,
        enabled: false,
        memberIds: [f.tenantBAdmin.memberId],
      }).expect(400);
      const persisted = json<WorkGoalSettingsDto>(
        await get('/settings').expect(200),
      ).rules.find((r) => r.id === created.id);
      expect(persisted).toEqual(stopped);
      expect(
        await h.adminDatabase.auditLog.count({
          where: {
            tenantId: f.tenantA.id,
            action: 'work_goal.saved',
            resourceId: created.id,
          },
        }),
      ).toBe(2);
      if (disabled === 'member') {
        await h.adminDatabase.tenantMember.update({
          where: { id: f.employee.memberId },
          data: { status: 'ACTIVE' },
        });
      } else {
        await h.adminDatabase.user.update({
          where: { id: f.employee.userId },
          data: { status: 'ACTIVE' },
        });
      }
      expect(
        json<WorkGoalDto>(
          await save('calls', { ...original, expectedVersion: 2 }).expect(200),
        ),
      ).toEqual({ ...created, version: 3 });
    },
  );
  it('refuses a selected employee disabled while the save waits for the member lock', async () => {
    let pending!: Promise<request.Response>;
    await h.adminDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${f.employee.memberId}::uuid FOR UPDATE`;
      pending = Promise.resolve(save('calls', input()));
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.tenantMember.update({
        where: { id: f.employee.memberId },
        data: { status: 'DISABLED' },
      });
    });
    expect((await pending).status).toBe(400);
    expect(
      await h.adminDatabase.workGoalRule.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
  });
  it('progress uses real task counts, selected recipients, and current company date; goal inbox opens work and keeps snapshots', async () => {
    await save('tasksDone', input()).expect(200);
    await h.adminDatabase.workTask.create({
      data: {
        tenantId: f.tenantA.id,
        assigneeMemberId: f.employee.memberId,
        createdByMemberId: f.admin.memberId,
        title: 'Completed',
        dueAt: new Date(),
        status: 'DONE',
        completedAt: new Date(),
      },
    });
    const mine = await get('/progress', f.employee).expect(200);
    expect(json<WorkGoalProgressDto>(mine).items).toEqual([
      expect.objectContaining({
        metric: 'tasksDone',
        actual: 1,
        target: 2,
        memberId: f.employee.memberId,
        scheduledToday: true,
      }),
    ]);
    expect(
      json<WorkGoalProgressDto>(
        await get('/progress', f.otherEmployee).expect(200),
      ).items,
    ).toEqual([]);
    expect(
      json<WorkGoalProgressDto>(await get('/progress?scope=team').expect(200))
        .items,
    ).toHaveLength(1);
    await h.runtimeDatabase
      .$queryRaw`SELECT sweep_work_goal_notifications(500)`;
    const inbox = await request(h.app.getHttpServer())
      .get(`/api/v1/workspaces/${f.tenantA.code}/notifications`)
      .set('Cookie', f.employee.cookie)
      .expect(200);
    const notice = json<NotificationPageDto>(inbox).items.find(
      (n) => n.kind === 'WORK_GOAL_BEHIND',
    )!;
    expect(notice).toMatchObject({ canOpen: true });
    expect(notice.message).toContain('1');
    expect(notice.message).toContain('2');
    expect(notice.message).toContain(json<WorkGoalProgressDto>(mine).today);
    const target = await request(h.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${f.tenantA.code}/notifications/${notice.id}/target`,
      )
      .set('Cookie', f.employee.cookie)
      .expect(200);
    expect(json<{ href: string | null }>(target).href).toBe(
      `/workspace/${f.tenantA.code}/work`,
    );
    await save('tasksDone', {
      ...input(),
      expectedVersion: 1,
      enabled: false,
    }).expect(200);
    expect(
      json<WorkGoalProgressDto>(await get('/progress', f.employee).expect(200))
        .items,
    ).toEqual([]);
  });
});
