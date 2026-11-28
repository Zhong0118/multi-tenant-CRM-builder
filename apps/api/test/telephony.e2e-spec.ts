import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { KuaimaProvider } from '../src/modules/integrations/telephony/telephony-provider';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  CRITICAL_TENANT_A,
  CRITICAL_TENANT_B,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';
import { seatUsername } from '../src/modules/integrations/telephony/telephony-seats';
import {
  assertLocalTestDatabase,
  assignPlan,
  cleanupTelephony,
  configureLine,
  createPlan,
  promotePlatformAdmin,
  TELEPHONY_KEYRING,
} from './helpers/telephony-fixture';

jest.setTimeout(120_000);
const origin = 'http://localhost:3000';
function json(response: { body: unknown }): {
  id: string;
  status: string;
  total: number;
  hasAppSecret: boolean;
  items: Array<{ id: string }>;
  fields: Array<{ fieldKey: string }>;
} {
  return response.body as ReturnType<typeof json>;
}
describe('tenant telephony', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let outbound: jest.SpyInstance;
  let confirmedMode = 'MOCK';
  let hookToken = '';
  let planId = '';
  let unrelatedActivitySnapshot: unknown;
  const unrelatedActivities = () =>
    h.adminDatabase.recordActivity.findMany({
      where: {
        tenant: { code: { notIn: [CRITICAL_TENANT_A, CRITICAL_TENANT_B] } },
      },
      orderBy: { id: 'asc' },
    });
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/telephony`;
  const get = (path: string, cookie = f.admin.cookie) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', cookie);
  const patch = (path: string, body: object, cookie = f.admin.cookie) =>
    request(h.app.getHttpServer())
      .patch(path)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send(body);
  const dial = (body: object = {}, cookie = f.employee.cookie) =>
    request(h.app.getHttpServer())
      .post(`${base()}/calls`)
      .set('Origin', origin)
      .set('Cookie', cookie)
      .send({
        requestId: randomUUID(),
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        fieldKey: 'reviewCode',
        confirmation: {
          mode: confirmedMode,
          callerPhone: '13911113002',
          calleePhone: '13812345678',
        },
        ...body,
      });
  beforeAll(async () => {
    assertLocalTestDatabase();
    process.env.AI_MODEL_KEYRING = TELEPHONY_KEYRING;
    process.env.TELEPHONY_LIVE_ENABLED = 'false';
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(
          new Error('Outbound network forbidden in local telephony test'),
        ),
      );
    h = await createCriticalHarness();
    h.app.get(ConfigService).set('AI_MODEL_KEYRING', TELEPHONY_KEYRING);
    h.app.get(ConfigService).set('TELEPHONY_LIVE_ENABLED', 'false');
    unrelatedActivitySnapshot = await unrelatedActivities();
  });
  beforeEach(async () => {
    await cleanupTelephony(h);
    f = await provisionCriticalFixture(h);
    await promotePlatformAdmin(h, f);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        data: {
          name: '客户',
          reviewCode: '+8613812345678',
          secret: '13912345678',
        },
      },
    });
  });
  afterAll(async () => {
    await cleanupTelephony(h);
    expect(await unrelatedActivities()).toEqual(unrelatedActivitySnapshot);
    await closeCriticalHarness(h);
    outbound.mockRestore();
  });
  /** The platform opens the line and assigns a plan; the member gets a seat. */
  async function setup(mode: 'MOCK' | 'KUAIMA' = 'MOCK') {
    confirmedMode = mode;
    hookToken = await configureLine(h, f, mode);
    planId = (await createPlan(h, f)).id;
    await assignPlan(h, f, f.tenantA.id, planId);
    const setting = await patch(`${base()}/settings`, {
      version: 0,
      phoneFields: [{ objectCode: 'leads', fieldKeys: ['reviewCode', 'name'] }],
    });
    expect(setting.status).toBe(200);
    // Seat creation needs the supplier; tests that dial start with a saved seat.
    await h.adminDatabase.telephonyMemberBinding.create({
      data: {
        tenantId: f.tenantA.id,
        memberId: f.employee.memberId,
        enabled: true,
        seatId: 'seat-1',
        phone: '13911113002',
        providerUsername: seatUsername(f.employee.memberId),
        seatCreatedAt: new Date(),
      },
    });
  }
  it('requires login and admin for settings and bindings', async () => {
    expect(
      (await request(h.app.getHttpServer()).get(`${base()}/settings`)).status,
    ).toBe(401);
    expect((await get(`${base()}/settings`, f.employee.cookie)).status).toBe(
      403,
    );
    expect(
      (
        await patch(
          `${base()}/settings`,
          { version: 0, phoneFields: [] },
          f.employee.cookie,
        )
      ).status,
    ).toBe(403);
    expect((await get(`${base()}/members`, f.employee.cookie)).status).toBe(
      403,
    );
  });
  it('keeps calling closed until the platform assigns a plan', async () => {
    await configureLine(h, f, 'MOCK');
    expect(
      (await get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({
      enabled: false,
      hasHistory: false,
      available: false,
      reason: 'NOT_ENABLED',
    });
    expect((await get(`${base()}/settings`)).body).toMatchObject({
      plan: null,
      usage: { usedMinutes: 0, allowance: 0 },
    });
    const closed = await patch(`${base()}/settings`, {
      version: 0,
      phoneFields: [],
    });
    expect(closed.status).toBe(403);
    expect(closed.body).toMatchObject({
      fieldErrors: { telephony: ['NOT_ENABLED'] },
    });
    expect(
      (
        await patch(`${base()}/members/${f.employee.memberId}`, {
          version: 0,
          enabled: true,
          phone: '13911113002',
        })
      ).status,
    ).toBe(403);
    await setup();
    expect((await get(`${base()}/settings`)).body).toMatchObject({
      version: 1,
      plan: { seats: 3, monthlyMinutes: 100 },
      usage: { usedMinutes: 0, allowance: 100, seatsEnabled: 1 },
      lineReady: true,
    });
    expect(
      (await get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({
      enabled: true,
      available: true,
      reason: null,
      mode: 'MOCK',
    });
    expect(
      (await patch(`${base()}/settings`, { version: 0, phoneFields: [] }))
        .status,
    ).toBe(409);
  });
  it('takes caller only from actor binding, is concurrent-idempotent, and mock does not touch record or activities', async () => {
    await setup();
    const before = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    const requestId = randomUUID();
    const results = await Promise.all([
      dial({ requestId }),
      dial({ requestId }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(json(results[0]).id).toBe(json(results[1]).id);
    expect(results[0].body).toMatchObject({
      actorMemberId: f.employee.memberId,
      callerPhone: '13911113002',
      calleePhone: '13812345678',
      mode: 'MOCK',
      status: 'CONNECTED',
    });
    expect((await dial({ caller: '13899999999' })).status).toBe(400);
    expect(
      await h.adminDatabase.record.findUnique({
        where: { id: f.ownedRecord.id },
      }),
    ).toEqual(before);
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(0);
    expect(
      await h.adminDatabase.telephonyCall.findMany({
        where: { tenantId: f.tenantA.id },
      }),
    ).toHaveLength(1);
  });
  it('requires a complete confirmation snapshot before creating a call', async () => {
    await setup();
    for (const confirmation of [
      undefined,
      null,
      [],
      {},
      { mode: 'MOCK', callerPhone: '13911113002' },
    ]) {
      expect((await dial({ confirmation })).status).toBe(400);
    }
    expect(
      await h.adminDatabase.telephonyCall.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
  });
  it.each(['caller', 'callee', 'mode'])(
    'rejects an unpersisted retry after confirmed %s changes without dialing',
    async (changed) => {
      await setup();
      const requestId = randomUUID();
      await assignPlan(h, f, f.tenantA.id, null);
      expect((await dial({ requestId })).status).toBe(503);
      expect(
        await h.adminDatabase.telephonyCall.count({
          where: { tenantId: f.tenantA.id },
        }),
      ).toBe(0);
      await assignPlan(h, f, f.tenantA.id, planId);
      if (changed === 'mode') await configureLine(h, f, 'KUAIMA');
      if (changed === 'caller')
        await patch(`${base()}/members/${f.employee.memberId}`, {
          version: 1,
          enabled: true,
          phone: '13911113003',
        });
      if (changed === 'callee')
        await h.adminDatabase.record.update({
          where: { id: f.ownedRecord.id },
          data: { data: { name: '客户', reviewCode: '13812345679' } },
        });
      const provider = jest.spyOn(h.app.get(KuaimaProvider), 'dial');
      try {
        const retry = await dial({ requestId });
        expect(retry.status).toBe(409);
        expect(retry.body).toMatchObject({
          code: 'CONFIG_VERSION_CONFLICT',
          fieldErrors: { confirmation: ['TELEPHONY_CONFIRMATION_CHANGED'] },
        });
        expect(JSON.stringify(retry.body)).not.toMatch(
          /13911113003|13812345679/,
        );
        expect(
          await h.adminDatabase.telephonyCall.count({
            where: { tenantId: f.tenantA.id },
          }),
        ).toBe(0);
        expect(provider).not.toHaveBeenCalled();
      } finally {
        provider.mockRestore();
      }
    },
  );
  it('checks confirmation on the initial POST and normalizes equivalent phone prefixes', async () => {
    await setup();
    const stale = await dial({
      confirmation: {
        mode: 'MOCK',
        callerPhone: '13911113002',
        calleePhone: '13812345679',
      },
    });
    expect(stale.status).toBe(409);
    expect(
      await h.adminDatabase.telephonyCall.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(0);
    expect(
      (
        await dial({
          confirmation: {
            mode: 'MOCK',
            callerPhone: '+8613911113002',
            calleePhone: '+8613812345678',
          },
        })
      ).status,
    ).toBe(201);
  });
  it('returns a persisted request before comparing confirmation with changed settings or numbers', async () => {
    await setup();
    const requestId = randomUUID();
    const original = await dial({ requestId });
    expect(original.status).toBe(201);
    await assignPlan(h, f, f.tenantA.id, null);
    await configureLine(h, f, 'KUAIMA');
    await h.adminDatabase.telephonyMemberBinding.update({
      where: {
        tenantId_memberId: {
          tenantId: f.tenantA.id,
          memberId: f.employee.memberId,
        },
      },
      data: { seatId: 'seat-2', phone: '13911113003' },
    });
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { data: { name: '客户', reviewCode: '13812345679' } },
    });
    const retry = await dial({ requestId });
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(original.body);
    // Turning the service off keeps the call log reachable.
    expect(
      (await get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({
      enabled: false,
      hasHistory: true,
      reason: 'NOT_ENABLED',
    });
  });
  it('blocks cross tenant, other-owned, hidden fields, disabled members and archived objects', async () => {
    await setup();
    expect((await dial({}, f.tenantBAdmin.cookie)).status).toBe(403);
    expect((await dial({ recordId: f.otherRecord.id })).status).toBe(404);
    expect((await dial({ fieldKey: 'secret' })).status).toBe(403);
    await h.adminDatabase.tenantMember.update({
      where: { id: f.employee.memberId },
      data: { status: 'DISABLED' },
    });
    expect((await dial()).status).toBe(403);
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { status: 'ARCHIVED' },
    });
    expect((await dial({}, f.admin.cookie)).status).toBe(409);
  });
  it('keeps live disabled, returns runtime allowed fields and never calls network', async () => {
    await setup('KUAIMA');
    const runtime = await get(
      `${base()}/runtime?objectCode=leads&recordId=${f.ownedRecord.id}`,
      f.employee.cookie,
    );
    expect(runtime.status).toBe(200);
    expect(runtime.body).toMatchObject({
      available: false,
      reason: 'PLATFORM_NOT_READY',
      fields: [
        { fieldKey: 'name', label: '姓名' },
        { fieldKey: 'reviewCode', label: '审核编号' },
      ],
    });
    expect((await dial()).status).toBe(503);
    expect(outbound).not.toHaveBeenCalled();
    expect(
      await h.adminDatabase.telephonyCall.findMany({
        where: { tenantId: f.tenantA.id },
      }),
    ).toHaveLength(0);
  });
  it('restricts global history to own calls and redacts record metadata after read permission revocation', async () => {
    await setup();
    const call = await dial();
    expect(
      json(await get(`${base()}/calls`, f.otherEmployee.cookie)).total,
    ).toBe(0);
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { ownerMemberId: f.otherEmployee.memberId },
    });
    const detail = await get(
      `${base()}/calls/${json(call).id}`,
      f.employee.cookie,
    );
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      recordId: null,
      objectCode: null,
      fieldKey: null,
      calleePhone: null,
      recordingUrl: null,
      recordTitle: null,
    });
  });
  it('rejects callbacks without independent authentication and preserves ordinary origin checks', async () => {
    await setup();
    const hook = '/api/v1/telephony/hooks';
    expect(
      (await request(h.app.getHttpServer()).post(hook).send({})).status,
    ).toBe(401);
    expect(
      (
        await request(h.app.getHttpServer())
          .post(hook)
          .set('Authorization', 'Bearer wrong')
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(h.app.getHttpServer())
          .patch(`${base()}/settings`)
          .set('Cookie', f.admin.cookie)
          .send({ version: 1 })
      ).status,
    ).toBe(403);
  });
  async function acceptedCall(overrides: object = {}) {
    return h.adminDatabase.telephonyCall.create({
      data: {
        tenantId: f.tenantA.id,
        actorMemberId: f.employee.memberId,
        requestId: randomUUID(),
        objectId: f.object.id,
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        fieldKey: 'reviewCode',
        mode: 'KUAIMA',
        status: 'ACCEPTED',
        callerPhone: '13911113002',
        calleePhone: '13812345678',
        seatId: 'seat-1',
        providerBindId: randomUUID(),
        ...overrides,
      },
    });
  }
  const callback = (bindId: string, overrides: object = {}) =>
    request(h.app.getHttpServer())
      .post('/api/v1/telephony/hooks')
      .set('Authorization', `Bearer ${hookToken}`)
      .send({
        push_type: 1,
        bind_id: bindId,
        seats_id: 'seat-1',
        telA: '13911113002',
        telB: '+8613812345678',
        status: '1',
        begin_time: '2026-10-30 12:00:00',
        end_time: '2026-10-30 12:01:00',
        duration: 60,
        ...overrides,
      });
  it('merges concurrent replay and out-of-order callbacks once, late recording survives and FOLLOWING remains unchanged', async () => {
    await setup();
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { poolEnabled: true, poolLifecycleEnabled: true },
    });
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: {
        poolStage: 'FOLLOWING',
        ownershipExpiresAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    const before = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: f.ownedRecord.id },
    });
    const call = await acceptedCall();
    expect(
      (await callback(call.providerBindId!, { status: 'End' })).status,
    ).toBe(200);
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(0);
    const responses = await Promise.all([
      callback(call.providerBindId!),
      callback(call.providerBindId!),
    ]);
    expect(responses.map((entry) => entry.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual({ code: 0 });
    expect((await callback(call.providerBindId!, { status: '0' })).status).toBe(
      200,
    );
    expect(
      (
        await callback(call.providerBindId!, {
          push_type: 2,
          audio_url: 'https://audio.example.com/call.mp3',
        })
      ).status,
    ).toBe(200);
    expect(
      (await callback(call.providerBindId!, { status: 'End' })).status,
    ).toBe(200);
    const saved = await h.adminDatabase.telephonyCall.findUniqueOrThrow({
      where: { id: call.id },
    });
    expect(saved).toMatchObject({
      status: 'CONNECTED',
      recordingUrl: 'https://audio.example.com/call.mp3',
      durationSeconds: 60,
    });
    const activities = await h.adminDatabase.recordActivity.findMany({
      where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
    });
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      activityType: 'CALL',
      resultKey: 'CONNECTED',
      actorMemberId: f.employee.memberId,
    });
    expect(JSON.stringify(activities)).not.toMatch(
      /13812345678|13911113002|audio.example/,
    );
    expect(
      await h.adminDatabase.record.findUnique({
        where: { id: f.ownedRecord.id },
      }),
    ).toEqual(before);
  });
  it('authenticates the platform credential and validates callback binding, phones, seat, payload and recording URL', async () => {
    await setup();
    const call = await acceptedCall();
    expect((await callback('unknown')).status).toBe(404);
    expect(
      (await callback(call.providerBindId!, { telB: '13899999999' })).status,
    ).toBe(403);
    expect(
      (await callback(call.providerBindId!, { seats_id: 'other-seat' })).status,
    ).toBe(403);
    expect(
      (await callback(call.providerBindId!, { status: 'maybe' })).status,
    ).toBe(400);
    expect(
      (await callback(call.providerBindId!, { duration: -1 })).status,
    ).toBe(400);
    expect(
      (
        await callback(call.providerBindId!, {
          push_type: 2,
          audio_url: 'http://127.0.0.1/a',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(h.app.getHttpServer())
          .post('/api/v1/telephony/hooks')
          .set('Authorization', `Bearer ${hookToken}x`)
          .send({})
      ).status,
    ).toBe(401);
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(0);
  });
  it('accepts authoritative outcomes after member disable and record access revocation without leaking protected metadata', async () => {
    await setup();
    const call = await acceptedCall();
    await h.adminDatabase.tenantMember.update({
      where: { id: f.employee.memberId },
      data: { status: 'DISABLED' },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { status: 'ARCHIVED' },
    });
    expect((await callback(call.providerBindId!)).status).toBe(200);
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(1);
    const response = await get(`${base()}/calls/${call.id}`);
    expect(response.body).toMatchObject({
      status: 'CONNECTED',
      recordId: null,
      calleePhone: null,
      recordTitle: null,
    });
  });
  it('enforces one open call per member including UNKNOWN and database tenant isolation', async () => {
    await setup();
    const first = await acceptedCall({ status: 'UNKNOWN' });
    expect((await dial()).status).toBe(409);
    await expect(acceptedCall()).rejects.toThrow();
    expect(await h.runtimeDatabase.telephonyCall.findMany()).toEqual([]);
    const otherTenantRows = await h.runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenantB.id}, true)`;
      return tx.telephonyCall.findMany({ where: { id: first.id } });
    });
    expect(otherTenantRows).toEqual([]);
    await expect(
      acceptedCall({ tenantId: f.tenantB.id, providerBindId: 'cross-tenant' }),
    ).rejects.toThrow();
  });
  it('uses per-record GROUP phone access and allows record history without widening global history', async () => {
    await setup();
    const groupId = randomUUID();
    await h.adminDatabase.memberGroup.create({
      data: {
        id: groupId,
        tenantId: f.tenantA.id,
        name: '电话组',
        leaderMemberId: f.employee.memberId,
      },
    });
    await h.adminDatabase.tenantMember.updateMany({
      where: { id: { in: [f.employee.memberId, f.otherEmployee.memberId] } },
      data: { groupId },
    });
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'GROUP',
        updateScope: 'NONE',
        groupFieldAccess: {
          name: 'READ_ONLY',
          reviewCode: 'HIDDEN',
          secret: 'HIDDEN',
        },
      },
    });
    await h.adminDatabase.record.update({
      where: { id: f.otherRecord.id },
      data: { data: { name: '组员', reviewCode: '13812345678' } },
    });
    expect((await dial({ recordId: f.otherRecord.id })).status).toBe(403);
    const runtime = await get(
      `${base()}/runtime?objectCode=leads&recordId=${f.otherRecord.id}`,
      f.employee.cookie,
    );
    expect(
      json(runtime).fields.map((field: { fieldKey: string }) => field.fieldKey),
    ).not.toContain('reviewCode');
    const call = await acceptedCall({
      actorMemberId: f.otherEmployee.memberId,
      recordId: f.otherRecord.id,
    });
    expect(json(await get(`${base()}/calls`, f.employee.cookie)).total).toBe(0);
    const hiddenHistory = await get(
      `${base()}/calls?objectCode=leads&recordId=${f.otherRecord.id}`,
      f.employee.cookie,
    );
    expect(json(hiddenHistory).items).toEqual([]);
    await h.adminDatabase.objectPermission.updateMany({
      where: { tenantId: f.tenantA.id, subjectMemberId: f.employee.memberId },
      data: {
        groupFieldAccess: {
          name: 'READ_ONLY',
          reviewCode: 'READ_ONLY',
          secret: 'HIDDEN',
        },
      },
    });
    const visibleHistory = await get(
      `${base()}/calls?objectCode=leads&recordId=${f.otherRecord.id}`,
      f.employee.cookie,
    );
    expect(json(visibleHistory).items[0]).toMatchObject({
      id: call.id,
      recordId: f.otherRecord.id,
      calleePhone: '13812345678',
    });
  });
  it('records an unanswered final outcome once with the existing NOT_REACHED activity vocabulary', async () => {
    await setup();
    const call = await acceptedCall();
    expect(
      (await callback(call.providerBindId!, { status: '0', duration: 0 }))
        .status,
    ).toBe(200);
    expect((await callback(call.providerBindId!, { status: '1' })).status).toBe(
      200,
    );
    expect(
      await h.adminDatabase.recordActivity.findMany({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
        select: { resultKey: true },
      }),
    ).toEqual([{ resultKey: 'NOT_REACHED' }]);
    expect(json(await get(`${base()}/calls/${call.id}`)).status).toBe(
      'NOT_CONNECTED',
    );
  });
  it('filters record-history phone permissions before pagination and totals', async () => {
    await setup();
    await acceptedCall({ fieldKey: 'secret', status: 'CONNECTED' });
    await acceptedCall({ fieldKey: 'secret', status: 'CONNECTED' });
    const allowed = await acceptedCall({
      fieldKey: 'reviewCode',
      status: 'CONNECTED',
    });
    const result = await get(
      `${base()}/calls?objectCode=leads&recordId=${f.ownedRecord.id}&limit=1&page=1`,
      f.employee.cookie,
    );
    expect(json(result).total).toBe(1);
    expect(json(result).items).toHaveLength(1);
    expect(json(result).items[0].id).toBe(allowed.id);
  });
  it('persists ambiguous submission as UNKNOWN, does not retry, rejects other calls', async () => {
    await setup('KUAIMA');
    const config = h.app.get(ConfigService);
    config.set('TELEPHONY_LIVE_ENABLED', 'true');
    let attempts = 0;
    const provider = h.app.get(KuaimaProvider);
    const original = new KuaimaProvider();
    const spy = jest.spyOn(provider, 'dial').mockImplementation((input) =>
      original.dial(input, () => {
        attempts++;
        throw new Error('local test timeout');
      }),
    );
    try {
      const requestId = randomUUID();
      expect(json(await dial({ requestId })).status).toBe('UNKNOWN');
      expect(json(await dial({ requestId })).status).toBe('UNKNOWN');
      expect(attempts).toBe(1);
      expect((await dial()).status).toBe(409);
      expect(
        await h.adminDatabase.recordActivity.count({
          where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
        }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
      config.set('TELEPHONY_LIVE_ENABLED', 'false');
    }
  });
  it('stops dialing a field the administrator no longer allows, keeping its history', async () => {
    await setup();
    const call = await dial();
    const settings = await get(`${base()}/settings`);
    const removed = await patch(`${base()}/settings`, {
      version: (settings.body as { version: number }).version,
      phoneFields: [{ objectCode: 'leads', fieldKeys: ['name'] }],
    });
    expect(removed.status).toBe(200);
    expect((await dial()).status).toBe(403);
    const runtime = await get(
      `${base()}/runtime?objectCode=leads&recordId=${f.ownedRecord.id}`,
      f.employee.cookie,
    );
    expect(json(runtime).fields.map((entry) => entry.fieldKey)).toEqual([
      'name',
    ]);
    // The past call stays readable: the record and its phone field still are.
    expect(
      (await get(`${base()}/calls/${json(call).id}`, f.employee.cookie)).body,
    ).toMatchObject({ recordId: f.ownedRecord.id, calleePhone: '13812345678' });
  });
  it('does not associate a second call with an already used supplier binding ID', async () => {
    await setup('KUAIMA');
    const otherCall = await acceptedCall({
      actorMemberId: f.otherEmployee.memberId,
    });
    const config = h.app.get(ConfigService);
    config.set('TELEPHONY_LIVE_ENABLED', 'true');
    const spy = jest
      .spyOn(h.app.get(KuaimaProvider), 'dial')
      .mockResolvedValue({
        status: 'ACCEPTED',
        providerBindId: otherCall.providerBindId,
        failureReason: null,
      });
    try {
      const response = await dial();
      expect(response.status).toBe(201);
      expect(json(response).status).toBe('UNKNOWN');
      const saved = await h.adminDatabase.telephonyCall.findUniqueOrThrow({
        where: { id: json(response).id },
      });
      expect(saved.providerBindId).toBeNull();
      expect((await callback(otherCall.providerBindId!)).status).toBe(200);
      expect(
        (await get(`${base()}/calls/${json(response).id}`)).body,
      ).toMatchObject({ status: 'UNKNOWN' });
    } finally {
      spy.mockRestore();
      config.set('TELEPHONY_LIVE_ENABLED', 'false');
    }
  });
  it('accepts supplier numeric seat, push type and status while rejecting non-scalar or unsafe seat identifiers', async () => {
    await setup();
    const call = await acceptedCall({ seatId: '111' });
    const response = await callback(call.providerBindId!, {
      seats_id: 111,
      push_type: 1,
      status: 1,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ code: 0 });
    for (const seats_id of [
      { id: 111 },
      [111],
      true,
      null,
      111.5,
      -111,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        (
          await callback(call.providerBindId!, {
            seats_id,
            push_type: 1,
            status: 1,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await callback(call.providerBindId!, {
          seats_id: 112,
          push_type: 1,
          status: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      await h.adminDatabase.telephonyCall.findUniqueOrThrow({
        where: { id: call.id },
      }),
    ).toMatchObject({ seatId: '111', status: 'CONNECTED' });
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(1);
  });
  it('accepts the credential in the callback URL, ignores fields the supplier adds and rejects a rotated credential', async () => {
    await setup();
    const call = await acceptedCall();
    const body = {
      push_type: 1,
      bind_id: call.providerBindId,
      seats_id: 'seat-1',
      telA: '13911113002',
      telX: '17000000000',
      telB: '13812345678',
      status: 1,
      begin_time: '2026-10-30 12:00:00',
      end_time: '2026-10-30 12:00:45',
      duration: 45,
      audio_url: '',
      company_note: 'a field the documentation does not list',
    };
    const hook = '/api/v1/telephony/hooks';
    const old = hookToken;
    // Form-encoded bodies work too; the supplier's content type is unconfirmed.
    const viaQuery = await request(h.app.getHttpServer())
      .post(`${hook}?token=${encodeURIComponent(old)}`)
      .type('form')
      .send(body);
    expect(viaQuery.status).toBe(200);
    expect(viaQuery.body).toEqual({ code: 0 });
    const activities = await h.adminDatabase.recordActivity.findMany({
      where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
    });
    expect(activities).toEqual([
      expect.objectContaining({
        activityType: 'CALL',
        resultKey: 'CONNECTED',
        content: '电话外呼：已接通，通话 45 秒',
      }),
    ]);
    const rotated = await request(h.app.getHttpServer())
      .post('/api/v1/platform/telephony-settings/callback-token')
      .set('Origin', origin)
      .set('Cookie', f.tenantBAdmin.cookie);
    expect(rotated.status).toBe(200);
    expect(
      (
        await request(h.app.getHttpServer())
          .post(`${hook}?token=${encodeURIComponent(old)}`)
          .send(body)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(h.app.getHttpServer())
          .post('/api/v1/platform/telephony-settings/callback-token')
          .set('Origin', origin)
          .set('Cookie', f.admin.cookie)
      ).status,
    ).toBe(403);
  });
  it('treats the hang-up notice as an end event only and lets a later outcome replace it', async () => {
    await setup();
    const call = await acceptedCall();
    const hangup = await request(h.app.getHttpServer())
      .post(`/api/v1/telephony/hooks?token=${hookToken}`)
      .send({
        bind_id: call.providerBindId,
        status: 'End',
        time: '2026-10-30 12:02:00',
      });
    expect(hangup.status).toBe(200);
    expect(hangup.body).toEqual({ code: 0 });
    expect(
      await h.adminDatabase.telephonyCall.findUniqueOrThrow({
        where: { id: call.id },
      }),
    ).toMatchObject({
      status: 'ENDED',
      endedAt: new Date('2026-10-30T04:02:00.000Z'),
      activityId: null,
    });
    // The member is free to dial again; ENDED does not hold the open-call gate.
    expect((await dial()).status).toBe(201);
    expect(
      (await callback(call.providerBindId!, { status: '0', duration: 0 }))
        .status,
    ).toBe(200);
    expect(
      await h.adminDatabase.recordActivity.findMany({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
        select: { resultKey: true, content: true },
      }),
    ).toEqual([{ resultKey: 'NOT_REACHED', content: '电话外呼：未接通' }]);
  });
  it('lets the caller or an administrator end a stuck call after a minute, never another employee', async () => {
    await setup();
    const fresh = await acceptedCall({
      status: 'UNKNOWN',
      providerBindId: null,
    });
    const close = (id: string, cookie: string) =>
      request(h.app.getHttpServer())
        .post(`${base()}/calls/${id}/close`)
        .set('Origin', origin)
        .set('Cookie', cookie);
    const early = await close(fresh.id, f.employee.cookie);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({
      fieldErrors: { call: ['TELEPHONY_CLOSE_TOO_EARLY'] },
    });
    await h.adminDatabase.telephonyCall.update({
      where: { id: fresh.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    expect((await close(fresh.id, f.otherEmployee.cookie)).status).toBe(403);
    const closed = await close(fresh.id, f.employee.cookie);
    expect(closed.status).toBe(200);
    expect(json(closed).status).toBe('ENDED');
    expect((await dial()).status).toBe(201);
    const stuck = await acceptedCall({
      actorMemberId: f.otherEmployee.memberId,
      createdAt: new Date(Date.now() - 120_000),
    });
    expect(json(await close(stuck.id, f.admin.cookie)).status).toBe('ENDED');
    // Closing never writes an activity or touches the record.
    expect(
      await h.adminDatabase.recordActivity.count({
        where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
      }),
    ).toBe(0);
  });
  it('shows the supplier refusal reason and frees the member when the line rejects the dial', async () => {
    await setup('KUAIMA');
    const config = h.app.get(ConfigService);
    config.set('TELEPHONY_LIVE_ENABLED', 'true');
    const spy = jest
      .spyOn(h.app.get(KuaimaProvider), 'dial')
      .mockResolvedValue({
        status: 'FAILED',
        providerBindId: null,
        failureReason: '未获取到您的可用套餐，请联系管理员',
      });
    try {
      const response = await dial({
        confirmation: {
          mode: 'KUAIMA',
          callerPhone: '13911113002',
          calleePhone: '13812345678',
        },
      });
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'FAILED',
        failureReason: '未获取到您的可用套餐，请联系管理员',
        actorName: expect.any(String) as unknown,
      });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: '131',
          appSecret: 'platform-secret',
        }),
        expect.anything(),
        undefined,
        'https://www.kuaimatongxun.com',
      );
      const runtime = await get(`${base()}/runtime`, f.employee.cookie);
      expect(runtime.body).toMatchObject({ available: true, openCallId: null });
    } finally {
      spy.mockRestore();
      config.set('TELEPHONY_LIVE_ENABLED', 'false');
    }
  });
  it('keeps a call outcome when an administrator deletes its activity', async () => {
    await setup();
    const call = await acceptedCall();
    expect((await callback(call.providerBindId!)).status).toBe(200);
    const activity = await h.adminDatabase.recordActivity.findFirstOrThrow({
      where: { tenantId: f.tenantA.id, recordId: f.ownedRecord.id },
    });
    await h.runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.tenantA.id}, true)`;
      await tx.$executeRaw`SELECT set_config('app.user_id', ${f.admin.userId}, true)`;
      await tx.recordActivity.delete({ where: { id: activity.id } });
    });
    expect(
      await h.adminDatabase.telephonyCall.findUniqueOrThrow({
        where: { id: call.id },
      }),
    ).toMatchObject({ status: 'CONNECTED', activityId: null });
  });
});
