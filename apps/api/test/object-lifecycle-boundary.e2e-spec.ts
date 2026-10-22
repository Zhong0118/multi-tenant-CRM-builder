import { randomUUID } from 'node:crypto';
import { AiProposalService } from '../src/modules/ai/ai-proposal.service';
import request from 'supertest';
import type {
  CriticalFixture,
  CriticalHarness,
} from './helpers/critical-fixture';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import { PrismaRecordsRepository } from '../src/modules/records/records.repository';

const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!runtimeUrl || !adminUrl)
  throw new Error('Isolated test database URLs required');
const runtimeTarget = new URL(runtimeUrl);
const adminTarget = new URL(adminUrl);
if (
  !['localhost', '127.0.0.1'].includes(runtimeTarget.hostname) ||
  !/test/i.test(runtimeTarget.pathname) ||
  runtimeTarget.host !== adminTarget.host ||
  runtimeTarget.pathname !== adminTarget.pathname ||
  runtimeTarget.username !== 'crm_app'
)
  throw new Error('Matching isolated local test database and crm_app required');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = runtimeUrl;
process.env.DATABASE_ADMIN_URL = adminUrl;
process.env.DEV_VERIFICATION_CODE = '123456';
const helpers =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./helpers/critical-fixture') as typeof import('./helpers/critical-fixture');
const json = <T>(response: { body: unknown }) => response.body as T;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('test barrier timeout')),
          4000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const origin = 'http://localhost:3000';
type Operation =
  | 'create'
  | 'update'
  | 'import'
  | 'workflow'
  | 'attachment'
  | 'relation'
  | 'activity'
  | 'followup'
  | 'ai-update'
  | 'ai-followup'
  | 'ai-note';
jest.setTimeout(30_000);

describe('lifecycle runtime transaction boundary', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const runtime = () => `${base()}/objects/${f.object.code}`;
  const definition = (id = f.object.id) => `${base()}/object-definitions/${id}`;
  const get = (path: string) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', f.admin.cookie);
  const post = (path: string, payload: object, employee = false) =>
    request(h.app.getHttpServer())
      .post(path)
      .set('Cookie', employee ? f.employee.cookie : f.admin.cookie)
      .set('Origin', origin)
      .send(payload);
  const patch = (path: string, payload: object, employee = false) =>
    request(h.app.getHttpServer())
      .patch(path)
      .set('Cookie', employee ? f.employee.cookie : f.admin.cookie)
      .set('Origin', origin)
      .send(payload);
  async function archive(id = f.object.id) {
    const current = json<{ object: { version: number } }>(
      await get(definition(id)).expect(200),
    );
    return post(`${definition(id)}/archive`, {
      expectedVersion: current.object.version,
    });
  }
  function operation(kind: Operation) {
    const record = `${runtime()}/records/${f.ownedRecord.id}`;
    if (kind === 'create')
      return post(
        `${runtime()}/records`,
        { values: { name: 'in flight' } },
        true,
      );
    if (kind === 'update')
      return patch(
        record,
        { version: f.ownedRecord.version, values: { name: 'in flight' } },
        true,
      );
    if (kind === 'import')
      return post(
        `${runtime()}/records/import`,
        { rows: [{ rowNumber: 2, values: { name: 'in flight' } }] },
        true,
      );
    if (kind === 'workflow')
      return post(
        `${record}/workflow/transitions/qualify`,
        { expectedVersion: f.ownedRecord.version },
        true,
      );
    if (kind === 'attachment')
      return request(h.app.getHttpServer())
        .post(`${record}/attachments`)
        .set('Cookie', f.employee.cookie)
        .set('Origin', origin)
        .attach('file', Buffer.from('retained bytes'), 'boundary.txt');
    if (kind === 'relation')
      return post(
        `${record}/relations`,
        { objectCode: f.object.code, recordId: f.workflowRecord.id },
        true,
      );
    if (kind === 'activity')
      return post(
        `${record}/activities`,
        { activityType: 'CALL', content: 'in flight' },
        true,
      );
    return post(
      `${base()}/follow-ups`,
      {
        objectCode: f.object.code,
        recordId: f.ownedRecord.id,
        title: 'in flight',
        dueAt: new Date(Date.now() + 86400_000).toISOString(),
      },
      true,
    );
  }
  async function prepareOperation(kind: Operation) {
    if (!kind.startsWith('ai-')) return () => operation(kind);
    const context = {
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      userId: f.employee.userId,
      memberId: f.employee.memberId,
      role: 'EMPLOYEE' as const,
    };
    const conversation = await h.adminDatabase.aiConversation.create({
      data: {
        tenantId: context.tenantId,
        createdByMemberId: context.memberId,
        title: 'Lifecycle boundary',
        lastMessageAt: new Date(),
      },
    });
    const turnId = randomUUID();
    await h.adminDatabase.aiMessage.create({
      data: {
        tenantId: context.tenantId,
        conversationId: conversation.id,
        turnId,
        role: 'USER',
        status: 'COMPLETED',
        content: 'confirmed by member',
      },
    });
    const target = { objectCode: f.object.code, recordId: f.ownedRecord.id };
    const candidate =
      kind === 'ai-update'
        ? {
            ...target,
            operationType: 'UPDATE_RECORD',
            values: { name: 'AI boundary' },
          }
        : kind === 'ai-followup'
          ? {
              ...target,
              operationType: 'CREATE_FOLLOW_UP',
              title: 'AI boundary',
              dueAt: new Date(Date.now() + 86400_000).toISOString(),
            }
          : {
              ...target,
              operationType: 'ADD_ACTIVITY_NOTE',
              content: 'AI boundary',
            };
    const view = await h.app
      .get(AiProposalService)
      .preview(context, turnId, candidate, 'confirmed by member');
    return () =>
      post(
        `${base()}/ai/proposals/${view.proposalId}/confirm`,
        { idempotencyKey: randomUUID() },
        true,
      );
  }
  async function businessSnapshot() {
    const tenantId = f.tenantA.id;
    return {
      records: await h.adminDatabase.record.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      counters: await h.adminDatabase.recordCounter.findMany({
        where: { tenantId },
        orderBy: { objectId: 'asc' },
      }),
      tasks: await h.adminDatabase.recordFollowUp.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      activities: await h.adminDatabase.recordActivity.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      history: await h.adminDatabase.recordTransitionHistory.findMany({
        where: { tenantId },
        orderBy: { id: 'asc' },
      }),
      audits: await h.adminDatabase.auditLog.findMany({
        where: { tenantId, resourceType: { not: 'object_definition' } },
        orderBy: { id: 'asc' },
      }),
      attachments: await h.adminDatabase
        .$queryRaw`SELECT * FROM record_attachments WHERE tenant_id=${tenantId}::uuid ORDER BY id`,
      relations: await h.adminDatabase
        .$queryRaw`SELECT * FROM record_relations WHERE tenant_id=${tenantId}::uuid ORDER BY id`,
    };
  }
  async function waitUntil<T>(probe: () => Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const value = await probe();
      if (value !== undefined) return value;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Database barrier not reached within 4 seconds');
  }
  beforeAll(async () => {
    h = await helpers.createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await helpers.provisionCriticalFixture(h);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_attachments WHERE tenant_id=${f.tenantA.id}::uuid`;
    await h.adminDatabase
      .$executeRaw`DELETE FROM record_relations WHERE tenant_id=${f.tenantA.id}::uuid`;
  });
  afterAll(async () => {
    if (h) await helpers.closeCriticalHarness(h);
  });

  it.each<Operation>(['create', 'update', 'import', 'attachment', 'activity'])(
    'rejects %s when archive commits after preflight resolution but before its persistence transaction',
    async (kind) => {
      const reached = barrier();
      const resume = barrier();
      const objects = h.app.get(PublishedObjectService);
      const resolve = objects.resolveRuntimeSchema.bind(objects);
      let intercepted = false;
      jest
        .spyOn(objects, 'resolveRuntimeSchema')
        .mockImplementation(async (context, code) => {
          const result = await resolve(context, code);
          if (
            !intercepted &&
            context.memberId === f.employee.memberId &&
            code === f.object.code
          ) {
            intercepted = true;
            reached.release();
            await resume.promise;
          }
          return result;
        });
      const before = await businessSnapshot();
      const pending = operation(kind).then((response) => response);
      try {
        await bounded(reached.promise);
        expect((await archive()).status).toBe(200);
      } finally {
        resume.release();
      }
      const response = await pending;
      expect(response.status).toBe(409);
      expect(json<{ code: string }>(response).code).toBe('OBJECT_ARCHIVED');
      expect(await businessSnapshot()).toEqual(before);
    },
  );

  it('rejects a no-action workflow when archive wins before its transaction starts', async () => {
    const reached = barrier();
    const resume = barrier();
    const repository = h.app.get(PrismaRecordsRepository);
    const original = repository.withTenantTransaction.bind(repository);
    jest
      .spyOn(repository, 'withTenantTransaction')
      .mockImplementation(async (context, work) => {
        if (context.memberId === f.employee.memberId) {
          reached.release();
          await resume.promise;
        }
        return original(context, work);
      });
    const before = await businessSnapshot();
    const pending = operation('workflow').then((response) => response);
    try {
      await bounded(reached.promise);
      expect((await archive()).status).toBe(200);
    } finally {
      resume.release();
    }
    expect((await pending).status).toBe(409);
    expect(await businessSnapshot()).toEqual(before);
  });

  it.each<Operation>([
    'create',
    'update',
    'import',
    'workflow',
    'attachment',
    'relation',
    'followup',
    'ai-update',
    'ai-followup',
    'ai-note',
  ])(
    'archive waits for %s that has entered its runtime transaction before waiting on its actor',
    async (kind) => {
      const startOperation = await prepareOperation(kind);
      const held = barrier();
      const releaseActor = barrier();
      const holding = h.adminDatabase.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${f.employee.memberId}::uuid FOR UPDATE`;
          held.release();
          await releaseActor.promise;
        },
        { timeout: 15000 },
      );
      await held.promise;
      const pending = startOperation().then((response) => response);
      let stopping: Promise<request.Response> | undefined;
      let stateAtBoundary: string | undefined;
      try {
        await waitUntil(async () => {
          const rows = await h.adminDatabase.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='crm_app' AND wait_event_type='Lock' AND query ILIKE '%tenant_members%'`;
          return Number(rows[0].count) > 0 ? true : undefined;
        });
        stopping = archive().then((response) => response);
        stateAtBoundary = await waitUntil(async () => {
          const object =
            await h.adminDatabase.objectDefinition.findUniqueOrThrow({
              where: { id: f.object.id },
            });
          if (object.status === 'ARCHIVED') return object.status;
          const rows = await h.adminDatabase.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='crm_app' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock(%'`;
          return Number(rows[0].count) > 0 ? object.status : undefined;
        });
      } finally {
        releaseActor.release();
        await holding;
        await pending;
        if (stopping !== undefined) await stopping;
      }
      const result = await pending;
      if (stopping !== undefined) expect((await stopping).status).toBe(200);
      expect(stateAtBoundary).toBe('ACTIVE');
      expect(result.status).toBeGreaterThanOrEqual(200);
      expect(result.status).toBeLessThan(300);
      if (kind.startsWith('ai-'))
        expect(json<{ status: string }>(result).status).toBe('EXECUTED');
    },
  );

  it.each<Operation>(['ai-update', 'ai-followup', 'ai-note'])(
    'rejects %s confirmation when archive wins before the actual transaction',
    async (kind) => {
      const start = await prepareOperation(kind);
      const reached = barrier();
      const resume = barrier();
      const repository = h.app.get(PrismaRecordsRepository);
      const original = repository.withTenantTransaction.bind(repository);
      jest
        .spyOn(repository, 'withTenantTransaction')
        .mockImplementation(async (context, work) => {
          if (context.memberId === f.employee.memberId) {
            reached.release();
            await resume.promise;
          }
          return original(context, work);
        });
      const before = await businessSnapshot();
      const pending = start().then((response) => response);
      try {
        await bounded(reached.promise);
        expect((await archive()).status).toBe(200);
      } finally {
        resume.release();
      }
      const response = await pending;
      expect(response.status).toBe(409);
      expect(json<{ code: string }>(response).code).toBe('OBJECT_ARCHIVED');
      expect(await businessSnapshot()).toEqual(before);
    },
  );

  async function disabledPoolWithRetainedRules() {
    await patch(`${runtime()}/pool-config`, {
      enabled: false,
      lifecycleEnabled: true,
      ownershipTtlHours: 24,
      version: 1,
      protectionRules: [{ sourceObjectCode: 'deals', statusKeys: ['won'] }],
    }).expect(200);
    return h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: f.object.id },
    });
  }
  it('re-enables omitted retained protection rules when their published source remains active', async () => {
    const before = await disabledPoolWithRetainedRules();
    await patch(`${runtime()}/pool-config`, {
      enabled: true,
      ownershipTtlHours: 24,
      version: before.poolConfigVersion,
    }).expect(200);
    const after = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: f.object.id },
    });
    expect(after.poolEnabled).toBe(true);
    expect(after.poolProtectionRules).toEqual(before.poolProtectionRules);
  });
  it('rejects omitted retained protection rules after their source is archived without modifying configuration', async () => {
    const before = await disabledPoolWithRetainedRules();
    expect((await archive(f.rollbackObject.id)).status).toBe(200);
    const response = await patch(`${runtime()}/pool-config`, {
      enabled: true,
      ownershipTtlHours: 24,
      version: before.poolConfigVersion,
    });
    expect(response.status).toBe(409);
    expect(
      await h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: f.object.id },
      }),
    ).toEqual(before);
  });
  it('serializes an archive-first race against enabling omitted retained protection rules', async () => {
    const before = await disabledPoolWithRetainedRules();
    const entered = barrier();
    const release = barrier();
    const holding = h.adminDatabase.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${f.tenantA.id} || ':object-configuration',0))::text`;
        entered.release();
        await release.promise;
      },
      { timeout: 15000 },
    );
    await entered.promise;
    const stop = archive(f.rollbackObject.id).then((response) => response);
    let config: Promise<request.Response> | undefined;
    try {
      await waitUntil(async () => {
        const rows = await h.adminDatabase.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='crm_app' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock(%'`;
        return Number(rows[0].count) > 0 ? true : undefined;
      });
      config = patch(`${runtime()}/pool-config`, {
        enabled: true,
        ownershipTtlHours: 24,
        version: before.poolConfigVersion,
      }).then((response) => response);
      await waitUntil(async () => {
        const rows = await h.adminDatabase.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='crm_app' AND wait_event='advisory' AND query ILIKE '%pg_advisory_xact_lock(%'`;
        return Number(rows[0].count) >= 2 ? true : undefined;
      });
    } finally {
      release.release();
      await holding;
    }
    expect((await stop).status).toBe(200);
    expect((await config).status).toBe(409);
    expect(
      await h.adminDatabase.objectDefinition.findUniqueOrThrow({
        where: { id: f.object.id },
      }),
    ).toEqual(before);
  });
});
