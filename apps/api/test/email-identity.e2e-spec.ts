import { SessionService } from '../src/modules/auth/session.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '@crm/database';
import { EmailIdentityService } from '../src/modules/auth/email-identity.service';
import { DatabaseService } from '../src/infrastructure/database/database.service';
import type { MailService } from '../src/modules/mail/mail.service';
import type { EmailRateLimits } from '../src/modules/auth/email-rate-limits';

const admin = createDatabaseClient(process.env.TEST_DATABASE_ADMIN_URL!);
const runtime = createDatabaseClient(process.env.TEST_DATABASE_URL!);
const database = {
  client: runtime,
  transaction: (work) => runtime.$transaction(work),
} as DatabaseService;
const codes = new Map<string, string>();
const queued: string[] = [];
let deliver: (id: string) => Promise<boolean> = () => Promise.resolve(true);
const mail = {
  available: true,
  requireAvailable: () => undefined,
  challengeKey: () => Buffer.alloc(32, 2),
  sendCode: async (input: { challengeId: string; code: string }) => {
    codes.set(input.challengeId, input.code);
    return deliver(input.challengeId);
  },
  enqueue: (_tx: unknown, event: { kind: string }) => {
    queued.push(event.kind);
    return Promise.resolve();
  },
} as unknown as MailService;
const hasher = {
  hash: (s: string) => Promise.resolve('hash:' + s),
  verify: (h: string, s: string) => Promise.resolve(h === 'hash:' + s),
};
const limits = {
  issue: async () => {},
  account: async () => {},
  confirm: async () => {},
} as unknown as EmailRateLimits;
let now = Date.now();
const service = new EmailIdentityService(
  database,
  mail,
  hasher,
  limits,
  () => new Date(now),
);
const ids: string[] = [];
const ip = '192.0.2.1';
async function user(email: string | null = null, verified = false) {
  const row = await admin.user.create({
    data: {
      phone: '+86' + randomUUID().slice(0, 12),
      phoneVerifiedAt: new Date(),
      passwordHash: 'hash:Pass1234567',
      displayName: 'identity test',
      email,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
  ids.push(row.id);
  return row.id;
}
const address = () => randomUUID() + '@example.org';
afterAll(async () => {
  await admin.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await admin.user.deleteMany({ where: { id: { in: ids } } });
  await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
});
afterEach(() => {
  deliver = () => Promise.resolve(true);
  queued.length = 0;
});
it('consumes only once and normalizes the address on a concurrent bind', async () => {
  const id = await user(),
    email = address();
  const input = { purpose: 'BIND' as const, email: email.toUpperCase() };
  const { challengeId } = await service.issue(id, input, ip);
  const verify = { ...input, challengeId, code: codes.get(challengeId)! };
  const outcomes = await Promise.allSettled([
    service.verify(id, verify, ip),
    service.verify(id, verify, ip),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(await admin.user.findUnique({ where: { id } })).toMatchObject({
    email,
    emailVersion: 1,
  });
});
it('persists failures across IPs, locks at five and refuses a sixth correct code', async () => {
  const id = await user(),
    input = { purpose: 'BIND' as const, email: address() };
  const { challengeId } = await service.issue(id, input, ip);
  const code = codes.get(challengeId)!;
  for (let i = 0; i < 5; i++)
    await expect(
      service.verify(
        id,
        {
          ...input,
          challengeId,
          code: code === '000000' ? '111111' : '000000',
        },
        '192.0.2.' + i,
      ),
    ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
  await expect(
    service.verify(id, { ...input, challengeId, code }, ip),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
  expect(
    await admin.emailChallenge.findUnique({ where: { id: challengeId } }),
  ).toMatchObject({ attemptCount: 5, status: 'LOCKED' });
});
it('rechecks password at change completion and sends a notice only to the old verified address', async () => {
  const old = address(),
    id = await user(old, true),
    input = {
      purpose: 'CHANGE' as const,
      email: address(),
      currentPassword: 'Pass1234567',
    };
  const { challengeId } = await service.issue(id, input, ip);
  const verify = { ...input, challengeId, code: codes.get(challengeId)! };
  await expect(
    service.verify(id, { ...verify, currentPassword: 'wrong' }, ip),
  ).rejects.toMatchObject({
    fieldErrors: { currentPassword: ['当前密码不正确。'] },
  });
  expect((await admin.user.findUnique({ where: { id } }))?.email).toBe(old);
  await service.verify(id, verify, ip);
  expect(queued).toEqual(['email_changed']);
  await service.remove(id, 'Pass1234567');
  expect(queued).toEqual(['email_changed', 'email_removed']);
});
it('discards superseded, rejected and expired challenges', async () => {
  const id = await user(),
    input = { purpose: 'BIND' as const, email: address() };
  let release!: () => void, started!: () => void;
  const accepted = new Promise<void>((r) => {
      release = r;
    }),
    sending = new Promise<void>((r) => {
      started = r;
    });
  deliver = async () => {
    started();
    await accepted;
    return true;
  };
  const slow = service.issue(id, input, ip);
  await sending;
  deliver = () => Promise.resolve(false);
  await expect(service.issue(id, input, ip)).rejects.toBeDefined();
  release();
  await expect(slow).rejects.toBeDefined();
  const rows = await admin.emailChallenge.findMany({ where: { userId: id } });
  expect(rows.every((r) => r.status === 'DISCARDED')).toBe(true);
  deliver = () => Promise.resolve(true);
  const { challengeId } = await service.issue(id, input, ip);
  now += 600_000;
  await expect(
    service.verify(
      id,
      { ...input, challengeId, code: codes.get(challengeId)! },
      ip,
    ),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
});
it('returns neutral recovery before SMTP acceptance, revokes sessions, and rejects replay', async () => {
  const email = address(),
    id = await user(email, true);
  const unknown = await service.forgot(address(), ip);
  let release!: () => void, started!: () => void;
  const accepted = new Promise<void>((r) => {
      release = r;
    }),
    sending = new Promise<void>((r) => {
      started = r;
    });
  deliver = async () => {
    started();
    await accepted;
    return true;
  };
  const known = await service.forgot(email, ip);
  expect(known.message).toBe(unknown.message);
  expect(known.challengeId).not.toBe(unknown.challengeId);
  await sending;
  const reset = {
    email,
    challengeId: known.challengeId,
    code: codes.get(known.challengeId)!,
    newPassword: 'NewPass12345',
  };
  await expect(service.reset(reset, ip)).rejects.toMatchObject({
    code: 'VERIFICATION_INVALID',
  });
  const session = await admin.session.create({
    data: {
      userId: id,
      tokenHash: randomUUID(),
      expiresAt: new Date(now + 86400_000),
    },
  });
  release();
  for (let i = 0; i < 100; i++) {
    if (
      (
        await admin.emailChallenge.findUnique({
          where: { id: known.challengeId },
        })
      )?.status === 'ACTIVE'
    )
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await service.reset(reset, ip);
  expect(
    (await admin.session.findUnique({ where: { id: session.id } }))?.revokedAt,
  ).toBeInstanceOf(Date);
  await expect(service.reset(reset, ip)).rejects.toMatchObject({
    code: 'VERIFICATION_INVALID',
  });
  expect(queued).toEqual(['password_reset']);
});

it('allows only one account to bind a shared normalized address and preserves the losing account', async () => {
  const email = address(),
    owners = [await user(), await user()];
  const challenges = await Promise.all(
    owners.map((id, i) =>
      service.issue(
        id,
        { purpose: 'BIND', email: i ? email.toUpperCase() : email },
        ip,
      ),
    ),
  );
  const results = await Promise.allSettled(
    owners.map((id, i) =>
      service.verify(
        id,
        {
          purpose: 'BIND',
          email,
          challengeId: challenges[i].challengeId,
          code: codes.get(challenges[i].challengeId)!,
        },
        ip,
      ),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const losing = results.findIndex((r) => r.status === 'rejected');
  expect(results[losing]).toMatchObject({
    reason: { fieldErrors: { email: ['此邮箱不可使用。'] } },
  });
  expect(
    (await admin.user.findUnique({ where: { id: owners[losing] } }))?.email,
  ).toBeNull();
});
it('binds the challenge to its account, target, purpose, and current version, honoring cancellation', async () => {
  const id = await user(),
    other = await user(),
    email = address();
  const input = { purpose: 'BIND' as const, email };
  const { challengeId } = await service.issue(id, input, ip);
  const body = { ...input, challengeId, code: codes.get(challengeId)! };
  await expect(service.verify(other, body, ip)).rejects.toMatchObject({
    code: 'VERIFICATION_INVALID',
  });
  await expect(
    service.verify(id, { ...body, email: address() }, ip),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
  await expect(
    service.reset({ ...body, newPassword: 'newPass12345' }, ip),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
  await service.cancel(id, challengeId);
  await expect(service.verify(id, body, ip)).rejects.toMatchObject({
    code: 'VERIFICATION_INVALID',
  });
  const changed = await service.issue(id, input, ip);
  await admin.user.update({
    where: { id },
    data: { emailVersion: { increment: 1 } },
  });
  await expect(
    service.verify(
      id,
      { ...body, ...changed, code: codes.get(changed.challengeId)! },
      ip,
    ),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
  expect(
    await runtime.emailChallenge.findMany({ where: { userId: id } }),
  ).toEqual([]);
  const stored = await admin.emailChallenge.findUniqueOrThrow({
    where: { id: challengeId },
  });
  expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.emailDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(email);
});
it('reverifies a legacy address without exposing it, and leaves undeliverable old addresses out of notifications', async () => {
  const email = address(),
    id = await user(email);
  const { challengeId, maskedEmail } = await service.issue(
    id,
    { purpose: 'REVERIFY' },
    ip,
  );
  expect(maskedEmail).not.toBe(email);
  await service.verify(
    id,
    { purpose: 'REVERIFY', challengeId, code: codes.get(challengeId)! },
    ip,
  );
  const after = await admin.user.findUniqueOrThrow({ where: { id } });
  expect(after.emailVerifiedAt).toBeInstanceOf(Date);
  await admin.user.update({
    where: { id },
    data: { emailUndeliverableAt: new Date() },
  });
  await service.remove(id, 'Pass1234567');
  expect(queued).toEqual([]);
  const audit = await admin.auditLog.findMany({ where: { actorId: id } });
  expect(audit.map((a) => a.tenantId)).toEqual([null, null]);
  expect(JSON.stringify(audit)).not.toContain(email);
});

it('serializes concurrent device comparisons, retains the cookie on network changes and remembers devices while opted out', async () => {
  const repo = new PrismaAuthRepository(database, mail);
  const userId = await user(address(), true);
  const chrome = 'Chrome/123.4 Safari/9 (Windows NT 10.0)',
    other = 'Mozilla/5.0 (Android) Firefox/120';
  const add = (userAgent: string, ip: string, deviceCookie?: string) =>
    repo.transaction((store) =>
      store.createSession(
        {
          userId,
          ip,
          tokenHash: randomUUID(),
          createdAt: new Date(now),
          expiresAt: new Date(now + 86400_000),
        },
        { userAgent, deviceCookie },
      ),
    );
  const first = await add(chrome, ip);
  expect(first.deviceCookie).toMatch(/^[\w-]{43}$/);
  await add(chrome.replace('123.4', '130.0'), '192.0.2.87');
  await add(chrome, '10.0.0.1', first.deviceCookie);
  expect(queued).toEqual([]);
  await Promise.all([add(other, '198.51.100.4'), add(other, '198.51.100.8')]);
  expect(queued).toEqual(['new_device']);
  await service.updateSettings(userId, false);
  await add(other, '203.0.113.1');
  await service.updateSettings(userId, true);
  await add(other, '203.0.113.4');
  expect(queued).toEqual(['new_device']);
  const rows = await admin.loginDevice.findMany({ where: { userId } });
  expect(rows.map((r) => r.tokenHash)).not.toContain(first.deviceCookie);
});
it('emits the same mandatory reset alert for SMS and keeps only the current session after an authenticated change', async () => {
  const repo = new PrismaAuthRepository(database, mail);
  const userId = await user(address(), true);
  const phone = '139' + String(Date.now()).slice(-8);
  await admin.user.update({
    where: { id: userId },
    data: { phone: '+86' + phone, newDeviceMailEnabled: false },
  });
  const auth = new AuthService(
    repo,
    { send: async () => {} },
    { consume: async () => {} },
    hasher,
    new SessionService(() => randomUUID(), repo),
    () => new Date(now),
    () => '012345',
  );
  const login = () =>
    auth.login({ phone, password: 'Pass1234567', deviceKey: 'local-fixture' });
  const a = await login(),
    b = await login();
  await auth.changePassword({
    userId,
    currentSessionId: a.sessionId,
    currentPassword: 'Pass1234567',
    newPassword: 'newPass12345',
  });
  expect(
    (await admin.session.findUniqueOrThrow({ where: { id: b.sessionId } }))
      .revokedAt,
  ).toBeInstanceOf(Date);
  expect(
    (await admin.session.findUniqueOrThrow({ where: { id: a.sessionId } }))
      .revokedAt,
  ).toBeNull();
  await auth.requestVerification({
    phone,
    purpose: 'RESET_PASSWORD',
    requestIp: ip,
    deviceKey: 'local-fixture',
  });
  await auth.resetPassword({
    phone,
    code: '012345',
    newPassword: 'again1234567',
  });
  expect(
    (await admin.session.findUniqueOrThrow({ where: { id: a.sessionId } }))
      .revokedAt,
  ).toBeInstanceOf(Date);
  expect(queued).toEqual(['password_changed', 'password_reset']);
  await admin.verificationChallenge.deleteMany({
    where: { phone: '+86' + phone },
  });
});

it('remembers both recently visited networks when a known device switches Wi-Fi', async () => {
  const repo = new PrismaAuthRepository(database, mail),
    userId = await user(address(), true);
  const userAgent = 'Chrome/123 (Windows NT 10.0)';
  const visit = (ip: string, deviceCookie?: string) =>
    repo.transaction((store) =>
      store.createSession(
        {
          userId,
          ip,
          tokenHash: randomUUID(),
          createdAt: new Date(now),
          expiresAt: new Date(now + 86400_000),
        },
        { userAgent, deviceCookie },
      ),
    );
  const first = await visit('192.0.2.2');
  await visit('198.51.100.2', first.deviceCookie);
  await visit('192.0.2.3');
  expect(queued).toEqual([]);
});

it('gives unknown, unverified, disabled, undeliverable and SMTP-rejected addresses the same recovery response', async () => {
  const unknown = address(),
    legacy = address(),
    disabled = address(),
    bounced = address(),
    refused = address();
  await user(legacy);
  await admin.user.update({
    where: { id: await user(disabled, true) },
    data: { status: 'DISABLED' },
  });
  await admin.user.update({
    where: { id: await user(bounced, true) },
    data: { emailUndeliverableAt: new Date() },
  });
  await user(refused, true);
  const attempted: string[] = [];
  deliver = (id) => {
    attempted.push(id);
    return Promise.resolve(false);
  };
  const responses = await Promise.all(
    [unknown, legacy, disabled, bounced, refused].map((value) =>
      service.forgot(value, ip),
    ),
  );
  expect(new Set(responses.map((row) => row.challengeId)).size).toBe(5);
  for (const response of responses) {
    expect(Object.keys(response).sort()).toEqual(['challengeId', 'message']);
    expect(response.message).toBe('如果这个邮箱已绑定账号，你会收到验证码');
  }
  const id = responses[4].challengeId;
  for (let i = 0; i < 100; i++) {
    if (
      (await admin.emailChallenge.findUnique({ where: { id } }))?.status ===
      'DISCARDED'
    )
      break;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(attempted).toEqual([id]);
  expect(
    await admin.emailChallenge.count({
      where: { id: { in: responses.map((r) => r.challengeId) } },
    }),
  ).toBe(1);
  await expect(
    service.reset(
      {
        email: refused,
        challengeId: id,
        code: codes.get(id)!,
        newPassword: 'NewPass12345',
      },
      ip,
    ),
  ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID' });
});

it('prunes at most 200 old challenges and expired devices per maintenance pass without exposing other accounts', async () => {
  const id = await user(),
    old = new Date(Date.now() - 31 * 86400_000),
    future = new Date(Date.now() + 86400_000);
  const oldCode = {
    userId: id,
    purpose: 'BIND',
    emailVersion: 0,
    emailDigest: '1'.repeat(64),
    codeHash: '2'.repeat(64),
    status: 'ACTIVE',
    createdAt: old,
    expiresAt: old,
  };
  await admin.emailChallenge.createMany({
    data: Array.from({ length: 201 }, () => ({ ...oldCode, id: randomUUID() })),
  });
  const recent = await admin.emailChallenge.create({
    data: { ...oldCode, id: randomUUID(), createdAt: new Date() },
  });
  const valid = await admin.emailChallenge.create({
    data: { ...oldCode, id: randomUUID(), expiresAt: future },
  });
  await admin.loginDevice.createMany({
    data: Array.from({ length: 201 }, (_, i) => ({
      userId: id,
      tokenHash: i.toString(16).padStart(64, '0'),
      lastUsedAt: old,
      expiresAt: old,
    })),
  });
  await admin.loginDevice.create({
    data: {
      userId: id,
      tokenHash: 'f'.repeat(64),
      lastUsedAt: old,
      expiresAt: future,
    },
  });
  expect(await runtime.emailChallenge.count({ where: { userId: id } })).toBe(0);
  const prune = () =>
    runtime.$queryRaw<
      { n: number }[]
    >`SELECT public.auth_prune_email_identity() AS n`;
  expect(await prune()).toEqual([{ n: 400 }]);
  expect(await prune()).toEqual([{ n: 2 }]);
  expect(await prune()).toEqual([{ n: 0 }]);
  expect(
    (
      await admin.emailChallenge.findMany({
        where: { userId: id },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort(),
  ).toEqual([recent.id, valid.id].sort());
  expect(await admin.loginDevice.count({ where: { userId: id } })).toBe(1);
});
