import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import request from 'supertest';

import type { TenantContext } from '../src/common/tenancy/tenant-context';
import type { AutomationRule } from '../src/modules/automations/automation.types';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';
import { RECORDS_REPOSITORY } from '../src/modules/records/records.service';
import type {
  RecordListQuery,
  RecordsRepository,
} from '../src/modules/records/records.repository';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';

jest.setTimeout(90_000);

describe('legacy MONEY database precision', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let records: RecordsRepository;
  let context: TenantContext;

  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    records = h.app.get(RECORDS_REPOSITORY);
  });

  beforeEach(async () => {
    await cleanupAutomations();
    f = await provisionCriticalFixture(h);
    context = {
      userId: f.admin.userId,
      memberId: f.admin.memberId,
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      role: 'TENANT_ADMIN',
    };
    for (const objectId of [f.object.id, f.rollbackTargetObject.id]) {
      await h.adminDatabase.fieldDefinition.createMany({
        data: ['amount', 'hidden_money', 'retired_money', 'quantity'].map(
          (fieldKey) => ({
            id: randomUUID(),
            tenantId: f.tenantA.id,
            objectId,
            fieldKey,
            label: fieldKey,
            type:
              fieldKey === 'quantity'
                ? ('NUMBER' as const)
                : ('MONEY' as const),
            status:
              fieldKey === 'retired_money'
                ? ('INACTIVE' as const)
                : ('ACTIVE' as const),
            validation: { scale: 2 },
          }),
        ),
      });
      await republish(objectId, (schema) => {
        for (const fieldKey of ['amount', 'hidden_money', 'quantity']) {
          schema.fields.push({
            ...schema.fields[0],
            id: randomUUID(),
            fieldKey,
            label: fieldKey,
            type: fieldKey === 'quantity' ? 'NUMBER' : 'MONEY',
            required: false,
            defaultValue: null,
            validation: { scale: 2 },
            config: {},
          });
          schema.employeeAccess.fields[fieldKey] =
            fieldKey === 'hidden_money' ? 'HIDDEN' : 'EDIT';
        }
        schema.employeeAccess.canCreate = true;
      });
    }
    // These numeric JSON tokens must never pass through JavaScript numbers.
    await h.adminDatabase.$executeRaw`
      UPDATE records SET data = data ||
        '{"amount":100000000000000.01,"hidden_money":9007199254740993,"retired_money":9007199254740993,"quantity":10}'::jsonb
      WHERE id = ${f.ownedRecord.id}::uuid
    `;
    await h.adminDatabase.$executeRaw`
      UPDATE records SET data = data || '{"amount":9007199254740993,"quantity":2}'::jsonb
      WHERE id = ${f.otherRecord.id}::uuid
    `;
  });

  afterAll(async () => {
    if (h) {
      await cleanupAutomations();
      await closeCriticalHarness(h);
    }
  });

  async function cleanupAutomations() {
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_automation_executions WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('critical-a','critical-b'))`;
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_relations WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('critical-a','critical-b'))`;
  }

  const path = () =>
    `/api/v1/workspaces/critical-a/objects/leads/records/${f.ownedRecord.id}`;
  const api = (
    method: 'get' | 'post' | 'patch',
    url: string,
    body?: object,
    cookie = f.admin.cookie,
  ) => {
    const call = request(h.app.getHttpServer())
      [method](url)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000');
    return body ? call.send(body) : call;
  };

  async function republish(
    objectId: string,
    edit: (schema: PublishedObjectSchema) => void,
  ) {
    const object = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: objectId },
      include: { activePublication: true },
    });
    const schema = structuredClone(
      object.activePublication!.configuration,
    ) as unknown as PublishedObjectSchema;
    edit(schema);
    schema.publication = {
      id: randomUUID(),
      number: schema.publication.number + 1,
      sourceDraftVersion: object.version,
      publishedAt: new Date().toISOString(),
    };
    await h.adminDatabase.objectPublication.create({
      data: {
        id: schema.publication.id,
        tenantId: f.tenantA.id,
        objectId,
        publicationNo: schema.publication.number,
        sourceDraftVersion: object.version,
        configuration: schema as unknown as Prisma.InputJsonValue,
        changeSummary: [],
        publishedByMemberId: f.admin.memberId,
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: objectId },
      data: { activePublicationId: schema.publication.id },
    });
  }

  async function storedMoney() {
    return h.adminDatabase.$queryRaw<
      Array<{ amount: string; hidden: string; retired: string; kind: string }>
    >`
      SELECT data ->> 'amount' AS amount, data ->> 'hidden_money' AS hidden,
        data ->> 'retired_money' AS retired, jsonb_typeof(data -> 'amount') AS kind
      FROM records WHERE id = ${f.ownedRecord.id}::uuid
    `;
  }

  async function setRule(trigger: AutomationRule['trigger']) {
    await republish(f.object.id, (schema) => {
      schema.automations = [
        {
          key: 'copy-money',
          label: '复制金额',
          enabled: true,
          allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
          trigger,
          targetObjectCode: 'invoices',
          owner: 'ACTOR',
          mappings: {
            name: { source: 'SOURCE_FIELD', fieldKey: 'name' },
            amount: { source: 'SOURCE_FIELD', fieldKey: 'amount' },
          },
        },
      ];
    });
  }

  it('reads exact decimal text in details and both list sorting paths without modifying storage', async () => {
    const before = await storedMoney();
    const detail = await api(
      'get',
      path(),
      undefined,
      f.employee.cookie,
    ).expect(200);
    const detailBody = detail.body as { values: Record<string, unknown> };
    expect(detailBody.values.amount).toBe('100000000000000.01');
    expect(detailBody.values).not.toHaveProperty('hidden_money');
    expect(detailBody.values).not.toHaveProperty('retired_money');
    for (const sort of ['updatedAt', 'name']) {
      const result = await api(
        'get',
        `/api/v1/workspaces/critical-a/objects/leads/records?sort=${sort}`,
      ).expect(200);
      const resultBody = result.body as {
        items: { values: { amount?: string } }[];
      };
      const values = resultBody.items.map((item) => item.values.amount);
      expect(values).toContain('100000000000000.01');
      expect(values).toContain('9007199254740993.00');
    }
    expect(await storedMoney()).toEqual(before);
  });

  it.each(['amount', 'quantity'])(
    'sorts %s numerically in ascending and descending order',
    async (fieldKey) => {
      const ascending =
        fieldKey === 'amount'
          ? [f.ownedRecord.id, f.otherRecord.id]
          : [f.otherRecord.id, f.ownedRecord.id];
      for (const direction of ['asc', 'desc']) {
        const response = await api(
          'get',
          `/api/v1/workspaces/critical-a/objects/leads/records?sort=${fieldKey}&direction=${direction}`,
        ).expect(200);
        const body = response.body as {
          items: { id: string; values: Record<string, unknown> }[];
        };
        expect(body.items.slice(0, 2).map((item) => item.id)).toEqual(
          direction === 'asc' ? ascending : [...ascending].reverse(),
        );
        expect(
          body.items
            .slice(0, 2)
            .every((item) => typeof item.values.quantity === 'number'),
        ).toBe(true);
        expect(body.items[2].values).not.toHaveProperty(fieldKey);
      }
    },
  );

  it.each([
    ['amount', 'updatedAt'],
    ['amount', 'amount'],
    ['quantity', 'updatedAt'],
    ['quantity', 'quantity'],
  ])(
    'filters the %s numeric range when sorting by %s',
    async (fieldKey, sort) => {
      const filters = JSON.stringify({
        [fieldKey]:
          fieldKey === 'amount'
            ? { min: 100000000000000, max: 200000000000000 }
            : { min: 5, max: 10 },
      });
      const response = await api(
        'get',
        `/api/v1/workspaces/critical-a/objects/leads/records?sort=${sort}&filters=${encodeURIComponent(filters)}`,
      ).expect(200);
      const body = response.body as { items: { id: string }[]; total: number };
      expect(body.items.map((item) => item.id)).toEqual([f.ownedRecord.id]);
      expect(body.total).toBe(1);
    },
  );

  it.each(['empty', 'not_empty'])(
    'filters %s monetary values with the default system sort',
    async (presence) => {
      const filters = encodeURIComponent(
        JSON.stringify({ amount: { presence } }),
      );
      const response = await api(
        'get',
        `/api/v1/workspaces/critical-a/objects/leads/records?filters=${filters}`,
      ).expect(200);
      const body = response.body as { items: { id: string }[]; total: number };
      const expected =
        presence === 'empty'
          ? [f.workflowRecord.id]
          : [f.ownedRecord.id, f.otherRecord.id];
      expect(body.items.map((item) => item.id).sort()).toEqual(expected.sort());
      expect(body.total).toBe(expected.length);
    },
  );

  it('preserves exact amounts including hidden and retired fields when another field is saved', async () => {
    await api(
      'patch',
      path(),
      { version: 1, values: { name: 'updated' } },
      f.employee.cookie,
    ).expect(200);
    expect(await storedMoney()).toEqual([
      {
        amount: '100000000000000.01',
        hidden: '9007199254740993',
        retired: '9007199254740993',
        kind: 'string',
      },
    ]);
  });

  it('keeps exact amounts in automation preview and its locked execution snapshot', async () => {
    await setRule({ type: 'MANUAL' });
    const before = await storedMoney();
    const preview = await api(
      'post',
      `${path()}/automations/copy-money/preview`,
      { inputs: {} },
    ).expect(201);
    const previewBody = preview.body as { values: Record<string, unknown> };
    expect(previewBody.values.amount).toBe('100000000000000.01');
    expect(await storedMoney()).toEqual(before);
    await api('post', `${path()}/automations/copy-money/execute`, {
      expectedVersion: 1,
      requestId: randomUUID(),
      inputs: {},
    }).expect(201);
    const target = await h.adminDatabase.record.findFirstOrThrow({
      where: { objectId: f.rollbackTargetObject.id },
    });
    expect(target.data).toMatchObject({ amount: '100000000000000.01' });
    // Manual execution already writes the source to advance its version.
    expect(await storedMoney()).toEqual([{ ...before[0], kind: 'string' }]);
  });

  it('keeps exact amounts in the post-update snapshot used by field automations', async () => {
    await setRule({ type: 'FIELD_CHANGED', fieldKey: 'name', equals: 'won' });
    await api('patch', path(), { version: 1, values: { name: 'won' } }).expect(
      200,
    );
    const target = await h.adminDatabase.record.findFirstOrThrow({
      where: { objectId: f.rollbackTargetObject.id },
    });
    expect(target.data).toMatchObject({ amount: '100000000000000.01' });
  });

  it('does not mix a record version with monetary values from a later read', async () => {
    await expect(
      records.withTenantTransaction(context, async ({ tx, store }) => {
        const read = tx.record.findFirst.bind(tx.record);
        const concurrentRead = async (...args: Parameters<typeof read>) => {
          const row = await read(...args);
          await h.adminDatabase.record.update({
            where: { id: f.ownedRecord.id },
            data: { version: { increment: 1 } },
          });
          return row;
        };
        const spy = jest
          .spyOn(tx.record, 'findFirst')
          .mockImplementationOnce(concurrentRead as typeof tx.record.findFirst);
        try {
          return await store.findRecord(f.object.id, f.ownedRecord.id);
        } finally {
          spy.mockRestore();
        }
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
  });

  it.each(['field sort', 'numeric range', 'presence filter'] as const)(
    'rejects a record transferred after the SQL page selection (%s)',
    async (mode) => {
      const employeeContext: TenantContext = {
        ...context,
        userId: f.employee.userId,
        memberId: f.employee.memberId,
        role: 'EMPLOYEE',
      };
      const query: RecordListQuery = {
        objectId: f.object.id,
        ownerMemberId: f.employee.memberId,
        page: 1,
        limit: 100,
        searchFieldKeys: [],
        direction: 'asc',
        sort:
          mode === 'field sort'
            ? { fieldKey: 'amount', kind: 'NUMBER' }
            : 'updatedAt',
        filters:
          mode === 'numeric range'
            ? [{ fieldKey: 'amount', mode: 'NUMBER_RANGE', min: 1 }]
            : mode === 'presence filter'
              ? [{ fieldKey: 'amount', mode: 'NOT_EMPTY' }]
              : [],
      };
      await expect(
        records.withTenantTransaction(
          employeeContext,
          async ({ tx, store }) => {
            // The SQL page has already selected IDs; transfer before loading those
            // records, so the old employee must never receive the new owner's data.
            const read = tx.record.findMany.bind(tx.record);
            const transferredRead = async (
              ...args: Parameters<typeof read>
            ) => {
              await h.adminDatabase.record.update({
                where: { id: f.ownedRecord.id },
                data: {
                  ownerMemberId: f.otherEmployee.memberId,
                  version: { increment: 1 },
                  title: 'New owner confidential data',
                  data: {
                    name: 'New owner confidential data',
                    amount: '19.99',
                  },
                },
              });
              return read(...args);
            };
            const spy = jest
              .spyOn(tx.record, 'findMany')
              .mockImplementationOnce(
                transferredRead as typeof tx.record.findMany,
              );
            try {
              return await store.listRecords(query);
            } finally {
              spy.mockRestore();
            }
          },
        ),
      ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
    },
  );

  it('rejects a concurrently changed list row instead of falling back to rounded values', async () => {
    await expect(
      records.withTenantTransaction(context, async ({ tx, store }) => {
        const read = tx.record.findMany.bind(tx.record);
        const concurrentRead = async (...args: Parameters<typeof read>) => {
          const rows = await read(...args);
          await h.adminDatabase.record.update({
            where: { id: f.ownedRecord.id },
            data: { version: { increment: 1 } },
          });
          return rows;
        };
        const spy = jest
          .spyOn(tx.record, 'findMany')
          .mockImplementationOnce(concurrentRead as typeof tx.record.findMany);
        try {
          return await store.listRecords({
            objectId: f.object.id,
            page: 1,
            limit: 100,
            searchFieldKeys: [],
            filters: [],
            sort: 'updatedAt',
            direction: 'asc',
          });
        } finally {
          spy.mockRestore();
        }
      }),
    ).rejects.toMatchObject({ code: 'RECORD_VERSION_CONFLICT' });
  });
});
