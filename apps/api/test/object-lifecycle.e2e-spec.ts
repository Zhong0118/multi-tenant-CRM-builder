import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { components } from '@crm/contracts';
import type {
  CriticalActor,
  CriticalFixture,
  CriticalHarness,
} from './helpers/critical-fixture';
import { PrismaMembershipsRepository } from '../src/modules/memberships/memberships.repository';
import { RecordsService } from '../src/modules/records/records.service';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import { createDescribeObjectTool } from '../src/modules/ai/tools/describe-object.tool';
import { createGetRecordTool } from '../src/modules/ai/tools/get-record.tool';
import { createSearchRecordsTool } from '../src/modules/ai/tools/search-records.tool';
import { DashboardEngine } from '../src/modules/dashboards/dashboard-engine';
import { compileDashboardPublication } from '../src/modules/dashboards/dashboard-definition';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';

type Draft = components['schemas']['ObjectDraftResponseDto'];
type Lifecycle = components['schemas']['ObjectLifecycleResponseDto'];
const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!runtimeUrl || !adminUrl)
  throw new Error(
    'Isolated TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required',
  );
const runtimeTarget = new URL(runtimeUrl);
const adminTarget = new URL(adminUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(runtimeTarget.hostname) ||
  !/test/i.test(runtimeTarget.pathname) ||
  runtimeTarget.host !== adminTarget.host ||
  runtimeTarget.pathname !== adminTarget.pathname ||
  runtimeTarget.username !== 'crm_app'
)
  throw new Error(
    'Lifecycle E2E requires matching isolated local test databases and crm_app',
  );
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = runtimeUrl;
process.env.DATABASE_ADMIN_URL = adminUrl;
process.env.DEV_VERIFICATION_CODE = '123456';
const helpers =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./helpers/critical-fixture') as typeof import('./helpers/critical-fixture');
const json = <T>(response: { body: unknown }) => response.body as T;
const origin = 'http://localhost:3000';
jest.setTimeout(120_000);

describe('whole-table lifecycle HTTP and PostgreSQL', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const definition = (id = f.object.id) => `${base()}/object-definitions/${id}`;
  const runtime = (code = f.object.code) => `${base()}/objects/${code}`;
  const get = (path: string, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', actor.cookie);
  const post = (
    path: string,
    payload: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      .post(path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(payload);
  const patch = (
    path: string,
    payload: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      .patch(path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(payload);
  const draft = async (id = f.object.id) =>
    json<Draft>(await get(definition(id)).expect(200));
  const preview = async (id = f.object.id) =>
    json<Lifecycle>(await get(`${definition(id)}/lifecycle`).expect(200));
  async function archive(id = f.object.id) {
    const current = await draft(id);
    return json<Draft>(
      await post(`${definition(id)}/archive`, {
        expectedVersion: current.object.version,
      }).expect(200),
    );
  }
  async function restore(id = f.object.id, extra: object = {}) {
    const current = await draft(id);
    return json<Draft>(
      await post(`${definition(id)}/restore`, {
        expectedVersion: current.object.version,
        ...extra,
      }).expect(200),
    );
  }
  async function configure(
    rules: object[] = [],
    id = f.object.id,
    code = f.object.code,
  ) {
    const object = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id },
    });
    await patch(`${runtime(code)}/pool-config`, {
      enabled: true,
      lifecycleEnabled: true,
      ownershipTtlHours: 24,
      version: object.poolConfigVersion,
      protectionRules: rules,
    }).expect(200);
  }
  async function snapshot() {
    const tenantId = f.tenantA.id;
    return {
      records: await h.adminDatabase.record.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      fields: await h.adminDatabase.fieldDefinition.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      views: await h.adminDatabase.viewDefinition.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      fieldPermissions: await h.adminDatabase.fieldPermission.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      memberFieldPermissions:
        await h.adminDatabase.memberFieldPermission.findMany({
          where: { tenantId },
          orderBy: { id: 'asc' },
        }),
      permissions: await h.adminDatabase.objectPermission.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      publications: await h.adminDatabase.objectPublication.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      tasks: await h.adminDatabase.recordFollowUp.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      activities: await h.adminDatabase.recordActivity.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      attachments: await h.adminDatabase
        .$queryRaw`SELECT * FROM record_attachments WHERE tenant_id=${tenantId}::uuid ORDER BY id`,
      relations: await h.adminDatabase
        .$queryRaw`SELECT * FROM record_relations WHERE tenant_id=${tenantId}::uuid ORDER BY id`,
    };
  }
  beforeAll(async () => {
    h = await helpers.createCriticalHarness();
    expect(
      await h.runtimeDatabase
        .$queryRaw`SELECT current_database() AS database,current_user AS role`,
    ).toEqual([
      {
        database: decodeURIComponent(runtimeTarget.pathname.slice(1)),
        role: 'crm_app',
      },
    ]);
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await helpers.provisionCriticalFixture(h);
    // The shared critical fixture stores runtime snapshots only. Lifecycle also
    // exercises the designer, so materialize its matching draft configuration.
    const objects = await h.adminDatabase.objectDefinition.findMany({
      where: { tenantId: f.tenantA.id },
      include: { activePublication: true },
    });
    for (const object of objects) {
      const schema = object.activePublication!
        .configuration as unknown as PublishedObjectSchema;
      await h.adminDatabase.fieldDefinition.createMany({
        data: schema.fields.map((field) => ({
          id: field.id,
          tenantId: f.tenantA.id,
          objectId: object.id,
          fieldKey: field.fieldKey,
          label: field.label,
          type: field.type,
          required: field.required,
          isSystem: field.isSystem,
          validation: field.validation,
          config: field.config,
          sortOrder: field.sortOrder,
        })),
      });
      await h.adminDatabase.viewDefinition.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: object.id,
          code: 'default',
          name: schema.defaultView.name,
          columnFieldKeys: schema.defaultView.columnFieldKeys,
          sort: { ...schema.defaultView.sort },
        },
      });
      const { fields, ...access } = schema.employeeAccess;
      await h.adminDatabase.objectPermission.create({
        data: {
          tenantId: f.tenantA.id,
          objectId: object.id,
          subjectType: 'ROLE',
          subjectRole: 'EMPLOYEE',
          ...access,
        },
      });
      await h.adminDatabase.fieldPermission.createMany({
        data: schema.fields.map((field) => ({
          tenantId: f.tenantA.id,
          objectId: object.id,
          fieldId: field.id,
          subjectRole: 'EMPLOYEE',
          access: fields[field.fieldKey],
        })),
      });
    }
  });
  afterEach(async () => {
    if (!f) return;
    const definitions = await h.adminDatabase.objectWorkflowDefinition.findMany(
      { where: { tenantId: f.tenantA.id }, select: { id: true } },
    );
    const workflowDefinitionId = { in: definitions.map((item) => item.id) };
    await h.adminDatabase.workflowTransitionDefinition.deleteMany({
      where: { tenantId: f.tenantA.id, workflowDefinitionId },
    });
    await h.adminDatabase.workflowStateDefinition.deleteMany({
      where: { tenantId: f.tenantA.id, workflowDefinitionId },
    });
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_relations WHERE tenant_id=${f.tenantA.id}::uuid`;
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_attachments WHERE tenant_id=${f.tenantA.id}::uuid`;
  });
  afterAll(async () => {
    if (h) await helpers.closeCriticalHarness(h);
  });

  it('preserves records, hidden historical values, attachment bytes, relations and pending drafts on restore', async () => {
    const initial = await draft();
    const changed = json<Draft>(
      await patch(definition(), {
        expectedVersion: initial.object.version,
        description: 'still unpublished',
      }).expect(200),
    );
    await h.adminDatabase
      .$executeRaw`INSERT INTO record_attachments(id,tenant_id,record_id,filename,byte_size,content,created_by_member_id) VALUES(${randomUUID()}::uuid,${f.tenantA.id}::uuid,${f.ownedRecord.id}::uuid,'history.txt',3,decode('616263','hex'),${f.admin.memberId}::uuid)`;
    await h.adminDatabase
      .$executeRaw`INSERT INTO record_relations(id,tenant_id,source_record_id,target_record_id) VALUES(${randomUUID()}::uuid,${f.tenantA.id}::uuid,${f.ownedRecord.id}::uuid,${f.otherRecord.id}::uuid)`;
    await h.adminDatabase.recordActivity.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        actorMemberId: f.employee.memberId,
        activityType: 'CALL',
        content: 'Historical call',
      },
    });
    const before = await snapshot();
    const stopped = await archive();
    expect(stopped.object).toMatchObject({
      status: 'ARCHIVED',
      version: changed.object.version + 1,
      publicationNumber: initial.object.publicationNumber,
      hasUnpublishedChanges: true,
    });
    expect(stopped.object.archivedAt).toEqual(expect.any(String));
    expect(await snapshot()).toEqual(before);
    const restored = await restore();
    expect(restored.object).toMatchObject({
      status: 'ACTIVE',
      description: 'still unpublished',
      publicationNumber: initial.object.publicationNumber,
      archivedAt: null,
      hasUnpublishedChanges: true,
    });
    expect(await snapshot()).toEqual(before);
    const employeeSchema = await get(`${runtime()}/schema`, f.employee).expect(
      200,
    );
    expect(
      json<{ object: { description: string | null } }>(employeeSchema).object
        .description,
    ).toBeNull();
    const audits = await h.adminDatabase.auditLog.findMany({
      where: {
        tenantId: f.tenantA.id,
        action: { in: ['object.archived', 'object.restored'] },
      },
    });
    expect(audits).toHaveLength(2);
  });

  it('denies employees, cross-company callers, repeated operations and stale versions', async () => {
    const current = await draft();
    await get(`${definition()}/lifecycle`, f.employee).expect(403);
    await post(
      `${definition()}/archive`,
      { expectedVersion: current.object.version },
      f.employee,
    ).expect(403);
    await post(
      `${definition()}/restore`,
      { expectedVersion: current.object.version },
      f.employee,
    ).expect(403);
    await get(`${definition()}/lifecycle`, f.tenantBAdmin).expect(403);
    await post(
      `${definition()}/archive`,
      { expectedVersion: current.object.version },
      f.tenantBAdmin,
    ).expect(403);
    // Tenant B's own route cannot resolve Tenant A's object id either.
    await get(
      `/api/v1/workspaces/${f.tenantB.code}/object-definitions/${f.object.id}/lifecycle`,
      f.tenantBAdmin,
    ).expect(404);
    const stopped = await archive();
    expect(
      json<{ code: string }>(
        await post(`${definition()}/archive`, {
          expectedVersion: stopped.object.version,
        }).expect(409),
      ).code,
    ).toBe('OBJECT_ARCHIVED');
    expect(
      json<{ code: string }>(
        await post(`${definition()}/restore`, {
          expectedVersion: current.object.version,
        }).expect(409),
      ).code,
    ).toBe('CONFIG_VERSION_CONFLICT');
    const restored = await restore();
    await post(`${definition()}/restore`, {
      expectedVersion: restored.object.version,
    }).expect(409);
  });

  it('blocks direct runtime, writes, import, export, workflows, pool changes and draft edits while stopped', async () => {
    const stopped = await archive();
    const paths = [
      `${runtime()}/schema`,
      `${runtime()}/records`,
      `${runtime()}/records/${f.ownedRecord.id}`,
      `${runtime()}/records/${f.ownedRecord.id}/workflow`,
    ];
    for (const path of paths)
      expect(
        json<{ code: string }>(await get(path, f.employee).expect(409)).code,
      ).toBe('OBJECT_ARCHIVED');
    const exported = await get(
      `${runtime()}/records/export`,
      f.employee,
    ).expect(409);
    expect((JSON.parse(exported.text) as { code: string }).code).toBe(
      'OBJECT_ARCHIVED',
    );
    await post(`${runtime()}/records`, { values: { name: 'bypass' } }).expect(
      409,
    );
    await patch(`${runtime()}/records/${f.ownedRecord.id}`, {
      version: f.ownedRecord.version,
      values: { name: 'bypass' },
    }).expect(409);
    await post(`${runtime()}/records/import`, {
      rows: [{ rowNumber: 2, values: { name: 'bypass' } }],
    }).expect(409);
    await post(
      `${runtime()}/records/${f.ownedRecord.id}/workflow/transitions/qualify`,
      { expectedVersion: f.ownedRecord.version },
    ).expect(409);
    await patch(`${runtime()}/pool-config`, {
      enabled: false,
      ownershipTtlHours: null,
      version: 1,
    }).expect(409);
    await patch(definition(), {
      expectedVersion: stopped.object.version,
      name: 'bypass',
    }).expect(409);
    await post(`${definition()}/publications`, {
      expectedVersion: stopped.object.version,
    }).expect(409);
    await request(h.app.getHttpServer())
      .put(`${definition()}/workflow`)
      .set('Cookie', f.admin.cookie)
      .set('Origin', origin)
      .send({
        expectedDraftRevision: stopped.object.version,
        isEnabled: false,
        initialStateKey: null,
        states: [],
        transitions: [],
      })
      .expect(409);
    const navigation = json<Array<{ code: string }>>(
      await get(`${base()}/objects`, f.employee).expect(200),
    );
    expect(navigation.some((object) => object.code === f.object.code)).toBe(
      false,
    );
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.otherEmployee.memberId,
        canRead: false,
        canCreate: false,
        canUpdate: false,
        readScope: 'NONE',
        updateScope: 'NONE',
      },
    });
    await get(`${runtime()}/schema`, f.otherEmployee).expect(404);
  });

  it('pauses future deadlines, preserves expired and protected rows and manual task dates', async () => {
    await configure();
    const now = Date.now();
    const future = new Date(now + 3600_000);
    const expired = new Date(now - 3600_000);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { poolStage: 'PENDING_CONTACT', ownershipExpiresAt: future },
    });
    await h.adminDatabase.record.update({
      where: { id: f.otherRecord.id },
      data: { poolStage: 'FOLLOWING', ownershipExpiresAt: expired },
    });
    await h.adminDatabase.record.update({
      where: { id: f.workflowRecord.id },
      data: {
        poolStage: 'PROTECTED',
        poolProtectedAt: new Date(now),
        protectionNeedsReview: false,
        ownershipExpiresAt: null,
      },
    });
    const task = await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        assigneeMemberId: f.employee.memberId,
        title: 'Manually agreed due date',
        dueAt: expired,
      },
    });
    const before = await snapshot();
    await archive();
    expect(await snapshot()).toEqual(before);
    // Simulate one hour stopped, without waiting or changing the original deadline.
    const stoppedAt = new Date(now - 3600_000);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { archivedAt: stoppedAt },
    });
    expect(
      await h.runtimeDatabase
        .$queryRaw`SELECT reclaim_expired_record_ownership(100) AS count`,
    ).toEqual([{ count: 0 }]);
    const restoreStartedAt = Date.now();
    await restore();
    const after = await h.adminDatabase.record.findMany({
      where: { objectId: f.object.id },
    });
    const shifted = after.find((row) => row.id === f.ownedRecord.id)!;
    expect(
      shifted.ownershipExpiresAt!.getTime() - future.getTime(),
    ).toBeGreaterThanOrEqual(restoreStartedAt - stoppedAt.getTime());
    expect(
      shifted.ownershipExpiresAt!.getTime() - future.getTime(),
    ).toBeLessThan(Date.now() - stoppedAt.getTime() + 100);
    expect(after.find((row) => row.id === f.otherRecord.id)).toEqual(
      before.records.find((row) => row.id === f.otherRecord.id),
    );
    expect(after.find((row) => row.id === f.workflowRecord.id)).toEqual(
      before.records.find((row) => row.id === f.workflowRecord.id),
    );
    expect(
      await h.adminDatabase.recordFollowUp.findUnique({
        where: { id: task.id },
      }),
    ).toEqual(task);
    expect(
      await h.runtimeDatabase
        .$queryRaw`SELECT reclaim_expired_record_ownership(100) AS count`,
    ).toEqual([{ count: 1 }]);
  });

  it('requires legacy timer acknowledgement and never guesses historical paused duration', async () => {
    await configure();
    const deadline = new Date(Date.now() - 60_000);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { ownershipExpiresAt: deadline, poolStage: 'PENDING_CONTACT' },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { status: 'ARCHIVED', archivedAt: null },
    });
    const before = await snapshot();
    expect(await preview()).toMatchObject({
      requiresLegacyTimerAcknowledgement: true,
      expiredRecordCount: 1,
      archivedAt: null,
    });
    const current = await draft();
    await post(`${definition()}/restore`, {
      expectedVersion: current.object.version,
    }).expect(409);
    await restore(f.object.id, { acknowledgeLegacyTimers: true });
    expect(await snapshot()).toEqual(before);
  });

  it('lists published workflow dependencies and validates outgoing targets again on restore', async () => {
    const target = f.rollbackTargetObject;
    expect((await preview(target.id)).blockers).toEqual([
      expect.objectContaining({
        kind: 'WORKFLOW',
        objectCode: 'deals',
      }),
    ]);
    expect((await preview(target.id)).blockers[0].description).toContain(
      '标记赢单',
    );
    const current = await draft(target.id);
    await post(`${definition(target.id)}/archive`, {
      expectedVersion: current.object.version,
    }).expect(409);
    await archive(f.rollbackObject.id);
    await archive(target.id);
    const blocked = await preview(f.rollbackObject.id);
    expect(blocked.blockers).toEqual([
      expect.objectContaining({ kind: 'WORKFLOW', objectCode: 'invoices' }),
    ]);
    const source = await draft(f.rollbackObject.id);
    await post(`${definition(f.rollbackObject.id)}/restore`, {
      expectedVersion: source.object.version,
    }).expect(409);
    await restore(target.id);
    await restore(f.rollbackObject.id);
  });

  it('blocks pool protection dependencies and preserves protection state when stopped', async () => {
    await configure([{ sourceObjectCode: 'deals', statusKeys: ['won'] }]);
    expect((await preview(f.rollbackObject.id)).blockers).toEqual([
      expect.objectContaining({ kind: 'POOL_PROTECTION', objectCode: 'leads' }),
    ]);
    const current = await draft(f.rollbackObject.id);
    await post(`${definition(f.rollbackObject.id)}/archive`, {
      expectedVersion: current.object.version,
    }).expect(409);
    await archive();
    await archive(f.rollbackObject.id);
    expect((await preview()).blockers).toEqual([
      expect.objectContaining({ kind: 'POOL_PROTECTION', objectCode: 'deals' }),
    ]);
    const stopped = await draft();
    await post(`${definition()}/restore`, {
      expectedVersion: stopped.object.version,
    }).expect(409);
  });

  it('pauses notification scans, preserves unread history and deduplicates newly overdue tasks after restore', async () => {
    const overdue = new Date(Date.now() - 60_000);
    const first = await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        assigneeMemberId: f.employee.memberId,
        title: 'Existing reminder',
        dueAt: overdue,
      },
    });
    await h.runtimeDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
    const initial = await h.adminDatabase.memberNotification.findMany({
      where: { tenantId: f.tenantA.id },
    });
    expect(initial).toHaveLength(1);
    expect(initial[0].followUpId).toBe(first.id);
    await archive();
    await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.ownedRecord.id,
        assigneeMemberId: f.employee.memberId,
        title: 'Due while stopped',
        dueAt: overdue,
      },
    });
    await h.runtimeDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
    expect(
      await h.adminDatabase.memberNotification.findMany({
        where: { tenantId: f.tenantA.id },
      }),
    ).toEqual(initial);
    await restore();
    await h.runtimeDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
    await h.runtimeDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
    const after = await h.adminDatabase.memberNotification.findMany({
      where: { tenantId: f.tenantA.id },
    });
    expect(after).toHaveLength(2);
    expect(after.find((item) => item.id === initial[0].id)).toEqual(initial[0]);
    const response = await get(`${base()}/notifications`, f.employee).expect(
      200,
    );
    expect(json<{ unreadCount: number }>(response).unreadCount).toBe(2);
    await get(`${runtime()}/records/${f.ownedRecord.id}`, f.employee).expect(
      200,
    );
  });

  it('serializes duplicate archive and restore requests using version checks', async () => {
    const initial = await draft();
    const archiveResponses = await Promise.all([
      post(`${definition()}/archive`, {
        expectedVersion: initial.object.version,
      }),
      post(`${definition()}/archive`, {
        expectedVersion: initial.object.version,
      }),
    ]);
    expect(archiveResponses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const stopped = await draft();
    const restoreResponses = await Promise.all([
      post(`${definition()}/restore`, {
        expectedVersion: stopped.object.version,
      }),
      post(`${definition()}/restore`, {
        expectedVersion: stopped.object.version,
      }),
    ]);
    expect(restoreResponses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect((await draft()).object.version).toBe(initial.object.version + 2);
  });

  it('serializes archive against an incoming protection configuration mutation', async () => {
    const current = await draft(f.rollbackObject.id);
    const config = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: f.object.id },
    });
    const responses = await Promise.all([
      post(`${definition(f.rollbackObject.id)}/archive`, {
        expectedVersion: current.object.version,
      }),
      patch(`${runtime()}/pool-config`, {
        enabled: true,
        lifecycleEnabled: true,
        ownershipTtlHours: 24,
        version: config.poolConfigVersion,
        protectionRules: [{ sourceObjectCode: 'deals', statusKeys: ['won'] }],
      }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const [source, owner] = await Promise.all([
      h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: f.rollbackObject.id },
      }),
      h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: f.object.id },
      }),
    ]);
    expect(source.status === 'ACTIVE' || !owner.poolEnabled).toBe(true);
  });

  it('degrades only an archived dashboard widget while keeping other data available', async () => {
    const objects = await h.adminDatabase.objectDefinition.findMany({
      where: { tenantId: f.tenantA.id },
      include: { activePublication: true },
    });
    const catalog = objects.flatMap((object) =>
      object.activePublication
        ? [
            object.activePublication
              .configuration as unknown as PublishedObjectSchema,
          ]
        : [],
    );
    const compiled = compileDashboardPublication(
      {
        schemaVersion: 2,
        title: 'Lifecycle dashboard',
        widgets: [f.object.code, f.rollbackTargetObject.code].map(
          (code, index) => ({
            id: `table-${index}`,
            type: 'METRIC' as const,
            title: code,
            objectCode: code,
            audience: 'ALL' as const,
            width: 'QUARTER' as const,
            sortOrder: index * 10,
            filters: [],
            aggregation: 'COUNT' as const,
          }),
        ),
      },
      catalog,
    );
    await archive();
    const result = await h.app.get(DashboardEngine).evaluate({
      publication: { kind: 'COMPILED_V2', raw: compiled },
      catalog,
      context: {
        tenantId: f.tenantA.id,
        tenantCode: f.tenantA.code,
        userId: f.admin.userId,
        memberId: f.admin.memberId,
        role: 'TENANT_ADMIN',
      },
      period: {
        from: new Date(Date.now() - 86400_000).toISOString(),
        to: new Date().toISOString(),
        timezone: 'Asia/Shanghai',
      },
    });
    expect(result.widgets).toEqual([
      expect.objectContaining({
        id: 'table-0',
        state: 'UNAVAILABLE',
        reason: 'OBJECT_ARCHIVED',
      }),
      expect.objectContaining({ id: 'table-1', state: 'READY' }),
    ]);
  });

  it('serializes archive against publication of an incoming workflow dependency', async () => {
    const current = await draft();
    await request(h.app.getHttpServer())
      .put(`${definition()}/workflow`)
      .set('Cookie', f.admin.cookie)
      .set('Origin', origin)
      .send({
        expectedDraftRevision: current.object.version,
        isEnabled: true,
        initialStateKey: 'new',
        states: [
          { key: 'new', label: 'New', sortOrder: 10, isTerminal: false },
          { key: 'won', label: 'Won', sortOrder: 20, isTerminal: true },
        ],
        transitions: [
          {
            key: 'win',
            label: 'Win',
            fromStateKey: 'new',
            toStateKey: 'won',
            allowedRoles: ['TENANT_ADMIN'],
            requiredFieldKeys: [],
            actions: [
              {
                key: 'create-deal',
                type: 'CREATE_RECORD',
                targetObjectCode: 'deals',
                values: { name: { source: 'LITERAL', value: 'Workflow deal' } },
              },
            ],
            sortOrder: 10,
          },
        ],
      })
      .expect(200);
    const source = await draft();
    const analysis = await post(`${definition()}/publication-analysis`, {
      expectedVersion: source.object.version,
    }).expect(200);
    expect(json<{ blocking: unknown[] }>(analysis).blocking).toEqual([]);
    const target = await draft(f.rollbackObject.id);
    const results = await Promise.all([
      post(`${definition(f.rollbackObject.id)}/archive`, {
        expectedVersion: target.object.version,
      }),
      post(`${definition()}/publications`, {
        expectedVersion: source.object.version,
      }),
    ]);
    const codes = results.map((response) => response.status).sort();
    // Exactly one can activate its conflicting state. A blocked publication is 422.
    expect([
      [200, 422],
      [201, 409],
    ]).toContainEqual(codes);
    const published = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: f.object.id },
      include: { activePublication: true },
    });
    const targetAfter =
      await h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: f.rollbackObject.id },
      });
    const actions =
      (
        published.activePublication!
          .configuration as unknown as PublishedObjectSchema
      ).workflow?.transitions.flatMap(
        (transition) => transition.actions ?? [],
      ) ?? [];
    expect(
      targetAfter.status === 'ACTIVE' ||
        actions.every((action) => action.type !== 'CREATE_RECORD'),
    ).toBe(true);
  });

  it('keeps archived per-member object and field permissions unchanged, including writes after an earlier active-state read', async () => {
    const current = await draft();
    const fieldId = current.fields[0].id;
    const before = await snapshot();
    await archive();
    await request(h.app.getHttpServer())
      .put(
        `${base()}/members/${f.employee.memberId}/object-access/${f.object.id}`,
      )
      .set('Cookie', f.admin.cookie)
      .set('Origin', origin)
      .send({ mode: 'INHERIT' })
      .expect(404);
    await patch(`${base()}/objects/${f.object.id}/member-access`, {
      memberIds: [f.employee.memberId],
      fields: [{ fieldId, access: 'HIDDEN' }],
    }).expect(404);
    const repository = h.app.get(PrismaMembershipsRepository);
    const context = {
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      userId: f.admin.userId,
      memberId: f.admin.memberId,
      role: 'TENANT_ADMIN' as const,
    };
    // Exercise the repository boundary directly to represent a service that read
    // ACTIVE before a competing archive committed and now attempts its write.
    for (const write of [
      (store: Parameters<Parameters<typeof repository.withTenant>[1]>[0]) =>
        store.replaceMemberObjectAccess(f.employee.memberId, f.object.id, {
          canCreate: false,
          canRead: false,
          canUpdate: false,
          canDelete: false,
          readScope: 'NONE',
          updateScope: 'NONE',
        }),
      (store: Parameters<Parameters<typeof repository.withTenant>[1]>[0]) =>
        store.deleteMemberObjectAccess(f.employee.memberId, f.object.id),
      (store: Parameters<Parameters<typeof repository.withTenant>[1]>[0]) =>
        store.setMemberFieldAccess(f.employee.memberId, f.object.id, [
          { fieldId, access: 'HIDDEN' },
        ]),
    ])
      await expect(repository.withTenant(context, write)).rejects.toMatchObject(
        { code: 'OBJECT_ARCHIVED', status: 409 },
      );
    expect(await snapshot()).toEqual(before);
  });

  it('rejects archived AI read tools using real object and record services without provider calls', async () => {
    await archive();
    const context = {
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      userId: f.employee.userId,
      memberId: f.employee.memberId,
      role: 'EMPLOYEE' as const,
    };
    const records = h.app.get(RecordsService);
    const published = h.app.get(PublishedObjectService);
    for (const tool of [
      createDescribeObjectTool(published, context),
      createGetRecordTool(records, context),
      createSearchRecordsTool(records, context),
    ]) {
      await expect(
        tool.execute(
          {
            objectCode: f.object.code,
            ...(tool.name === 'get_record'
              ? { recordId: f.ownedRecord.id }
              : {}),
          },
          'lifecycle-check',
        ),
      ).rejects.toMatchObject({ code: 'OBJECT_ARCHIVED', status: 409 });
    }
  });

  it('keeps deadlines that elapsed while stopped out of a concurrent reclaimer after restore', async () => {
    await configure();
    await archive();
    const stoppedAt = new Date(Date.now() - 3600_000);
    const elapsedDeadline = new Date(stoppedAt.getTime() + 1800_000);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { archivedAt: stoppedAt },
    });
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage: 'PENDING_CONTACT',
        ownershipExpiresAt: elapsedDeadline,
      },
    });
    const [, reclaimed] = await Promise.all([
      restore(),
      h.runtimeDatabase.$queryRaw<
        Array<{ count: number }>
      >`SELECT reclaim_expired_record_ownership(100) AS count`,
    ]);
    expect(reclaimed).toEqual([{ count: 0 }]);
    const record = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    expect(record.ownerMemberId).toBe(f.employee.memberId);
    expect(record.inPublicPool).toBe(false);
    expect(record.ownershipExpiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 1700_000,
    );
  });

  it('reviews genuinely cancelled protection evidence on restore while retaining permanent protection and deadlines', async () => {
    await configure([{ sourceObjectCode: 'deals', statusKeys: ['won'] }]);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage: 'PROTECTED',
        poolProtectedAt: new Date(),
        protectionNeedsReview: false,
      },
    });
    await h.adminDatabase.record.update({
      where: { id: f.rollbackRecord.id },
      data: { statusKey: 'won' },
    });
    await h.adminDatabase
      .$executeRaw`INSERT INTO record_relations(id,tenant_id,source_record_id,target_record_id) VALUES(${randomUUID()}::uuid,${f.tenantA.id}::uuid,${f.ownedRecord.id}::uuid,${f.rollbackRecord.id}::uuid)`;
    const before = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    expect(before.protectionNeedsReview).toBe(false);
    await archive();
    await h.adminDatabase.record.update({
      where: { id: f.rollbackRecord.id },
      data: { statusKey: 'open' },
    });
    expect(
      await h.adminDatabase.record.findUniqueOrThrow({
        where: { id: f.ownedRecord.id },
      }),
    ).toEqual(before);
    await restore();
    const restored = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    expect(restored).toMatchObject({
      poolStage: 'PROTECTED',
      ownerMemberId: before.ownerMemberId,
      poolProtectedAt: before.poolProtectedAt,
      ownershipExpiresAt: null,
      protectionNeedsReview: true,
      version: before.version + 1,
    });
    expect(restored.data).toEqual(before.data);
  });

  it('does not rescan protected records when draft saves only rewrite unchanged publication and pool metadata', async () => {
    await configure();
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage: 'PROTECTED',
        poolProtectedAt: new Date(),
        protectionNeedsReview: false,
      },
    });
    const before = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    const current = await draft();
    await patch(definition(), {
      expectedVersion: current.object.version,
      description: 'unpublished metadata',
    }).expect(200);
    expect(
      await h.adminDatabase.record.findUniqueOrThrow({
        where: { id: f.ownedRecord.id },
      }),
    ).toEqual(before);
  });
});
