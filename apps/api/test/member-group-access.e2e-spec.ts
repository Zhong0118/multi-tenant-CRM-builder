import { RecordsService } from '../src/modules/records/records.service';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import { DashboardEngine } from '../src/modules/dashboards/dashboard-engine';
import { compileDashboardPublication } from '../src/modules/dashboards/dashboard-definition';
import { createAggregateRecordsTool } from '../src/modules/ai/tools/aggregate-records.tool';
import { createSearchRecordsTool } from '../src/modules/ai/tools/search-records.tool';
import { createGetRecordTool } from '../src/modules/ai/tools/get-record.tool';
import type { TenantContext } from '../src/common/tenancy/tenant-context';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);
const origin = 'http://localhost:3000';

describe('GROUP read boundaries over HTTP', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let groupId: string;
  let outsideId: string;
  let unassignedId: string;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const records = () => `${base()}/objects/${f.object.code}/records`;
  const schemaPath = () => `${base()}/objects/${f.object.code}/schema`;
  const get = (path: string, actor: CriticalActor = f.employee) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', actor.cookie);
  const patch = (path: string, data: object) =>
    request(h.app.getHttpServer())
      .patch(path)
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .send(data);

  beforeAll(async () => {
    const runtime = new URL(process.env.TEST_DATABASE_URL ?? '');
    const admin = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
    for (const url of [runtime, admin]) {
      expect(['postgres:', 'postgresql:']).toContain(url.protocol);
      expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
      expect(url.pathname).toMatch(/^\/[a-z0-9_]*test[a-z0-9_]*$/i);
      expect(
        [...url.searchParams.keys()].every((key) => key === 'schema'),
      ).toBe(true);
    }
    expect(runtime.host + runtime.pathname).toBe(admin.host + admin.pathname);
    expect(runtime.username).toBe('crm_app');
    expect(['crm', userInfo().username]).toContain(admin.username);
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
    groupId = randomUUID();
    await h.adminDatabase.memberGroup.create({
      data: { id: groupId, tenantId: f.tenantA.id, name: '销售一组' },
    });
    await h.adminDatabase.tenantMember.updateMany({
      where: {
        tenantId: f.tenantA.id,
        id: { in: [f.employee.memberId, f.otherEmployee.memberId] },
      },
      data: { groupId },
    });
    await h.adminDatabase.memberGroup.update({
      where: { id: groupId },
      data: { leaderMemberId: f.employee.memberId },
    });
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'GROUP',
        updateScope: 'OWN',
      },
    });
    for (const [title, ownerMemberId] of [
      ['其他组记录', f.admin.memberId],
      ['未分配记录', null],
    ] as const) {
      const response = await request(h.app.getHttpServer())
        .post(records())
        .set('Cookie', f.admin.cookie)
        .set('Origin', origin)
        .send({ values: { name: title }, ownerMemberId })
        .expect(201);
      const id = (response.body as { id: string }).id;
      if (ownerMemberId) outsideId = id;
      else unassignedId = id;
    }
  });
  afterEach(async () => {
    if (!f) return;
    await h.adminDatabase.memberGroup.updateMany({
      where: { tenantId: f.tenantA.id },
      data: { leaderMemberId: null },
    });
    await h.adminDatabase.tenantMember.updateMany({
      where: { tenantId: f.tenantA.id },
      data: { groupId: null },
    });
    await h.adminDatabase.memberGroup.deleteMany({
      where: { tenantId: f.tenantA.id },
    });
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('labels only current GROUP owners without exposing roster details', async () => {
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { displayName: '钱宇' },
    });
    const response = await get(schemaPath()).expect(200);
    const schema = response.body as {
      ownerMembers: Array<{ id: string; displayName: string; status: string }>;
    };
    expect(schema.ownerMembers).toEqual(
      expect.arrayContaining([
        {
          id: f.employee.memberId,
          displayName: 'Critical Employee',
          status: 'ACTIVE',
        },
        { id: f.otherEmployee.memberId, displayName: '钱宇', status: 'ACTIVE' },
      ]),
    );
    expect(schema.ownerMembers).toHaveLength(2);
    await get(`${base()}/members`).expect(403);
    const employeeSchema = await get(schemaPath(), f.otherEmployee).expect(200);
    expect(employeeSchema.body).not.toHaveProperty('ownerMembers');
    const adminSchema = await get(schemaPath(), f.admin).expect(200);
    expect(adminSchema.body).not.toHaveProperty('ownerMembers');
  });

  it('scopes list, search, counts and CSV to the current group and retains hidden fields', async () => {
    const response = await get(records()).expect(200);
    const page = response.body as {
      items: Array<{ id: string; values: Record<string, unknown> }>;
      total: number;
    };
    expect(page.items.map((item) => item.id)).toContain(f.otherRecord.id);
    expect(page.items.map((item) => item.id)).not.toContain(outsideId);
    expect(page.items.map((item) => item.id)).not.toContain(unassignedId);
    expect(page.total).toBe(page.items.length);
    expect(page.items.every((item) => !('secret' in item.values))).toBe(true);
    const searched = await get(records())
      .query({ search: '他人线索' })
      .expect(200);
    expect(
      (searched.body as { items: Array<{ id: string }> }).items.map(
        (item) => item.id,
      ),
    ).toEqual([f.otherRecord.id]);
    const csv = await get(`${records()}/export`).expect(200);
    expect(csv.text).toContain('他人线索');
    expect(csv.text).not.toContain('其他组记录');
    expect(csv.text).not.toContain('未分配记录');
    expect(csv.text).not.toContain('hidden-other');
    await get(
      `/api/v1/workspaces/${f.tenantB.code}/objects/leads/records`,
    ).expect(403);
  });

  it.each([
    '',
    '/activities',
    '/attachments',
    '/relations',
    '/workflow',
    '/workflow/history',
  ])('protects single-record reads at %s', async (suffix) => {
    await get(`${records()}/${f.otherRecord.id}${suffix}`).expect(200);
    await get(`${records()}/${outsideId}${suffix}`).expect(404);
    await get(`${records()}/${unassignedId}${suffix}`).expect(404);
  });

  it('keeps teammate records read-only without affecting ownership', async () => {
    await patch(`${records()}/${f.otherRecord.id}`, {
      version: f.otherRecord.version,
      values: { name: '越权编辑' },
    }).expect(404);
    await request(h.app.getHttpServer())
      .post(`${records()}/${f.otherRecord.id}/activities`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .send({ activityType: 'NOTE', content: '越权跟进' })
      .expect(404);
    await request(h.app.getHttpServer())
      .post(`${records()}/${f.otherRecord.id}/workflow/transitions/qualify`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .send({ expectedVersion: f.otherRecord.version })
      .expect(404);
    const row = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.otherRecord.id },
    });
    expect(row.ownerMemberId).toBe(f.otherEmployee.memberId);
    expect(row.version).toBe(f.otherRecord.version);
  });

  it('removes moved members immediately and restores visibility when moved back', async () => {
    await get(`${records()}/${f.otherRecord.id}`).expect(200);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { groupId: null },
    });
    await get(`${records()}/${f.otherRecord.id}`).expect(404);
    const movedSchema = await get(schemaPath()).expect(200);
    expect(
      (
        movedSchema.body as { ownerMembers: Array<{ id: string }> }
      ).ownerMembers.map((member) => member.id),
    ).toEqual([f.employee.memberId]);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { groupId },
    });
    await get(`${records()}/${f.otherRecord.id}`).expect(200);
    const restoredSchema = await get(schemaPath()).expect(200);
    expect(
      (
        restoredSchema.body as { ownerMembers: Array<{ id: string }> }
      ).ownerMembers.map((member) => member.id),
    ).toContain(f.otherEmployee.memberId);
    expect(
      (
        await h.adminDatabase.record.findUniqueOrThrow({
          where: { id: f.otherRecord.id },
        })
      ).ownerMemberId,
    ).toBe(f.otherEmployee.memberId);
  });

  it('falls back to OWN after the leader is replaced', async () => {
    await h.adminDatabase.memberGroup.update({
      where: { id: groupId },
      data: { leaderMemberId: f.otherEmployee.memberId },
    });
    await get(`${records()}/${f.ownedRecord.id}`).expect(200);
    await get(`${records()}/${f.otherRecord.id}`).expect(404);
    const ownSchema = await get(schemaPath()).expect(200);
    expect(ownSchema.body).toMatchObject({ scopes: { read: 'OWN' } });
    expect(ownSchema.body).not.toHaveProperty('ownerMembers');
  });

  it.each(['member', 'account'] as const)(
    'retains managerial visibility over disabled %s still in the group',
    async (kind) => {
      if (kind === 'member')
        await h.adminDatabase.tenantMember.update({
          where: { id: f.otherEmployee.memberId },
          data: { status: 'DISABLED' },
        });
      else
        await h.adminDatabase.user.update({
          where: { id: f.otherEmployee.userId },
          data: { status: 'DISABLED' },
        });
      await get(`${records()}/${f.otherRecord.id}`).expect(200);
      const disabledSchema = await get(schemaPath()).expect(200);
      expect(
        (disabledSchema.body as { ownerMembers: object[] }).ownerMembers,
      ).toContainEqual({
        id: f.otherEmployee.memberId,
        displayName: 'Critical Other',
        status: 'DISABLED',
      });
    },
  );

  it('applies the same live owner boundary to AI reads, aggregation and dashboard SQL', async () => {
    const context: TenantContext = {
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      memberId: f.employee.memberId,
      userId: f.employee.userId,
      role: 'EMPLOYEE',
    };
    const service = h.app.get(RecordsService);
    const aggregate = createAggregateRecordsTool(service, context);
    const search = createSearchRecordsTool(service, context);
    const detail = createGetRecordTool(service, context);
    expect(
      await aggregate.execute(
        { objectCode: 'leads', aggregation: 'COUNT' },
        'count',
      ),
    ).toMatchObject({ value: '3' });
    expect(
      await search.execute(
        { objectCode: 'leads', query: '他人线索' },
        'search',
      ),
    ).toMatchObject({ total: 1, items: [{ id: f.otherRecord.id }] });
    await expect(
      detail.execute({ objectCode: 'leads', recordId: outsideId }, 'detail'),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
    const { schema } = await h.app
      .get(PublishedObjectService)
      .resolveRuntimeSchema(context, 'leads');
    const catalog = [schema];
    const publication = compileDashboardPublication(
      {
        schemaVersion: 2,
        title: '团队',
        widgets: [
          {
            id: 'team-count',
            title: '团队记录',
            objectCode: 'leads',
            audience: 'ALL',
            type: 'METRIC',
            aggregation: 'COUNT',
            displayFormat: 'NUMBER',
            filters: [],
            width: 'HALF',
            sortOrder: 0,
          },
        ],
      },
      catalog,
    );
    const evaluate = () =>
      h.app.get(DashboardEngine).evaluate({
        publication,
        catalog,
        context,
        period: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',
          timezone: 'Asia/Shanghai',
        },
      });
    expect((await evaluate()).widgets).toMatchObject([
      { id: 'team-count', state: 'READY', data: { value: 3 } },
    ]);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { groupId: null },
    });
    expect(
      await aggregate.execute(
        { objectCode: 'leads', aggregation: 'COUNT' },
        'moved-count',
      ),
    ).toMatchObject({ value: '2' });
    expect((await evaluate()).widgets).toMatchObject([
      { id: 'team-count', state: 'READY', data: { value: 2 } },
    ]);
  });

  it('filters assigned follow-ups and notification counts by live group owners', async () => {
    for (const recordId of [f.otherRecord.id, outsideId])
      await h.adminDatabase.recordFollowUp.create({
        data: {
          id: randomUUID(),
          tenantId: f.tenantA.id,
          recordId,
          assigneeMemberId: f.employee.memberId,
          title: '待回访',
          dueAt: new Date(Date.now() - 60_000),
        },
      });
    await h.adminDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
    const tasks = await get(`${base()}/follow-ups`).expect(200);
    expect(tasks.body).toMatchObject({
      total: 1,
      items: [{ recordId: f.otherRecord.id, canManage: false }],
    });
    const inbox = await get(`${base()}/notifications`).expect(200);
    expect(inbox.body).toMatchObject({
      total: 1,
      unreadCount: 1,
      items: [{ canOpen: true }],
    });
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { groupId: null },
    });
    expect((await get(`${base()}/follow-ups`).expect(200)).body).toMatchObject({
      total: 0,
      items: [],
    });
    expect(
      (await get(`${base()}/notifications`).expect(200)).body,
    ).toMatchObject({ total: 0, unreadCount: 0, items: [] });
  });
});
