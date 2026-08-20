import { Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import {
  RATE_LIMITER,
  type RateLimiter,
} from '../../infrastructure/rate-limit/rate-limiter';
import {
  VERIFICATION_SENDER,
  type VerificationSender,
} from '../../infrastructure/verification/verification-sender';
import {
  AUTH_REPOSITORY,
  type AuthChallenge,
  type AuthRepository,
  type AuthStore,
  type AuthUser,
  type ChallengePurpose,
} from './auth.repository';
import { normalizeChineseMobile } from './phone-number';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';

export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export const VERIFICATION_CODE_GENERATOR = Symbol(
  'VERIFICATION_CODE_GENERATOR',
);

export type AuthClock = () => Date;
export type VerificationCodeGenerator = () => string;

interface VerificationInput {
  phone: string;
  purpose: ChallengePurpose;
  requestIp: string;
  deviceKey: string;
}

interface RegisterInput {
  phone: string;
  code: string;
  displayName: string;
  password: string;
  ip?: string;
  deviceSummary?: string;
}

interface LoginInput {
  phone: string;
  password: string;
  ip?: string;
  deviceSummary?: string;
  deviceKey: string;
}

interface ResetPasswordInput {
  phone: string;
  code: string;
  newPassword: string;
}

interface ChangePasswordInput {
  userId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}

export interface PublicSession {
  id: string;
  expiresAt: Date;
  lastUsedAt?: Date;
  deviceSummary?: string;
  ipSummary?: string;
  isCurrent: boolean;
  createdAt: Date;
  revokedAt?: Date;
}

export interface AuthenticatedSessionResult {
  accepted: true;
  sessionId: string;
  sessionToken: string;
  expiresAt: Date;
  user: {
    id: string;
    displayName: string;
    phone: string;
    isPlatformAdmin: boolean;
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function codesMatch(actualHash: string, candidate: string): boolean {
  const expected = Buffer.from(actualHash, 'hex');
  const received = Buffer.from(sha256(candidate), 'hex');
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
    @Inject(VERIFICATION_SENDER)
    private readonly sender: VerificationSender,
    @Inject(RATE_LIMITER)
    private readonly rateLimiter: RateLimiter,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
    @Inject(VERIFICATION_CODE_GENERATOR)
    private readonly codeGenerator: VerificationCodeGenerator,
  ) {}

  async requestVerification(
    input: VerificationInput,
  ): Promise<{ accepted: true }> {
    const phone = normalizeChineseMobile(input.phone);
    const phoneKey = sha256(phone);
    await Promise.all([
      this.rateLimiter.consume({
        key: `verification:phone:${phoneKey}`,
        limit: 5,
        windowSeconds: 60 * 60,
      }),
      this.rateLimiter.consume({
        key: `verification:ip:${input.requestIp}`,
        limit: 20,
        windowSeconds: 60 * 60,
      }),
      this.rateLimiter.consume({
        key: `verification:device:${sha256(input.deviceKey)}`,
        limit: 10,
        windowSeconds: 60 * 60,
      }),
    ]);

    const now = this.clock();
    const code = this.codeGenerator();
    await this.repository.createChallenge({
      phone,
      purpose: input.purpose,
      codeHash: sha256(code),
      status: 'PENDING',
      attemptCount: 0,
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      requestIp: input.requestIp,
      createdAt: now,
    });
    await this.sender.send({ phone, code, purpose: input.purpose });

    return { accepted: true };
  }

  register(input: RegisterInput): Promise<AuthenticatedSessionResult> {
    const phone = normalizeChineseMobile(input.phone);

    return this.repository.transaction(async (store) => {
      await this.consumeValidChallenge(store, phone, 'REGISTER', input.code);
      let user = await store.findUserByPhone(phone);

      if (!user) {
        user = await store.createUser({
          displayName: input.displayName,
          phone,
          phoneVerifiedAt: this.clock(),
          passwordHash: await this.passwordHasher.hash(input.password),
          isPlatformAdmin: false,
          status: 'ACTIVE',
        });
      }

      return this.issueSession(store, user, input);
    });
  }

  async login(input: LoginInput): Promise<AuthenticatedSessionResult> {
    let phone: string;
    try {
      phone = normalizeChineseMobile(input.phone);
    } catch {
      throw new ApiException('INVALID_CREDENTIALS', 401);
    }

    await this.rateLimiter.consume({
      key: `login:${sha256(`${phone}:${input.deviceKey}`)}`,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    const user = await this.repository.findUserByPhone(phone);

    if (!user) {
      await this.passwordHasher.hash(input.password);
      throw new ApiException('INVALID_CREDENTIALS', 401);
    }

    const valid = await this.passwordHasher.verify(
      user.passwordHash,
      input.password,
    );
    if (!valid || user.status !== 'ACTIVE') {
      throw new ApiException('INVALID_CREDENTIALS', 401);
    }

    return this.repository.transaction((store) =>
      this.issueSession(store, user, input),
    );
  }

  resetPassword(input: ResetPasswordInput): Promise<{ accepted: true }> {
    const phone = normalizeChineseMobile(input.phone);

    return this.repository.transaction(async (store) => {
      await this.consumeValidChallenge(
        store,
        phone,
        'RESET_PASSWORD',
        input.code,
      );
      const user = await store.findUserByPhone(phone);
      if (user) {
        await store.updatePassword(
          user.id,
          await this.passwordHasher.hash(input.newPassword),
        );
        await store.revokeAllSessions(user.id, this.clock());
      }

      return { accepted: true };
    });
  }

  changePassword(input: ChangePasswordInput): Promise<{ accepted: true }> {
    return this.repository.transaction(async (store) => {
      const user = await store.findUserById(input.userId);
      if (
        !user ||
        !(await this.passwordHasher.verify(
          user.passwordHash,
          input.currentPassword,
        ))
      ) {
        throw new ApiException('INVALID_CREDENTIALS', 401);
      }

      await store.updatePassword(
        user.id,
        await this.passwordHasher.hash(input.newPassword),
      );
      await store.revokeOtherSessions(
        user.id,
        input.currentSessionId,
        this.clock(),
      );
      return { accepted: true };
    });
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<PublicSession[]> {
    const sessions = await this.repository.listSessionsByUser(userId);
    return sessions.map((session) => ({
      id: session.id,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
      deviceSummary: session.deviceSummary,
      ipSummary: session.ip,
      isCurrent: session.id === currentSessionId,
      createdAt: session.createdAt,
      revokedAt: session.revokedAt,
    }));
  }

  async revokeSession(
    userId: string,
    sessionId: string,
  ): Promise<{ accepted: true }> {
    await this.repository.revokeSession(userId, sessionId, this.clock());
    return { accepted: true };
  }

  logout(userId: string, sessionId: string): Promise<{ accepted: true }> {
    return this.revokeSession(userId, sessionId);
  }

  async getUser(userId: string): Promise<AuthUser> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    return user;
  }

  private async consumeValidChallenge(
    store: AuthStore,
    phone: string,
    purpose: ChallengePurpose,
    candidateCode: string,
  ): Promise<void> {
    const challenge = await store.findLatestChallenge(phone, purpose);
    this.assertChallengeUsable(challenge);
    const now = this.clock();

    if (challenge.expiresAt.getTime() <= now.getTime()) {
      await store.updateChallengeFailure(
        challenge.id,
        challenge.attemptCount,
        'EXPIRED',
      );
      throw new ApiException('VERIFICATION_EXPIRED', 409);
    }

    if (!codesMatch(challenge.codeHash, candidateCode)) {
      const attemptCount = challenge.attemptCount + 1;
      await store.updateChallengeFailure(
        challenge.id,
        attemptCount,
        attemptCount >= 5 ? 'LOCKED' : 'PENDING',
      );
      throw new ApiException('VERIFICATION_INVALID', 400);
    }

    if (!(await store.consumeChallenge(challenge.id, now))) {
      throw new ApiException('VERIFICATION_INVALID', 400);
    }
  }

  private assertChallengeUsable(
    challenge: AuthChallenge | null,
  ): asserts challenge is AuthChallenge {
    if (!challenge || challenge.status !== 'PENDING') {
      throw new ApiException('VERIFICATION_INVALID', 400);
    }
  }

  private async issueSession(
    store: AuthStore,
    user: AuthUser,
    meta: { ip?: string; deviceSummary?: string },
  ): Promise<AuthenticatedSessionResult> {
    const issued = await this.sessions.issue(store, {
      userId: user.id,
      now: this.clock(),
      ip: meta.ip,
      deviceSummary: meta.deviceSummary,
    });

    return {
      accepted: true,
      sessionId: issued.session.id,
      sessionToken: issued.token,
      expiresAt: issued.session.expiresAt,
      user: {
        id: user.id,
        displayName: user.displayName,
        phone: user.phone,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    };
  }
}
