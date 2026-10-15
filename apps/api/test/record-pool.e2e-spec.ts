import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { lockObject } from '../src/modules/records/record-ownership-locks';
import type { components } from '@crm/contracts';
type PoolConfig = components['schemas']['RecordPoolConfigResponseDto'];
type OwnershipResult = components['schemas']['RecordOwnershipResponseDto'];
type RecordResult = components['schemas']['RecordResponseDto'];
type PageResult = components['schemas']['RecordPageResponseDto'];
function body<T>(response: { body: unknown }): T {
  return response.body as T;
}
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);

describe('Record pool HTTP and database integration', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;
  const origin = 'http://localhost:3000';
  const path = (code = fixture.object.code) =>
    `/api/v1/workspaces/${fixture.tenantA.code}/objects/${code}`;
  const get = (url: string, actor = fixture.admin) =>
    request(harness.app.getHttpServer()).get(url).set('Cookie', actor.cookie);
  const ownership = (
    id: string,
    action: 'CLAIM' | 'RELEASE' | 'ASSIGN',
    version: number,
    actor: CriticalActor = fixture.admin,
    ownerMemberId?: string,
    code?: string,
  ) =>
    request(harness.app.getHttpServer())
      .post(`${path(code)}/records/${id}/ownership`)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send({ action, version, ...(ownerMemberId ? { ownerMemberId } : {}) });
  async function configure(
    enabled: boolean,
    hours: number | null = null,
    code?: string,
  ) {
    const current = await get(`${path(code)}/pool-config`).expect(200);
    return request(harness.app.getHttpServer())
      .patch(`${path(code)}/pool-config`)
      .set('Cookie', fixture.admin.cookie)
      .set('Origin', origin)
      .send({
        enabled,
        ownershipTtlHours: hours,
        version: body<PoolConfig>(current).version,
      })
      .expect(200);
  }
  async function createUnassigned(code?: string) {
    const response = await request(harness.app.getHttpServer())
      .post(`${path(code)}/records`)
      .set('Cookie', fixture.admin.cookie)
      .set('Origin', origin)
      .send({ values: { name: 'Unassigned, never automatically public' } })
      .expect(201);
    return response.body as { id: string; version: number };
  }

  beforeAll(async () => {
    harness = await createCriticalHarness();
    // Keep concurrent requests on one server instead of Supertest closing it per request.
    await harness.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    fixture = await provisionCriticalFixture(harness);
  });
  afterAll(async () => {
    if (harness) await closeCriticalHarness(harness);
  });

  it('imports to a selected active owner with the table deadline and never reassigns skipped rows', async () => {
    await configure(true, 24);
    const batchId = '1b6a863a-44d6-41da-87d1-5db079e8a3ae';
    const input = {
      batchId,
      ownerMemberId: fixture.employee.memberId,
      rows: [{ rowNumber: 2, values: { name: 'Assigned import' } }],
    };
    const send = (payload: object, actor = fixture.admin) =>
      request(harness.app.getHttpServer())
        .post(`${path()}/records/import`)
        .set('Cookie', actor.cookie)
        .set('Origin', origin)
        .send(payload);
    const before = await harness.adminDatabase.record.count();
    const preview = await send({ ...input, dryRun: true }).expect(201);
    expect(
      body<components['schemas']['RecordImportResponseDto']>(preview).items[0]
        .status,
    ).toBe('READY');
    expect(await harness.adminDatabase.record.count()).toBe(before);
    const response = await send(input).expect(201);
    const imported =
      body<components['schemas']['RecordImportResponseDto']>(response).items[0]
        .record!;
    expect(imported).toMatchObject({
      ownerMemberId: fixture.employee.memberId,
      inPublicPool: false,
    });
    expect(
      Date.parse(imported.ownershipExpiresAt!) - Date.now(),
    ).toBeGreaterThan(23 * 3600_000);
    const persisted = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: imported.id },
    });
    expect(persisted.ownershipExpiresAt?.toISOString()).toBe(
      imported.ownershipExpiresAt,
    );
    const retry = await send({
      ...input,
      ownerMemberId: fixture.otherEmployee.memberId,
    }).expect(201);
    expect(
      body<components['schemas']['RecordImportResponseDto']>(retry).items[0]
        .status,
    ).toBe('SKIPPED');
    expect(
      await harness.adminDatabase.record.findUnique({
        where: { id: imported.id },
      }),
    ).toEqual(persisted);
    await get(`${path()}/records/${imported.id}`, fixture.employee).expect(200);
    await get(`${path()}/records/${imported.id}`, fixture.otherEmployee).expect(
      404,
    );
  });

  it('rejects employee assignment overrides and inactive or foreign owners before import writes', async () => {
    const input = {
      ownerMemberId: fixture.otherEmployee.memberId,
      rows: [{ rowNumber: 2, values: { name: 'Forbidden assignment' } }],
    };
    const send = (payload: object, actor = fixture.admin) =>
      request(harness.app.getHttpServer())
        .post(`${path()}/records/import`)
        .set('Cookie', actor.cookie)
        .set('Origin', origin)
        .send(payload);
    const before = await harness.adminDatabase.record.count();
    await send(input, fixture.employee).expect(403);
    await send({
      ...input,
      ownerMemberId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      dryRun: true,
    }).expect(400);
    await harness.adminDatabase.tenantMember.update({
      where: { id: fixture.otherEmployee.memberId },
      data: { status: 'DISABLED' },
    });
    await send({ ...input, dryRun: true }).expect(400);
    await send(input).expect(400);
    expect(await harness.adminDatabase.record.count()).toBe(before);
  });

  it('updates 100 selected records but rejects 101 before any writes', async () => {
    const source = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.ownedRecord.id },
    });
    const records = Array.from({ length: 101 }, (_, i) => ({
      ...source,
      id: randomUUID(),
      recordNo: BigInt(1000 + i),
      data: { name: `Bulk ${i}` },
    }));
    await harness.adminDatabase.record.createMany({ data: records });
    const send = (count: number) =>
      request(harness.app.getHttpServer())
        .post(`${path()}/records/batch`)
        .set('Cookie', fixture.admin.cookie)
        .set('Origin', origin)
        .send({
          items: records
            .slice(0, count)
            .map((r) => ({ recordId: r.id, version: r.version })),
          values: { name: 'Bulk updated' },
        });
    await send(101).expect(400);
    expect(
      await harness.adminDatabase.record.count({
        where: { tenantId: fixture.tenantA.id, title: 'Bulk updated' },
      }),
    ).toBe(0);
    const response = await send(100).expect(201);
    expect(
      body<components['schemas']['RecordBatchUpdateResponseDto']>(response),
    ).toMatchObject({ updated: 100, failed: 0 });
    expect(
      await harness.adminDatabase.record.count({
        where: { tenantId: fixture.tenantA.id, title: 'Bulk updated' },
      }),
    ).toBe(100);
  });

  it('allows assigned imports, unassigned imports and ordinary creation concurrently', async () => {
    await configure(true, 24);
    const before = await harness.adminDatabase.record.count({
      where: { tenantId: fixture.tenantA.id },
    });
    const responses = await Promise.all(
      Array.from({ length: 9 }, (_, i) => {
        const values = { name: `Concurrent ${i}` };
        return request(harness.app.getHttpServer())
          .post(`${path()}/records${i % 3 === 2 ? '' : '/import'}`)
          .set(
            'Cookie',
            i % 3 === 0 ? fixture.admin.cookie : fixture.otherEmployee.cookie,
          )
          .set('Origin', origin)
          .send(
            i % 3 === 2
              ? { values }
              : {
                  matchFields: ['name'],
                  rows: [{ rowNumber: 2, values }],
                  ...(i % 3 === 0
                    ? { ownerMemberId: fixture.employee.memberId }
                    : {}),
                },
          );
      }),
    );
    expect(responses.map((response) => response.status)).toEqual(
      Array(9).fill(201),
    );
    expect(
      await harness.adminDatabase.record.count({
        where: { tenantId: fixture.tenantA.id },
      }),
    ).toBe(before + 9);
  });

  it('allows record foreign-key checks while ownership configuration is locked', async () => {
    await harness.adminDatabase.$transaction(async (tx) => {
      await lockObject(
        tx,
        {
          tenantId: fixture.tenantA.id,
          tenantCode: fixture.tenantA.code,
          userId: fixture.admin.userId,
          memberId: fixture.admin.memberId,
          role: 'TENANT_ADMIN',
        },
        fixture.object.code,
      );
      await harness.adminDatabase.$transaction(async (other) => {
        await other.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
        await other.$queryRaw`SELECT id FROM object_definitions WHERE id = ${fixture.object.id}::uuid FOR KEY SHARE`;
      });
    });
  });

  it('defaults off and enabling one table does not change existing records or other tables', async () => {
    const unassigned = await createUnassigned();
    const before = await harness.adminDatabase.record.findMany({
      where: { tenantId: fixture.tenantA.id },
      orderBy: { id: 'asc' },
    });
    const config = await get(`${path()}/pool-config`).expect(200);
    expect(body<PoolConfig>(config)).toMatchObject({
      enabled: false,
      ownershipTtlHours: null,
    });
    await configure(true, 24);
    const after = await harness.adminDatabase.record.findMany({
      where: { tenantId: fixture.tenantA.id },
      orderBy: { id: 'asc' },
    });
    expect(after).toEqual(before);
    const pool = await get(
      `${path()}/records?scope=pool`,
      fixture.employee,
    ).expect(200);
    expect(body<PageResult>(pool).items).toEqual([]);
    await get(`${path()}/records/${unassigned.id}`, fixture.employee).expect(
      404,
    );
    const other = await get(`${path('invoices')}/pool-config`).expect(200);
    expect(body<PoolConfig>(other).enabled).toBe(false);
  });

  it('releases, previews without hidden fields, and claims the same record with a new deadline', async () => {
    await configure(true, 24);
    const original = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.ownedRecord.id },
    });
    const released = await ownership(
      original.id,
      'RELEASE',
      original.version,
      fixture.employee,
    ).expect(201);
    const pool = await get(
      `${path()}/records?scope=pool`,
      fixture.otherEmployee,
    ).expect(200);
    expect(
      body<PageResult>(pool).items.map((r: { id: string }) => r.id),
    ).toContain(original.id);
    expect(body<PageResult>(pool).items[0].values).not.toHaveProperty('secret');
    const preview = await get(
      `${path()}/records/${original.id}`,
      fixture.otherEmployee,
    ).expect(200);
    expect(body<RecordResult>(preview)).toMatchObject({
      inPublicPool: true,
      ownerMemberId: null,
      ownershipExpiresAt: null,
    });
    expect(body<RecordResult>(preview).values).not.toHaveProperty('secret');
    await request(harness.app.getHttpServer())
      .patch(`${path()}/records/${original.id}`)
      .set('Cookie', fixture.otherEmployee.cookie)
      .set('Origin', origin)
      .send({
        version: body<OwnershipResult>(released).version,
        values: { name: 'Must claim first' },
      })
      .expect(404);
    await ownership(
      original.id,
      'CLAIM',
      body<OwnershipResult>(released).version,
      fixture.otherEmployee,
    ).expect(201);
    const claimed = await get(
      `${path()}/records/${original.id}`,
      fixture.otherEmployee,
    ).expect(200);
    expect(body<RecordResult>(claimed)).toMatchObject({
      ownerMemberId: fixture.otherEmployee.memberId,
      inPublicPool: false,
    });
    expect(
      Date.parse(body<RecordResult>(claimed).ownershipExpiresAt!) - Date.now(),
    ).toBeGreaterThan(23 * 3600_000);
    expect(body<RecordResult>(claimed).values.name).toBe(
      original.data && (original.data as { name: string }).name,
    );
    await get(`${path()}/records/${original.id}`, fixture.employee).expect(404);
    const mine = await get(
      `${path()}/records?scope=mine`,
      fixture.otherEmployee,
    ).expect(200);
    expect(
      body<PageResult>(mine).items.map((r: { id: string }) => r.id),
    ).toContain(original.id);
  });

  it('has one winner for simultaneous claims and prevents replay', async () => {
    await configure(true);
    const released = await ownership(
      fixture.ownedRecord.id,
      'RELEASE',
      fixture.ownedRecord.version,
    ).expect(201);
    const attempts = await Promise.all([
      ownership(
        fixture.ownedRecord.id,
        'CLAIM',
        body<OwnershipResult>(released).version,
        fixture.employee,
      ),
      ownership(
        fixture.ownedRecord.id,
        'CLAIM',
        body<OwnershipResult>(released).version,
        fixture.otherEmployee,
      ),
    ]);
    expect(attempts.filter((result) => result.status === 201)).toHaveLength(1);
    expect(
      attempts.filter((result) => [404, 409].includes(result.status)),
    ).toHaveLength(1);
    const saved = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.ownedRecord.id },
    });
    expect(saved.version).toBe(body<OwnershipResult>(released).version + 1);
    expect([
      fixture.employee.memberId,
      fixture.otherEmployee.memberId,
    ]).toContain(saved.ownerMemberId);
    const winner =
      saved.ownerMemberId === fixture.employee.memberId
        ? fixture.employee
        : fixture.otherEmployee;
    await ownership(
      fixture.ownedRecord.id,
      'CLAIM',
      body<OwnershipResult>(released).version,
      winner,
    ).expect(409);
  });

  it('administrator assigns old unassigned data and ordinary edits do not extend its deadline', async () => {
    const record = await createUnassigned();
    await configure(true, 48);
    const assigned = await ownership(
      record.id,
      'ASSIGN',
      record.version,
      fixture.admin,
      fixture.employee.memberId,
    ).expect(201);
    const before = await get(
      `${path()}/records/${record.id}`,
      fixture.employee,
    ).expect(200);
    expect(body<RecordResult>(before)).toMatchObject({
      inPublicPool: false,
      ownerMemberId: fixture.employee.memberId,
    });
    expect(body<RecordResult>(before).ownershipExpiresAt).toBeTruthy();
    await request(harness.app.getHttpServer())
      .patch(`${path()}/records/${record.id}`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', origin)
      .send({
        version: body<OwnershipResult>(assigned).version,
        values: { name: 'Updated without extending ownership' },
      })
      .expect(200);
    const after = await get(
      `${path()}/records/${record.id}`,
      fixture.employee,
    ).expect(200);
    expect(body<RecordResult>(after).ownershipExpiresAt).toBe(
      body<RecordResult>(before).ownershipExpiresAt,
    );
  });

  it('rejects employee settings, assignment, all-private scope and releasing another owner', async () => {
    await configure(true);
    await request(harness.app.getHttpServer())
      .patch(`${path()}/pool-config`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', origin)
      .send({ enabled: true, ownershipTtlHours: null, version: 2 })
      .expect(403);
    await ownership(
      fixture.otherRecord.id,
      'RELEASE',
      fixture.otherRecord.version,
      fixture.employee,
    ).expect((result) => {
      expect([403, 404]).toContain(result.status);
    });
    await ownership(
      fixture.ownedRecord.id,
      'ASSIGN',
      fixture.ownedRecord.version,
      fixture.employee,
      fixture.otherEmployee.memberId,
    ).expect(403);
    await get(`${path()}/records?scope=all`, fixture.employee).expect(403);
    await get(`${path()}/pool-config`, fixture.tenantBAdmin).expect(403);
    await ownership(
      fixture.ownedRecord.id,
      'ASSIGN',
      fixture.ownedRecord.version,
      fixture.admin,
      fixture.tenantBAdmin.memberId,
    ).expect(400);
    await harness.adminDatabase.tenantMember.update({
      where: { id: fixture.otherEmployee.memberId },
      data: { status: 'DISABLED' },
    });
    await ownership(
      fixture.ownedRecord.id,
      'ASSIGN',
      fixture.ownedRecord.version,
      fixture.admin,
      fixture.otherEmployee.memberId,
    ).expect(400);
  });

  it('allows read-only pool preview but denies claiming or editing it', async () => {
    await configure(true, null, 'invoices');
    const record = await createUnassigned('invoices');
    const released = await ownership(
      record.id,
      'RELEASE',
      record.version,
      fixture.admin,
      undefined,
      'invoices',
    ).expect(201);
    const page = await get(
      `${path('invoices')}/records?scope=pool`,
      fixture.employee,
    ).expect(200);
    expect(
      body<PageResult>(page).items.map((r: { id: string }) => r.id),
    ).toContain(record.id);
    await ownership(
      record.id,
      'CLAIM',
      body<OwnershipResult>(released).version,
      fixture.employee,
      undefined,
      'invoices',
    ).expect(403);
  });

  it('detects stale settings and disabling preserves state while stopping employee pool actions', async () => {
    const config = await configure(true, 12);
    await request(harness.app.getHttpServer())
      .patch(`${path()}/pool-config`)
      .set('Cookie', fixture.admin.cookie)
      .set('Origin', origin)
      .send({
        enabled: true,
        ownershipTtlHours: 6,
        version: body<PoolConfig>(config).version - 1,
      })
      .expect(409);
    const released = await ownership(
      fixture.ownedRecord.id,
      'RELEASE',
      fixture.ownedRecord.version,
    ).expect(201);
    const before = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.ownedRecord.id },
    });
    await configure(false, 12);
    expect(
      await harness.adminDatabase.record.findUniqueOrThrow({
        where: { id: fixture.ownedRecord.id },
      }),
    ).toEqual(before);
    await ownership(
      fixture.ownedRecord.id,
      'CLAIM',
      body<OwnershipResult>(released).version,
      fixture.employee,
    ).expect((result) => expect([400, 403]).toContain(result.status));
    await get(
      `${path()}/records/${fixture.ownedRecord.id}`,
      fixture.employee,
    ).expect(404);
    await ownership(
      fixture.ownedRecord.id,
      'ASSIGN',
      body<OwnershipResult>(released).version,
      fixture.admin,
      fixture.employee.memberId,
    ).expect(201);
  });
  it('reclaims expired ownership atomically with runtime DB privileges, preserving private and future records', async () => {
    await configure(true, 1);
    const unassigned = await createUnassigned();
    const assigned = await ownership(
      fixture.ownedRecord.id,
      'ASSIGN',
      fixture.ownedRecord.version,
      fixture.admin,
      fixture.employee.memberId,
    ).expect(201);
    await ownership(
      fixture.otherRecord.id,
      'ASSIGN',
      fixture.otherRecord.version,
      fixture.admin,
      fixture.otherEmployee.memberId,
    ).expect(201);
    await harness.adminDatabase.$executeRaw`
      UPDATE records SET ownership_expires_at = CURRENT_TIMESTAMP - interval '1 minute'
      WHERE id = ${fixture.ownedRecord.id}::uuid
    `;
    const sweep = () => harness.runtimeDatabase.$queryRaw<
      Array<{ count: number }>
    >`
      SELECT public.reclaim_expired_record_ownership(100) AS count
    `;
    // Disabled settings pause reclamation even for already-expired ownership.
    await configure(false, 1);
    expect((await sweep())[0].count).toBe(0);
    await configure(true, 1);
    expect((await sweep())[0].count).toBe(1);
    expect((await sweep())[0].count).toBe(0);
    const reclaimed = await get(
      `${path()}/records/${fixture.ownedRecord.id}`,
      fixture.otherEmployee,
    ).expect(200);
    expect(body<RecordResult>(reclaimed)).toMatchObject({
      ownerMemberId: null,
      inPublicPool: true,
      ownershipExpiresAt: null,
      version: body<OwnershipResult>(assigned).version + 1,
    });
    const privateRecord = await get(
      `${path()}/records/${unassigned.id}`,
    ).expect(200);
    expect(body<RecordResult>(privateRecord)).toMatchObject({
      ownerMemberId: null,
      inPublicPool: false,
      ownershipExpiresAt: null,
    });
    const futureRecord = await get(
      `${path()}/records/${fixture.otherRecord.id}`,
    ).expect(200);
    expect(body<RecordResult>(futureRecord).inPublicPool).toBe(false);
    const audits = await harness.adminDatabase.auditLog.findMany({
      where: {
        resourceId: fixture.ownedRecord.id,
        action: 'record.ownership_reclaimed',
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorType).toBe('SYSTEM');
    expect(audits[0].before).toMatchObject({
      ownerMemberId: fixture.employee.memberId,
    });
    expect(audits[0].after).toMatchObject({
      inPublicPool: true,
      ownerMemberId: null,
    });
  });
});
