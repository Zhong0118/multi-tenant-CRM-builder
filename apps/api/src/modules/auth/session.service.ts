import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type AuthSession,
  type AuthStore,
} from './auth.repository';

export const SESSION_TOKEN_GENERATOR = Symbol('SESSION_TOKEN_GENERATOR');

export type SessionTokenGenerator = () => string;

export interface SessionPrincipal {
  sessionId: string;
  user: AuthenticatedUser;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(SESSION_TOKEN_GENERATOR)
    private readonly tokenGenerator: SessionTokenGenerator,
    @Inject(AUTH_REPOSITORY)
    private readonly repository: AuthRepository,
  ) {}

  async issue(
    store: AuthStore,
    input: {
      userId: string;
      now: Date;
      ip?: string;
      deviceSummary?: string;
    },
  ): Promise<{ session: AuthSession; token: string }> {
    const token = this.tokenGenerator();
    const session = await store.createSession({
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(input.now.getTime() + 30 * 24 * 60 * 60 * 1000),
      ip: input.ip,
      deviceSummary: input.deviceSummary,
      createdAt: input.now,
    });

    return { session, token };
  }

  async authenticate(
    token: string,
    now = new Date(),
  ): Promise<SessionPrincipal> {
    const found = await this.repository.findSessionByTokenHash(
      hashSessionToken(token),
    );

    if (
      !found ||
      found.session.revokedAt ||
      found.session.expiresAt.getTime() <= now.getTime() ||
      found.user.status !== 'ACTIVE'
    ) {
      throw new ApiException('AUTH_REQUIRED', 401);
    }

    if (
      !found.session.lastUsedAt ||
      now.getTime() - found.session.lastUsedAt.getTime() >= 5 * 60 * 1000
    ) {
      await this.repository.touchSession(found.session.id, now);
    }

    return {
      sessionId: found.session.id,
      user: {
        id: found.user.id,
        phone: found.user.phone,
        isPlatformAdmin: found.user.isPlatformAdmin,
      },
    };
  }
}
