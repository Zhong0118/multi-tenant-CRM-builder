import request from 'supertest';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  publishObject,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

type Metrics = {
  widgets: Array<{
    id: string;
    state: string;
    data?: {
      value: number;
      members: Array<{ memberId: string; value: number }>;
    };
  }>;
};
type Report = { reference: { businessMetrics: Metrics } };
const json = <T>(res: { body: unknown }) => res.body as T;

describe('Published workbench metrics in daily reports', () => {
  let h: CriticalHarness,
    f: CriticalFixture,
    objectId: string,
    recordId: string;
  const date = '2026-11-05';
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const get = (path: string, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer())
      .get(base() + path)
      .set('Cookie', actor.cookie);
  const send = (method: 'put' | 'post' | 'patch', path: string, body: object) =>
    request(h.app.getHttpServer())
      [method](base() + path)
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send(body);
  const report = async (actor: CriticalActor = f.employee) =>
    json<Report>(await get(`/daily-reports/${date}/mine`, actor).expect(200))
      .reference.businessMetrics;
  const metric = (
    id: string,
    memberSource: string,
    fieldKey: string,
    extra: object = {},
  ) => ({
    id,
    type: 'METRIC',
    title: id,
    audience: 'ALL',
    objectCode: 'report_orders',
    width: 'QUARTER',
    sortOrder: 0,
    aggregation: 'COUNT',
    workReport: { memberSource },
    filters: [{ fieldKey, operator: 'DASHBOARD_PERIOD' }],
    ...extra,
  });
  const configuration = () => ({
    schemaVersion: 2,
    title: '每日业务统计',
    widgets: [
      metric('new', 'CREATOR', '$createdAt'),
      metric('orders', 'RECORD_OWNER', 'confirmed_at', {
        filters: [
          { fieldKey: 'confirmed_at', operator: 'DASHBOARD_PERIOD' },
          { fieldKey: 'confirmed', operator: 'EQ', value: true },
        ],
      }),
      metric('amount', 'RECORD_OWNER', 'confirmed_at', {
        aggregation: 'SUM',
        valueFieldKey: 'amount',
      }),
    ],
  });

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
    const object = await publishObject(h.adminDatabase, {
      tenantId: f.tenantA.id,
      publisherMemberId: f.admin.memberId,
      code: 'report_orders',
      name: '普通订单表',
      now: new Date(),
      fields: [
        ['name', 'TEXT'],
        ['confirmed', 'BOOLEAN'],
        ['confirmed_at', 'DATE'],
        ['amount', 'MONEY'],
      ].map(([key, type]) => ({
        key,
        label: key,
        type,
        access: 'EDIT' as const,
        required: false,
      })),
      access: {
        canRead: true,
        canCreate: true,
        canUpdate: true,
        readScope: 'ALL',
        updateScope: 'OWN',
      },
    });
    objectId = object.id;
    const rows = [
      {
        owner: f.employee.memberId,
        creator: f.employee.memberId,
        confirmed: true,
        amount: 30,
        at: '2026-11-04T16:00:00Z',
        day: date,
      },
      {
        owner: f.otherEmployee.memberId,
        creator: f.employee.memberId,
        confirmed: true,
        amount: 70,
        at: '2026-11-05T15:59:59Z',
        day: date,
      },
      {
        owner: f.employee.memberId,
        creator: f.otherEmployee.memberId,
        confirmed: false,
        amount: 20,
        at: '2026-11-05T16:00:00Z',
        day: date,
      },
      {
        owner: f.employee.memberId,
        creator: f.employee.memberId,
        confirmed: true,
        amount: 99,
        at: '2026-11-04T15:59:59Z',
        day: '2026-11-04',
      },
      {
        owner: null,
        creator: null,
        confirmed: true,
        amount: 999,
        at: '2026-11-05T02:00:00Z',
        day: date,
      },
    ];
    for (const [i, row] of rows.entries()) {
      const r = await h.adminDatabase.record.create({
        data: {
          tenantId: f.tenantA.id,
          objectId,
          ownerMemberId: row.owner,
          createdByMemberId: row.creator,
          recordNo: BigInt(i + 1),
          title: `订单${i}`,
          createdAt: new Date(row.at),
          data: {
            name: `订单${i}`,
            confirmed: row.confirmed,
            confirmed_at: row.day,
            amount: row.amount,
          },
        },
      });
      if (i === 0) recordId = r.id;
    }
    await send('put', '/dashboards/home/configuration', {
      expectedVersion: 0,
      configuration: configuration(),
    }).expect(200);
  });
  afterEach(async () => {
    if (h && f)
      await h.adminDatabase.memberFieldPermission.deleteMany({
        where: { tenantId: f.tenantA.id },
      });
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  const publish = async () => {
    const config = json<{ draft: { draftVersion: number } }>(
      await get('/dashboards/home/configuration').expect(200),
    );
    await send('post', '/dashboards/home/publications', {
      expectedVersion: config.draft.draftVersion,
    }).expect(201);
    await send('patch', '/dashboards/defaults', {
      employeeDashboardCode: 'home',
      adminDashboardCode: 'home',
    }).expect(200);
  };

  it('uses published non-pool metrics, dates and personal attribution without any activity registration', async () => {
    expect((await report()).widgets).toEqual([]);
    await publish();
    const own = await report();
    expect(own.widgets.map((w) => [w.id, w.data?.value])).toEqual([
      ['new', 2],
      ['orders', 1],
      ['amount', 50],
    ]);
    expect(
      own.widgets
        .flatMap((w) => w.data?.members ?? [])
        .every((m) => m.memberId === f.employee.memberId),
    ).toBe(true);
    const team = json<{ businessMetrics: Metrics }>(
      await get(`/team-activity?from=${date}&to=${date}`).expect(200),
    ).businessMetrics;
    expect(team.widgets.map((w) => [w.id, w.data?.value])).toEqual([
      ['new', 2],
      ['orders', 2],
      ['amount', 120],
    ]);
    const reviewed = json<Report>(
      await get(`/daily-reports/${date}/members/${f.employee.memberId}`).expect(
        200,
      ),
    );
    expect(reviewed.reference.businessMetrics).toEqual(own);
    await get(
      `/daily-reports/${date}/members/${f.otherEmployee.memberId}`,
      f.employee,
    ).expect(403);
    await get(`/team-activity?from=${date}&to=${date}`, f.employee).expect(403);
    const otherResponse = json<Report>(
      await request(h.app.getHttpServer())
        .get(`/api/v1/workspaces/${f.tenantB.code}/daily-reports/${date}/mine`)
        .set('Cookie', f.tenantBAdmin.cookie)
        .expect(200),
    );
    const other = otherResponse.reference.businessMetrics;
    expect(other.widgets).toEqual([]);
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
    await h.adminDatabase.record.update({
      where: { id: recordId },
      data: { title: '只改备注，不增加新客' },
    });
    expect((await report()).widgets[0].data?.value).toBe(2);
  });

  it('follows current ownership without altering creator attribution, and applies soft deletion', async () => {
    await publish();
    await h.adminDatabase.record.update({
      where: { id: recordId },
      data: { ownerMemberId: f.otherEmployee.memberId },
    });
    expect((await report()).widgets.map((w) => w.data?.value)).toEqual([
      2, 0, 20,
    ]);
    await h.adminDatabase.record.update({
      where: { id: recordId },
      data: { deletedAt: new Date() },
    });
    expect((await report()).widgets.map((w) => w.data?.value)).toEqual([
      1, 0, 20,
    ]);
  });

  it('honors current hidden fields and reports archived sources instead of showing a fake zero', async () => {
    await publish();
    const publication =
      await h.adminDatabase.objectPublication.findFirstOrThrow({
        where: { objectId },
      });
    const fields = (
      publication.configuration as unknown as {
        fields: Array<{ id: string; fieldKey: string }>;
      }
    ).fields;
    const fieldId = fields.find((field) => field.fieldKey === 'amount')!.id;
    await h.adminDatabase.fieldDefinition.create({
      data: {
        id: fieldId,
        tenantId: f.tenantA.id,
        objectId,
        fieldKey: 'amount',
        label: '金额',
        type: 'MONEY',
        status: 'ACTIVE',
        sortOrder: 30,
      },
    });
    await h.adminDatabase.memberFieldPermission.create({
      data: {
        tenantId: f.tenantA.id,
        memberId: f.employee.memberId,
        objectId,
        fieldId,
        access: 'HIDDEN',
      },
    });
    expect((await report()).widgets.map((w) => w.id)).toEqual([
      'new',
      'orders',
    ]);
    await h.adminDatabase.objectDefinition.update({
      where: { id: objectId },
      data: { status: 'ARCHIVED' },
    });
    expect(
      (await report()).widgets.every(
        (w) => w.state === 'UNAVAILABLE' && !w.data,
      ),
    ).toBe(true);
  });

  it('counts passed WeChat records using legacy text dates and skips invalid or missing dates', async () => {
    const passed = await publishObject(h.adminDatabase, {
      tenantId: f.tenantA.id,
      publisherMemberId: f.admin.memberId,
      code: 'passes',
      name: '通过表',
      now: new Date(),
      fields: [
        ['name', 'TEXT'],
        ['passed', 'BOOLEAN'],
        ['passed_at', 'TEXT'],
      ].map(([key, type]) => ({
        key,
        label: key,
        type,
        required: false,
        access: 'EDIT' as const,
      })),
      access: {
        canRead: true,
        canCreate: true,
        canUpdate: true,
        readScope: 'ALL',
        updateScope: 'OWN',
      },
    });
    for (const [i, day] of [
      '26.11.5',
      '2026.11.05',
      '2026-11-05',
      '2026.02.30',
      '',
      '11/05/2026',
      '2026-11-04',
    ].entries()) {
      await h.adminDatabase.record.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: passed.id,
          recordNo: BigInt(i + 1),
          title: '通过',
          ownerMemberId: f.employee.memberId,
          data: { name: '通过', passed: true, passed_at: day },
        },
      });
    }
    const current = json<{ draft: { draftVersion: number } }>(
      await get('/dashboards/home/configuration').expect(200),
    );
    await send('put', '/dashboards/home/configuration', {
      expectedVersion: current.draft.draftVersion,
      configuration: {
        schemaVersion: 2,
        title: '加微信统计',
        widgets: [
          metric('wechat', 'RECORD_OWNER', 'passed_at', {
            objectCode: 'passes',
            filters: [
              { fieldKey: 'passed_at', operator: 'DASHBOARD_PERIOD' },
              { fieldKey: 'passed', operator: 'EQ', value: true },
            ],
          }),
        ],
      },
    }).expect(200);
    await publish();
    expect((await report()).widgets[0]).toMatchObject({
      state: 'READY',
      data: { value: 3 },
    });
  });
});
