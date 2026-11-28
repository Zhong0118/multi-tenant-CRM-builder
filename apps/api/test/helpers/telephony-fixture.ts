import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  CRITICAL_TENANT_A,
  CRITICAL_TENANT_B,
  type CriticalFixture,
  type CriticalHarness,
} from './critical-fixture';

export const TELEPHONY_ORIGIN = 'http://localhost:3000';
export const TELEPHONY_KEYRING = JSON.stringify({
  activeKeyId: 'telephony-test',
  keys: { 'telephony-test': Buffer.alloc(32, 7).toString('base64') },
});
export const TEST_PLAN_PREFIX = 'e2e 通话 ';
const LINE = '/api/v1/platform/telephony-settings';

/** Refuses to run anywhere but a local throwaway test database. */
export function assertLocalTestDatabase() {
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
}

export function telephonyHttp(h: CriticalHarness) {
  const server = () => h.app.getHttpServer();
  return {
    get: (path: string, cookie: string) =>
      request(server()).get(path).set('Cookie', cookie),
    post: (path: string, body: object | undefined, cookie: string) =>
      request(server())
        .post(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie)
        .send(body ?? {}),
    patch: (path: string, body: object, cookie: string) =>
      request(server())
        .patch(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie)
        .send(body),
    delete: (path: string, cookie: string) =>
      request(server())
        .delete(path)
        .set('Origin', TELEPHONY_ORIGIN)
        .set('Cookie', cookie),
  };
}

/** Removes everything the telephony specs create and resets the platform line. */
export async function cleanupTelephony(h: CriticalHarness) {
  const db = h.adminDatabase;
  const tenants = await db.tenant.findMany({
    where: { code: { in: [CRITICAL_TENANT_A, CRITICAL_TENANT_B] } },
    select: { id: true },
  });
  const where = { tenantId: { in: tenants.map(({ id }) => id) } };
  await db.telephonyCall.deleteMany({ where });
  await db.telephonyMemberBinding.deleteMany({ where });
  await db.telephonySettings.deleteMany({ where });
  await db.telephonyMinuteAddition.deleteMany({ where });
  await db.telephonyTenantMonth.deleteMany({ where });
  await db.telephonyPlanHistory.deleteMany({ where });
  await db.tenantTelephonyConfig.deleteMany({ where });
  await db.memberNotification.deleteMany({
    where: {
      ...where,
      kind: { in: ['TELEPHONY_MINUTES_80', 'TELEPHONY_MINUTES_100'] },
    },
  });
  await db.telephonyPlan.deleteMany({
    where: { name: { startsWith: TEST_PLAN_PREFIX } },
  });
  await db.telephonyPlatformSettings.update({
    where: { id: true },
    data: {
      mode: 'MOCK',
      companyId: '',
      appSecretEncrypted: null,
      callbackTokenEncrypted: null,
      costPerMinute: 0,
      seatMonthlyCost: 0,
    },
  });
}

/** Tenant B's administrator doubles as the platform administrator. */
export async function promotePlatformAdmin(
  h: CriticalHarness,
  f: CriticalFixture,
) {
  await h.adminDatabase.user.update({
    where: { id: f.tenantBAdmin.userId },
    data: { isPlatformAdmin: true },
  });
}

/** Sets the platform line and issues a callback credential; returns the token. */
export async function configureLine(
  h: CriticalHarness,
  f: CriticalFixture,
  mode: 'MOCK' | 'KUAIMA' = 'MOCK',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const http = telephonyHttp(h);
  const cookie = f.tenantBAdmin.cookie;
  const current = await http.get(LINE, cookie);
  expect(current.status).toBe(200);
  const saved = await http.patch(
    LINE,
    {
      version: (current.body as { version: number }).version,
      mode,
      companyId: '131',
      appSecret: 'platform-secret',
      ...extra,
    },
    cookie,
  );
  expect(saved.status).toBe(200);
  const issued = await http.post(`${LINE}/callback-token`, undefined, cookie);
  expect(issued.status).toBe(200);
  return new URL(
    (issued.body as { callbackUrl: string }).callbackUrl,
  ).searchParams.get('token')!;
}

export async function createPlan(
  h: CriticalHarness,
  f: CriticalFixture,
  overrides: Record<string, unknown> = {},
) {
  const created = await telephonyHttp(h).post(
    '/api/v1/platform/telephony-plans',
    {
      name: `${TEST_PLAN_PREFIX}${randomUUID().slice(0, 8)}`,
      seats: 3,
      monthlyMinutes: 100,
      monthlyPrice: '120.00',
      assignable: true,
      ...overrides,
    },
    f.tenantBAdmin.cookie,
  );
  expect(created.status).toBe(201);
  return created.body as { id: string; name: string; version: number };
}

export async function assignPlan(
  h: CriticalHarness,
  f: CriticalFixture,
  tenantId: string,
  planId: string | null,
) {
  const http = telephonyHttp(h);
  const path = `/api/v1/platform/tenants/${tenantId}/telephony`;
  const current = await http.get(path, f.tenantBAdmin.cookie);
  expect(current.status).toBe(200);
  const saved = await http.patch(
    path,
    { version: (current.body as { version: number }).version, planId },
    f.tenantBAdmin.cookie,
  );
  expect(saved.status).toBe(200);
  return saved.body as { version: number; month: string };
}
