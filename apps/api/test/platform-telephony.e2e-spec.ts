import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@crm/database';
import {
  KuaimaProvider,
  KuaimaSeatError,
} from '../src/modules/integrations/telephony/telephony-provider';
import { seatUsername } from '../src/modules/integrations/telephony/telephony-seats';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import {
  assertLocalTestDatabase,
  assignPlan,
  cleanupTelephony,
  configureLine,
  createPlan,
  promotePlatformAdmin,
  telephonyHttp,
  TELEPHONY_KEYRING,
  TEST_PLAN_PREFIX,
} from './helpers/telephony-fixture';

jest.setTimeout(120_000);
const read = <T>(response: { body: unknown }) => response.body as T;
type Company = {
  version: number;
  month: string;
  planId: string | null;
  seatsEnabled: number;
};

describe('platform telephony', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let http: ReturnType<typeof telephonyHttp>;
  let outbound: jest.SpyInstance;
  let platform = '';
  const config = () => h.app.get(ConfigService);
  const LINE = '/api/v1/platform/telephony-settings';
  const PLANS = '/api/v1/platform/telephony-plans';
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/telephony`;
  const company = (tenantId = f.tenantA.id) =>
    `/api/v1/platform/tenants/${tenantId}/telephony`;
  const bind = (memberId: string, seatId: string) =>
    h.adminDatabase.telephonyMemberBinding.upsert({
      where: { tenantId_memberId: { tenantId: f.tenantA.id, memberId } },
      create: {
        tenantId: f.tenantA.id,
        memberId,
        enabled: true,
        phone: '13911113002',
        seatId,
        providerUsername: seatUsername(memberId),
        seatCreatedAt: new Date(),
      },
      update: { enabled: true, seatId, seatCreatedAt: new Date() },
    });
  const acceptedCall = (overrides: object = {}) =>
    h.adminDatabase.telephonyCall.create({
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
  const hook = (token: string, bindId: string, overrides: object = {}) =>
    request(h.app.getHttpServer())
      .post(`/api/v1/telephony/hooks?token=${encodeURIComponent(token)}`)
      .send({
        push_type: 1,
        bind_id: bindId,
        seats_id: 'seat-1',
        telA: '13911113002',
        telB: '13812345678',
        status: '1',
        begin_time: '2026-10-30 12:00:00',
        end_time: '2026-10-30 12:01:01',
        duration: 61,
        ...overrides,
      });
  const usedMinutes = async (tenantId = f.tenantA.id) =>
    (
      await h.adminDatabase.telephonyTenantMonth.findMany({
        where: { tenantId },
      })
    ).reduce((sum, row) => sum + row.usedMinutes, 0);

  beforeAll(async () => {
    assertLocalTestDatabase();
    process.env.AI_MODEL_KEYRING = TELEPHONY_KEYRING;
    process.env.TELEPHONY_LIVE_ENABLED = 'false';
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(
          new Error('Outbound network forbidden in platform telephony test'),
        ),
      );
    h = await createCriticalHarness();
    config().set('AI_MODEL_KEYRING', TELEPHONY_KEYRING);
    config().set('TELEPHONY_LIVE_ENABLED', 'false');
    http = telephonyHttp(h);
  });
  beforeEach(async () => {
    await cleanupTelephony(h);
    f = await provisionCriticalFixture(h);
    await promotePlatformAdmin(h, f);
    platform = f.tenantBAdmin.cookie;
    await h.adminDatabase.record.update({
      where: { id: f.ownedRecord.id },
      data: { data: { name: '客户', reviewCode: '+8613812345678' } },
    });
  });
  afterEach(() => {
    config().set('TELEPHONY_LIVE_ENABLED', 'false');
    config().set('NODE_ENV', 'test');
    jest.restoreAllMocks();
    outbound = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.reject(
          new Error('Outbound network forbidden in platform telephony test'),
        ),
      );
  });
  afterAll(async () => {
    await cleanupTelephony(h);
    await closeCriticalHarness(h);
    outbound.mockRestore();
  });

  it('keeps the line for platform admins, seals secrets and names what is missing', async () => {
    expect((await http.get(LINE, f.admin.cookie)).status).toBe(403);
    const fresh = await http.get(LINE, platform);
    expect(fresh.body).toMatchObject({
      mode: 'MOCK',
      ready: true,
      problems: [],
      hasAppSecret: false,
    });
    const kuaima = await http.patch(
      LINE,
      {
        version: read<{ version: number }>(fresh).version,
        mode: 'KUAIMA',
        costPerMinute: '0.1500',
        seatMonthlyCost: '10.00',
      },
      platform,
    );
    expect(kuaima.status).toBe(200);
    expect(kuaima.body).toMatchObject({
      ready: false,
      problems: [
        '企业 ID 未填写',
        '企业密钥未填写',
        '回调地址未生成',
        '服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）',
      ],
      costPerMinute: '0.1500',
      seatMonthlyCost: '10.00',
    });
    const token = await configureLine(h, f, 'KUAIMA');
    const line = await http.get(LINE, platform);
    expect(line.body).toMatchObject({
      companyId: '131',
      hasAppSecret: true,
      hasCallbackToken: true,
      problems: ['服务器未开启真实外呼（TELEPHONY_LIVE_ENABLED）'],
      callbackEndpoint: expect.stringMatching(
        /\/api\/v1\/telephony\/hooks$/,
      ) as unknown,
    });
    expect(JSON.stringify(line.body)).not.toContain('platform-secret');
    expect(JSON.stringify(line.body)).not.toContain(token);
    const [row] = await h.adminDatabase.$queryRawUnsafe<
      Array<{ app_secret_encrypted: string; callback_token_encrypted: string }>
    >(
      'SELECT app_secret_encrypted, callback_token_encrypted FROM telephony_platform_settings',
    );
    expect(row.app_secret_encrypted).not.toContain('platform-secret');
    expect(row.callback_token_encrypted).not.toContain(token);
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    expect((await http.get(LINE, platform)).body).toMatchObject({
      ready: true,
      problems: [],
    });
    // A blank secret keeps the saved one; a stale version conflicts.
    const version = read<{ version: number }>(line).version;
    expect(
      (await http.patch(LINE, { version, appSecret: '' }, platform)).body,
    ).toMatchObject({ hasAppSecret: true });
    expect(
      (await http.patch(LINE, { version, companyId: '132' }, platform)).status,
    ).toBe(409);
    config().set('NODE_ENV', 'production');
    expect(
      (await http.patch(LINE, { version: version + 1, mode: 'MOCK' }, platform))
        .status,
    ).toBe(400);
    expect(
      (await http.post(`${LINE}/callback-token`, undefined, f.admin.cookie))
        .status,
    ).toBe(403);
  });

  it('names plans uniquely, refuses deleting or shrinking a plan in use and records plan history', async () => {
    expect((await http.get(PLANS, f.admin.cookie)).status).toBe(403);
    const plan = await createPlan(h, f, { seats: 2 });
    const same = {
      name: plan.name,
      seats: 1,
      monthlyMinutes: 1,
      monthlyPrice: '1.00',
      assignable: true,
    };
    expect((await http.post(PLANS, same, platform)).status).toBe(409);
    expect(
      (
        await http.post(
          PLANS,
          {
            ...same,
            name: `${TEST_PLAN_PREFIX}bad`,
            seats: 0,
            monthlyPrice: '1.001',
          },
          platform,
        )
      ).status,
    ).toBe(400);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await bind(f.employee.memberId, 'seat-a');
    await bind(f.otherEmployee.memberId, 'seat-b');
    const edit = {
      version: plan.version,
      name: plan.name,
      seats: 1,
      monthlyMinutes: 100,
      monthlyPrice: '120.00',
      assignable: true,
    };
    const shrink = await http.patch(`${PLANS}/${plan.id}`, edit, platform);
    expect(shrink.status).toBe(409);
    expect(read<{ message: string }>(shrink).message).toContain('（2 个）');
    expect(
      (
        await http.delete(
          `${PLANS}/${plan.id}?version=${plan.version}`,
          platform,
        )
      ).status,
    ).toBe(409);
    const renamed = await http.patch(
      `${PLANS}/${plan.id}`,
      {
        ...edit,
        name: `${plan.name} 改`,
        seats: 2,
        monthlyMinutes: 200,
        monthlyPrice: '150.00',
        assignable: false,
      },
      platform,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      seats: 2,
      monthlyMinutes: 200,
      monthlyPrice: '150.00',
      assignable: false,
      companies: 1,
      version: plan.version + 1,
    });
    const history = await h.adminDatabase.telephonyPlanHistory.findMany({
      where: { tenantId: f.tenantA.id },
      orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
    });
    expect(
      history.map((entry) => [
        entry.planName,
        entry.monthlyPrice.toFixed(2),
        entry.monthlyMinutes,
      ]),
    ).toEqual([
      [plan.name, '120.00', 100],
      [`${plan.name} 改`, '150.00', 200],
    ]);
    // A plan that stopped being assignable cannot go to another company.
    const other = read<Company>(
      await http.get(company(f.tenantB.id), platform),
    );
    expect(
      (
        await http.patch(
          company(f.tenantB.id),
          { version: other.version, planId: plan.id },
          platform,
        )
      ).status,
    ).toBe(400);
    await assignPlan(h, f, f.tenantA.id, null);
    expect(
      (
        await http.delete(
          `${PLANS}/${plan.id}?version=${plan.version + 1}`,
          platform,
        )
      ).status,
    ).toBe(204);
  });

  it('assigns plans within seat limits and adds minutes once per key with an audit trail', async () => {
    const started = new Date();
    const small = await createPlan(h, f, { seats: 1 });
    const big = await createPlan(h, f, { seats: 3 });
    await assignPlan(h, f, f.tenantA.id, big.id);
    await bind(f.employee.memberId, 'seat-a');
    await bind(f.otherEmployee.memberId, 'seat-b');
    const current = read<Company>(await http.get(company(), platform));
    expect(current).toMatchObject({ planId: big.id, seatsEnabled: 2 });
    const refused = await http.patch(
      company(),
      { version: current.version, planId: small.id },
      platform,
    );
    expect(refused.status).toBe(409);
    expect(read<{ message: string }>(refused).message).toContain(
      '已开 2 个坐席',
    );
    expect(
      (
        await http.patch(
          company(),
          { version: current.version - 1, planId: null },
          platform,
        )
      ).status,
    ).toBe(409);
    const key = randomUUID();
    const add = (minutes = 50) =>
      http.post(
        `${company()}/minutes`,
        {
          month: current.month,
          minutes,
          price: '30.00',
          note: '月中加量',
          idempotencyKey: key,
        },
        platform,
      );
    expect((await add()).body).toEqual({ applied: true, month: current.month });
    expect((await add()).body).toEqual({
      applied: false,
      month: current.month,
    });
    expect((await add(60)).status).toBe(409);
    expect(
      (
        await http.post(
          `${company()}/minutes`,
          {
            month: '2020-01-01',
            minutes: 1,
            price: '0.00',
            idempotencyKey: randomUUID(),
          },
          platform,
        )
      ).status,
    ).toBe(409);
    expect((await http.get(company(), platform)).body).toMatchObject({
      extraMinutes: 50,
      allowance: 150,
      additions: [{ minutes: 50, price: '30.00', note: '月中加量' }],
    });
    const audits = await h.adminDatabase.auditLog.findMany({
      where: {
        tenantId: f.tenantA.id,
        createdAt: { gte: started },
        action: { in: ['telephony.plan_assigned', 'telephony.minutes_added'] },
      },
    });
    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'telephony.minutes_added',
      'telephony.plan_assigned',
    ]);
  });

  it('shows a company its plan and usage without money or the platform account', async () => {
    const plan = await createPlan(h, f, { monthlyPrice: '987.65' });
    await configureLine(h, f, 'MOCK');
    await assignPlan(h, f, f.tenantA.id, plan.id);
    const month = read<Company>(await http.get(company(), platform)).month;
    await http.post(
      `${company()}/minutes`,
      { month, minutes: 5, price: '4.32', idempotencyKey: randomUUID() },
      platform,
    );
    const settings = await http.get(`${base()}/settings`, f.admin.cookie);
    expect(settings.body).toMatchObject({
      plan: { name: plan.name, seats: 3, monthlyMinutes: 100 },
      usage: {
        usedMinutes: 0,
        extraMinutes: 5,
        allowance: 105,
        seatsEnabled: 0,
      },
      lineReady: true,
    });
    const text = [
      settings.body,
      (await http.get(`${base()}/runtime`, f.employee.cookie)).body,
      (await http.get(`${base()}/members`, f.admin.cookie)).body,
    ]
      .map((body) => JSON.stringify(body))
      .join('');
    for (const leak of [
      '987.65',
      '4.32',
      'platform-secret',
      'companyId',
      'Price',
      'cost',
    ])
      expect(text).not.toContain(leak);
    const asMember = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      h.runtimeDatabase.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${f.admin.userId}, true), set_config('app.tenant_id', ${f.tenantA.id}, true)`;
        return work(tx);
      });
    const counts = await asMember(async (tx) => {
      const count = async (table: string) =>
        (
          await tx.$queryRawUnsafe<Array<{ n: number }>>(
            `SELECT count(*)::int AS n FROM ${table}`,
          )
        )[0].n;
      return {
        line: await count('telephony_platform_settings'),
        plans: await count('telephony_plans'),
        history: await count('telephony_plan_history'),
        additions: await count('telephony_minute_additions'),
        config: await count('tenant_telephony_configs'),
      };
    });
    expect(counts).toEqual({
      line: 0,
      plans: 0,
      history: 0,
      additions: 0,
      config: 1,
    });
    await expect(
      asMember(
        (tx) =>
          tx.$queryRaw`SELECT * FROM telephony_report(date_trunc('month', now())::date)`,
      ),
    ).rejects.toThrow();
  });

  it('creates seats on its own, adopts a half-saved seat and keeps calling off when the supplier refuses', async () => {
    const plan = await createPlan(h, f, { seats: 1 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await configureLine(h, f, 'MOCK');
    const members = `${base()}/members`;
    const mock = await http.patch(
      `${members}/${f.employee.memberId}`,
      { version: 0, enabled: true, phone: '13911113002' },
      f.admin.cookie,
    );
    expect(mock.status).toBe(200);
    expect(mock.body).toMatchObject({
      enabled: true,
      seatStatus: 'READY',
      seatError: null,
      version: 1,
    });
    const where = {
      tenantId_memberId: {
        tenantId: f.tenantA.id,
        memberId: f.employee.memberId,
      },
    };
    expect(
      (
        await h.adminDatabase.telephonyMemberBinding.findUniqueOrThrow({
          where,
        })
      ).seatId,
    ).toBe(`MOCK-${seatUsername(f.employee.memberId)}`);
    const full = await http.patch(
      `${members}/${f.otherEmployee.memberId}`,
      { version: 0, enabled: true, phone: '13911113003' },
      f.admin.cookie,
    );
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({
      fieldErrors: { telephony: ['TELEPHONY_SEATS_FULL'] },
    });

    // On the supplier line a simulated seat counts as none.
    await configureLine(h, f, 'KUAIMA');
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    const provider = h.app.get(KuaimaProvider);
    const find = jest.spyOn(provider, 'findSeat').mockResolvedValue(null);
    const create = jest
      .spyOn(provider, 'createSeat')
      .mockRejectedValueOnce(new KuaimaSeatError('手机号已被其他坐席使用'));
    const update = jest
      .spyOn(provider, 'updateSeat')
      .mockResolvedValue(undefined);
    expect(
      (await http.get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({
      reason: 'MEMBER_NOT_CONFIGURED',
    });
    const refused = await http.patch(
      `${members}/${f.employee.memberId}`,
      { version: 1, enabled: true, phone: '13911113004' },
      f.admin.cookie,
    );
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      message: '快马：手机号已被其他坐席使用',
      fieldErrors: { seat: ['TELEPHONY_SEAT_FAILED'] },
    });
    const listed = read<{ members: Array<{ memberId: string }> }>(
      await http.get(members, f.admin.cookie),
    );
    expect(
      listed.members.find((entry) => entry.memberId === f.employee.memberId),
    ).toMatchObject({
      seatStatus: 'FAILED',
      seatError: '手机号已被其他坐席使用',
      version: 1,
    });
    // The retry finds the seat the supplier made last time and adopts it.
    find.mockResolvedValueOnce({
      id: '9001',
      username: seatUsername(f.employee.memberId),
      mobile: '13911110000',
    });
    const adopted = await http.patch(
      `${members}/${f.employee.memberId}`,
      { version: 1, enabled: true, phone: '13911113004' },
      f.admin.cookie,
    );
    expect(adopted.status).toBe(200);
    expect(adopted.body).toMatchObject({
      enabled: true,
      seatStatus: 'READY',
      seatError: null,
      version: 2,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: '131',
        appSecret: 'platform-secret',
      }),
      '9001',
      expect.objectContaining({ mobile: '13911113004' }),
    );
    // A new mobile on a real seat only updates it.
    expect(
      (
        await http.patch(
          `${members}/${f.employee.memberId}`,
          { version: 2, enabled: true, phone: '13911113005' },
          f.admin.cookie,
        )
      ).status,
    ).toBe(200);
    expect(update).toHaveBeenLastCalledWith(
      expect.anything(),
      '9001',
      expect.objectContaining({ mobile: '13911113005' }),
    );
    expect(find).toHaveBeenCalledTimes(2);
    const saved =
      await h.adminDatabase.telephonyMemberBinding.findUniqueOrThrow({ where });
    expect(saved).toMatchObject({
      seatId: '9001',
      providerUsername: seatUsername(f.employee.memberId),
      phone: '13911113005',
    });
    expect(saved.seatCreatedAt).not.toBeNull();
  });

  it('lets only one of two simultaneous requests take the last seat', async () => {
    const plan = await createPlan(h, f, { seats: 1 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await configureLine(h, f, 'MOCK');
    const turnOn = (memberId: string, phone: string) =>
      http.patch(
        `${base()}/members/${memberId}`,
        { version: 0, enabled: true, phone },
        f.admin.cookie,
      );
    const results = await Promise.all([
      turnOn(f.employee.memberId, '13911113002'),
      turnOn(f.otherEmployee.memberId, '13911113003'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await h.adminDatabase.telephonyMemberBinding.count({
        where: { tenantId: f.tenantA.id, enabled: true },
      }),
    ).toBe(1);
  });

  it('bills whole minutes once, stops dialing when minutes run out and tells administrators at 80% and 100%', async () => {
    const token = await configureLine(h, f, 'KUAIMA', {
      costPerMinute: '0.1500',
    });
    config().set('TELEPHONY_LIVE_ENABLED', 'true');
    const plan = await createPlan(h, f, { monthlyMinutes: 5 });
    await assignPlan(h, f, f.tenantA.id, plan.id);
    expect(
      (
        await http.patch(
          `${base()}/settings`,
          {
            version: 0,
            phoneFields: [{ objectCode: 'leads', fieldKeys: ['reviewCode'] }],
          },
          f.admin.cookie,
        )
      ).status,
    ).toBe(200);
    await bind(f.employee.memberId, 'seat-1');
    const notices = async (kind: string) =>
      (
        await h.adminDatabase.memberNotification.findMany({
          where: { tenantId: f.tenantA.id, kind },
        })
      ).map((entry) => entry.recipientMemberId);

    const first = await acceptedCall();
    expect((await hook(token, first.providerBindId!)).status).toBe(200);
    expect((await hook(token, first.providerBindId!)).status).toBe(200);
    expect(
      await h.adminDatabase.telephonyCall.findUniqueOrThrow({
        where: { id: first.id },
      }),
    ).toMatchObject({
      billedMinutes: 2,
    });
    expect(
      (
        await h.adminDatabase.telephonyCall.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).costPerMinute.toFixed(4),
    ).toBe('0.1500');
    const second = await acceptedCall();
    await hook(token, second.providerBindId!, { duration: 60 });
    const missed = await acceptedCall();
    await hook(token, missed.providerBindId!, { status: '0', duration: 0 });
    expect(await usedMinutes()).toBe(3);
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual([]);
    // Recording first, outcome later: still billed once.
    const recorded = await acceptedCall();
    expect(
      (
        await hook(token, recorded.providerBindId!, {
          push_type: 2,
          audio_url: 'https://records.example.com/a.mp3',
        })
      ).status,
    ).toBe(200);
    await hook(token, recorded.providerBindId!, { duration: 30 });
    expect(await usedMinutes()).toBe(4);
    const eighty = await notices('TELEPHONY_MINUTES_80');
    expect(eighty).toContain(f.admin.memberId);
    expect(eighty).not.toContain(f.employee.memberId);
    const last = await acceptedCall();
    await hook(token, last.providerBindId!, { duration: 59 });
    await hook(token, last.providerBindId!, { duration: 59 });
    expect(await usedMinutes()).toBe(5);
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual(eighty);
    expect(await notices('TELEPHONY_MINUTES_100')).toHaveLength(eighty.length);
    expect(
      (await http.get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({
      available: false,
      reason: 'MINUTES_EXHAUSTED',
    });
    const dial = await http.post(
      `${base()}/calls`,
      {
        requestId: randomUUID(),
        objectCode: 'leads',
        recordId: f.ownedRecord.id,
        fieldKey: 'reviewCode',
        confirmation: {
          mode: 'KUAIMA',
          callerPhone: '13911113002',
          calleePhone: '13812345678',
        },
      },
      f.employee.cookie,
    );
    expect(dial.status).toBe(503);
    expect(dial.body).toMatchObject({
      fieldErrors: { telephony: ['MINUTES_EXHAUSTED'] },
    });
    // Added minutes reopen dialing and never repeat a notice.
    const month = read<Company>(await http.get(company(), platform)).month;
    await http.post(
      `${company()}/minutes`,
      { month, minutes: 10, price: '5.00', idempotencyKey: randomUUID() },
      platform,
    );
    expect(
      (await http.get(`${base()}/runtime`, f.employee.cookie)).body,
    ).toMatchObject({ available: true, reason: null });
    expect(await notices('TELEPHONY_MINUTES_80')).toEqual(eighty);
  });

  it('routes one callback address to each company by its supplier call ID', async () => {
    const token = await configureLine(h, f, 'KUAIMA');
    const plan = await createPlan(h, f);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await assignPlan(h, f, f.tenantB.id, plan.id);
    const recordB = await h.adminDatabase.record.findFirstOrThrow({
      where: { tenantId: f.tenantB.id },
    });
    const objectB = await h.adminDatabase.objectDefinition.findUniqueOrThrow({
      where: { id: recordB.objectId },
    });
    const callA = await acceptedCall();
    const callB = await h.adminDatabase.telephonyCall.create({
      data: {
        tenantId: f.tenantB.id,
        actorMemberId: f.tenantBAdmin.memberId,
        requestId: randomUUID(),
        objectId: recordB.objectId,
        objectCode: objectB.code,
        recordId: recordB.id,
        fieldKey: 'phone',
        mode: 'KUAIMA',
        status: 'ACCEPTED',
        callerPhone: '13911113004',
        calleePhone: '13812345670',
        seatId: 'seat-b',
        providerBindId: randomUUID(),
      },
    });
    const numbersB = {
      seats_id: 'seat-b',
      telA: '13911113004',
      telB: '13812345670',
    };
    expect(
      (await hook(token, callA.providerBindId!, { duration: 45 })).status,
    ).toBe(200);
    expect(
      (await hook(token, callB.providerBindId!, { ...numbersB, duration: 125 }))
        .status,
    ).toBe(200);
    expect(await usedMinutes(f.tenantA.id)).toBe(1);
    expect(await usedMinutes(f.tenantB.id)).toBe(3);
    // Company A's call ID with company B's numbers is refused.
    const strayA = await acceptedCall();
    expect((await hook(token, strayA.providerBindId!, numbersB)).status).toBe(
      403,
    );
    expect((await hook(token, randomUUID())).status).toBe(404);
    expect((await hook(`${token}x`, callA.providerBindId!)).status).toBe(401);
  });

  it('reports revenue, cost and margin, using the last plan of the month', async () => {
    await configureLine(h, f, 'KUAIMA', {
      costPerMinute: '0.1500',
      seatMonthlyCost: '10.00',
    });
    const cheap = await createPlan(h, f, { monthlyPrice: '80.00' });
    const plan = await createPlan(h, f, { monthlyPrice: '120.00' });
    await assignPlan(h, f, f.tenantA.id, cheap.id);
    await assignPlan(h, f, f.tenantA.id, plan.id);
    await bind(f.employee.memberId, '9001');
    await bind(f.otherEmployee.memberId, '9002');
    // A simulated seat costs nothing.
    await bind(f.admin.memberId, `MOCK-${seatUsername(f.admin.memberId)}`);
    const call = await acceptedCall({ seatId: '9001' });
    await h.adminDatabase.telephonyCall.update({
      where: { id: call.id },
      data: { status: 'CONNECTED', durationSeconds: 61 },
    });
    const month = read<Company>(await http.get(company(), platform)).month;
    expect(
      (
        await http.post(
          `${company()}/minutes`,
          { month, minutes: 30, price: '30.00', idempotencyKey: randomUUID() },
          platform,
        )
      ).status,
    ).toBe(200);
    const report = await http.get(
      `/api/v1/platform/telephony-report?month=${month.slice(0, 7)}`,
      platform,
    );
    expect(report.status).toBe(200);
    const body = read<{
      seatMonthlyCost: string;
      rows: Array<{ tenantId: string }>;
      total: unknown;
    }>(report);
    expect(body.seatMonthlyCost).toBe('10.00');
    expect(body.rows.find((entry) => entry.tenantId === f.tenantA.id)).toEqual({
      tenantId: f.tenantA.id,
      tenantName: expect.any(String) as unknown,
      planName: plan.name,
      monthlyMinutes: 100,
      usedMinutes: 2,
      extraMinutes: 30,
      allowance: 130,
      planPrice: '120.00',
      extraPrice: '30.00',
      revenue: '150.00',
      minuteCost: '0.30',
      seatCost: '20.00',
      cost: '20.30',
      margin: '129.70',
      seatsProvisioned: 2,
    });
    expect(body.total).toEqual({
      usedMinutes: 2,
      revenue: '150.00',
      cost: '20.30',
      margin: '129.70',
    });
    expect(
      (
        await http.get(
          '/api/v1/platform/telephony-report?month=2026-13',
          platform,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await http.get(
          `/api/v1/platform/telephony-report?month=${month.slice(0, 7)}`,
          f.admin.cookie,
        )
      ).status,
    ).toBe(403);
  });
});
