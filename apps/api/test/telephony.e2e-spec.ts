import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { KuaimaProvider } from '../src/modules/integrations/telephony/telephony-provider';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

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
        ...body,
      });
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? '');
    const runtime = new URL(process.env.TEST_DATABASE_URL ?? '');
    for (const target of [url, runtime]) {
      expect(['postgres:', 'postgresql:']).toContain(target.protocol);
      expect(['localhost', '127.0.0.1', '[::1]']).toContain(target.hostname);
      const ephemeralCi =
        process.env.CI === 'true' &&
        target.port === '5432' &&
        target.pathname === '/crm' &&
        ['crm', 'crm_app'].includes(target.username);
      expect(
        ephemeralCi || /^\/[a-z0-9_]*test[a-z0-9_]*$/i.test(target.pathname),
      ).toBe(true);
      expect(
        [...target.searchParams.keys()].every((key) => key === 'schema'),
      ).toBe(true);
    }
    expect(runtime.host + runtime.pathname).toBe(url.host + url.pathname);
    expect(runtime.username).toBe('crm_app');
    process.env.TELEPHONY_ENCRYPTION_KEY = 'ab'.repeat(32);
    process.env.TELEPHONY_LIVE_ENABLED = 'false';
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(
          new Error('Outbound network forbidden in local telephony test'),
        ),
      );
    h = await createCriticalHarness();
    h.app.get(ConfigService).set('TELEPHONY_ENCRYPTION_KEY', 'ab'.repeat(32));
    h.app.get(ConfigService).set('TELEPHONY_LIVE_ENABLED', 'false');
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    // Keep cleanup local to this new test database and tolerate the initial red run.
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_calls')
      .catch(() => undefined);
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_member_bindings')
      .catch(() => undefined);
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_settings')
      .catch(() => undefined);
    f = await provisionCriticalFixture(h);
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
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_calls')
      .catch(() => undefined);
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_member_bindings')
      .catch(() => undefined);
    await h.adminDatabase
      .$executeRawUnsafe('DELETE FROM telephony_settings')
      .catch(() => undefined);
    await closeCriticalHarness(h);
    outbound.mockRestore();
  });
  async function setup(mode = 'MOCK') {
    const setting = await patch(`${base()}/settings`, {
      version: 0,
      enabled: true,
      mode,
      companyId: 'test-company',
      appSecret: 'test-secret',
      callbackToken: 'test-callback-token-long',
      phoneFields: [{ objectCode: 'leads', fieldKeys: ['reviewCode', 'name'] }],
    });
    expect(setting.status).toBe(200);
    const binding = await patch(`${base()}/members/${f.employee.memberId}`, {
      version: 0,
      enabled: true,
      seatId: 'seat-1',
      phone: '13911113002',
    });
    expect(binding.status).toBe(200);
  }
  it('requires login and admin for settings and bindings', async () => {
    expect(
      (await request(h.app.getHttpServer()).get(`${base()}/settings`)).status,
    ).toBe(401);
    expect((await get(`${base()}/settings`, f.employee.cookie)).status).toBe(
      403,
    );
    expect(
      (await patch(`${base()}/settings`, { version: 0 }, f.employee.cookie))
        .status,
    ).toBe(403);
    expect((await get(`${base()}/members`, f.employee.cookie)).status).toBe(
      403,
    );
  });
  it('encrypts secrets, omits them in responses and preserves blank updates with version conflict', async () => {
    await setup();
    const result = await get(`${base()}/settings`);
    expect(result.body).toMatchObject({
      version: 1,
      hasAppSecret: true,
      hasCallbackToken: true,
    });
    expect(JSON.stringify(result.body)).not.toMatch(
      /test-secret|test-callback/,
    );
    const rows = await h.adminDatabase.$queryRawUnsafe<
      Array<{ app_secret_encrypted: string }>
    >('SELECT app_secret_encrypted FROM telephony_settings');
    expect(rows[0].app_secret_encrypted).not.toContain('test-secret');
    const changed = await patch(`${base()}/settings`, {
      ...(result.body as object),
      appSecret: '',
      callbackToken: '',
      hasAppSecret: undefined,
      hasCallbackToken: undefined,
    });
    expect(changed.status).toBe(200);
    expect(json(changed).hasAppSecret).toBe(true);
    expect(
      (await patch(`${base()}/settings`, { version: 1, enabled: false }))
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
        where: { recordId: f.ownedRecord.id },
      }),
    ).toBe(0);
    expect(
      await h.adminDatabase.$queryRawUnsafe('SELECT id FROM telephony_calls'),
    ).toHaveLength(1);
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
      reason: 'LIVE_DISABLED',
      fields: [
        { fieldKey: 'name', label: '姓名' },
        { fieldKey: 'reviewCode', label: '审核编号' },
      ],
    });
    expect((await dial()).status).toBe(503);
    expect(outbound).not.toHaveBeenCalled();
    expect(
      await h.adminDatabase.$queryRawUnsafe('SELECT id FROM telephony_calls'),
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
    const hook = `/api/v1/telephony/hooks/${f.tenantA.id}`;
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
      .post(`/api/v1/telephony/hooks/${f.tenantA.id}`)
      .set('Authorization', 'Bearer test-callback-token-long')
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
    expect(await h.adminDatabase.recordActivity.count()).toBe(0);
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
      where: { recordId: f.ownedRecord.id },
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
  it('authenticates tenant and validates callback binding, phones, seat, payload and recording URL', async () => {
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
      (await callback(call.providerBindId!, { unexpected: 'field' })).status,
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
          .post(`/api/v1/telephony/hooks/${f.tenantB.id}`)
          .set('Authorization', 'Bearer test-callback-token-long')
          .send({})
      ).status,
    ).toBe(401);
    expect(await h.adminDatabase.recordActivity.count()).toBe(0);
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
    expect(await h.adminDatabase.recordActivity.count()).toBe(1);
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
        where: { recordId: f.ownedRecord.id },
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
  it('persists ambiguous submission as UNKNOWN, does not retry, rejects other calls, and production refuses MOCK', async () => {
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
      expect(await h.adminDatabase.recordActivity.count()).toBe(0);
      config.set('NODE_ENV', 'production');
      expect(
        (await patch(`${base()}/settings`, { version: 1, mode: 'MOCK' }))
          .status,
      ).toBe(400);
    } finally {
      spy.mockRestore();
      config.set('TELEPHONY_LIVE_ENABLED', 'false');
      config.set('NODE_ENV', 'test');
    }
  });
  it('rejects an inactive published phone field and redacts its old history', async () => {
    await setup();
    const call = await dial();
    const publication =
      await h.adminDatabase.objectPublication.findFirstOrThrow({
        where: { objectId: f.object.id },
      });
    const fields = (
      publication.configuration as unknown as {
        fields: Array<{
          id: string;
          fieldKey: string;
          label: string;
          type: 'TEXT' | 'TEXTAREA';
        }>;
      }
    ).fields;
    const field = fields.find((entry) => entry.fieldKey === 'reviewCode')!;
    await h.adminDatabase.fieldDefinition.create({
      data: {
        ...field,
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        status: 'INACTIVE',
      },
    });
    expect((await dial()).status).toBe(403);
    expect(
      (await get(`${base()}/calls/${json(call).id}`, f.employee.cookie)).body,
    ).toMatchObject({ recordId: null, calleePhone: null, recordingUrl: null });
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
});
