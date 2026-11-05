import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import {
  type RecordPageResponse,
  RecordsService,
  RECORDS_REPOSITORY,
} from '../src/modules/records/records.service';
import { type RecordsRepository } from '../src/modules/records/records.repository';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  publishObject,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

describe('Business dates: legacy imports, sorting and calendar filters', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let objectId: string;
  const path = () =>
    `/api/v1/workspaces/${f.tenantA.code}/objects/business_dates/records`;
  const get = (query: Record<string, string | number>, employee = false) =>
    request(h.app.getHttpServer())
      .get(path())
      .set('Cookie', (employee ? f.employee : f.admin).cookie)
      .query(query);

  beforeAll(async () => {
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
    await h.adminDatabase.tenant.update({
      where: { id: f.tenantA.id },
      data: { timezone: 'Asia/Shanghai' },
    });
    const object = await publishObject(h.adminDatabase, {
      tenantId: f.tenantA.id,
      publisherMemberId: f.admin.memberId,
      code: 'business_dates',
      name: '日期验证',
      now: new Date(),
      fields: [
        ['name', 'TEXT'],
        ['legacy', 'TEXT'],
        ['day', 'DATE'],
        ['moment', 'DATETIME'],
        ['secret', 'TEXT'],
      ].map(([key, type]) => ({
        key,
        type,
        label: key,
        required: false,
        access: key === 'secret' ? 'HIDDEN' : 'EDIT',
      })),
      access: {
        canCreate: true,
        canRead: true,
        canUpdate: true,
        readScope: 'OWN',
        updateScope: 'OWN',
      },
    });
    objectId = object.id;
    const pub = await h.adminDatabase.objectPublication.findFirstOrThrow({
      where: { objectId },
    });
    const configuration = pub.configuration as Prisma.JsonObject;
    const fields = configuration.fields as Prisma.JsonObject[];
    for (const field of fields)
      if (field.fieldKey === 'legacy' || field.fieldKey === 'secret')
        field.config = { dateInterpretation: true };
    const nextId = randomUUID();
    configuration.publication = {
      ...(configuration.publication as Prisma.JsonObject),
      id: nextId,
      number: 2,
    };
    await h.adminDatabase.objectPublication.create({
      data: {
        ...pub,
        id: nextId,
        publicationNo: 2,
        configuration,
        changeSummary: {},
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: objectId },
      data: { activePublicationId: nextId },
    });
    const dates = [
      '2025-02-27',
      '2026.11.05',
      '26.11.2',
      '2026-2-9',
      '2026/10/23',
      '2026-02-31',
      '未定',
      null,
    ];
    await h.adminDatabase.record.createMany({
      data: dates.map((day, i) => ({
        tenantId: f.tenantA.id,
        objectId,
        recordNo: BigInt(i + 1),
        title: `date-${i + 1}`,
        ownerMemberId: i === 0 ? f.otherEmployee.memberId : f.employee.memberId,
        data: {
          name: `date-${i + 1}`,
          legacy: day,
          secret: day,
          day: i === 5 ? '2026-02-31' : '2026-11-05',
          moment: [
            '2026-11-04T15:59:59Z',
            '2026-11-04T16:00:00Z',
            '2026-11-05T23:59:59+08:00',
            '2026-11-06T00:00:00+08:00',
          ][i % 4],
        },
      })),
    });
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('orders mixed imported dates chronologically with invalid values last in both directions', async () => {
    const asc = await get({
      sort: 'legacy',
      direction: 'asc',
      limit: 100,
    }).expect(200);
    expect(
      (asc.body as RecordPageResponse).items
        .slice(0, 5)
        .map((x: { title: string }) => x.title),
    ).toEqual(['date-1', 'date-4', 'date-5', 'date-3', 'date-2']);
    const desc = await get({
      sort: 'legacy',
      direction: 'desc',
      limit: 100,
    }).expect(200);
    expect(
      (desc.body as RecordPageResponse).items
        .slice(0, 5)
        .map((x: { title: string }) => x.title),
    ).toEqual(['date-2', 'date-3', 'date-5', 'date-4', 'date-1']);
    expect((desc.body as RecordPageResponse).total).toBe(8);
  });
  it('filters parsed text dates with system sorting and export without modifying stored text', async () => {
    const filters = JSON.stringify({
      legacy: { from: '2026-11-01', to: '2026-11-05' },
    });
    const res = await get({
      filters,
      sort: 'recordNo',
      direction: 'asc',
    }).expect(200);
    expect(
      (res.body as RecordPageResponse).items.map(
        (x: { title: string }) => x.title,
      ),
    ).toEqual(['date-2', 'date-3']);
    const exported = await request(h.app.getHttpServer())
      .get(path() + '/export')
      .set('Cookie', f.admin.cookie)
      .query({ filters, sort: 'legacy', direction: 'asc' })
      .expect(200);
    expect(exported.text).toContain('26.11.2');
    expect(exported.text).not.toContain('date-1');
    const raw = await h.adminDatabase.record.findFirstOrThrow({
      where: { objectId, recordNo: 3n },
    });
    expect((raw.data as Prisma.JsonObject).legacy).toBe('26.11.2');
  });
  it('uses company-local full-day boundaries for datetime filters, independent of record sorting', async () => {
    const res = await get({
      filters: JSON.stringify({
        moment: { from: '2026-11-05', to: '2026-11-05' },
      }),
      sort: 'moment',
      direction: 'asc',
    }).expect(200);
    expect(
      (res.body as RecordPageResponse).items
        .map((x: { title: string }) => x.title)
        .sort(),
    ).toEqual(['date-2', 'date-3', 'date-6', 'date-7']);
  });
  it('resolves shortcuts after local midnight and keeps pagination stable for identical dates', async () => {
    const service = new RecordsService(
      h.app.get<RecordsRepository>(RECORDS_REPOSITORY),
      h.app.get(PublishedObjectService),
      () => new Date('2026-11-04T16:05:00Z'),
      randomUUID,
    );
    const context = {
      userId: f.admin.userId,
      memberId: f.admin.memberId,
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      role: 'TENANT_ADMIN' as const,
    };
    for (const [relative, total] of [
      ['today', 1],
      ['yesterday', 0],
      ['past_7_days', 2],
      ['past_30_days', 3],
      ['this_month', 2],
      ['last_month', 1],
      ['this_week', 2],
    ] as const) {
      const result = await service.list(context, 'business_dates', {
        page: 1,
        limit: 100,
        sort: 'legacy',
        direction: 'asc',
        filters: JSON.stringify({ legacy: { relative } }),
      });
      expect({ relative, total: result.total }).toEqual({ relative, total });
    }
    const first = await get({
      sort: 'day',
      direction: 'asc',
      limit: 2,
      page: 1,
    }).expect(200);
    const second = await get({
      sort: 'day',
      direction: 'asc',
      limit: 2,
      page: 2,
    }).expect(200);
    expect(
      new Set(
        [
          ...(first.body as RecordPageResponse).items,
          ...(second.body as RecordPageResponse).items,
        ].map((x: { id: string }) => x.id),
      ).size,
    ).toBe(4);
  });
  it('rejects impossible dates, excludes malformed stored DATEs, and enforces employee scope/hidden fields', async () => {
    await get({
      filters: JSON.stringify({ day: { from: '2026-02-31' } }),
    }).expect(400);
    const res = await get({
      filters: JSON.stringify({
        day: { from: '2026-01-01', to: '2026-12-31' },
      }),
    }).expect(200);
    expect((res.body as RecordPageResponse).total).toBe(7);
    const owned = await get({ sort: 'legacy' }, true).expect(200);
    expect((owned.body as RecordPageResponse).total).toBe(7);
    await get({ sort: 'secret' }, true).expect(400);
    await get(
      { filters: JSON.stringify({ secret: { from: '2026-01-01' } }) },
      true,
    ).expect(400);
  });

  it('imports 100 historical rows without pushing newer business dates down or rewriting existing records', async () => {
    const before = await h.adminDatabase.record.findMany({
      where: { objectId },
      orderBy: { recordNo: 'asc' },
    });
    await h.adminDatabase.recordCounter.create({
      data: { tenantId: f.tenantA.id, objectId, nextRecordNo: 9n },
    });
    const imported = await request(h.app.getHttpServer())
      .post(path() + '/import')
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        rows: Array.from({ length: 100 }, (_, i) => ({
          rowNumber: i + 2,
          values: { name: `补录-${i}`, legacy: '2025.6.10' },
        })),
      })
      .expect(201);
    expect((imported.body as { created: number }).created).toBe(100);
    const sorted = await get({
      sort: 'legacy',
      direction: 'desc',
      limit: 20,
    }).expect(200);
    expect(
      (sorted.body as RecordPageResponse).items
        .slice(0, 4)
        .map((x: { title: string }) => x.title),
    ).toEqual(['date-2', 'date-3', 'date-5', 'date-4']);
    expect(
      await h.adminDatabase.record.findMany({
        where: { id: { in: before.map((row) => row.id) } },
        orderBy: { recordNo: 'asc' },
      }),
    ).toEqual(before);
  });
});
