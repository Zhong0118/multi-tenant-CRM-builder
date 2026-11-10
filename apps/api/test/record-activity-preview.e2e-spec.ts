import request from 'supertest';
import type {
  RecordPageResponse,
  RecordActivityPageResponse,
} from '../src/modules/records/records.service';
import { randomUUID } from 'node:crypto';
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
    for (const key of ['TEST_DATABASE_URL', 'TEST_DATABASE_ADMIN_URL']) {
      const url = new URL(process.env[key] ?? '');
      expect(['localhost', '127.0.0.1']).toContain(url.hostname);
      expect(url.pathname).toMatch(/_test$/);
    }
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
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
