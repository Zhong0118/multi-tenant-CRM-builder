import type { ApiErrorCode } from '../../common/errors/api-error-code';
import type { RateLimiter } from '../../infrastructure/rate-limit/rate-limiter';
import type { VerificationSender } from '../../infrastructure/verification/verification-sender';
import type {
  AuthChallenge,
  AuthRepository,
  AuthSession,
  AuthStore,
  AuthUser,
  ChallengePurpose,
  ChallengeStatus,
} from './auth.repository';
import type { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';

class MemoryAuthRepository implements AuthRepository {
  challenges: AuthChallenge[] = [];
  sessions: AuthSession[] = [];
  users: AuthUser[] = [];

  transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  createChallenge(input: Omit<AuthChallenge, 'id'>): Promise<AuthChallenge> {
    const challenge = {
      ...input,
      id: `challenge-${this.challenges.length + 1}`,
    };
    this.challenges.push(challenge);
    return Promise.resolve(challenge);
  }

  findLatestChallenge(
    phone: string,
    purpose: ChallengePurpose,
  ): Promise<AuthChallenge | null> {
    return Promise.resolve(
      this.challenges.findLast(
        (challenge) =>
          challenge.phone === phone && challenge.purpose === purpose,
      ) ?? null,
    );
  }

  updateChallengeFailure(
    id: string,
    attemptCount: number,
    status: ChallengeStatus,
  ): Promise<void> {
    const challenge = this.challenges.find((item) => item.id === id);
    if (challenge) {
      challenge.attemptCount = attemptCount;
      challenge.status = status;
    }
    return Promise.resolve();
  }

  consumeChallenge(id: string, consumedAt: Date): Promise<boolean> {
    const challenge = this.challenges.find((item) => item.id === id);
    if (!challenge || challenge.status !== 'PENDING') {
      return Promise.resolve(false);
    }
    challenge.status = 'CONSUMED';
    challenge.consumedAt = consumedAt;
    return Promise.resolve(true);
  }

  findUserByPhone(phone: string): Promise<AuthUser | null> {
    return Promise.resolve(
      this.users.find((user) => user.phone === phone) ?? null,
    );
  }

  findUserById(id: string): Promise<AuthUser | null> {
    return Promise.resolve(this.users.find((user) => user.id === id) ?? null);
  }

  createUser(input: Omit<AuthUser, 'id'>): Promise<AuthUser> {
    const user = { ...input, id: `user-${this.users.length + 1}` };
    this.users.push(user);
    return Promise.resolve(user);
  }

  updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user) user.passwordHash = passwordHash;
    return Promise.resolve();
  }

  createSession(input: Omit<AuthSession, 'id'>): Promise<AuthSession> {
    const session = { ...input, id: `session-${this.sessions.length + 1}` };
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  findSessionByTokenHash(
    tokenHash: string,
  ): Promise<{ session: AuthSession; user: AuthUser } | null> {
    const session = this.sessions.find((item) => item.tokenHash === tokenHash);
    const user = session
      ? this.users.find((item) => item.id === session.userId)
      : undefined;
    return Promise.resolve(session && user ? { session, user } : null);
  }

  touchSession(sessionId: string, usedAt: Date): Promise<void> {
    const session = this.sessions.find((item) => item.id === sessionId);
    if (session) session.lastUsedAt = usedAt;
    return Promise.resolve();
  }

  revokeAllSessions(userId: string, revokedAt: Date): Promise<void> {
    for (const session of this.sessions) {
      if (session.userId === userId && !session.revokedAt) {
        session.revokedAt = revokedAt;
      }
    }
    return Promise.resolve();
  }

  revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    for (const session of this.sessions) {
      if (
        session.userId === userId &&
        session.id !== currentSessionId &&
        !session.revokedAt
      ) {
        session.revokedAt = revokedAt;
      }
    }
    return Promise.resolve();
  }

  listSessionsByUser(userId: string): Promise<AuthSession[]> {
    return Promise.resolve(
      this.sessions.filter((session) => session.userId === userId),
    );
  }

  listSessionPage(
    userId: string,
    input: {
      kind: 'ACTIVE' | 'HISTORY';
      page: number;
      limit: number;
      now: Date;
    },
  ): Promise<{ items: AuthSession[]; total: number }> {
    const matching = this.sessions
      .filter((session) => session.userId === userId)
      .filter((session) => {
        const active =
          !session.revokedAt &&
          session.expiresAt.getTime() > input.now.getTime();
        return input.kind === 'ACTIVE' ? active : !active;
      })
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
    const offset = (input.page - 1) * input.limit;
    return Promise.resolve({
      items: matching.slice(offset, offset + input.limit),
      total: matching.length,
    });
  }

  pruneAuthArtifacts(input: {
    sessionCutoff: Date;
    challengeCutoff: Date;
  }): Promise<void> {
    this.sessions = this.sessions.filter(
      (session) =>
        !(
          session.expiresAt < input.sessionCutoff ||
          (session.revokedAt && session.revokedAt < input.sessionCutoff)
        ),
    );
    this.challenges = this.challenges.filter(
      (challenge) => challenge.createdAt >= input.challengeCutoff,
    );
    return Promise.resolve();
  }

  updateLastLoginAt(userId: string, at: Date): Promise<void> {
    const user = this.users.find((item) => item.id === userId);
    if (user) (user as AuthUser & { lastLoginAt?: Date }).lastLoginAt = at;
    return Promise.resolve();
  }

  revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const session = this.sessions.find(
      (item) => item.id === sessionId && item.userId === userId,
    );
    if (!session) return Promise.resolve(false);
    session.revokedAt = revokedAt;
    return Promise.resolve(true);
  }
}

class MemorySender implements VerificationSender {
  sent: Array<{ phone: string; code: string; purpose: ChallengePurpose }> = [];

  send(input: {
    phone: string;
    code: string;
    purpose: ChallengePurpose;
  }): Promise<void> {
    this.sent.push(input);
    return Promise.resolve();
  }
}

const rateLimiter: RateLimiter = {
  consume: () => Promise.resolve(),
};

const passwordHasher: PasswordHasher = {
  hash: (password) => Promise.resolve(`encoded:${password}`),
  verify: (hash, password) => Promise.resolve(hash === `encoded:${password}`),
};

function createFixture() {
  const repository = new MemoryAuthRepository();
  const sender = new MemorySender();
  let now = new Date('2026-08-20T00:00:00.000Z');
  let tokenSequence = 0;
  const service = new AuthService(
    repository,
    sender,
    rateLimiter,
    passwordHasher,
    new SessionService(() => `token-${++tokenSequence}`, repository),
    () => new Date(now),
    () => '123456',
  );

  return {
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
    repository,
    sender,
    service,
  };
}

async function expectCode(work: Promise<unknown>, code: ApiErrorCode) {
  await expect(work).rejects.toMatchObject({ code });
}

describe('AuthService verification policy', () => {
  it('rejects an expired verification code', async () => {
    const fixture = createFixture();
    await fixture.service.requestVerification({
      phone: '13800138000',
      purpose: 'REGISTER',
      requestIp: '127.0.0.1',
      deviceKey: 'test-device',
    });
    fixture.advance(10 * 60 * 1000 + 1);

    await expectCode(
      fixture.service.register({
        phone: '13800138000',
        code: '123456',
        displayName: '测试用户',
        password: 'correct horse battery staple',
        ip: '127.0.0.1',
        deviceSummary: 'Jest',
      }),
      'VERIFICATION_EXPIRED',
    );
  });

  it('locks a challenge after five wrong attempts', async () => {
    const fixture = createFixture();
    await fixture.service.requestVerification({
      phone: '13800138000',
      purpose: 'REGISTER',
      requestIp: '127.0.0.1',
      deviceKey: 'test-device',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectCode(
        fixture.service.register({
          phone: '13800138000',
          code: '000000',
          displayName: '测试用户',
          password: 'correct horse battery staple',
          ip: '127.0.0.1',
          deviceSummary: 'Jest',
        }),
        'VERIFICATION_INVALID',
      );
    }

    expect(fixture.repository.challenges[0]).toMatchObject({
      attemptCount: 5,
      status: 'LOCKED',
    });
    await expectCode(
      fixture.service.register({
        phone: '13800138000',
        code: '123456',
        displayName: '测试用户',
        password: 'correct horse battery staple',
        ip: '127.0.0.1',
        deviceSummary: 'Jest',
      }),
      'VERIFICATION_INVALID',
    );
  });

  it('does not allow a consumed reset code to be reused', async () => {
    const fixture = createFixture();
    fixture.repository.users.push({
      id: 'user-1',
      displayName: '测试用户',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:old-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });
    await fixture.service.requestVerification({
      phone: '13800138000',
      purpose: 'RESET_PASSWORD',
      requestIp: '127.0.0.1',
      deviceKey: 'test-device',
    });

    await fixture.service.resetPassword({
      phone: '13800138000',
      code: '123456',
      newPassword: 'new-password-value',
    });
    await expectCode(
      fixture.service.resetPassword({
        phone: '13800138000',
        code: '123456',
        newPassword: 'another-password-value',
      }),
      'VERIFICATION_INVALID',
    );
  });

  it('returns the same accepted shape when registration already exists', async () => {
    const fixture = createFixture();
    fixture.repository.users.push({
      id: 'user-1',
      displayName: '原姓名',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:original-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });
    await fixture.service.requestVerification({
      phone: '13800138000',
      purpose: 'REGISTER',
      requestIp: '127.0.0.1',
      deviceKey: 'test-device',
    });

    const result = await fixture.service.register({
      phone: '13800138000',
      code: '123456',
      displayName: '新姓名',
      password: 'replacement-password',
      ip: '127.0.0.1',
      deviceSummary: 'Jest',
    });

    expect(result).toMatchObject({ accepted: true });
    expect(result.sessionToken).toEqual(expect.any(String));
    expect(fixture.repository.users).toHaveLength(1);
    expect(fixture.repository.users[0]).toMatchObject({
      displayName: '原姓名',
      passwordHash: 'encoded:original-password',
    });
  });
});

describe('AuthService credentials and reset', () => {
  it('records the time of a successful password login', async () => {
    const fixture = createFixture();
    fixture.repository.users.push({
      id: 'user-1',
      displayName: '测试用户',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:correct-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });

    await fixture.service.login({
      phone: '13800138000',
      password: 'correct-password',
      ip: '127.0.0.1',
      deviceSummary: 'Jest',
      deviceKey: 'test-device',
    });

    expect(fixture.repository.users[0].lastLoginAt).toEqual(
      new Date('2026-08-20T00:00:00.000Z'),
    );
  });

  it('uses the same public error for a missing user and a bad password', async () => {
    const missing = createFixture();
    const badPassword = createFixture();
    badPassword.repository.users.push({
      id: 'user-1',
      displayName: '测试用户',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:correct-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });

    const input = {
      phone: '13800138000',
      password: 'wrong-password',
      ip: '127.0.0.1',
      deviceSummary: 'Jest',
      deviceKey: 'test-device',
    };
    const errors = await Promise.all(
      [missing.service.login(input), badPassword.service.login(input)].map(
        async (work) => work.catch((error: unknown) => error),
      ),
    );

    expect(errors).toEqual([
      expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
      expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
    ]);
    expect((errors[0] as Error).message).toBe((errors[1] as Error).message);
  });

  it('revokes every existing session after a password reset', async () => {
    const fixture = createFixture();
    fixture.repository.users.push({
      id: 'user-1',
      displayName: '测试用户',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:old-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });
    fixture.repository.sessions.push(
      {
        id: 'session-1',
        userId: 'user-1',
        tokenHash: 'hash-1',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date(),
      },
      {
        id: 'session-2',
        userId: 'user-1',
        tokenHash: 'hash-2',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date(),
      },
    );
    await fixture.service.requestVerification({
      phone: '13800138000',
      purpose: 'RESET_PASSWORD',
      requestIp: '127.0.0.1',
      deviceKey: 'test-device',
    });

    await fixture.service.resetPassword({
      phone: '13800138000',
      code: '123456',
      newPassword: 'new-password-value',
    });

    expect(fixture.repository.sessions).toHaveLength(2);
    for (const session of fixture.repository.sessions) {
      expect(session.revokedAt).toBeInstanceOf(Date);
    }
    expect(fixture.repository.users[0].passwordHash).toBe(
      'encoded:new-password-value',
    );
  });

  it('keeps the current session and revokes every other session after a password change', async () => {
    const fixture = createFixture();
    fixture.repository.users.push({
      id: 'user-1',
      displayName: '测试用户',
      phone: '+8613800138000',
      phoneVerifiedAt: new Date(),
      passwordHash: 'encoded:current-password',
      isPlatformAdmin: false,
      status: 'ACTIVE',
    });
    fixture.repository.sessions.push(
      {
        id: 'current-session',
        userId: 'user-1',
        tokenHash: 'hash-current',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date(),
      },
      {
        id: 'other-session',
        userId: 'user-1',
        tokenHash: 'hash-other',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date(),
      },
    );

    await fixture.service.changePassword({
      userId: 'user-1',
      currentSessionId: 'current-session',
      currentPassword: 'current-password',
      newPassword: 'new-password-value',
    });

    expect(fixture.repository.sessions[0].revokedAt).toBeUndefined();
    expect(fixture.repository.sessions[1].revokedAt).toEqual(expect.any(Date));
    expect(fixture.repository.users[0].passwordHash).toBe(
      'encoded:new-password-value',
    );
  });

  it('returns safe session summaries without token hashes', async () => {
    const fixture = createFixture();
    fixture.repository.sessions.push({
      id: 'session-1',
      userId: 'user-1',
      tokenHash: 'must-never-leave-the-api',
      expiresAt: new Date('2026-09-20T00:00:00.000Z'),
      deviceSummary: 'Safari on macOS',
      ip: '203.0.113.42',
      createdAt: new Date('2026-08-20T00:00:00.000Z'),
    });

    const sessions = await fixture.service.listSessions('user-1', 'session-1');

    expect(sessions).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      items: [
        {
          id: 'session-1',
          expiresAt: new Date('2026-09-20T00:00:00.000Z'),
          lastUsedAt: undefined,
          deviceSummary: 'Safari on macOS',
          ipSummary: '203.0.113.42',
          isCurrent: true,
          createdAt: new Date('2026-08-20T00:00:00.000Z'),
          revokedAt: undefined,
        },
      ],
    });
    expect(sessions.items[0]).not.toHaveProperty('tokenHash');
  });

  it('separates active sessions from paged history and prunes old auth artifacts', async () => {
    const fixture = createFixture();
    fixture.repository.sessions.push(
      {
        id: 'current-session',
        userId: 'user-1',
        tokenHash: 'active-token',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        createdAt: new Date('2026-08-19T00:00:00.000Z'),
      },
      {
        id: 'recent-revoked',
        userId: 'user-1',
        tokenHash: 'history-token',
        expiresAt: new Date('2026-09-20T00:00:00.000Z'),
        revokedAt: new Date('2026-08-18T00:00:00.000Z'),
        createdAt: new Date('2026-08-18T00:00:00.000Z'),
      },
      {
        id: 'old-expired',
        userId: 'user-1',
        tokenHash: 'old-token',
        expiresAt: new Date('2026-05-01T00:00:00.000Z'),
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    );
    fixture.repository.challenges.push({
      id: 'old-challenge',
      phone: '+8613800138000',
      purpose: 'REGISTER',
      codeHash: 'hash',
      status: 'CONSUMED',
      attemptCount: 0,
      expiresAt: new Date('2026-07-01T00:10:00.000Z'),
      consumedAt: new Date('2026-07-01T00:01:00.000Z'),
      requestIp: '127.0.0.1',
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const result = await (fixture.service.listSessions as Function)(
      'user-1',
      'current-session',
      { kind: 'HISTORY', page: 1, limit: 10 },
    );

    expect(result).toMatchObject({ page: 1, limit: 10, total: 1 });
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'recent-revoked', isCurrent: false }),
    ]);
    expect(fixture.repository.sessions.map((item) => item.id)).not.toContain(
      'old-expired',
    );
    expect(fixture.repository.challenges).toHaveLength(0);
  });
});
