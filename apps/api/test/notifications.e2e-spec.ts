import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import request from 'supertest';
import type {
  CriticalActor,
  CriticalFixture,
  CriticalHarness,
} from './helpers/critical-fixture';

// Set every connection before loading bootstrap/ConfigModule. This suite must
// never fall back to the developer's .env or the seeded demonstration database.
const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
if (!runtimeUrl || !adminUrl) {
  throw new Error('TEST_DATABASE_URL and TEST_DATABASE_ADMIN_URL are required');
}
const runtimeTarget = new URL(runtimeUrl);
const adminTarget = new URL(adminUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(runtimeTarget.hostname) ||
  !/(test|notifications)/i.test(runtimeTarget.pathname) ||
  runtimeTarget.host !== adminTarget.host ||
  runtimeTarget.pathname !== adminTarget.pathname ||
  runtimeTarget.username !== 'crm_app'
) {
  throw new Error(
    'Notifications HTTP tests require matching isolated local test databases and the crm_app runtime role',
  );
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = runtimeUrl;
process.env.DATABASE_ADMIN_URL = adminUrl;
process.env.TEST_DATABASE_URL = runtimeUrl;
process.env.TEST_DATABASE_ADMIN_URL = adminUrl;
process.env.DEV_VERIFICATION_CODE = '123456';

// CommonJS require deliberately runs after the environment assignments above.
const helpers =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./helpers/critical-fixture') as typeof import('./helpers/critical-fixture');

interface InboxItem {
  id: string;
  kind: string;
  title: string;
  message: string;
  readAt: string | null;
  canOpen: boolean;
}
interface Inbox {
  items: InboxItem[];
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  serverTime: string;
  snapshot: string;
}
const json = <T>(response: { body: unknown }): T => response.body as T;
const origin = 'http://localhost:3000';
jest.setTimeout(120_000);

describe('in-app notifications HTTP with real PostgreSQL and crm_app RLS', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/notifications`;
  const get = (suffix = '', actor: CriticalActor = f.employee) =>
    request(h.app.getHttpServer())
      .get(base() + suffix)
      .set('Cookie', actor.cookie);
  const markRead = (id: string, actor: CriticalActor = f.employee) =>
    request(h.app.getHttpServer())
      .patch(`${base()}/${id}/read`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin);
  const readAll = (before: string, snapshot: string) =>
    request(h.app.getHttpServer())
      .post(`${base()}/read-all`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', origin)
      .send({ before, snapshot });
  async function inbox(query = ''): Promise<Inbox> {
    return json<Inbox>(await get(query).expect(200));
  }
  async function cleanNotifications() {
    await h.adminDatabase.$executeRaw`
      DELETE FROM member_notifications
      WHERE tenant_id IN (
        SELECT id FROM tenants WHERE code IN ('critical-a','critical-b')
      )`;
  }
  async function sweep() {
    await h.adminDatabase.$queryRaw`SELECT sweep_member_notifications(500)`;
  }
  async function task(
    recordId = f.ownedRecord.id,
    assigneeMemberId = f.employee.memberId,
  ) {
    return h.adminDatabase.recordFollowUp.create({
      data: {
        id: randomUUID(),
        tenantId: f.tenantA.id,
        recordId,
        assigneeMemberId,
        title: 'Private task title must not leak into a notification',
        dueAt: new Date(Date.now() - 60_000),
      },
    });
  }
  async function taskNotification() {
    const followUp = await task();
    await sweep();
    const page = await inbox();
    expect(page.items).toHaveLength(1);
    return { followUp, notification: page.items[0] };
  }

  beforeAll(async () => {
    h = await helpers.createCriticalHarness();
    // Assert the runtime role/target before any fixtures or destructive cleanup.
    const identity = await h.runtimeDatabase.$queryRaw<
      Array<{ database: string; role: string }>
    >`SELECT current_database() AS database,current_user AS role`;
    expect(identity).toEqual([
      {
        database: decodeURIComponent(runtimeTarget.pathname.slice(1)),
        role: 'crm_app',
      },
    ]);
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    await cleanNotifications();
    f = await helpers.provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) {
      await cleanNotifications();
      await helpers.closeCriticalHarness(h);
    }
  });

  it('returns a recipient-only inbox and does not duplicate a swept event', async () => {
    const { notification } = await taskNotification();
    await sweep();
    const page = await inbox();
    expect(page.total).toBe(1);
    expect(page.unreadCount).toBe(1);
    expect(page.items[0].id).toBe(notification.id);
    expect(page.items[0].kind).toBe('TASK_OVERDUE');
    expect(page.items[0].canOpen).toBe(true);
    expect(JSON.stringify(page)).not.toContain('Private task title');
    expect(JSON.stringify(page)).not.toContain('员工自己的线索');
    const other = json<Inbox>(await get('', f.otherEmployee).expect(200));
    expect(other).toMatchObject({ items: [], total: 0, unreadCount: 0 });
    await get('', f.tenantBAdmin).expect(403);
    await markRead(notification.id, f.otherEmployee).expect(404);
    await get(`/${notification.id}/target`, f.otherEmployee).expect(404);
    await request(h.app.getHttpServer())
      .patch(
        `/api/v1/workspaces/${f.tenantB.code}/notifications/${notification.id}/read`,
      )
      .set('Cookie', f.tenantBAdmin.cookie)
      .set('Origin', origin)
      .expect(404);
    await request(h.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${f.tenantB.code}/notifications/${notification.id}/target`,
      )
      .set('Cookie', f.tenantBAdmin.cookie)
      .expect(404);
  });

  it('marks only the current recipient read, is idempotent, and filters unread', async () => {
    const { followUp, notification } = await taskNotification();
    await markRead(notification.id).expect(200, { ok: true });
    const first = await inbox();
    expect(first.unreadCount).toBe(0);
    expect(first.items[0].readAt).toEqual(expect.any(String));
    await markRead(notification.id).expect(200, { ok: true });
    expect((await inbox()).items[0].readAt).toBe(first.items[0].readAt);
    expect(await inbox('?unreadOnly=true')).toMatchObject({
      items: [],
      total: 0,
      unreadCount: 0,
    });
    const taskAfter = await h.adminDatabase.recordFollowUp.findUniqueOrThrow({
      where: { id: followUp.id },
    });
    expect(taskAfter.status).toBe('OPEN');
    expect(taskAfter.version).toBe(followUp.version);
  });

  it('filters current OWN permissions before LIMIT, OFFSET, total and unread count', async () => {
    await task();
    await task(f.workflowRecord.id);
    for (let index = 0; index < 5; index++) await task(f.otherRecord.id);
    await sweep();
    // Put unreadable records ahead of readable ones. Post-LIMIT filtering would
    // return an empty/short first page or report seven instead of two items.
    await h.adminDatabase.$executeRaw`
      UPDATE member_notifications
      SET created_at = CASE WHEN record_id=${f.otherRecord.id}::uuid
        THEN CURRENT_TIMESTAMP ELSE CURRENT_TIMESTAMP-interval '1 hour' END
      WHERE tenant_id=${f.tenantA.id}::uuid`;
    const first = await inbox('?limit=1&page=1');
    const second = await inbox('?limit=1&page=2');
    expect(first).toMatchObject({
      total: 2,
      unreadCount: 2,
      page: 1,
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await inbox('?limit=1&page=3')).items).toEqual([]);
  });

  it('read-all respects serverTime and leaves messages arriving after the snapshot unread', async () => {
    const { notification: old } = await taskNotification();
    const displayed = await inbox();
    const nextTask = await task(f.workflowRecord.id);
    await sweep();
    // Avoid a millisecond timing race without sleeping or changing the clock.
    await h.adminDatabase.$executeRaw`
      UPDATE member_notifications SET created_at=${new Date(new Date(displayed.serverTime).getTime() + 1000)}
      WHERE follow_up_id=${nextTask.id}::uuid`;
    await readAll(displayed.serverTime, displayed.snapshot).expect(201, {
      ok: true,
    });
    const result = await inbox();
    expect(result.total).toBe(2);
    expect(result.unreadCount).toBe(1);
    expect(
      result.items.find((item) => item.id === old.id)?.readAt,
    ).not.toBeNull();
    expect(result.items.find((item) => item.id !== old.id)?.readAt).toBeNull();
  });

  it('does not mark an unseen notification from a late-committing transaction read', async () => {
    await taskNotification();
    const nextTask = await task(f.workflowRecord.id);
    let commit!: () => void;
    let inserted!: () => void;
    const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const generating = h.adminDatabase.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT sweep_member_notifications(500)`;
        inserted();
        await release;
      },
      { timeout: 10000 },
    );
    let displayed!: Inbox;
    try {
      await ready;
      displayed = await inbox();
      expect(displayed.total).toBe(1);
    } finally {
      commit();
      await generating;
    }
    await readAll(displayed.serverTime, displayed.snapshot).expect(201);
    const result = await inbox();
    expect(result.total).toBe(2);
    expect(result.unreadCount).toBe(1);
    const late = await h.adminDatabase.memberNotification.findFirstOrThrow({
      where: { followUpId: nextTask.id },
    });
    expect(late.readAt).toBeNull();
  });

  it('uses the same public-pool read exception as record detail, withdrawing it when the pool is disabled', async () => {
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { poolEnabled: true },
    });
    await h.adminDatabase.record.update({
      where: { id: f.otherRecord.id },
      data: { ownerMemberId: null, inPublicPool: true, poolStage: 'LEAD_POOL' },
    });
    await task(f.otherRecord.id);
    await sweep();
    const page = await inbox();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].canOpen).toBe(true);
    const target = json<{ href: string }>(
      await get(`/${page.items[0].id}/target`).expect(200),
    );
    expect(target.href).toContain(f.otherRecord.id);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { poolEnabled: false },
    });
    expect((await inbox()).total).toBe(0);
    await get(`/${page.items[0].id}/target`).expect(200, { href: null });
  });

  it('rechecks OWN permission on click and returns a followUp link only while readable', async () => {
    const { followUp, notification } = await taskNotification();
    const target = json<{ href: string | null }>(
      await get(`/${notification.id}/target`).expect(200),
    );
    expect(target.href).toContain(`/workspace/${f.tenantA.code}/`);
    expect(target.href).toContain(f.ownedRecord.id);
    expect(target.href).toContain(`followUp=${followUp.id}`);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { ownerMemberId: f.otherEmployee.memberId },
    });
    await get(`/${notification.id}/target`).expect(200, { href: null });
    expect(await inbox()).toMatchObject({
      items: [],
      total: 0,
      unreadCount: 0,
    });
  });

  it.each(['DONE', 'CANCELLED', 'RESCHEDULED', 'REASSIGNED'])(
    'removes stale overdue notifications immediately after a task is %s',
    async (change) => {
      const { followUp, notification } = await taskNotification();
      await h.adminDatabase.recordFollowUp.update({
        where: { id: followUp.id },
        data:
          change === 'RESCHEDULED'
            ? { dueAt: new Date(Date.now() + 86_400_000) }
            : change === 'REASSIGNED'
              ? { assigneeMemberId: f.otherEmployee.memberId }
              : { status: change },
      });
      expect(await inbox()).toMatchObject({
        items: [],
        total: 0,
        unreadCount: 0,
      });
      await get(`/${notification.id}/target`).expect(200, { href: null });
    },
  );

  it('withdraws a contact deadline reminder as soon as its deadline is renewed', async () => {
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: {
        poolEnabled: true,
        poolLifecycleEnabled: true,
        poolContactTtlHours: 24,
      },
    });
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage: 'PENDING_CONTACT',
        ownershipExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await sweep();
    const page = await inbox();
    expect(page.items).toHaveLength(1);
    expect(page.items[0].kind).toBe('CONTACT_DUE');
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { ownershipExpiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await inbox()).toMatchObject({
      items: [],
      total: 0,
      unreadCount: 0,
    });
  });

  it('applies newly published table permissions before listing and opening messages', async () => {
    const { notification } = await taskNotification();
    const previous = await h.adminDatabase.objectPublication.findFirstOrThrow({
      where: { tenantId: f.tenantA.id, objectId: f.object.id },
      orderBy: { publicationNo: 'desc' },
    });
    const configuration = previous.configuration as Prisma.JsonObject;
    const publicationId = randomUUID();
    const publishedAt = new Date();
    await h.adminDatabase.objectPublication.create({
      data: {
        id: publicationId,
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        publicationNo: previous.publicationNo + 1,
        sourceDraftVersion: previous.sourceDraftVersion + 1,
        publishedByMemberId: f.admin.memberId,
        publishedAt,
        changeSummary: {},
        configuration: {
          ...configuration,
          publication: {
            id: publicationId,
            number: previous.publicationNo + 1,
            sourceDraftVersion: previous.sourceDraftVersion + 1,
            publishedAt: publishedAt.toISOString(),
          },
          employeeAccess: {
            ...(configuration.employeeAccess as Prisma.JsonObject),
            canRead: false,
            readScope: 'NONE',
          },
        },
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { activePublicationId: publicationId },
    });
    expect(await inbox()).toMatchObject({
      items: [],
      total: 0,
      unreadCount: 0,
    });
    await get(`/${notification.id}/target`).expect(200, { href: null });
  });

  it.each(['member', 'user', 'tenant'])(
    'does not expose notifications after the %s is disabled',
    async (subject) => {
      await taskNotification();
      if (subject === 'member') {
        await h.adminDatabase.tenantMember.update({
          where: { id: f.employee.memberId },
          data: { status: 'DISABLED' },
        });
      } else if (subject === 'user') {
        await h.adminDatabase.user.update({
          where: { id: f.employee.userId },
          data: { status: 'DISABLED' },
        });
      } else {
        await h.adminDatabase.tenant.update({
          where: { id: f.tenantA.id },
          data: { status: 'SUSPENDED' },
        });
      }
      const response = await get();
      expect([401, 403, 404]).toContain(response.status);
      expect(response.body).not.toHaveProperty('items');
    },
  );

  it('validates pagination, unread filters and read-all cutoff instead of treating bad input as defaults', async () => {
    for (const query of [
      '?page=0',
      '?limit=0',
      '?limit=1001',
      '?unreadOnly=garbage',
    ]) {
      await get(query).expect(400);
    }
    await readAll('not-a-date', '100:110:').expect(400);
  });
});
