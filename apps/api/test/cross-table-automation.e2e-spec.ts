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
import type { AutomationRule } from '../src/modules/automations/automation.types';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';
import { RECORDS_REPOSITORY } from '../src/modules/records/records.service';
import type { RecordsRepository } from '../src/modules/records/records.repository';
import { updateRecordCommand } from '../src/modules/records/record-command';
import { resolvePublishedObjectInTransaction } from '../src/modules/objects/published-object-transaction';

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
    const saved = await api('put', url, { expectedVersion: 1, rules: [rule] });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      version: 2,
      publishedRules: [],
      rules: [rule],
    });
    expect((await api('get', `${path()}/automations`)).body.items).toEqual([]);
    expect(
      (await api('put', url, { expectedVersion: 1, rules: [] })).status,
    ).toBe(409);
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
