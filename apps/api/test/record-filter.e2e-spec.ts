import type { Prisma } from '@crm/database';
import type {
  PublishedObjectSchema,
  PublishedFieldType,
} from '../src/modules/objects/object-schema';
import { randomUUID } from 'node:crypto';
import type { TenantContext } from '../src/common/tenancy/tenant-context';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import {
  RECORDS_REPOSITORY,
  RecordsService,
} from '../src/modules/records/records.service';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);

describe('Published record filters against PostgreSQL', () => {
  it('compares decimals, literal text, multiselects and tenant dates identically in pages, totals and exports', async () => {
    const harness = await createCriticalHarness();
    try {
      const f = await provisionCriticalFixture(harness);
      const db = harness.adminDatabase;
      await db.tenant.update({
        where: { id: f.tenantA.id },
        data: { timezone: 'America/New_York' },
      });
      const publication = await db.objectPublication.findFirstOrThrow({
        where: { objectId: f.object.id },
      });
      const schema =
        publication.configuration as unknown as PublishedObjectSchema;
      const fields: Array<[string, PublishedFieldType]> = [
        ['amount', 'MONEY'],
        ['meeting', 'DATETIME'],
        ['tags', 'MULTI_SELECT'],
        ['stage', 'SINGLE_SELECT'],
        ['vip', 'BOOLEAN'],
        ['score', 'NUMBER'],
      ];
      for (const [fieldKey, type] of fields)
        schema.fields.push({
          ...schema.fields[0],
          id: randomUUID(),
          fieldKey,
          label: fieldKey,
          type,
          config: {
            options: [
              { key: 'a', label: '甲' },
              { key: 'b', label: '乙' },
            ],
          },
        });
      const id = randomUUID();
      schema.publication = {
        ...schema.publication,
        id,
        number: 2,
        sourceDraftVersion: 2,
      };
      await db.objectPublication.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          id,
          publicationNo: 2,
          sourceDraftVersion: 2,
          publishedByMemberId: f.admin.memberId,
          configuration: schema as unknown as Prisma.InputJsonObject,
          changeSummary: {},
        },
      });
      await db.objectDefinition.update({
        where: { id: f.object.id },
        data: { activePublicationId: id },
      });
      const a = f.ownedRecord.id,
        b = f.otherRecord.id,
        c = f.workflowRecord.id;
      await db.record.update({
        where: { id: a },
        data: {
          data: {
            name: 'Acme%_A',
            tags: ['a', 'b'],
            stage: 'a',
            vip: false,
            score: 0,
            amount: '9007199254740993.01',
            meeting: '2024-03-11T03:59:59.999Z',
          },
        },
      });
      await db.record.update({
        where: { id: b },
        data: {
          data: {
            name: 'AcmeZZ',
            tags: ['b'],
            stage: 'b',
            vip: true,
            score: -3,
            amount: '9007199254740993.02',
            meeting: '2024-03-11T04:00:00.000Z',
          },
        },
      });
      await db.record.update({
        where: { id: c },
        data: {
          data: {
            name: 'Empty',
            tags: [],
            meeting: '2024-03-10T04:59:59.999Z',
          },
        },
      });
      const service = new RecordsService(
        harness.app.get(RECORDS_REPOSITORY),
        harness.app.get(PublishedObjectService),
        () => new Date('2024-03-10T07:00:00Z'),
        randomUUID,
      );
      const actor: TenantContext = {
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
        userId: f.admin.userId,
        memberId: f.admin.memberId,
        role: 'TENANT_ADMIN',
      };
      const cases: Array<[string, string, unknown, string[]]> = [
        ['amount', 'gt', '9007199254740993.01', [b]],
        [
          'amount',
          'between',
          { from: '9007199254740993.01', to: '9007199254740993.02' },
          [a, b],
        ],
        ['name', 'contains', 'ME%_', [a]],
        ['name', 'notContains', 'ME%_', [b, c]],
        ['name', 'eq', 'AcmeZZ', [b]],
        ['tags', 'in', ['a'], [a]],
        ['tags', 'notIn', ['a'], [b]],
        ['tags', 'empty', undefined, [c]],
        ['stage', 'notIn', ['b'], [a]],
        ['vip', 'eq', false, [a]],
        ['vip', 'notEmpty', undefined, [a, b]],
        ['score', 'notEmpty', undefined, [a, b]],
        ['score', 'empty', undefined, [c]],
        ['meeting', 'on', '2024-03-10', [a]],
        ['meeting', 'relative', 'today', [a]],
        ['meeting', 'before', '2024-03-10', [c]],
        ['meeting', 'after', '2024-03-10', [b]],
      ];
      for (const [fieldKey, operator, value, expected] of cases) {
        const rule = {
          version: 1,
          match: 'all',
          conditions: [
            { fieldKey, operator, ...(value !== undefined ? { value } : {}) },
          ],
        };
        const query = {
          sort: 'recordNo',
          direction: 'asc' as const,
          filters: JSON.stringify(rule),
        };
        const page = await service.list(actor, 'leads', {
          ...query,
          page: 1,
          limit: 10,
        });
        expect({
          fieldKey,
          operator,
          ids: page.items.map((r) => r.id),
        }).toEqual({ fieldKey, operator, ids: expected });
        expect(page.total).toBe(expected.length);
        const count = await service.aggregate(actor, 'leads', {
          filters: rule,
          aggregation: 'COUNT',
          limit: 1,
        });
        expect(count.value).toBe(String(expected.length));
        const csv = await service.exportCsv(actor, 'leads', query, {
          requestId: randomUUID(),
        });
        expect(csv.rowCount).toBe(expected.length);
      }
    } finally {
      await closeCriticalHarness(harness);
    }
  });

  it('binds OPEN tasks and earliest date to the viewer, honors the tenant DST boundary, and paginates after sorting', async () => {
    const harness = await createCriticalHarness();
    try {
      const f = await provisionCriticalFixture(harness);
      const db = harness.adminDatabase;
      await db.tenant.update({
        where: { id: f.tenantA.id },
        data: { timezone: 'America/New_York' },
      });
      const now = new Date('2024-03-10T07:00:00.000Z');
      const service = new RecordsService(
        harness.app.get(RECORDS_REPOSITORY),
        harness.app.get(PublishedObjectService),
        () => now,
        randomUUID,
      );
      const tenant = { tenantId: f.tenantA.id, tenantCode: f.tenantA.code };
      const me: TenantContext = {
        ...tenant,
        userId: f.employee.userId,
        memberId: f.employee.memberId,
        role: 'EMPLOYEE',
      };
      const admin: TenantContext = {
        ...tenant,
        userId: f.admin.userId,
        memberId: f.admin.memberId,
        role: 'TENANT_ADMIN',
      };
      const early = '2024-03-09T15:00:00.000Z';
      const late = '2024-03-11T03:59:59.999Z';
      const tomorrow = '2024-03-11T04:00:00.000Z';
      const task = (
        recordId: string,
        assigneeMemberId: string,
        dueAt: string,
        status = 'OPEN',
      ) => ({
        tenantId: f.tenantA.id,
        recordId,
        assigneeMemberId,
        dueAt: new Date(dueAt),
        status,
        title: '待联系',
      });
      await db.recordFollowUp.createMany({
        data: [
          task(f.ownedRecord.id, me.memberId, early),
          task(f.ownedRecord.id, me.memberId, now.toISOString()),
          task(f.workflowRecord.id, me.memberId, tomorrow),
          task(f.workflowRecord.id, admin.memberId, late),
          task(f.workflowRecord.id, me.memberId, early, 'DONE'),
          task(f.workflowRecord.id, me.memberId, early, 'CANCELLED'),
          task(f.otherRecord.id, me.memberId, late),
        ],
      });
      const query = {
        page: 1,
        limit: 10,
        sort: 'nextFollowUpAt',
        direction: 'asc' as const,
      };
      const due = (assignee?: string) =>
        JSON.stringify({
          version: 1,
          match: 'all',
          conditions: [
            {
              fieldKey: '$followUp',
              operator: 'dueThroughToday',
              ...(assignee ? { value: { assignee } } : {}),
            },
          ],
        });
      const list = (actor: TenantContext, filters?: string) =>
        service.list(actor, 'leads', { ...query, filters });
      const employeePage = await list(me, due());
      expect(employeePage.timeZone).toBe('America/New_York');
      expect(employeePage.total).toBe(1);
      expect(
        employeePage.items.map((row) => [row.id, row.nextFollowUpAt]),
      ).toEqual([[f.ownedRecord.id, early]]);
      expect((await list(me, due('any'))).items.map((row) => row.id)).toEqual([
        f.ownedRecord.id,
      ]);
      expect(
        (await list(admin, due())).items.map((row) => [
          row.id,
          row.nextFollowUpAt,
        ]),
      ).toEqual([[f.workflowRecord.id, late]]);
      const team = await list(admin, due('any'));
      expect(team.total).toBe(3);
      expect(team.items.map((row) => row.id)).toEqual([
        f.ownedRecord.id,
        ...[f.workflowRecord.id, f.otherRecord.id].sort(),
      ]);
      expect(
        await service.aggregate(admin, 'leads', {
          filters: JSON.parse(due('any')) as Record<string, unknown>,
          aggregation: 'COUNT',
          limit: 1,
        }),
      ).toMatchObject({ value: '3' });
      for (const direction of ['asc', 'desc'] as const) {
        const first = await service.list(admin, 'leads', {
          ...query,
          limit: 1,
          direction,
        });
        expect(first.items.map((row) => [row.id, row.nextFollowUpAt])).toEqual([
          [f.workflowRecord.id, late],
        ]);
        const second = await service.list(admin, 'leads', {
          ...query,
          page: 2,
          limit: 1,
          direction,
        });
        expect(second.items[0]?.nextFollowUpAt).toBeNull();
      }
      const dated = await list(me);
      expect(dated.items.map((row) => row.nextFollowUpAt)).toEqual([
        early,
        tomorrow,
      ]);
    } finally {
      await closeCriticalHarness(harness);
    }
  });
});
