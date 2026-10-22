import request from 'supertest';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
interface Row {
  id: string;
  version: number;
  poolStage: string | null;
  poolOrigin: string | null;
  poolQuality: string | null;
  ownerMemberId: string | null;
  ownershipExpiresAt: string | null;
  poolLastFollowUpAt: string | null;
}
interface Config {
  version: number;
  preview?: { legacyUnassigned: number };
  permissions?: { readScope: string };
  protectionSources?: unknown[];
}
interface Imported {
  created: number;
  items: Array<{ record: Row; status: string }>;
}
const json = <T>(response: { body: unknown }) => response.body as T;
jest.setTimeout(120_000);
describe('generic record pool lifecycle HTTP', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const path = () =>
    `/api/v1/workspaces/${f.tenantA.code}/objects/${f.object.code}`;
  const get = (suffix: string, actor: CriticalActor = f.admin) =>
    request(h.app.getHttpServer())
      .get(path() + suffix)
      .set('Cookie', actor.cookie);
  const post = (
    suffix: string,
    payload: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      .post(path() + suffix)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .send(payload);
  const state = (id: string) =>
    h.adminDatabase.record.findUniqueOrThrow({ where: { id } });
  async function configure(extra: object = {}) {
    const current = json<Config>(await get('/pool-config').expect(200));
    return request(h.app.getHttpServer())
      .patch(path() + '/pool-config')
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        enabled: true,
        lifecycleEnabled: true,
        ownershipTtlHours: null,
        contactTtlHours: 24,
        followUpTtlHours: 720,
        version: current.version,
        ...extra,
      })
      .expect(200);
  }
  const ownership = (
    row: { id: string; version: number },
    action: string,
    extra: object = {},
    actor: CriticalActor = f.admin,
  ) =>
    post(
      `/records/${row.id}/ownership`,
      { action, version: row.version, ...extra },
      actor,
    );
  async function pool() {
    const result = json<Imported>(
      await post('/records/import', {
        importToPool: true,
        rows: [{ rowNumber: 2, values: { name: 'Lifecycle resource' } }],
      }).expect(201),
    );
    expect(result.created).toBe(1);
    return result.items[0].record;
  }
  beforeAll(async () => {
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  it('enables without enrolling legacy data, previews only for admin and explicitly classifies legacy records', async () => {
    const old = await state(f.ownedRecord.id);
    const legacy = json<Row>(
      await post('/records', { values: { name: 'Legacy unassigned' } }).expect(
        201,
      ),
    );
    await configure();
    const after = await state(old.id);
    const adminSettings = json<Config>(await get('/pool-config').expect(200));
    expect(adminSettings.permissions?.readScope).toBe('OWN');
    expect(after).toEqual(old);
    expect(after.poolStage).toBeNull();
    const employee = json<Config>(
      await get('/pool-config', f.employee).expect(200),
    );
    expect(employee.preview).toBeUndefined();
    expect(employee.protectionSources).toBeUndefined();
    expect(employee.permissions?.readScope).toBe('OWN');
    expect((await state(legacy.id)).poolStage).toBeNull();
    await ownership(legacy, 'RELEASE', { reason: '分类' }).expect(400);
    await ownership(legacy, 'RELEASE', {
      reason: '确认资源进入线索池',
      poolStage: 'LEAD_POOL',
    }).expect(201);
    expect((await state(legacy.id)).poolStage).toBe('LEAD_POOL');
    // Records created once the lifecycle is on are placed, not left unclassified.
    const created = json<Row>(
      await post('/records', { values: { name: 'New unassigned' } }).expect(
        201,
      ),
    );
    expect(created.poolStage).toBe('LEAD_POOL');
    expect(created.ownerMemberId).toBeNull();
  });
  it('resolves a claim racing the lead creator as a conflict, never a deadlock', async () => {
    // The winner's second write re-checks every foreign key on its own fresh
    // row version, including created_by → the creator's member row, which the
    // creator's request locks first. Member locks must not block those checks.
    await configure();
    for (let round = 0; round < 6; round += 1) {
      const row = await pool();
      const attempts = await Promise.all([
        ownership(row, 'CLAIM', {}, f.employee),
        ownership(row, 'CLAIM', {}, f.admin),
      ]);
      for (const attempt of attempts)
        expect([201, 404, 409]).toContain(attempt.status);
      expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    }
  });
  it('claims once under contention, confirms contact, renews only by activity and releases with quality', async () => {
    await configure();
    const row = await pool();
    expect(row.poolStage).toBe('LEAD_POOL');
    expect(row.ownerMemberId).toBeNull();
    const claimed = await Promise.all([
      ownership(row, 'CLAIM', {}, f.employee),
      ownership(row, 'CLAIM', {}, f.otherEmployee),
    ]);
    expect(claimed.filter((r) => r.status === 201)).toHaveLength(1);
    expect(claimed.filter((r) => [404, 409].includes(r.status))).toHaveLength(
      1,
    );
    const pending = await state(row.id);
    const actor =
      pending.ownerMemberId === f.employee.memberId
        ? f.employee
        : f.otherEmployee;
    expect(pending.poolOrigin).toBe('LEAD_POOL');
    expect(pending.poolStage).toBe('PENDING_CONTACT');
    await post(
      `/records/${row.id}/activities`,
      { activityType: 'NOTE', content: '初次尝试联系' },
      actor,
    ).expect(201);
    expect((await state(row.id)).ownershipExpiresAt).toEqual(
      pending.ownershipExpiresAt,
    );
    await ownership(pending, 'CONFIRM_CONTACT', {}, actor).expect(201);
    const following = await state(row.id);
    expect(following.poolStage).toBe('FOLLOWING');
    expect(
      following.ownershipExpiresAt!.getTime() - Date.now(),
    ).toBeGreaterThan(719 * 3600_000);
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: { ownershipExpiresAt: new Date(Date.now() + 3600_000) },
    });
    await post(
      `/records/${row.id}/activities`,
      {
        activityType: 'MESSAGE',
        content: '客户沟通结果',
        nextActionAt: new Date(Date.now() + 86400_000).toISOString(),
      },
      actor,
    ).expect(201);
    const renewed = await state(row.id);
    expect(renewed.ownershipExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      719 * 3600_000,
    );
    expect(renewed.poolLastFollowUpAt).not.toBeNull();
    await ownership(renewed, 'RELEASE', {}, actor).expect(400);
    await ownership(
      renewed,
      'RELEASE',
      { reason: '重复资源', quality: 'DUPLICATE' },
      actor,
    ).expect(201);
    const released = await state(row.id);
    expect(released.poolStage).toBe('CUSTOMER_POOL');
    expect(released.poolQuality).toBe('DUPLICATE');
    expect(released.ownerMemberId).toBeNull();
    expect(released.ownershipExpiresAt).toBeNull();
  });
  it('blocks overdue contact and followup before sweep and returns records to the correct pool', async () => {
    await configure();
    const row = await pool();
    await ownership(row, 'CLAIM', {}, f.employee).expect(201);
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: { ownershipExpiresAt: new Date(Date.now() - 1000) },
    });
    const overdue = await state(row.id);
    await ownership(overdue, 'CONFIRM_CONTACT', {}, f.employee).expect(409);
    await h.runtimeDatabase
      .$queryRaw`SELECT reclaim_expired_record_ownership(100)`;
    expect((await state(row.id)).poolStage).toBe('LEAD_POOL');
    const lead = await state(row.id);
    await ownership(lead, 'CLAIM', {}, f.employee).expect(201);
    await ownership(
      await state(row.id),
      'CONFIRM_CONTACT',
      {},
      f.employee,
    ).expect(201);
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: { ownershipExpiresAt: new Date(Date.now() - 1000) },
    });
    await post(
      `/records/${row.id}/activities`,
      { activityType: 'NOTE', content: '已过期不可续期' },
      f.employee,
    ).expect(409);
    await h.runtimeDatabase
      .$queryRaw`SELECT reclaim_expired_record_ownership(100)`;
    expect((await state(row.id)).poolStage).toBe('CUSTOMER_POOL');
  });
  it('validates import target exclusivity and active target table permissions', async () => {
    const payload = {
      importToPool: true,
      rows: [{ rowNumber: 2, values: { name: 'Import target' } }],
    };
    await post('/records/import', payload).expect(403);
    await configure();
    await post('/records/import', {
      ...payload,
      ownerMemberId: f.employee.memberId,
    }).expect(400);
    await post('/records/import', payload, f.employee).expect(403);
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.otherEmployee.memberId,
        canRead: true,
        canUpdate: false,
        readScope: 'ALL',
        updateScope: 'NONE',
      },
    });
    const row = await pool();
    await ownership(row, 'ASSIGN', {
      ownerMemberId: f.otherEmployee.memberId,
    }).expect(400);
    await post('/records/import', {
      ownerMemberId: f.otherEmployee.memberId,
      rows: payload.rows,
    }).expect(400);
    const imported = json<Imported>(
      await post('/records/import', {
        ownerMemberId: f.employee.memberId,
        rows: payload.rows,
      }).expect(201),
    );
    expect(imported.items[0].record.poolStage).toBe('PENDING_CONTACT');
  });
  it('filters and counts visible stages without leaking other private records and filters quality', async () => {
    await configure();
    const a = await pool(),
      b = await pool();
    await ownership(a, 'CLAIM', {}, f.employee).expect(201);
    await ownership(b, 'CLAIM', {}, f.otherEmployee).expect(201);
    const result = json<{ items: Row[]; poolCounts: Record<string, number> }>(
      await get(
        '/records?poolStage=PENDING_CONTACT&scope=mine',
        f.employee,
      ).expect(200),
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe(a.id);
    expect(result.poolCounts.PENDING_CONTACT).toBe(1);
    const own = await state(a.id);
    await ownership(
      own,
      'RELEASE',
      { reason: '空号', quality: 'INVALID' },
      f.employee,
    ).expect(201);
    const publicResult = json<{
      items: Row[];
      poolCounts: Record<string, number>;
    }>(
      await get(
        '/records?poolStage=LEAD_POOL&poolQuality=INVALID',
        f.employee,
      ).expect(200),
    );
    expect(publicResult.items.map((r) => r.id)).toEqual([a.id]);
    expect(publicResult.poolCounts.PENDING_CONTACT).toBe(0);
    const allCounts = json<{ poolCounts: Record<string, number> }>(
      await get('/records?scope=pool', f.otherEmployee).expect(200),
    );
    expect(allCounts.poolCounts.LEAD_POOL).toBe(1);
    expect(allCounts.poolCounts.PENDING_CONTACT).toBe(1);
  });
  it('keeps normal edits and legacy activity outside lifecycle and pauses renewal/reclaim while closed', async () => {
    await configure();
    const legacyBefore = await state(f.ownedRecord.id);
    await post(
      `/records/${legacyBefore.id}/activities`,
      { activityType: 'NOTE', content: '旧数据不入新流程' },
      f.employee,
    ).expect(201);
    expect(await state(legacyBefore.id)).toEqual(legacyBefore);
    const row = await pool();
    await ownership(row, 'CLAIM', {}, f.employee).expect(201);
    await ownership(
      await state(row.id),
      'CONFIRM_CONTACT',
      {},
      f.employee,
    ).expect(201);
    const before = await state(row.id);
    await request(h.app.getHttpServer())
      .patch(`${path()}/records/${row.id}`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ version: before.version, values: { name: '普通编辑' } })
      .expect(200);
    expect((await state(row.id)).ownershipExpiresAt).toEqual(
      before.ownershipExpiresAt,
    );
    await configure({ enabled: false });
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: { ownershipExpiresAt: new Date(Date.now() - 1000) },
    });
    const paused = await state(row.id);
    await post(
      `/records/${row.id}/activities`,
      { activityType: 'NOTE', content: '关闭期间保留跟进历史' },
      f.employee,
    ).expect(201);
    await h.runtimeDatabase
      .$queryRaw`SELECT reclaim_expired_record_ownership(100)`;
    expect(await state(row.id)).toEqual(paused);
  });
  it('refuses downgrading enrolled lifecycle records and accepts closing the pool', async () => {
    await configure();
    await pool();
    const current = json<Config>(await get('/pool-config').expect(200));
    await request(h.app.getHttpServer())
      .patch(path() + '/pool-config')
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        enabled: true,
        lifecycleEnabled: false,
        ownershipTtlHours: null,
        version: current.version,
      })
      .expect(400);
    await configure({ enabled: false });
  });

  it('validates ordinary owner writes and prevents clearing protection outside the explicit command', async () => {
    await configure();
    const row = await pool();
    await ownership(row, 'ASSIGN', {
      ownerMemberId: f.employee.memberId,
    }).expect(201);
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.otherEmployee.memberId,
        canRead: true,
        canUpdate: false,
        readScope: 'ALL',
        updateScope: 'NONE',
      },
    });
    const patch = (payload: object) =>
      request(h.app.getHttpServer())
        .patch(`${path()}/records/${row.id}`)
        .set('Cookie', f.admin.cookie)
        .set('Origin', 'http://localhost:3000')
        .send(payload);
    let current = await state(row.id);
    await patch({
      version: current.version,
      ownerMemberId: f.otherEmployee.memberId,
    }).expect(400);
    await patch({ version: current.version, ownerMemberId: null }).expect(403);
    await ownership(current, 'CONFIRM_CONTACT').expect(201);
    current = await state(row.id);
    await patch({ version: current.version, ownerMemberId: null }).expect(403);
    await h.adminDatabase.record.update({
      where: { id: row.id },
      data: {
        poolStage: 'PROTECTED',
        poolProtectedAt: new Date(),
        ownershipExpiresAt: null,
      },
    });
    await patch({ version: current.version, ownerMemberId: null }).expect(403);
    await ownership(await state(row.id), 'ASSIGN', {
      ownerMemberId: f.admin.memberId,
    }).expect(201);
    expect((await state(row.id)).poolStage).toBe('PROTECTED');
    await ownership(await state(row.id), 'UNPROTECT_RELEASE', {
      reason: '管理员确认解除',
    }).expect(201);
    expect((await state(row.id)).poolStage).toBe('CUSTOMER_POOL');
  });
  it('keeps a fresh contact deadline when an administrator transfers while the pool is paused', async () => {
    await configure();
    const row = await pool();
    await ownership(row, 'ASSIGN', {
      ownerMemberId: f.employee.memberId,
    }).expect(201);
    await ownership(await state(row.id), 'CONFIRM_CONTACT').expect(201);
    await configure({ enabled: false });
    const before = await state(row.id);
    await request(h.app.getHttpServer())
      .patch(`${path()}/records/${row.id}`)
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        version: before.version,
        ownerMemberId: f.otherEmployee.memberId,
      })
      .expect(200);
    const moved = await state(row.id);
    expect(moved.poolStage).toBe('PENDING_CONTACT');
    expect(moved.ownershipExpiresAt).not.toBeNull();
    expect(moved.ownershipExpiresAt!.getTime() - Date.now()).toBeGreaterThan(
      23 * 3600_000,
    );
  });
});
