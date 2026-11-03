import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  publishObject,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

describe('Company-configured workbench metrics', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  beforeAll(async () => {
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
  });

  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('includes the final calendar day of a confirmed-order trend until an exclusive midnight boundary', async () => {
    const db = h.adminDatabase;
    const object = await publishObject(db, {
      tenantId: f.tenantA.id,
      publisherMemberId: f.admin.memberId,
      code: 'confirmed_orders',
      name: '已确认订单',
      now: new Date(),
      fields: [
        ['name', 'TEXT'],
        ['confirmed', 'BOOLEAN'],
        ['order_date', 'DATE'],
        ['amount', 'MONEY'],
      ].map(([key, type]) => ({
        key,
        label: key,
        type,
        access: 'EDIT',
        required: false,
      })),
      access: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        readScope: 'OWN',
        updateScope: 'OWN',
      },
    });
    await db.record.createMany({
      data: [
        [true, '2026-11-02', 80],
        [true, '2026-11-03', 20],
        [false, '2026-11-03', 999],
      ].map(([confirmed, day, amount], i) => ({
        tenantId: f.tenantA.id,
        objectId: object.id,
        ownerMemberId: f.employee.memberId,
        recordNo: BigInt(i + 1),
        title: '订单',
        data: { name: '订单', confirmed, order_date: day, amount },
      })),
    });
    const path = '/api/v1/workspaces/' + f.tenantA.code + '/dashboards/orders';
    const client = request(h.app.getHttpServer());
    const headers = { Cookie: f.admin.cookie, Origin: 'http://localhost:3000' };
    const settled = [{ fieldKey: 'confirmed', operator: 'EQ', value: true }];
    const configuration = {
      schemaVersion: 2,
      title: '订单趋势',
      widgets: [
        {
          id: 'orders_total',
          type: 'METRIC',
          title: '已确认开单量',
          audience: 'ALL',
          width: 'HALF',
          sortOrder: 0,
          objectCode: 'confirmed_orders',
          aggregation: 'COUNT',
          filters: [
            ...settled,
            { fieldKey: 'order_date', operator: 'DASHBOARD_PERIOD' },
          ],
        },
        {
          id: 'confirmed',
          type: 'TREND',
          title: '确认金额',
          audience: 'ALL',
          width: 'HALF',
          sortOrder: 0,
          objectCode: 'confirmed_orders',
          dateFieldKey: 'order_date',
          granularity: 'DAY',
          aggregation: 'SUM',
          valueFieldKey: 'amount',
          filters: settled,
        },
      ],
    };
    const draft = await client
      .put(path + '/configuration')
      .set(headers)
      .send({ expectedVersion: 0, configuration })
      .expect(200);
    const expectedVersion = (draft.body as { draftVersion: number })
      .draftVersion;
    const preview = (to: string) =>
      client
        .post(path + '/preview')
        .set(headers)
        .send({
          expectedVersion,
          period: { from: '2026-11-01T16:00:00.000Z', to },
        })
        .expect(201);
    await preview('2026-11-02T16:00:00.000Z').expect((res) =>
      expect(res.body).toMatchObject({
        widgets: [
          { state: 'READY', data: { value: 1 } },
          {
            state: 'READY',
            data: { items: [{ date: '2026-11-02', value: 80 }] },
          },
        ],
      }),
    );
    await preview('2026-11-03T04:00:00.000Z').expect((res) =>
      expect(res.body).toMatchObject({
        widgets: [
          { state: 'READY', data: { value: 2 } },
          {
            state: 'READY',
            data: {
              items: [
                { date: '2026-11-02', value: 80 },
                { date: '2026-11-03', value: 20 },
              ],
            },
          },
        ],
      }),
    );
  });

  it('previews and publishes record counts across two objects using actual creation time, within each viewer’s scope', async () => {
    const root = '/api/v1/workspaces/' + f.tenantA.code;
    const path = root + '/dashboards/home';
    const client = request(h.app.getHttpServer());
    const headers = { Cookie: f.admin.cookie, Origin: 'http://localhost:3000' };
    const from = '2026-11-01T16:00:00.000Z',
      to = '2026-11-03T04:00:00.000Z';
    for (const [id, at] of [
      [f.ownedRecord.id, from],
      [f.otherRecord.id, '2026-11-03T02:00:00.000Z'],
      [f.workflowRecord.id, to],
    ]) {
      await h.adminDatabase.record.update({
        where: { id },
        data: { createdAt: new Date(at) },
      });
    }
    await h.adminDatabase.record.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.rollbackTargetObject.id,
        ownerMemberId: f.employee.memberId,
        recordNo: 10n,
        title: '开单',
        data: { name: '开单' },
        createdAt: new Date(from),
      },
    });
    const metric = {
      type: 'METRIC',
      audience: 'ALL',
      width: 'HALF',
      sortOrder: 0,
      aggregation: 'COUNT',
      filters: [{ fieldKey: '$createdAt', operator: 'DASHBOARD_PERIOD' }],
    };
    const configuration = {
      schemaVersion: 2,
      title: '业绩',
      widgets: [
        {
          ...metric,
          id: 'new',
          title: '新增客户档案',
          objectCode: f.object.code,
        },
        {
          ...metric,
          id: 'orders',
          title: '新建开单',
          objectCode: f.rollbackTargetObject.code,
        },
        {
          ...metric,
          id: 'all',
          title: '累计',
          objectCode: f.object.code,
          filters: [],
        },
        {
          ...metric,
          id: 'trend',
          title: '新增趋势',
          objectCode: f.object.code,
          type: 'TREND',
          dateFieldKey: '$createdAt',
          granularity: 'DAY',
          filters: [],
        },
      ],
    };
    const saved = await client
      .put(path + '/configuration')
      .set(headers)
      .send({ expectedVersion: 0, configuration })
      .expect(200);
    const expectedVersion = (saved.body as { draftVersion: number })
      .draftVersion;
    const data = (value: number) => ({ state: 'READY', data: { value } });
    await client
      .post(path + '/preview')
      .set(headers)
      .send({ expectedVersion, period: { from, to } })
      .expect(201)
      .expect((res) =>
        expect(res.body).toMatchObject({
          widgets: [
            data(2),
            data(1),
            data(3),
            {
              state: 'READY',
              data: {
                items: [
                  { date: '2026-11-02', value: 1 },
                  { date: '2026-11-03', value: 1 },
                ],
              },
            },
          ],
        }),
      );
    await client
      .post(path + '/publications')
      .set(headers)
      .send({ expectedVersion })
      .expect(201);
    await client
      .patch(root + '/dashboards/defaults')
      .set(headers)
      .send({ adminDashboardCode: 'home', employeeDashboardCode: 'home' })
      .expect(200);
    await client
      .get(root + '/dashboards/overview')
      .set('Cookie', f.employee.cookie)
      .query({ from, to })
      .expect(200)
      .expect((res) =>
        expect(res.body).toMatchObject({
          widgets: [
            data(1),
            data(1),
            data(2),
            {
              state: 'READY',
              data: { items: [{ date: '2026-11-02', value: 1 }] },
            },
          ],
        }),
      );
    await client
      .get(path + '/overview')
      .set('Cookie', f.admin.cookie)
      .query({ from, to: '2026-11-02T16:00:00.000Z' })
      .expect(200)
      .expect((res) =>
        expect(res.body).toMatchObject({
          widgets: [
            data(1),
            data(1),
            data(3),
            {
              state: 'READY',
              data: { items: [{ date: '2026-11-02', value: 1 }] },
            },
          ],
        }),
      );
    await client
      .get(path + '/overview')
      .set('Cookie', f.tenantBAdmin.cookie)
      .query({ from, to })
      .expect(403);
  });
});
