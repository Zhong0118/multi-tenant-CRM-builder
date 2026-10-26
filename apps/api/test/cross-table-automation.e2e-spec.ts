import { AiProposalService } from '../src/modules/ai/ai-proposal.service';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Prisma } from '@crm/database';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import type {
  AutomationStatsDto,
  AutomationStatsEventsDto,
} from '../src/modules/automations/automation.dto';
import type { AutomationRule } from '../src/modules/automations/automation.types';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';
import { RECORDS_REPOSITORY } from '../src/modules/records/records.service';
import type { RecordsRepository } from '../src/modules/records/records.repository';
import { updateRecordCommand } from '../src/modules/records/record-command';
import { resolvePublishedObjectInTransaction } from '../src/modules/objects/published-object-transaction';
import { readAutomationStatsEvents } from '../src/modules/automations/automation-stats';

jest.setTimeout(90000);
const baseRule: AutomationRule = {
  key: 'create-order',
  label: '确认开单',
  enabled: true,
  allowedRoles: ['TENANT_ADMIN', 'EMPLOYEE'],
  trigger: { type: 'FIELD_CHANGED', fieldKey: 'name', equals: 'won' },
  targetObjectCode: 'invoices',
  owner: 'ACTOR',
  mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
};
describe('cross-table automation (real PostgreSQL)', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  beforeAll(async () => {
    h = await createCriticalHarness();
  });
  async function cleanExtras() {
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_automation_executions WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('critical-a','critical-b'))`;
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_relations WHERE tenant_id IN (SELECT id FROM tenants WHERE code IN ('critical-a','critical-b'))`;
  }
  beforeEach(async () => {
    await cleanExtras();
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    await cleanExtras();
    await closeCriticalHarness(h);
  });
  const path = (id?: string) =>
    `/api/v1/workspaces/critical-a/objects/leads/records/${id ?? f.ownedRecord.id}`;
  function api(
    method: 'get' | 'post' | 'patch' | 'put',
    url: string,
    body?: unknown,
    cookie = f.admin.cookie,
  ) {
    const req = request(h.app.getHttpServer())
      [method](url)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000');
    return (body === undefined ? req : req.send(body as object)).then(
      (response) => ({
        status: response.status,
        body: response.body as {
          items?: unknown[];
          values?: Record<string, unknown>;
          fieldLabels?: Record<string, string>;
          id?: string;
          targetRecordId?: string;
          publishedRules?: unknown[];
        },
      }),
    );
  }
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
    return schema;
  }
  async function rules(rules: AutomationRule[] = [baseRule]) {
    return republish(f.object.id, (schema) => {
      schema.automations = rules;
    });
  }
  const targets = () =>
    h.adminDatabase.record.count({
      where: { objectId: f.rollbackTargetObject.id },
    });
  const executions = () =>
    h.adminDatabase.recordAutomationExecution.count({
      where: { tenantId: f.tenantA.id },
    });
  const source = () =>
    h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
  async function snapshot() {
    return {
      records: await targets(),
      history: await executions(),
      counter: await h.adminDatabase.recordCounter.findMany({
        where: { tenantId: f.tenantA.id },
      }),
      audits: await h.adminDatabase.auditLog.count({
        where: {
          tenantId: f.tenantA.id,
          action: { not: 'automation.execution_failed' },
        },
      }),
    };
  }
  const statsPath = (objectId = f.object.id) =>
    `/api/v1/workspaces/critical-a/object-definitions/${objectId}/automations/stats`;
  const stats = async <T = AutomationStatsDto>(
    suffix = '',
    cookie = f.admin.cookie,
  ) => {
    const response = await request(h.app.getHttpServer())
      .get(`${statsPath()}${suffix}`)
      .set('Cookie', cookie);
    return { status: response.status, body: response.body as T };
  };
  async function pendingFailure(publicationId: string) {
    let release!: () => void;
    let inserted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const pending = h.adminDatabase.$transaction(
      async (tx) => {
        await tx.auditLog.create({
          data: {
            tenantId: f.tenantA.id,
            actorType: 'USER',
            actorId: f.admin.userId,
            action: 'automation.execution_failed',
            resourceType: 'record',
            resourceId: f.ownedRecord.id,
            after: {
              ruleKey: 'create-order',
              publicationId,
              code: 'FIELD_REQUIRED',
            },
            requestId: randomUUID(),
          },
        });
        inserted();
        await gate;
      },
      { timeout: 15000 },
    );
    await Promise.race([ready, pending]);
    return async () => {
      release();
      await pending;
    };
  }

  it('does not repeat earlier rows when a pre-window-end transaction commits between pages', async () => {
    const publication = await rules();
    await h.adminDatabase.auditLog.createMany({
      data: Array.from({ length: 21 }, () => ({
        tenantId: f.tenantA.id,
        actorType: 'USER' as const,
        actorId: f.admin.userId,
        action: 'automation.execution_failed',
        resourceType: 'record',
        resourceId: f.ownedRecord.id,
        after: {
          ruleKey: 'create-order',
          publicationId: publication.publication.id,
          code: 'FIELD_REQUIRED',
        },
        requestId: randomUUID(),
        createdAt: new Date(Date.now() - 10000),
      })),
    });
    const original = await h.adminDatabase.auditLog.findMany({
      where: { tenantId: f.tenantA.id, action: 'automation.execution_failed' },
      select: { id: true },
    });
    const commit = await pendingFailure(publication.publication.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const until = new Date().toISOString();
      const first = await stats<AutomationStatsEventsDto>(
        `/create-order/events?until=${until}&status=FAILED`,
      );
      expect(first.body.total).toBe(21);
      await commit();
      const second = await stats<AutomationStatsEventsDto>(
        `/create-order/events?until=${until}&status=FAILED&cursor=${first.body.nextCursor}`,
      );
      expect(second.body.total).toBe(22);
      const firstIds = new Set(first.body.items.map((item) => item.id));
      expect(second.body.items.filter((item) => firstIds.has(item.id))).toEqual(
        [],
      );
      expect(second.body.items).toHaveLength(1);
      expect(
        new Set(
          [...first.body.items, ...second.body.items].map((item) => item.id),
        ),
      ).toEqual(new Set(original.map((item) => item.id)));
    } finally {
      await commit();
    }
  });

  it('counts and reads one statement snapshot when another transaction commits after the first read', async () => {
    const publication = await rules();
    await h.adminDatabase.auditLog.create({
      data: {
        tenantId: f.tenantA.id,
        actorType: 'USER',
        actorId: f.admin.userId,
        action: 'automation.execution_failed',
        resourceType: 'record',
        resourceId: f.ownedRecord.id,
        after: {
          ruleKey: 'create-order',
          publicationId: publication.publication.id,
          code: 'FIELD_REQUIRED',
        },
        requestId: randomUUID(),
      },
    });
    const commit = await pendingFailure(publication.publication.id);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const until = new Date().toISOString();
      const context = {
        userId: f.admin.userId,
        memberId: f.admin.memberId,
        role: 'TENANT_ADMIN' as const,
        tenantId: f.tenantA.id,
        tenantCode: 'critical-a',
      };
      const repository = h.app.get<RecordsRepository>(RECORDS_REPOSITORY);
      const result = await repository.withTenantTransaction(
        context,
        async ({ tx }) => {
          // Every query still executes against PostgreSQL. Only schedule the writer
          // after the first read, exposing a second SQL statement's newer snapshot.
          const transaction = new Proxy(tx, {
            get(target, property, receiver) {
              if (property !== '$queryRaw')
                return Reflect.get(target, property, receiver) as unknown;
              return async (...args: Parameters<typeof tx.$queryRaw>) => {
                const rows = await tx.$queryRaw(...args);
                await commit();
                return rows;
              };
            },
          });
          return readAutomationStatsEvents(
            transaction,
            context,
            f.object.id,
            'create-order',
            { days: 30, until, status: 'FAILED' },
          );
        },
      );
      expect(result.items).toHaveLength(result.total);
      expect(result.total).toBe(1);
      expect(
        (
          await stats<AutomationStatsEventsDto>(
            `/create-order/events?until=${until}&status=FAILED`,
          )
        ).body.total,
      ).toBe(2);
    } finally {
      await commit();
    }
  });

  it('counts committed successes, rolled-back failures and both dedup paths without executing from statistics', async () => {
    await rules([
      { ...baseRule, trigger: { type: 'MANUAL' } },
      { ...baseRule, key: 'never-run', label: '尚未执行' },
    ]);
    const executionPath = `${path()}/automations/create-order/execute`;
    const input = { expectedVersion: 1, requestId: randomUUID(), inputs: {} };
    expect((await api('post', executionPath, input)).status).toBe(201);
    expect((await api('post', executionPath, input)).status).toBe(201);
    // A denied outer request and a preview are not execution attempts.
    expect(
      (await api('post', executionPath, { ...input, requestId: randomUUID() }))
        .status,
    ).toBe(409);
    expect(
      (
        await api('post', `${path()}/automations/create-order/preview`, {
          inputs: {},
        })
      ).status,
    ).toBe(201);
    await rules([
      { ...baseRule, mappings: {} },
      { ...baseRule, key: 'never-run', label: '尚未执行', enabled: false },
    ]);
    expect(
      (await api('patch', path(), { version: 2, values: { name: 'won' } }))
        .status,
    ).toBe(400);
    expect((await source()).version).toBe(2);
    await rules([
      { ...baseRule, label: '生效名称' },
      { ...baseRule, key: 'never-run', label: '尚未执行', enabled: false },
    ]);
    expect(
      (await api('patch', path(), { version: 2, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    expect(
      (await api('patch', path(), { version: 3, values: { name: 'reset' } }))
        .status,
    ).toBe(200);
    expect(
      (await api('patch', path(), { version: 4, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    const before = await snapshot();
    await h.adminDatabase.tenant.update({
      where: { id: f.tenantA.id },
      data: { timezone: 'America/New_York' },
    });
    const response = await stats();
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      days: 30,
      timezone: 'America/New_York',
      deduplicationCoverage: 'SINCE_INSTRUMENTATION',
      totals: { succeeded: 2, failed: 1, deduplicated: 2 },
      items: expect.arrayContaining([
        expect.objectContaining({
          ruleKey: 'create-order',
          ruleLabel: '生效名称',
          succeeded: 2,
          failed: 1,
          deduplicated: 2,
          current: true,
        }),
        expect.objectContaining({
          ruleKey: 'never-run',
          succeeded: 0,
          failed: 0,
          deduplicated: 0,
          lastExecutedAt: null,
        }),
      ]) as unknown,
    });
    expect(await snapshot()).toEqual(before);
    expect(await targets()).toBe(2);
    const failures = await stats<AutomationStatsEventsDto>(
      '/create-order/events?status=FAILED',
    );
    expect(failures.status).toBe(200);
    expect(failures.body).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          status: 'FAILED',
          errorCode: 'FIELD_REQUIRED',
          errorMessage: expect.any(String) as unknown,
        }) as unknown,
      ],
    });
    expect(JSON.stringify(failures.body)).not.toContain('won');
    expect(JSON.stringify(failures.body)).not.toContain('dedupKey');
    await rules([]);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { status: 'ARCHIVED' },
    });
    const historical = await stats();
    expect(historical.status).toBe(200);
    expect(historical.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleKey: 'create-order',
          current: false,
          succeeded: 2,
        }),
      ]),
    );
    const events = await stats<AutomationStatsEventsDto>(
      '/create-order/events',
    );
    expect(events.status).toBe(200);
    expect(events.body.items).toHaveLength(5);
    expect(
      events.body.items.every(
        (item: { sourceAvailable: boolean }) => !item.sourceAvailable,
      ),
    ).toBe(true);
  });

  it('scopes identical rule keys by publication tenant and source object and rejects non-admin or malformed queries', async () => {
    const publication = await rules([{ ...baseRule, mappings: {} }]);
    const other = await republish(f.rollbackObject.id, (schema) => {
      schema.automations = [{ ...baseRule, label: '另一张表' }];
    });
    const audit = (tenantId: string, publicationId: string) =>
      h.adminDatabase.auditLog.create({
        data: {
          tenantId,
          actorType: 'USER',
          actorId: f.admin.userId,
          action: 'automation.execution_failed',
          resourceType: 'record',
          resourceId: f.ownedRecord.id,
          after: {
            ruleKey: 'create-order',
            publicationId,
            code: 'FIELD_REQUIRED',
          },
          requestId: randomUUID(),
        },
      });
    await audit(f.tenantA.id, other.publication.id);
    await audit(f.tenantB.id, publication.publication.id);
    expect((await stats()).body.totals).toEqual({
      succeeded: 0,
      failed: 0,
      deduplicated: 0,
    });
    expect((await stats('', f.employee.cookie)).status).toBe(403);
    expect(
      (await stats('/create-order/events', f.employee.cookie)).status,
    ).toBe(403);
    expect((await stats('', f.tenantBAdmin.cookie)).status).toBe(403);
    expect((await api('get', statsPath(randomUUID()))).status).toBe(404);
    expect((await api('get', statsPath('not-uuid'))).status).toBe(400);
    for (const suffix of [
      '?days=1',
      '?days=91',
      '/create-order/events?cursor=!',
      '/create-order/events?cursor=invalid',
      `/create-order/events?cursor=${'a'.repeat(513)}`,
      '/create-order/events?status=UNKNOWN',
      '/bad_key/events',
      '?until=not-date',
      '?until=2099-01-01T00:00:00.000Z',
      `?until=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}`,
      `?until=${new Date(Date.now() - 86400000).toISOString().slice(0, -1)}`,
    ]) {
      expect((await stats(suffix)).status).toBe(400);
    }
  });

  it('paginates a stable filtered timeline and uses inclusive start, exclusive end rolling windows', async () => {
    const publication = await rules();
    const until = new Date(Date.now() - 1000);
    const start = new Date(until.getTime() - 7 * 86400000);
    for (let index = 0; index < 23; index++) {
      await h.adminDatabase.auditLog.create({
        data: {
          tenantId: f.tenantA.id,
          actorType: 'USER',
          actorId: f.admin.userId,
          action: 'automation.execution_failed',
          resourceType: 'record',
          resourceId: f.ownedRecord.id,
          after: {
            ruleKey: 'create-order',
            publicationId: publication.publication.id,
            code: index === 0 ? 'private raw failure' : 'FIELD_REQUIRED',
            message: 'PRIVATE_VALUE',
          },
          requestId: randomUUID(),
          createdAt:
            index === 21
              ? until
              : index === 22
                ? new Date(start.getTime() - 1)
                : start,
        },
      });
    }
    const query = `days=7&until=${until.toISOString()}`;
    const summary = await stats(`?${query}`);
    expect(summary.status).toBe(200);
    expect(summary.body.totals).toEqual({
      succeeded: 0,
      failed: 21,
      deduplicated: 0,
    });
    const first = await stats<AutomationStatsEventsDto>(
      `/create-order/events?${query}&status=FAILED`,
    );
    const repeated = await stats<AutomationStatsEventsDto>(
      `/create-order/events?${query}&status=FAILED`,
    );
    const second = await stats<AutomationStatsEventsDto>(
      `/create-order/events?${query}&status=FAILED&cursor=${first.body.nextCursor}`,
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      total: 21,
      pageSize: 20,
      until: until.toISOString(),
    });
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(second.body.nextCursor).toBeNull();
    expect(first.body.items).toHaveLength(20);
    expect(second.body.items).toHaveLength(1);
    expect(first.body.items).toEqual(repeated.body.items);
    const ids = [...first.body.items, ...second.body.items].map(
      (item: { id: string }) => item.id,
    );
    expect(new Set(ids).size).toBe(21);
    expect(JSON.stringify([first.body, second.body])).not.toMatch(
      /PRIVATE_VALUE|private raw failure/,
    );
    const empty = await stats<AutomationStatsEventsDto>(
      `/create-order/events?${query}&status=SUCCEEDED`,
    );
    expect(empty.body).toMatchObject({ total: 0, items: [] });
    const cursor = first.body.nextCursor!;
    for (const suffix of [
      `/create-order/events?${query}&status=SUCCEEDED&cursor=${cursor}`,
      `/create-order/events?days=30&until=${until.toISOString()}&status=FAILED&cursor=${cursor}`,
      `/create-order/events?days=7&until=${new Date(until.getTime() - 1).toISOString()}&status=FAILED&cursor=${cursor}`,
      `/another-rule/events?${query}&status=FAILED&cursor=${cursor}`,
      `/create-order/events?days=7&status=FAILED&cursor=${cursor}`,
    ])
      expect((await stats(suffix)).status).toBe(400);
    expect(
      (
        await api(
          'get',
          `${statsPath(f.rollbackObject.id)}/create-order/events?${query}&status=FAILED&cursor=${cursor}`,
        )
      ).status,
    ).toBe(400);
    const decoded = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    for (const value of [
      null,
      { ...decoded, at: 'not-a-date' },
      { ...decoded, id: 'not-a-uuid' },
      { ...decoded, status: 'PRIVATE_ERROR' },
    ]) {
      const invalid = Buffer.from(JSON.stringify(value)).toString('base64url');
      expect(
        (
          await stats(
            `/create-order/events?${query}&status=FAILED&cursor=${invalid}`,
          )
        ).status,
      ).toBe(400);
    }
  });
  it('fires once on crossing, deduplicates across reset and republish, and preserves source snapshots', async () => {
    await rules();
    expect(
      (await api('patch', path(), { version: 1, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    expect(await targets()).toBe(1);
    expect(await executions()).toBe(1);
    expect(
      (await api('patch', path(), { version: 2, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    await rules([{ ...baseRule, label: '新名称' }]);
    expect(
      (await api('patch', path(), { version: 3, values: { name: 'reset' } }))
        .status,
    ).toBe(200);
    expect(
      (await api('patch', path(), { version: 4, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    expect(await targets()).toBe(1);
    expect(
      (
        await h.adminDatabase.record.findFirstOrThrow({
          where: { objectId: f.rollbackTargetObject.id },
        })
      ).data,
    ).toEqual({ name: 'won' });
    expect(
      (await api('get', `${path()}/automations/history`)).body.items,
    ).toHaveLength(1);
  });
  it.each(['MANUAL', 'FIELD_CHANGED'] as const)(
    'initializes the target pool lease for %s automation-created records',
    async (triggerType) => {
      await h.adminDatabase.objectDefinition.update({
        where: { id: f.rollbackTargetObject.id },
        data: {
          poolEnabled: true,
          poolLifecycleEnabled: true,
          poolContactTtlHours: 12,
        },
      });
      await rules([
        {
          ...baseRule,
          trigger:
            triggerType === 'MANUAL' ? { type: 'MANUAL' } : baseRule.trigger,
        },
      ]);
      const before = Date.now();
      const response =
        triggerType === 'MANUAL'
          ? await api('post', `${path()}/automations/create-order/execute`, {
              expectedVersion: 1,
              requestId: randomUUID(),
              inputs: {},
            })
          : await api('patch', path(), { version: 1, values: { name: 'won' } });
      expect(response.status).toBe(triggerType === 'MANUAL' ? 201 : 200);
      const created = await h.adminDatabase.record.findFirstOrThrow({
        where: { objectId: f.rollbackTargetObject.id },
      });
      expect(created).toMatchObject({
        ownerMemberId: f.admin.memberId,
        poolStage: 'PENDING_CONTACT',
        poolOrigin: 'LEAD_POOL',
        inPublicPool: false,
      });
      expect(created.poolClaimedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(
        created.ownershipExpiresAt!.getTime() -
          created.poolClaimedAt!.getTime(),
      ).toBe(12 * 60 * 60 * 1000);
      expect(await executions()).toBe(1);
    },
  );
  it('reads and maps legacy numeric money without rewriting the source, then saves it through normal validation', async () => {
    for (const objectId of [f.object.id, f.rollbackTargetObject.id]) {
      await h.adminDatabase.fieldDefinition.create({
        data: {
          tenantId: f.tenantA.id,
          objectId,
          fieldKey: 'amount',
          label: '金额',
          type: 'MONEY',
          validation: { scale: 2 },
        },
      });
      await republish(objectId, (schema) => {
        schema.fields.push({
          ...schema.fields[0],
          id: randomUUID(),
          fieldKey: 'amount',
          label: '金额',
          type: 'MONEY',
          required: false,
          defaultValue: null,
          validation: { scale: 2 },
          config: {},
        });
        schema.employeeAccess.fields.amount = 'EDIT';
        schema.employeeAccess.canCreate = true;
      });
    }
    await rules([
      {
        ...baseRule,
        trigger: { type: 'MANUAL' },
        mappings: {
          name: { source: 'SOURCE_FIELD', fieldKey: 'name' },
          amount: { source: 'SOURCE_FIELD', fieldKey: 'amount' },
        },
      },
    ]);
    const row = await source();
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: { data: { ...(row.data as object), amount: 71000 } },
    });
    const before = await source();
    const read = await api('get', path(), undefined, f.employee.cookie);
    expect(read.status).toBe(200);
    expect(read.body.values?.amount).toBe('71000.00');
    expect(await source()).toEqual(before);
    const preview = await api(
      'post',
      `${path()}/automations/create-order/preview`,
      { inputs: {} },
      f.employee.cookie,
    );
    expect(preview.status).toBe(201);
    expect(preview.body.values?.amount).toBe('71000.00');
    expect(await source()).toEqual(before);
    const execution = await api(
      'post',
      `${path()}/automations/create-order/execute`,
      {
        expectedVersion: before.version,
        requestId: randomUUID(),
        inputs: {},
      },
      f.employee.cookie,
    );
    expect(execution.status).toBe(201);
    const created = await h.adminDatabase.record.findFirstOrThrow({
      where: { objectId: f.rollbackTargetObject.id },
    });
    expect((created.data as Record<string, unknown>).amount).toBe('71000.00');
    // Execution already writes the source version; that normal save also
    // normalizes the legacy amount representation without changing its value.
    const unchanged = await source();
    expect((unchanged.data as Record<string, unknown>).amount).toBe('71000');
    const saved = await api(
      'patch',
      path(),
      { version: unchanged.version, values: { amount: '71000.00' } },
      f.employee.cookie,
    );
    expect(saved.status).toBe(200);
    expect((await source()).data).toMatchObject({ amount: '71000.00' });
  });

  it('does not trigger for historical matches, create, or imports', async () => {
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { data: { name: 'won' }, title: 'won' },
    });
    await rules();
    expect(
      (await api('patch', path(), { version: 1, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    expect(
      (
        await api(
          'post',
          '/api/v1/workspaces/critical-a/objects/leads/records',
          { values: { name: 'won' } },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await api(
          'post',
          '/api/v1/workspaces/critical-a/objects/leads/records/import',
          { rows: [{ rowNumber: 2, values: { name: 'won' } }] },
        )
      ).status,
    ).toBe(201);
    expect(await targets()).toBe(0);
  });
  it('rolls back the source and all effects when a target required field is missing', async () => {
    await rules([{ ...baseRule, mappings: {} }]);
    const before = await source();
    const counts = await snapshot();
    expect(
      (await api('patch', path(), { version: 1, values: { name: 'won' } }))
        .status,
    ).toBe(400);
    expect(await source()).toEqual(before);
    expect(await snapshot()).toEqual(counts);
    const failure = await h.adminDatabase.auditLog.findFirstOrThrow({
      where: { tenantId: f.tenantA.id, action: 'automation.execution_failed' },
    });
    expect(failure.after).toMatchObject({
      ruleKey: 'create-order',
      sourceVersion: 1,
      code: 'FIELD_REQUIRED',
    });
    expect(JSON.stringify(failure.after)).not.toContain('won');
  });
  it('rolls back denied target creation and denies cross-tenant records', async () => {
    await rules();
    const before = await source();
    expect(
      (
        await api(
          'patch',
          path(),
          { version: 1, values: { name: 'won' } },
          f.employee.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await source()).toEqual(before);
    expect(await targets()).toBe(0);
    expect(
      (
        await api(
          'get',
          `${path()}/automations`,
          undefined,
          f.tenantBAdmin.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (await api('patch', path(), { version: 1, values: { name: 'won' } }))
        .status,
    ).toBe(200);
    expect(await executions()).toBe(1);
    const rows = await h.runtimeDatabase.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${f.tenantB.id}, true)`;
      return tx.$queryRaw`SELECT * FROM record_automation_executions WHERE tenant_id = ${f.tenantA.id}::uuid`;
    });
    expect(rows).toEqual([]);
  });
  it('previews with no writes, rejects missing inputs, and supports idempotent concurrent manual requests and additional orders', async () => {
    await rules([
      {
        ...baseRule,
        trigger: { type: 'MANUAL' },
        mappings: { name: { source: 'INPUT' } },
      },
    ]);
    const url = `${path()}/automations/create-order`;
    const before = await snapshot();
    expect((await api('post', `${url}/preview`, { inputs: {} })).status).toBe(
      400,
    );
    const preview = await api('post', `${url}/preview`, {
      inputs: { name: '订单一' },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.values).toEqual({ name: '订单一' });
    expect(await snapshot()).toEqual(before);
    const input = {
      expectedVersion: 1,
      requestId: randomUUID(),
      inputs: { name: '订单一' },
    };
    const [a, b] = await Promise.all([
      api('post', `${url}/execute`, input),
      api('post', `${url}/execute`, input),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await targets()).toBe(1);
    expect(
      (
        await api('post', `${url}/execute`, {
          ...input,
          requestId: randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api('post', `${url}/execute`, {
          ...input,
          expectedVersion: 2,
          requestId: randomUUID(),
          inputs: { name: '订单二' },
        })
      ).status,
    ).toBe(201);
    expect(await targets()).toBe(2);
    expect(await executions()).toBe(2);
    expect(
      (
        await api('post', `${url}/execute`, {
          ...input,
          requestId: randomUUID(),
          expectedVersion: 999,
        })
      ).status,
    ).toBe(409);
  });
  it('validates multi-select option keys and does not recursively execute target rules', async () => {
    await republish(f.rollbackTargetObject.id, (schema) => {
      schema.fields.push({
        ...schema.fields[0],
        id: randomUUID(),
        fieldKey: 'tags',
        label: '标签',
        type: 'MULTI_SELECT',
        required: false,
        config: { options: [{ key: 'a', label: 'A', isActive: true }] },
      });
      schema.employeeAccess.fields.tags = 'EDIT';
      schema.automations = [
        {
          ...baseRule,
          targetObjectCode: 'leads',
          trigger: { type: 'FIELD_CHANGED', fieldKey: 'name', equals: 'won' },
        },
      ];
    });
    await rules([
      {
        ...baseRule,
        trigger: { type: 'MANUAL' },
        mappings: {
          name: { source: 'LITERAL', value: 'won' },
          tags: { source: 'INPUT' },
        },
      },
    ]);
    const url = `${path()}/automations/create-order/execute`;
    expect(
      (
        await api('post', url, {
          expectedVersion: 1,
          requestId: randomUUID(),
          inputs: { tags: ['bad'] },
        })
      ).status,
    ).toBe(400);
    const response = await api('post', url, {
      expectedVersion: 1,
      requestId: randomUUID(),
      inputs: { tags: ['a'] },
    });
    expect(response.status).toBe(201);
    expect(await targets()).toBe(1);
    expect(await executions()).toBe(1);
  });
  it('isolates batch failures with savepoints and shares the command used by AI updates', async () => {
    await republish(f.object.id, (schema) => {
      schema.fields.push({
        ...schema.fields[1],
        id: randomUUID(),
        fieldKey: 'stage',
        type: 'TEXT',
      });
      schema.employeeAccess.fields.stage = 'EDIT';
    });
    await rules([
      {
        ...baseRule,
        trigger: { type: 'FIELD_CHANGED', fieldKey: 'stage', equals: 'won' },
        mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'name' } },
      },
    ]);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { data: { name: '' } },
    });
    const response = await api(
      'post',
      '/api/v1/workspaces/critical-a/objects/leads/records/batch',
      {
        items: [
          { recordId: f.ownedRecord.id, version: 1 },
          { recordId: f.otherRecord.id, version: 1 },
        ],
        values: { stage: 'won' },
      },
    );
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ updated: 1, failed: 1 });
    expect((await source()).data).toEqual({ name: '' });
    expect((await source()).version).toBe(1);
    expect(await targets()).toBe(1);
    const context = {
      userId: f.admin.userId,
      memberId: f.admin.memberId,
      role: 'TENANT_ADMIN' as const,
      tenantId: f.tenantA.id,
      tenantCode: 'critical-a',
    };
    const repository = h.app.get<RecordsRepository>(RECORDS_REPOSITORY);
    await repository.withTenantTransaction(context, async ({ tx, store }) => {
      const resolved = await resolvePublishedObjectInTransaction(
        tx,
        context,
        'leads',
      );
      await updateRecordCommand({
        store,
        resolved,
        context,
        recordId: f.workflowRecord.id,
        input: { version: 1, values: { stage: 'won' } },
        meta: { requestId: 'ai-confirmed-command' },
      });
    });
    expect(await targets()).toBe(2);
  });
  it('blocks archived source and target tables without partial source writes', async () => {
    await rules();
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.rollbackTargetObject.id },
      data: { status: 'ARCHIVED' },
    });
    expect(
      (await api('patch', path(), { version: 1, values: { name: 'won' } }))
        .status,
    ).toBe(409);
    expect((await source()).version).toBe(1);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { status: 'ARCHIVED' },
    });
    expect((await api('get', `${path()}/automations`)).status).toBe(409);
    expect(await targets()).toBe(0);
  });
  it.each([true, false])(
    'lets admins inspect employee-only drafts without granting runtime execution or employee access (enabled=%s)',
    async (enabled) => {
      const rule: AutomationRule = {
        ...baseRule,
        allowedRoles: ['EMPLOYEE'],
        trigger: { type: 'MANUAL' },
      };
      await rules([rule]);
      const draftUrl = `/api/v1/workspaces/critical-a/object-definitions/${f.object.id}/automations/preview`;
      const input = {
        rule: { ...rule, enabled },
        sourceRecordId: f.ownedRecord.id,
        inputs: {},
      };
      const before = await snapshot();
      const preview = await api('post', draftUrl, input);
      expect(preview.status).toBe(201);
      expect(preview.body.values).toEqual({ name: (await source()).title });
      expect(
        (await api('post', draftUrl, input, f.employee.cookie)).status,
      ).toBe(403);
      expect(
        (
          await api('post', `${path()}/automations/create-order/preview`, {
            inputs: {},
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await api('post', `${path()}/automations/create-order/execute`, {
            expectedVersion: 1,
            requestId: randomUUID(),
            inputs: {},
          })
        ).status,
      ).toBe(403);
      expect(await snapshot()).toEqual(before);
      await h.adminDatabase.objectDefinition.update({
        where: { id: f.rollbackTargetObject.id },
        data: { status: 'ARCHIVED' },
      });
      expect((await api('post', draftUrl, input)).status).toBe(409);
      expect(await snapshot()).toEqual(before);
    },
  );
  it('saves versioned drafts, previews without writes, and only enables frozen published rules', async () => {
    const schema = await republish(f.object.id, () => undefined);
    for (const field of schema.fields) {
      await h.adminDatabase.fieldDefinition.create({
        data: {
          id: field.id,
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldKey: field.fieldKey,
          label: field.label,
          type: field.type,
          required: field.required,
          config: field.config,
          validation: field.validation,
          status: 'ACTIVE',
        },
      });
      await h.adminDatabase.fieldPermission.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldId: field.id,
          subjectRole: 'EMPLOYEE',
          access: schema.employeeAccess.fields[field.fieldKey],
        },
      });
    }
    await h.adminDatabase.viewDefinition.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        code: 'default',
        name: '全部',
        columnFieldKeys: schema.defaultView.columnFieldKeys,
        sort: schema.defaultView.sort,
        status: 'ACTIVE',
      },
    });
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'ROLE',
        subjectRole: 'EMPLOYEE',
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
      },
    });
    const url = `/api/v1/workspaces/critical-a/object-definitions/${f.object.id}/automations`;
    const rule: AutomationRule = {
      ...baseRule,
      allowedRoles: ['TENANT_ADMIN'],
      trigger: { type: 'MANUAL' },
    };
    const duplicateRules = [
      { ...baseRule, allowedRoles: rule.allowedRoles },
      { ...baseRule, allowedRoles: rule.allowedRoles, key: 'duplicate-order' },
    ];
    expect(
      (await api('put', url, { expectedVersion: 1, rules: duplicateRules }))
        .status,
    ).toBe(400);
    expect((await api('get', url)).body).toMatchObject({
      version: 1,
      rules: [],
    });
    const saved = await api('put', url, { expectedVersion: 1, rules: [rule] });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      version: 2,
      publishedRules: [],
      rules: [rule],
    });
    expect((await api('get', `${path()}/automations`)).body.items).toEqual([]);
    expect(
      await api('put', url, { expectedVersion: 1, rules: [] }),
    ).toMatchObject({
      status: 409,
      body: { code: 'CONFIG_VERSION_CONFLICT' },
    });
    expect((await api('get', url, undefined, f.employee.cookie)).status).toBe(
      403,
    );
    const before = await snapshot();
    expect(
      (
        await api('post', `${url}/preview`, {
          rule,
          sourceRecordId: f.ownedRecord.id,
          inputs: {},
        })
      ).status,
    ).toBe(201);
    expect(await snapshot()).toEqual(before);
    const published = await api(
      'post',
      `/api/v1/workspaces/critical-a/object-definitions/${f.object.id}/publications`,
      { expectedVersion: 2 },
    );
    expect(published.status).toBe(201);
    expect((await api('get', url)).body.publishedRules).toEqual([rule]);
    expect((await api('get', `${path()}/automations`)).body.items).toHaveLength(
      1,
    );
    expect(
      (await api('put', url, { expectedVersion: 2, rules: [] })).status,
    ).toBe(200);
    expect((await api('get', `${path()}/automations`)).body.items).toHaveLength(
      1,
    );
  });
  it('denies hidden source mappings, hides target defaults and scopes history to current record owner', async () => {
    await republish(f.rollbackTargetObject.id, (schema) => {
      schema.employeeAccess.canCreate = true;
      schema.employeeAccess.readScope = 'OWN';
      schema.fields.push({
        ...schema.fields[0],
        id: randomUUID(),
        fieldKey: 'private',
        label: '私密',
        required: false,
        defaultValue: 'private-default',
      });
      schema.employeeAccess.fields.private = 'HIDDEN';
    });
    const manual: AutomationRule = { ...baseRule, trigger: { type: 'MANUAL' } };
    await rules([manual]);
    const preview = await api(
      'post',
      `${path()}/automations/create-order/preview`,
      { inputs: {} },
      f.employee.cookie,
    );
    expect(preview.status).toBe(201);
    expect(preview.body.values).not.toHaveProperty('private');
    expect(preview.body.fieldLabels).toEqual({ name: '名称' });
    const result = await api(
      'post',
      `${path()}/automations/create-order/execute`,
      { expectedVersion: 1, requestId: randomUUID(), inputs: {} },
      f.employee.cookie,
    );
    expect(result.status).toBe(201);
    expect(
      (
        await api(
          'get',
          `${path()}/automations/history`,
          undefined,
          f.employee.cookie,
        )
      ).body.items,
    ).toHaveLength(1);
    await h.adminDatabase.record.update({
      where: { id: result.body.targetRecordId },
      data: { ownerMemberId: f.otherEmployee.memberId },
    });
    expect(
      (
        await api(
          'get',
          `${path()}/automations/history`,
          undefined,
          f.employee.cookie,
        )
      ).body.items,
    ).toEqual([]);
    await rules([
      {
        ...manual,
        mappings: { name: { source: 'SOURCE_FIELD', fieldKey: 'secret' } },
      },
    ]);
    const denied = await api(
      'post',
      `${path()}/automations/create-order/preview`,
      { inputs: {} },
      f.employee.cookie,
    );
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).not.toContain('private-default');
  });
  it.each([false, true])(
    'lists no actions but preserves history for read-only scope (canUpdate=%s)',
    async (canUpdate) => {
      await republish(f.rollbackTargetObject.id, (schema) => {
        schema.employeeAccess.canRead = true;
        schema.employeeAccess.readScope = 'ALL';
      });
      await rules([{ ...baseRule, trigger: { type: 'MANUAL' } }]);
      const result = await api(
        'post',
        `${path()}/automations/create-order/execute`,
        { expectedVersion: 1, requestId: randomUUID(), inputs: {} },
      );
      expect(result.status).toBe(201);
      await republish(f.object.id, (schema) => {
        schema.employeeAccess.canRead = true;
        schema.employeeAccess.readScope = 'ALL';
        schema.employeeAccess.canUpdate = canUpdate;
        schema.employeeAccess.updateScope = 'OWN';
      });
      await h.adminDatabase.record.update({
        where: { id: f.ownedRecord.id },
        data: { ownerMemberId: f.otherEmployee.memberId },
      });
      const actions = await api(
        'get',
        `${path()}/automations`,
        undefined,
        f.employee.cookie,
      );
      expect(actions.status).toBe(200);
      expect(actions.body.items).toEqual([]);
      const history = await api(
        'get',
        `${path()}/automations/history`,
        undefined,
        f.employee.cookie,
      );
      expect(history.status).toBe(200);
      expect(history.body.items).toHaveLength(1);
      const preview = await api(
        'post',
        `${path()}/automations/create-order/preview`,
        { inputs: {} },
        f.employee.cookie,
      );
      expect(preview.status).toBe(canUpdate ? 404 : 403);
      const execute = await api(
        'post',
        `${path()}/automations/create-order/execute`,
        { expectedVersion: 2, requestId: randomUUID(), inputs: {} },
        f.employee.cookie,
      );
      expect(execute.status).toBe(canUpdate ? 404 : 403);
    },
  );
  it('rolls target creation, numbering and source edit back when relation insertion fails', async () => {
    await rules();
    const before = await source();
    const counts = await snapshot();
    await h.adminDatabase.$executeRawUnsafe(
      `CREATE FUNCTION automation_e2e_reject_relation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'automation_e2e_relation_failure'; END $$`,
    );
    await h.adminDatabase.$executeRawUnsafe(
      `CREATE TRIGGER automation_e2e_reject_relation BEFORE INSERT ON record_relations FOR EACH ROW WHEN (NEW.tenant_id = '${f.tenantA.id}'::uuid) EXECUTE FUNCTION automation_e2e_reject_relation()`,
    );
    try {
      expect(
        (await api('patch', path(), { version: 1, values: { name: 'won' } }))
          .status,
      ).toBe(500);
      expect(await source()).toEqual(before);
      expect(await snapshot()).toEqual(counts);
    } finally {
      await h.adminDatabase.$executeRawUnsafe(
        'DROP TRIGGER automation_e2e_reject_relation ON record_relations',
      );
      await h.adminDatabase.$executeRawUnsafe(
        'DROP FUNCTION automation_e2e_reject_relation()',
      );
    }
  });
  it('runs the field rule from the actual AI confirmation HTTP path exactly once', async () => {
    await rules();
    const context = {
      userId: f.admin.userId,
      memberId: f.admin.memberId,
      role: 'TENANT_ADMIN' as const,
      tenantId: f.tenantA.id,
      tenantCode: 'critical-a',
    };
    const conversation = await h.adminDatabase.aiConversation.create({
      data: {
        tenantId: f.tenantA.id,
        createdByMemberId: f.admin.memberId,
        title: '自动化确认',
        lastMessageAt: new Date(),
      },
    });
    const turnId = randomUUID();
    await h.adminDatabase.aiMessage.create({
      data: {
        tenantId: f.tenantA.id,
        conversationId: conversation.id,
        turnId,
        role: 'USER',
        status: 'COMPLETED',
        content: '确认开单',
      },
    });
    const view = await h.app.get(AiProposalService).preview(
      context,
      turnId,
      {
        operationType: 'UPDATE_RECORD',
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        values: { name: 'won' },
      },
      '确认开单',
    );
    expect(await targets()).toBe(0);
    const url = `/api/v1/workspaces/critical-a/ai/proposals/${view.proposalId}/confirm`;
    const body = { idempotencyKey: randomUUID() };
    expect((await api('post', url, body)).status).toBe(200);
    expect((await api('post', url, body)).status).toBe(200);
    expect(await targets()).toBe(1);
    expect(await executions()).toBe(1);
    expect((await source()).data).toMatchObject({ name: 'won' });
  });
});
