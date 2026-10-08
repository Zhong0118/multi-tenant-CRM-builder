import { createHash } from 'node:crypto';
import { PrismaAuthRepository } from '../src/modules/auth/auth.repository';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionService } from '../src/modules/auth/session.service';
import type { DatabaseService } from '../src/infrastructure/database/database.service';
import { createDatabaseClient } from '@crm/database';
import type { PrismaClient } from '@crm/database';
import type { PasswordHasher } from '../src/modules/auth/password-hasher';
import type { VerificationSender } from '../src/infrastructure/verification/verification-sender';
import type { RateLimiter } from '../src/infrastructure/rate-limit/rate-limiter';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;
if (!adminUrl || !runtimeUrl)
  throw new Error('TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required');

const admin = createDatabaseClient(adminUrl);
const runtime = createDatabaseClient(runtimeUrl);
const repository = new PrismaAuthRepository({
  get client() {
    return runtime;
  },
  transaction: (work) => runtime.$transaction(work),
} as DatabaseService);
const sessions = new SessionService(
  () => 'integration-session-token',
  repository,
);
const sender: VerificationSender = { send: async () => undefined };
const limiter: RateLimiter = { consume: async () => undefined };
const hasher: PasswordHasher = {
  hash: async (value) => `hash:${value}`,
  verify: async (value, candidate) => value === `hash:${candidate}`,
};
const clock = () => new Date();
const service = new AuthService(
  repository,
  sender,
  limiter,
  hasher,
  sessions,
  clock,
  () => '123456',
);

const phone = `+86139${String(Date.now()).slice(-8)}`;
const hashCode = (code: string) =>
  createHash('sha256').update(code).digest('hex');
let challengeIds: string[] = [];
let userId: string | undefined;

beforeAll(async () => {
  await admin.$executeRaw`SELECT 1`;
  const role = await runtime.$queryRaw<
    Array<{ rolsuper: boolean; rolbypassrls: boolean }>
  >`
    SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
  `;
  expect(role).toEqual([{ rolsuper: false, rolbypassrls: false }]);
});

afterAll(async () => {
  if (challengeIds.length)
    await admin.verificationChallenge.deleteMany({
      where: { id: { in: challengeIds } },
    });
  await admin.session.deleteMany({ where: { user: { phone } } });
  await admin.user.deleteMany({ where: { phone } });
  await admin.$disconnect();
  await runtime.$disconnect();
});

async function createChallenge(
  purpose: 'REGISTER' | 'RESET_PASSWORD',
  code = '123456',
) {
  const challenge = await admin.verificationChallenge.create({
    data: {
      phone,
      purpose,
      codeHash: hashCode(code),
      requestIp: '127.0.0.1',
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  challengeIds.push(challenge.id);
  return challenge;
}

const registration = () =>
  service.register({
    phone,
    code: '000000',
    displayName: 'Auth persistence fixture',
    password: 'test-password',
    ip: '127.0.0.1',
    deviceSummary: 'integration-test',
  });

describe('AuthService persistence with PostgreSQL repository', () => {
  it('handles twelve concurrent wrong codes with a ten-connection database pool', async () => {
    const challenge = await createChallenge('REGISTER');
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        service.register({
          phone,
          code: '000000',
          displayName: 'fixture',
          password: 'test',
        }),
      ),
    );
    for (const result of outcomes) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          code: 'VERIFICATION_INVALID',
          status: 400,
        });
    }
    expect(
      await admin.verificationChallenge.findUniqueOrThrow({
        where: { id: challenge.id },
      }),
    ).toMatchObject({ attemptCount: 5, status: 'LOCKED' });
  }, 15000);
  it('commits each wrong registration code and locks on attempt five', async () => {
    const challenge = await createChallenge('REGISTER');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await expect(registration()).rejects.toMatchObject({
        code: 'VERIFICATION_INVALID',
        getStatus: expect.any(Function),
      });
      const persisted = await admin.verificationChallenge.findUniqueOrThrow({
        where: { id: challenge.id },
      });
      expect(persisted.attemptCount).toBe(attempt);
      expect(persisted.status).toBe(attempt === 5 ? 'LOCKED' : 'PENDING');
    }
    await expect(
      service.register({
        phone,
        code: '123456',
        displayName: 'x',
        password: 'x',
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID', status: 400 });
  });

  it('serializes concurrent wrong attempts and rejects attempts after lock as 400', async () => {
    const challenge = await createChallenge('REGISTER');
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, registration),
    );
    expect(outcomes.every((result) => result.status === 'rejected')).toBe(true);
    const persisted = await admin.verificationChallenge.findUniqueOrThrow({
      where: { id: challenge.id },
    });
    expect(persisted.attemptCount).toBe(5);
    expect(persisted.status).toBe('LOCKED');
    for (const result of outcomes) {
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          code: 'VERIFICATION_INVALID',
          status: 400,
        });
    }
  });

  it('persists reset-password failures and locks after five concurrent wrong codes', async () => {
    const challenge = await createChallenge('RESET_PASSWORD');
    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.resetPassword({ phone, code: '000000', newPassword: 'new' }),
      ),
    );
    for (const result of outcomes) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          code: 'VERIFICATION_INVALID',
          status: 400,
        });
    }
    expect(
      await admin.verificationChallenge.findUniqueOrThrow({
        where: { id: challenge.id },
      }),
    ).toMatchObject({ attemptCount: 5, status: 'LOCKED' });
    await expect(
      service.resetPassword({ phone, code: '123456', newPassword: 'new' }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_INVALID', status: 400 });
  });

  it('rolls back challenge consumption and password changes when later business work fails', async () => {
    const verifiedUser = await admin.user.create({
      data: {
        displayName: 'Existing user',
        phone,
        phoneVerifiedAt: new Date(),
        passwordHash: 'hash:old',
        isPlatformAdmin: false,
      },
    });
    userId = verifiedUser.id;
    const challenge = await createChallenge('RESET_PASSWORD');
    const failingHasher: PasswordHasher = {
      ...hasher,
      hash: async () => {
        throw new Error('simulated business write failure');
      },
    };
    const failingService = new AuthService(
      repository,
      sender,
      limiter,
      failingHasher,
      sessions,
      clock,
      () => '123456',
    );
    await expect(
      failingService.resetPassword({
        phone,
        code: '123456',
        newPassword: 'new',
      }),
    ).rejects.toThrow('simulated business write failure');
    const persisted = await admin.verificationChallenge.findUniqueOrThrow({
      where: { id: challenge.id },
    });
    expect(persisted.status).toBe('PENDING');
    expect(persisted.attemptCount).toBe(0);
    expect(
      (await admin.user.findUniqueOrThrow({ where: { id: verifiedUser.id } }))
        .passwordHash,
    ).toBe('hash:old');
    await service.resetPassword({ phone, code: '123456', newPassword: 'new' });
    expect(
      (
        await admin.verificationChallenge.findUniqueOrThrow({
          where: { id: challenge.id },
        })
      ).status,
    ).toBe('CONSUMED');
    expect(
      (await admin.user.findUniqueOrThrow({ where: { id: verifiedUser.id } }))
        .passwordHash,
    ).toBe('hash:new');
    await admin.user.delete({ where: { id: verifiedUser.id } });
    userId = undefined;
  });
});
