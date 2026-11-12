import request from 'supertest';
import type {
  RecordPageResponse,
  RecordActivityPageResponse,
} from '../src/modules/records/records.service';
import { randomUUID } from 'node:crypto';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);
describe('record communication previews and history over HTTP', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const records = () =>
    `/api/v1/workspaces/${f.tenantA.code}/objects/${f.object.code}/records`;
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
  it('lets only a tenant admin remove employee communication from the correct record', async () => {
    const older = await h.adminDatabase.recordActivity.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        activityType: 'NOTE',
        actorMemberId: f.employee.memberId,
        content: '保留的备注',
        createdAt: new Date('2025-01-01'),
      },
    });
    const row = await h.adminDatabase.recordActivity.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        activityType: 'NOTE',
        actorMemberId: f.employee.memberId,
        content: '填错的备注',
        createdAt: new Date('2026-11-10T04:00:00Z'),
      },
    });
    const task = await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: row.recordId,
        assigneeMemberId: f.employee.memberId,
        title: '回访',
        dueAt: new Date(),
        completedAt: new Date(),
        status: 'DONE',
        completionActivityId: row.id,
      },
    });
    const remove = (cookie: string, recordId = row.recordId, id = row.id) =>
      request(h.app.getHttpServer())
        .delete(`${records()}/${recordId}/activities/${id}`)
        .set('Cookie', cookie)
        .set('Origin', 'http://localhost:3000');
    await remove(f.employee.cookie).expect(403);
    // A runtime connection with employee context cannot delete even its own note.
    const direct = await h.runtimeDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${f.tenantA.id}, true),
        set_config('app.user_id', ${f.employee.userId}, true)`;
      return tx.recordActivity.deleteMany({ where: { id: row.id } });
    });
    expect(direct.count).toBe(0);
    expect([403, 404]).toContain((await remove(f.tenantBAdmin.cookie)).status);
    await remove(f.admin.cookie, f.otherRecord.id).expect(404);
    const system = await h.adminDatabase.recordActivity.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: row.recordId,
        activityType: 'SYSTEM',
        actorMemberId: f.admin.memberId,
        content: '系统事件',
      },
    });
    await remove(f.admin.cookie, row.recordId, system.id).expect(404);
    const notes = async () => {
      const stats = await request(h.app.getHttpServer())
        .get(
          `/api/v1/workspaces/${f.tenantA.code}/team-activity?from=2026-11-10&to=2026-11-10`,
        )
        .set('Cookie', f.admin.cookie)
        .expect(200);
      const { members } = stats.body as {
        members: Array<{ memberId: string; notes: number }>;
      };
      return members.find((m) => m.memberId === f.employee.memberId)?.notes;
    };
    expect(await notes()).toBe(1);
    await remove(f.admin.cookie).expect(200, { accepted: true });
    expect(await notes()).toBe(0);
    await remove(f.admin.cookie).expect(404);
    const list = await request(h.app.getHttpServer())
      .get(records())
      .set('Cookie', f.admin.cookie)
      .expect(200);
    expect(
      (list.body as RecordPageResponse).items.find((r) => r.id === row.recordId)
        ?.latestActivity?.id,
    ).toBe(older.id);
    const history = await request(h.app.getHttpServer())
      .get(`${records()}/${row.recordId}/activities`)
      .set('Cookie', f.employee.cookie)
      .expect(200);
    expect(history.body).toMatchObject({ items: [{ id: older.id }], total: 1 });
    expect(
      await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({ status: 'DONE', completionActivityId: null });
    expect(
      await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          actorId: f.admin.userId,
          resourceId: row.id,
          action: 'record.activity_deleted',
        },
      }),
    ).toBe(1);
  });

  it('serves newest bounded previews, preserves full paginated history, excludes other owners and denies other tenants', async () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const activities = Array.from({ length: 25 }, (_, i) => ({
      id: randomUUID(),
      tenantId: f.tenantA.id,
      recordId: f.ownedRecord.id,
      activityType: 'MESSAGE' as const,
      content: `沟通${i} ` + '详细正文'.repeat(200),
      actorMemberId: f.employee.memberId,
      resultKey: 'CONNECTED',
      createdAt: new Date(now.getTime() + i * 1000),
    }));
    await h.adminDatabase.recordActivity.createMany({
      data: [
        ...activities,
        {
          id: randomUUID(),
          tenantId: f.tenantA.id,
          recordId: f.otherRecord.id,
          activityType: 'NOTE',
          content: '其他员工沟通秘密',
          actorMemberId: f.otherEmployee.memberId,
          createdAt: now,
        },
      ],
    });
    // A later internal event must not replace the latest human communication.
    await h.adminDatabase.recordActivity.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        activityType: 'SYSTEM',
        actorMemberId: f.admin.memberId,
        content: '内部事件',
        createdAt: new Date(now.getTime() + 100000),
      },
    });
    const list = await request(h.app.getHttpServer())
      .get(records() + '?limit=1000')
      .set('Cookie', f.employee.cookie)
      .expect(200);
    const body = list.body as RecordPageResponse;
    const own = body.items.find((r) => r.id === f.ownedRecord.id)!;
    expect(own.latestActivity).toMatchObject({
      id: activities[24].id,
      activityType: 'MESSAGE',
      outcome: 'CONNECTED',
      actorMemberId: f.employee.memberId,
    });
    expect(own.latestActivity?.content).toHaveLength(240);
    expect(JSON.stringify(list.body)).not.toContain('其他员工沟通秘密');
    expect(JSON.stringify(list.body)).not.toContain('内部事件');
    const first = await request(h.app.getHttpServer())
      .get(`${records()}/${f.ownedRecord.id}/activities?page=1&limit=20`)
      .set('Cookie', f.employee.cookie)
      .expect(200);
    const second = await request(h.app.getHttpServer())
      .get(`${records()}/${f.ownedRecord.id}/activities?page=2&limit=20`)
      .set('Cookie', f.employee.cookie)
      .expect(200);
    const firstPage = first.body as RecordActivityPageResponse;
    const secondPage = second.body as RecordActivityPageResponse;
    expect(firstPage.total).toBe(25);
    expect(firstPage.items).toHaveLength(20);
    expect(secondPage.items).toHaveLength(5);
    expect(firstPage.items[0].content).toEqual(activities[24].content);
    expect(
      new Set(
        [...firstPage.items, ...secondPage.items].map(
          (a: { id: string }) => a.id,
        ),
      ).size,
    ).toBe(25);
    await request(h.app.getHttpServer())
      .get(`${records()}/${f.otherRecord.id}/activities`)
      .set('Cookie', f.employee.cookie)
      .expect(404);
    const foreign = await request(h.app.getHttpServer())
      .get(records())
      .set('Cookie', f.tenantBAdmin.cookie);
    expect([403, 404]).toContain(foreign.status);
    await request(h.app.getHttpServer())
      .post(`${records()}/${f.ownedRecord.id}/activities`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ activityType: 'NOTE', content: '有修改权限时允许追加' })
      .expect(201);
    // Read-only access still permits reading, but never appending communication.
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        objectId: f.object.id,
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'NONE',
      },
    });
    await request(h.app.getHttpServer())
      .get(records())
      .set('Cookie', f.employee.cookie)
      .expect(200);
    await request(h.app.getHttpServer())
      .post(`${records()}/${f.ownedRecord.id}/activities`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ activityType: 'NOTE', content: '不允许写入' })
      .expect(403);
  });
});
