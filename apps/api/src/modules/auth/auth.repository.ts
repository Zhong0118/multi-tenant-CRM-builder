import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseService } from '../../infrastructure/database/database.service';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export type ChallengePurpose = 'REGISTER' | 'RESET_PASSWORD';
export type ChallengeStatus = 'PENDING' | 'CONSUMED' | 'EXPIRED' | 'LOCKED';
export type AccountStatus = 'ACTIVE' | 'DISABLED' | 'LOCKED';
export type SessionKind = 'ACTIVE' | 'HISTORY';

export interface AuthChallenge {
  id: string;
  phone: string;
  purpose: ChallengePurpose;
  codeHash: string;
  status: ChallengeStatus;
  attemptCount: number;
  expiresAt: Date;
  consumedAt?: Date;
  requestIp: string;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  displayName: string;
  phone: string;
  phoneVerifiedAt: Date;
  passwordHash: string;
  isPlatformAdmin: boolean;
  status: AccountStatus;
  lastLoginAt?: Date;
}

export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt?: Date;
  ip?: string;
  deviceSummary?: string;
  revokedAt?: Date;
  createdAt: Date;
}

export interface SessionWithUser {
  session: AuthSession;
  user: AuthUser;
}

export interface AuthStore {
  createChallenge(input: Omit<AuthChallenge, 'id'>): Promise<AuthChallenge>;
  findLatestChallenge(
    phone: string,
    purpose: ChallengePurpose,
  ): Promise<AuthChallenge | null>;
  updateChallengeFailure(
    id: string,
    attemptCount: number,
    status: ChallengeStatus,
  ): Promise<void>;
  consumeChallenge(id: string, consumedAt: Date): Promise<boolean>;
  findUserByPhone(phone: string): Promise<AuthUser | null>;
  findUserById(id: string): Promise<AuthUser | null>;
  createUser(input: Omit<AuthUser, 'id'>): Promise<AuthUser>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  createSession(input: Omit<AuthSession, 'id'>): Promise<AuthSession>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null>;
  touchSession(sessionId: string, usedAt: Date): Promise<void>;
  listSessionPage(
    userId: string,
    input: { kind: SessionKind; page: number; limit: number; now: Date },
  ): Promise<{ items: AuthSession[]; total: number }>;
  pruneAuthArtifacts(input: {
    sessionCutoff: Date;
    challengeCutoff: Date;
  }): Promise<void>;
  updateLastLoginAt(userId: string, at: Date): Promise<void>;
  revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
  ): Promise<boolean>;
  revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    revokedAt: Date,
  ): Promise<void>;
  revokeAllSessions(userId: string, revokedAt: Date): Promise<void>;
}

export interface AuthRepository extends AuthStore {
  transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T>;
}

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  transaction<T>(work: (store: AuthStore) => Promise<T>): Promise<T> {
    return this.database.transaction((client) =>
      work(new PrismaAuthStore(client)),
    );
  }

  createChallenge(input: Omit<AuthChallenge, 'id'>): Promise<AuthChallenge> {
    return this.store.createChallenge(input);
  }

  findLatestChallenge(
    phone: string,
    purpose: ChallengePurpose,
  ): Promise<AuthChallenge | null> {
    return this.store.findLatestChallenge(phone, purpose);
  }

  updateChallengeFailure(
    id: string,
    attemptCount: number,
    status: ChallengeStatus,
  ): Promise<void> {
    return this.store.updateChallengeFailure(id, attemptCount, status);
  }

  consumeChallenge(id: string, consumedAt: Date): Promise<boolean> {
    return this.store.consumeChallenge(id, consumedAt);
  }

  findUserByPhone(phone: string): Promise<AuthUser | null> {
    return this.store.findUserByPhone(phone);
  }

  findUserById(id: string): Promise<AuthUser | null> {
    return this.store.findUserById(id);
  }

  createUser(input: Omit<AuthUser, 'id'>): Promise<AuthUser> {
    return this.store.createUser(input);
  }

  updatePassword(userId: string, passwordHash: string): Promise<void> {
    return this.store.updatePassword(userId, passwordHash);
  }

  createSession(input: Omit<AuthSession, 'id'>): Promise<AuthSession> {
    return this.store.createSession(input);
  }

  findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    return this.store.findSessionByTokenHash(tokenHash);
  }

  touchSession(sessionId: string, usedAt: Date): Promise<void> {
    return this.store.touchSession(sessionId, usedAt);
  }

  listSessionPage(
    userId: string,
    input: { kind: SessionKind; page: number; limit: number; now: Date },
  ): Promise<{ items: AuthSession[]; total: number }> {
    return this.store.listSessionPage(userId, input);
  }

  pruneAuthArtifacts(input: {
    sessionCutoff: Date;
    challengeCutoff: Date;
  }): Promise<void> {
    return this.store.pruneAuthArtifacts(input);
  }

  updateLastLoginAt(userId: string, at: Date): Promise<void> {
    return this.store.updateLastLoginAt(userId, at);
  }

  revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    return this.store.revokeSession(userId, sessionId, revokedAt);
  }

  revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    return this.store.revokeOtherSessions(userId, currentSessionId, revokedAt);
  }

  revokeAllSessions(userId: string, revokedAt: Date): Promise<void> {
    return this.store.revokeAllSessions(userId, revokedAt);
  }

  private get store(): AuthStore {
    return new PrismaAuthStore(this.database.client);
  }
}

class PrismaAuthStore implements AuthStore {
  constructor(private readonly client: Prisma.TransactionClient) {}

  async createChallenge(
    input: Omit<AuthChallenge, 'id'>,
  ): Promise<AuthChallenge> {
    const challenge = await this.client.verificationChallenge.create({
      data: input,
    });
    return mapChallenge(challenge);
  }

  async findLatestChallenge(
    phone: string,
    purpose: ChallengePurpose,
  ): Promise<AuthChallenge | null> {
    const challenge = await this.client.verificationChallenge.findFirst({
      where: { phone, purpose },
      orderBy: { createdAt: 'desc' },
    });
    return challenge ? mapChallenge(challenge) : null;
  }

  async updateChallengeFailure(
    id: string,
    attemptCount: number,
    status: ChallengeStatus,
  ): Promise<void> {
    await this.client.verificationChallenge.update({
      where: { id },
      data: { attemptCount, status },
    });
  }

  async consumeChallenge(id: string, consumedAt: Date): Promise<boolean> {
    const result = await this.client.verificationChallenge.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CONSUMED', consumedAt },
    });
    return result.count === 1;
  }

  async findUserByPhone(phone: string): Promise<AuthUser | null> {
    const user = await this.client.user.findUnique({ where: { phone } });
    return user ? mapUser(user) : null;
  }

  async findUserById(id: string): Promise<AuthUser | null> {
    const user = await this.client.user.findUnique({ where: { id } });
    return user ? mapUser(user) : null;
  }

  async createUser(input: Omit<AuthUser, 'id'>): Promise<AuthUser> {
    const user = await this.client.user.create({ data: input });
    return mapUser(user);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async createSession(input: Omit<AuthSession, 'id'>): Promise<AuthSession> {
    const session = await this.client.session.create({ data: input });
    return mapSession(session);
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionWithUser | null> {
    const found = await this.client.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    return found
      ? { session: mapSession(found), user: mapUser(found.user) }
      : null;
  }

  async touchSession(sessionId: string, usedAt: Date): Promise<void> {
    await this.client.session.update({
      where: { id: sessionId },
      data: { lastUsedAt: usedAt },
    });
  }

  async listSessionPage(
    userId: string,
    input: { kind: SessionKind; page: number; limit: number; now: Date },
  ): Promise<{ items: AuthSession[]; total: number }> {
    const active = { revokedAt: null, expiresAt: { gt: input.now } } as const;
    const where: Prisma.SessionWhereInput = {
      userId,
      ...(input.kind === 'ACTIVE'
        ? active
        : {
            OR: [
              { revokedAt: { not: null } },
              { expiresAt: { lte: input.now } },
            ],
          }),
    };
    const [sessions, total] = await Promise.all([
      this.client.session.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.client.session.count({ where }),
    ]);
    return { items: sessions.map(mapSession), total };
  }

  async pruneAuthArtifacts(input: {
    sessionCutoff: Date;
    challengeCutoff: Date;
  }): Promise<void> {
    await Promise.all([
      this.client.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: input.sessionCutoff } },
            { revokedAt: { lt: input.sessionCutoff } },
          ],
        },
      }),
      this.client.verificationChallenge.deleteMany({
        where: { createdAt: { lt: input.challengeCutoff } },
      }),
    ]);
  }

  async updateLastLoginAt(userId: string, at: Date): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { lastLoginAt: at },
    });
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const result = await this.client.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt },
    });
    return result.count === 1;
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.client.session.updateMany({
      where: { userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt },
    });
  }

  async revokeAllSessions(userId: string, revokedAt: Date): Promise<void> {
    await this.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }
}

function mapChallenge(input: {
  id: string;
  phone: string;
  purpose: ChallengePurpose | 'CHANGE_PHONE';
  codeHash: string;
  status: ChallengeStatus;
  attemptCount: number;
  expiresAt: Date;
  consumedAt: Date | null;
  requestIp: string;
  createdAt: Date;
}): AuthChallenge {
  if (input.purpose === 'CHANGE_PHONE') {
    throw new Error('Unsupported verification purpose');
  }
  return {
    ...input,
    purpose: input.purpose,
    consumedAt: input.consumedAt ?? undefined,
  };
}

function mapUser(
  input: Omit<AuthUser, 'lastLoginAt'> & { lastLoginAt: Date | null },
): AuthUser {
  return {
    id: input.id,
    displayName: input.displayName,
    phone: input.phone,
    phoneVerifiedAt: input.phoneVerifiedAt,
    passwordHash: input.passwordHash,
    isPlatformAdmin: input.isPlatformAdmin,
    status: input.status,
    lastLoginAt: input.lastLoginAt ?? undefined,
  };
}

function mapSession(input: {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
  ip: string | null;
  deviceSummary: string | null;
  revokedAt: Date | null;
  createdAt: Date;
}): AuthSession {
  return {
    ...input,
    lastUsedAt: input.lastUsedAt ?? undefined,
    ip: input.ip ?? undefined,
    deviceSummary: input.deviceSummary ?? undefined,
    revokedAt: input.revokedAt ?? undefined,
  };
}
