import { createHash } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthRepository, AuthSession, AuthUser } from './auth.repository';
import { SessionService } from './session.service';

const now = new Date('2026-08-20T00:00:00.000Z');
const rawToken = 'raw-session-token';
const tokenHash = createHash('sha256').update(rawToken).digest('hex');

function createSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    id: 'session-1',
    userId: 'user-1',
    tokenHash,
    expiresAt: new Date('2026-09-20T00:00:00.000Z'),
    createdAt: new Date('2026-08-19T00:00:00.000Z'),
    ...overrides,
  };
}

function createUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    displayName: '测试用户',
    phone: '+8613800138000',
    phoneVerifiedAt: new Date('2026-08-19T00:00:00.000Z'),
    passwordHash: 'encoded-password',
    isPlatformAdmin: false,
    status: 'ACTIVE',
    ...overrides,
  };
}

function createRepository(
  session: AuthSession,
  user: AuthUser,
): { repository: AuthRepository; touched: Date[] } {
  const touched: Date[] = [];
  const repository = {
    findSessionByTokenHash(hash: string) {
      return Promise.resolve(hash === tokenHash ? { session, user } : null);
    },
    touchSession(_sessionId: string, usedAt: Date) {
      touched.push(usedAt);
      return Promise.resolve();
    },
  } as unknown as AuthRepository;
  return { repository, touched };
}

describe('SessionService authentication', () => {
  it('authenticates a raw token without exposing it to persistence', async () => {
    const fixture = createRepository(createSession(), createUser());
    const service = new SessionService(() => 'unused', fixture.repository);

    await expect(service.authenticate(rawToken, now)).resolves.toEqual({
      sessionId: 'session-1',
      user: {
        id: 'user-1',
        phone: '+8613800138000',
        isPlatformAdmin: false,
      },
    });
    expect(fixture.touched).toEqual([now]);
  });

  it.each([
    ['revoked session', createSession({ revokedAt: now }), createUser()],
    [
      'expired session',
      createSession({ expiresAt: new Date('2026-08-19T23:59:59.000Z') }),
      createUser(),
    ],
    ['disabled user', createSession(), createUser({ status: 'DISABLED' })],
  ])('rejects a %s', async (_name, session, user) => {
    const fixture = createRepository(session, user);
    const service = new SessionService(() => 'unused', fixture.repository);

    await expect(service.authenticate(rawToken, now)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    } satisfies Partial<ApiException>);
  });

  it('does not write last-used time more than once every five minutes', async () => {
    const fixture = createRepository(
      createSession({
        lastUsedAt: new Date('2026-08-19T23:58:00.000Z'),
      }),
      createUser(),
    );
    const service = new SessionService(() => 'unused', fixture.repository);

    await service.authenticate(rawToken, now);

    expect(fixture.touched).toEqual([]);
  });
});
