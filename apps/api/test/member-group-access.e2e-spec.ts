import { ConversationRepository } from '../src/modules/ai/conversation.repository';
import { AiProposalService } from '../src/modules/ai/ai-proposal.service';
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

  it('filters one authorized group owner in lists and exports instead of returning the entire group', async () => {
    for (const [memberId, recordIds] of [
      [f.employee.memberId, [f.ownedRecord.id, f.workflowRecord.id]],
      [f.otherEmployee.memberId, [f.otherRecord.id]],
    ] as const) {
      const response = await get(records())
        .query({ ownerMemberId: memberId })
        .expect(200);
      const page = response.body as {
        items: Array<{ id: string }>;
        total: number;
      };
      expect(page.items.map((item) => item.id).sort()).toEqual(
        [...recordIds].sort(),
      );
      expect(page.total).toBe(recordIds.length);
    }
    const csv = await get(`${records()}/export`)
      .query({ ownerMemberId: f.otherEmployee.memberId })
      .expect(200);
    expect(csv.text).toContain('他人线索');
    expect(csv.text).not.toContain('员工自己的线索');
    expect(csv.text).not.toContain('hidden-other');
    for (const ownerMemberId of [
      f.admin.memberId,
      f.tenantBAdmin.memberId,
      'unassigned',
    ]) {
      await get(records()).query({ ownerMemberId }).expect(400);
      await get(`${records()}/export`).query({ ownerMemberId }).expect(400);
    }
  });

  it('keeps private counts in the selected own scope while showing the public pool', async () => {
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { poolEnabled: true, poolLifecycleEnabled: true },
    });
    await h.adminDatabase.record.update({
      where: { id: unassignedId },
      data: { inPublicPool: true, poolStage: 'LEAD_POOL' },
    });
    const pool = await get(records())
      .query({ scope: 'mine', poolStage: 'LEAD_POOL' })
      .expect(200);
    expect(pool.body).toHaveProperty('items', [
      expect.objectContaining({ id: unassignedId }),
    ]);
    expect(pool.body).toHaveProperty('poolCounts.LEGACY', 2);
    const mine = await get(records())
      .query({ scope: 'mine', poolStage: 'LEGACY' })
      .expect(200);
    expect(mine.body).toHaveProperty('total', 2);
    const group = await get(records())
      .query({ scope: 'group', poolStage: 'LEGACY' })
      .expect(200);
    expect(group.body).toHaveProperty('total', 3);
  });

  it('offers an explicit group scope without granting company-wide access or retaining revoked membership', async () => {
    const response = await get(records()).query({ scope: 'group' }).expect(200);
    const page = response.body as { items: Array<{ id: string }> };
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [f.ownedRecord.id, f.workflowRecord.id, f.otherRecord.id].sort(),
    );
    await get(records()).query({ scope: 'all' }).expect(403);
    await get(records(), f.otherEmployee).query({ scope: 'group' }).expect(403);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.otherEmployee.memberId },
      data: { groupId: null },
    });
    await get(records())
      .query({ scope: 'group', ownerMemberId: f.otherEmployee.memberId })
      .expect(400);
    await h.adminDatabase.memberGroup.update({
      where: { id: groupId },
      data: { leaderMemberId: null },
    });
    await get(records()).query({ scope: 'group' }).expect(403);
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

  describe('independent peer field policies', () => {
    const policyPath = () =>
      `${base()}/members/${f.employee.memberId}/object-access/${f.object.id}`;
    const configure = (
      groupFieldAccess: Record<string, string> | null,
      canUpdate = true,
    ) =>
      request(h.app.getHttpServer())
        .put(policyPath())
        .set('Cookie', f.admin.cookie)
        .set('Origin', origin)
        .send({
          mode: 'OVERRIDE',
          canCreate: true,
          canRead: true,
          canUpdate,
          readScope: 'GROUP',
          updateScope: 'OWN',
          groupFieldAccess,
        });
    beforeEach(async () => {
      const publication =
        await h.adminDatabase.objectPublication.findFirstOrThrow({
          where: { objectId: f.object.id },
        });
      const schema = publication.configuration as unknown as {
        fields: Array<{
          id: string;
          fieldKey: string;
          label: string;
          type: 'TEXT' | 'TEXTAREA';
        }>;
      };
      for (const field of schema.fields)
        await h.adminDatabase.fieldDefinition.create({
          data: { ...field, tenantId: f.tenantA.id, objectId: f.object.id },
        });
    });
    afterEach(async () => {
      if (f)
        await h.adminDatabase.memberFieldPermission.deleteMany({
          where: { tenantId: f.tenantA.id },
        });
    });
    it('saves the reviewed DTO and keeps own and peer values independent', async () => {
      const configured = await configure({
        name: 'READ_ONLY',
        reviewCode: 'EDIT',
        secret: 'HIDDEN',
      }).expect(200);
      expect(configured.body).toHaveProperty(
        'effective.groupFieldAccess.reviewCode',
        'EDIT',
      );
      const schema = await get(schemaPath()).expect(200);
      expect(schema.body).toMatchObject({
        groupFieldAccess: {
          reviewCode: 'EDIT',
          secret: 'HIDDEN',
        },
      });
      expect(schema.body).toHaveProperty(
        'queryFieldKeys',
        expect.not.arrayContaining(['secret']),
      );
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        values: { reviewCode: 'group-edited' },
      }).expect(200);
      const detail = await get(`${records()}/${f.otherRecord.id}`).expect(200);
      expect(detail.body).toMatchObject({
        values: { reviewCode: 'group-edited' },
        canEditFields: true,
        fieldAccess: { name: 'READ_ONLY', secret: 'HIDDEN' },
      });
      await patch(`${records()}/${f.ownedRecord.id}`, {
        version: 1,
        values: { name: 'owner unchanged rules' },
      }).expect(200);
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 2,
        values: { reviewCode: 'rollback', secret: 'forbidden' },
      }).expect(403);
      expect(
        (await get(`${records()}/${f.otherRecord.id}`).expect(200)).body,
      ).toHaveProperty('values.reviewCode', 'group-edited');
    });
    it('hides peer title across read endpoints, queries, CSV and SQL protection', async () => {
      await configure({ name: 'HIDDEN', reviewCode: 'EDIT' }).expect(200);
      for (const suffix of [
        '',
        '/activities',
        '/relations',
        '/attachments',
        '/workflow',
        '/workflow/history',
        '/automations/history',
      ])
        await get(`${records()}/${f.otherRecord.id}${suffix}`).expect(404);
      const page = await get(records())
        .query({ search: '他人线索' })
        .expect(200);
      expect(page.body).toHaveProperty('total', 0);
      expect(
        (
          await get(records())
            .query({ scope: 'group', ownerMemberId: f.otherEmployee.memberId })
            .expect(200)
        ).body,
      ).toHaveProperty('total', 0);
      expect(
        (
          await get(`${records()}/export`)
            .query({ scope: 'group', ownerMemberId: f.otherEmployee.memberId })
            .expect(200)
        ).text,
      ).not.toContain('他人线索');
      expect((await get(`${records()}/export`).expect(200)).text).not.toContain(
        '他人线索',
      );
      await get(`${records()}/${f.ownedRecord.id}`).expect(200);
      const result = await h.runtimeDatabase.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${f.employee.userId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenantA.id}, true)`;
        return tx.$queryRaw<
          Array<{ allowed: boolean }>
        >`SELECT public.record_pool_can_protect(r) AS allowed FROM records r WHERE r.id=${f.otherRecord.id}::uuid`;
      });
      expect(result[0].allowed).toBe(false);
    });
    it('rejects empty peer patches without incrementing version or emitting automation', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      for (const values of [undefined, {}])
        await patch(`${records()}/${f.otherRecord.id}`, {
          version: 1,
          ...(values ? { values } : {}),
        }).expect(403);
      await configure({ reviewCode: 'READ_ONLY' }).expect(200);
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        values: {},
      }).expect(403);
      expect(
        (await get(`${records()}/${f.otherRecord.id}`).expect(200)).body,
      ).toHaveProperty('version', 1);
    });
    it('rejects stale attempt output after a retry has captured changed permissions', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      const context: TenantContext = {
        ...f.employee,
        role: 'EMPLOYEE',
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
      };
      const conversations = h.app.get(ConversationRepository);
      const turn = await conversations.beginTurn(context, {
        content: 'attempt question',
      });
      await conversations.finalizeAssistant(context, turn.turnId, {
        status: 'FAILED',
        content: '',
      });
      await configure({ reviewCode: 'HIDDEN' }).expect(200);
      await conversations.retryTurn(context, turn.turnId);
      await expect(
        conversations.finalizeAssistant(context, turn.turnId, {
          providerAttempt: 1,
          status: 'COMPLETED',
          content: 'stale-attempt-secret',
        }),
      ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE' });
      await conversations.finalizeAssistant(context, turn.turnId, {
        providerAttempt: 2,
        status: 'COMPLETED',
        content: 'current-attempt-answer',
      });
      const page = await get(
        `${base()}/ai/conversations/${turn.conversationId}/messages`,
      ).expect(200);
      expect(page.text).not.toContain('stale-attempt-secret');
      expect(page.text).toContain('current-attempt-answer');
    });
    it('revokes protected pool answers when the pool is disabled through its API', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      await h.adminDatabase.objectDefinition.update({
        where: { id: f.object.id },
        data: { poolEnabled: true },
      });
      await h.adminDatabase.record.update({
        where: { id: unassignedId },
        data: { inPublicPool: true },
      });
      await get(`${records()}/${unassignedId}`).expect(200);
      const context: TenantContext = {
        ...f.employee,
        role: 'EMPLOYEE',
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
      };
      const conversations = h.app.get(ConversationRepository);
      const turn = await conversations.beginTurn(context, {
        content: 'pool question',
      });
      await conversations.finalizeAssistant(context, turn.turnId, {
        status: 'COMPLETED',
        content: 'protected-pool-answer',
        sourceSummary: [
          { recordId: unassignedId, summary: 'pool-source-secret' },
        ],
      });
      const path = `${base()}/ai/conversations/${turn.conversationId}/messages`;
      expect((await get(path).expect(200)).text).toContain(
        'protected-pool-answer',
      );
      await request(h.app.getHttpServer())
        .patch(`${base()}/objects/${f.object.code}/pool-config`)
        .set('Cookie', f.admin.cookie)
        .set('Origin', origin)
        .send({ enabled: false, ownershipTtlHours: null, version: 1 })
        .expect(200);
      await get(`${records()}/${unassignedId}`).expect(404);
      expect((await get(path).expect(200)).text).not.toMatch(
        /protected-pool-answer|pool-source-secret/,
      );
      expect(
        JSON.stringify(
          await conversations.contextMessages(context, turn.conversationId),
        ),
      ).not.toMatch(/protected-pool-answer|pool-source-secret/);
    });
    it('invalidates protected assistant history and provider context only after security changes', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      const context: TenantContext = {
        ...f.employee,
        role: 'EMPLOYEE',
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
      };
      const conversations = h.app.get(ConversationRepository);
      const turn = await conversations.beginTurn(context, {
        content: '用户自己的问题',
      });
      await conversations.finalizeAssistant(context, turn.turnId, {
        status: 'COMPLETED',
        content: 'protected-peer-answer',
        sourceSummary: [{ kind: 'AGGREGATE', value: '987654' }],
      });
      const path = `${base()}/ai/conversations/${turn.conversationId}/messages`;
      expect((await get(path).expect(200)).text).toContain(
        'protected-peer-answer',
      );
      await patch(`${records()}/${f.ownedRecord.id}`, {
        version: 1,
        values: { name: '普通值修改' },
      }).expect(200);
      expect((await get(path).expect(200)).text).toContain(
        'protected-peer-answer',
      );
      await configure({ reviewCode: 'HIDDEN' }).expect(200);
      expect((await get(path).expect(200)).text).not.toMatch(
        /protected-peer-answer|987654/,
      );
      const providerContext = await conversations.contextMessages(
        context,
        turn.conversationId,
      );
      expect(JSON.stringify(providerContext)).not.toMatch(
        /protected-peer-answer|987654/,
      );
      expect(providerContext.find((row) => row.role === 'USER')?.content).toBe(
        '用户自己的问题',
      );
      await configure(null).expect(200);
      expect((await get(path).expect(200)).text).not.toContain(
        'protected-peer-answer',
      );
    });
    it('previews and confirms explicit peer fields through AI while rechecking revocation', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      const context: TenantContext = {
        ...f.employee,
        role: 'EMPLOYEE',
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
      };
      const conversations = h.app.get(ConversationRepository);
      const proposals = h.app.get(AiProposalService);
      const turn = await conversations.beginTurn(context, {
        content: '修改审核编号',
      });
      const proposal = await proposals.preview(
        context,
        turn.turnId,
        {
          operationType: 'UPDATE_RECORD',
          objectCode: f.object.code,
          recordId: f.otherRecord.id,
          values: { reviewCode: 'ai-approved' },
        },
        '修改审核编号',
      );
      await conversations.finalizeAssistant(context, turn.turnId, {
        status: 'COMPLETED',
        content: '待确认',
      });
      expect(
        await proposals.confirm(context, proposal.proposalId, randomUUID(), {
          requestId: 'group-ai',
        }),
      ).toMatchObject({ status: 'EXECUTED' });
      expect(
        (await get(`${records()}/${f.otherRecord.id}`).expect(200)).body,
      ).toHaveProperty('values.reviewCode', 'ai-approved');
      const next = await conversations.beginTurn(context, {
        conversationId: turn.conversationId,
        content: '再次修改',
      });
      const pending = await proposals.preview(
        context,
        next.turnId,
        {
          operationType: 'UPDATE_RECORD',
          objectCode: f.object.code,
          recordId: f.otherRecord.id,
          values: { reviewCode: 'must-not-write' },
        },
        '再次修改',
      );
      await conversations.finalizeAssistant(context, next.turnId, {
        status: 'COMPLETED',
        content: '待确认',
      });
      await configure({ reviewCode: 'READ_ONLY' }).expect(200);
      expect(
        await proposals.confirm(context, pending.proposalId, randomUUID(), {
          requestId: 'group-ai-revoked',
        }),
      ).toMatchObject({ status: 'CONFLICTED' });
      expect(
        (await get(`${records()}/${f.otherRecord.id}`).expect(200)).body,
      ).toHaveProperty('values.reviewCode', 'ai-approved');
    });
    it('keeps mine and export scopes inside own-title readability while returning peer lists with pool counts', async () => {
      await configure({ name: 'READ_ONLY', reviewCode: 'EDIT' }).expect(200);
      const title = await h.adminDatabase.fieldDefinition.findFirstOrThrow({
        where: { objectId: f.object.id, fieldKey: 'name' },
      });
      await h.adminDatabase.memberFieldPermission.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldId: title.id,
          memberId: f.employee.memberId,
          access: 'HIDDEN',
        },
      });
      await h.adminDatabase.objectDefinition.update({
        where: { id: f.object.id },
        data: { poolEnabled: true },
      });
      const page = await get(records()).expect(200);
      expect(page.body).toHaveProperty(
        'items',
        expect.arrayContaining([
          expect.objectContaining({ id: f.otherRecord.id }),
        ]),
      );
      expect(page.body).toHaveProperty(
        'items',
        expect.not.arrayContaining([
          expect.objectContaining({ id: f.ownedRecord.id }),
        ]),
      );
      expect(page.body).toHaveProperty('poolCounts.LEAD_POOL', 0);
      expect(
        (
          await get(records())
            .query({ scope: 'group', ownerMemberId: f.employee.memberId })
            .expect(200)
        ).body,
      ).toHaveProperty('total', 0);
      expect(
        (
          await get(`${records()}/export`)
            .query({ ownerMemberId: f.employee.memberId })
            .expect(200)
        ).text,
      ).not.toContain('员工自己的线索');
      expect(
        (await get(records()).query({ scope: 'mine' }).expect(200)).body,
      ).toHaveProperty('total', 0);
      expect(
        (await get(`${records()}/export`).query({ scope: 'mine' }).expect(200))
          .text,
      ).not.toContain('员工自己的线索');
      await get(records()).query({ scope: 'pool' }).expect(403);
    });
    it('does not grant ownership, activity, workflow, relation or attachment writes', async () => {
      await configure({ reviewCode: 'EDIT' }).expect(200);
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        ownerMemberId: f.employee.memberId,
      }).expect(404);
      for (const [suffix, data] of [
        ['activities', { activityType: 'NOTE', content: 'blocked' }],
        ['workflow/transitions/qualify', { expectedVersion: 1 }],
        [
          'relations',
          { objectCode: f.object.code, recordId: f.ownedRecord.id },
        ],
      ] as const) {
        const response = await request(h.app.getHttpServer())
          .post(`${records()}/${f.otherRecord.id}/${suffix}`)
          .set('Cookie', f.employee.cookie)
          .set('Origin', origin)
          .send(data);
        expect([400, 403, 404]).toContain(response.status);
      }
      await patch(`${records()}/${outsideId}`, {
        version: 1,
        values: { reviewCode: 'blocked' },
      }).expect(404);
      await request(h.app.getHttpServer())
        .patch(`${records()}/${f.otherRecord.id}`)
        .set('Cookie', f.otherEmployee.cookie)
        .set('Origin', origin)
        .send({ version: 1, values: { reviewCode: 'blocked' } })
        .expect(403);
      await get(
        `/api/v1/workspaces/${f.tenantB.code}/objects/leads/records`,
      ).expect(403);
    });
    it('applies canUpdate, membership changes and field retirement immediately', async () => {
      await configure({ reviewCode: 'EDIT' }, false).expect(200);
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        values: { reviewCode: 'blocked' },
      }).expect(403);
      await configure({ reviewCode: 'EDIT' }).expect(200);
      await h.adminDatabase.tenantMember.update({
        where: { id: f.otherEmployee.memberId },
        data: { groupId: null },
      });
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        values: { reviewCode: 'blocked' },
      }).expect(404);
      await h.adminDatabase.tenantMember.update({
        where: { id: f.otherEmployee.memberId },
        data: { groupId },
      });
      await h.adminDatabase.fieldDefinition.updateMany({
        where: { objectId: f.object.id, fieldKey: 'reviewCode' },
        data: { status: 'INACTIVE' },
      });
      await configure({ reviewCode: 'EDIT' }).expect(400);
      expect((await get(schemaPath()).expect(200)).body).toHaveProperty(
        'fields',
        expect.not.arrayContaining([
          expect.objectContaining({ fieldKey: 'reviewCode' }),
        ]),
      );
      await patch(`${records()}/${f.otherRecord.id}`, {
        version: 1,
        values: { reviewCode: 'blocked' },
      }).expect(400);
      await h.adminDatabase.memberGroup.update({
        where: { id: groupId },
        data: { leaderMemberId: null },
      });
      await get(`${records()}/${f.otherRecord.id}`).expect(404);
    });
    it('rejects hidden-field filters and sorting and emits mixed batch outcomes', async () => {
      await configure({ reviewCode: 'HIDDEN', secret: 'EDIT' }).expect(200);
      await get(records())
        .query({ filters: JSON.stringify({ reviewCode: { contains: 'x' } }) })
        .expect(400);
      await get(records()).query({ sort: 'reviewCode' }).expect(400);
      const response = await request(h.app.getHttpServer())
        .post(`${records()}/batch`)
        .set('Cookie', f.employee.cookie)
        .set('Origin', origin)
        .send({
          items: [
            { recordId: f.ownedRecord.id, version: 1 },
            { recordId: f.otherRecord.id, version: 1 },
          ],
          values: { secret: 'allowed-peer' },
        });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ updated: 1, failed: 1 });
      expect(response.body).toHaveProperty(
        'items.1.record.values.secret',
        'allowed-peer',
      );
    });
  });

  describe('GROUP pool protection', () => {
    afterEach(async () => {
      if (!f) return;
      await h.adminDatabase
        .$executeRaw`DELETE FROM record_relations WHERE tenant_id = ${f.tenantA.id}::uuid`;
      await h.adminDatabase.memberFieldPermission.deleteMany({
        where: { tenantId: f.tenantA.id },
      });
    });
    const permissionWhere = () => ({
      tenantId: f.tenantA.id,
      objectId: f.object.id,
      subjectMemberId: f.employee.memberId,
    });
    const protectionAccess = async (actor: CriticalActor = f.employee) =>
      h.runtimeDatabase.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${f.tenantA.id}, true), set_config('app.user_id', ${actor.userId}, true)`;
        const rows = await tx.$queryRaw<
          Array<{ id: string; allowed: boolean }>
        >`
          SELECT r.id, public.record_pool_can_protect(r) AS allowed
          FROM public.records r WHERE r.tenant_id = ${f.tenantA.id}::uuid
            AND r.id IN (${f.ownedRecord.id}::uuid, ${f.otherRecord.id}::uuid,
              ${outsideId}::uuid, ${unassignedId}::uuid)`;
        const byId = new Map(rows.map((row) => [row.id, row.allowed]));
        return [
          f.ownedRecord.id,
          f.otherRecord.id,
          outsideId,
          unassignedId,
        ].map((id) => byId.get(id));
      });

    it('protects an owned customer when a GROUP reader links qualifying evidence', async () => {
      await h.adminDatabase.record.update({
        where: { id: f.workflowRecord.id },
        data: { statusKey: 'qualified' },
      });
      await h.adminDatabase.objectDefinition.update({
        where: { id: f.object.id },
        data: {
          poolEnabled: true,
          poolLifecycleEnabled: true,
          poolProtectionRules: [
            { sourceObjectCode: f.object.code, statusKeys: ['qualified'] },
          ],
        },
      });
      await request(h.app.getHttpServer())
        .post(`${records()}/${f.ownedRecord.id}/relations`)
        .set('Cookie', f.employee.cookie)
        .set('Origin', origin)
        .send({ objectCode: f.object.code, recordId: f.workflowRecord.id })
        .expect(201);
      const protectedRecord = await h.adminDatabase.record.findUniqueOrThrow({
        where: { id: f.ownedRecord.id },
      });
      expect(protectedRecord).toMatchObject({
        poolStage: 'PROTECTED',
        ownershipExpiresAt: null,
        ownerMemberId: f.employee.memberId,
      });
      expect(protectedRecord.poolProtectedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['OWN', [true, false, false, false]],
      ['ALL', [true, true, false, false]],
      ['NONE', [false, false, false, false]],
    ] as const)(
      'intersects GROUP reads with %s writes in the database guard',
      async (updateScope, expected) => {
        await h.adminDatabase.objectPermission.updateMany({
          where: permissionWhere(),
          data: { updateScope },
        });
        expect(await protectionAccess()).toEqual(expected);
      },
    );

    it.each(['replaced', 'outside own group'] as const)(
      'falls back to OWN protection when the stored leader is %s',
      async (kind) => {
        await h.adminDatabase.objectPermission.updateMany({
          where: permissionWhere(),
          data: { updateScope: 'ALL' },
        });
        if (kind === 'replaced')
          await h.adminDatabase.memberGroup.update({
            where: { id: groupId },
            data: { leaderMemberId: f.otherEmployee.memberId },
          });
        else
          await h.adminDatabase.tenantMember.update({
            where: { id: f.employee.memberId },
            data: { groupId: null },
          });
        expect(await protectionAccess()).toEqual([true, false, false, false]);
      },
    );

    it.each(['member', 'account'] as const)(
      'denies protection when the acting %s is disabled',
      async (kind) => {
        if (kind === 'member')
          await h.adminDatabase.tenantMember.update({
            where: { id: f.employee.memberId },
            data: { status: 'DISABLED' },
          });
        else
          await h.adminDatabase.user.update({
            where: { id: f.employee.userId },
            data: { status: 'DISABLED' },
          });
        expect(await protectionAccess()).toEqual([false, false, false, false]);
      },
    );

    it.each(['canRead', 'canUpdate'] as const)(
      'does not let GROUP bypass %s=false',
      async (permission) => {
        await h.adminDatabase.objectPermission.updateMany({
          where: permissionWhere(),
          data: { updateScope: 'ALL', [permission]: false },
        });
        expect(await protectionAccess()).toEqual([false, false, false, false]);
      },
    );

    it.each(['member', 'account'] as const)(
      'preserves explicit ALL writes to records of a disabled group owner %s',
      async (kind) => {
        await h.adminDatabase.objectPermission.updateMany({
          where: permissionWhere(),
          data: { updateScope: 'ALL' },
        });
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
        expect(await protectionAccess()).toEqual([true, true, false, false]);
      },
    );

    it('revokes protection of a moved owner immediately', async () => {
      await h.adminDatabase.objectPermission.updateMany({
        where: permissionWhere(),
        data: { updateScope: 'ALL' },
      });
      expect(await protectionAccess()).toEqual([true, true, false, false]);
      await h.adminDatabase.tenantMember.update({
        where: { id: f.otherEmployee.memberId },
        data: { groupId: null },
      });
      expect(await protectionAccess()).toEqual([true, false, false, false]);
    });

    it('denies protection when the title is hidden', async () => {
      const title = await h.adminDatabase.fieldDefinition.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldKey: 'name',
          label: '姓名',
          type: 'TEXT',
        },
      });
      await h.adminDatabase.memberFieldPermission.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldId: title.id,
          memberId: f.employee.memberId,
          access: 'HIDDEN',
        },
      });
      expect(await protectionAccess()).toEqual([false, false, false, false]);
    });

    it('rejects an actor from another tenant even with the target tenant context', async () => {
      expect(await protectionAccess(f.tenantBAdmin)).toEqual([
        false,
        false,
        false,
        false,
      ]);
    });
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
