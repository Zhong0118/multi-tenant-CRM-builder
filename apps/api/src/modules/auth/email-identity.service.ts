import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { maskEmail, normalizeEmail, validMailbox } from '../mail/mail-address';
import { MailService } from '../mail/mail.service';
import { AUTH_CLOCK, type AuthClock } from './auth.service';
import { lockAccount } from './login-device';
import { EmailRateLimits } from './email-rate-limits';
import { PASSWORD_HASHER, type PasswordHasher } from './password-hasher';

export type EmailPurpose = 'BIND' | 'CHANGE' | 'REVERIFY';
type Purpose = EmailPurpose | 'RESET';
interface RequestCode {
  purpose: EmailPurpose;
  email?: string;
  currentPassword?: string;
}
interface ConfirmCode {
  challengeId: string;
  code: string;
}
type Tx = Prisma.TransactionClient;
const accepted = { accepted: true } as const;
const duration = 600_000;
const unavailableEmail = () =>
  new ApiException('VALIDATION_FAILED', 400, {
    message: '此邮箱不可使用。',
    fieldErrors: { email: ['此邮箱不可使用。'] },
  });
const invalidCode = () =>
  new ApiException('VERIFICATION_INVALID', 400, {
    message: '验证码无效或已过期。',
    fieldErrors: { code: ['验证码无效或已过期。'] },
  });
const selectIdentity = {
  id: true,
  status: true,
  email: true,
  passwordHash: true,
  emailVersion: true,
  emailVerifiedAt: true,
  emailUndeliverableAt: true,
} as const;
type Identity = Prisma.UserGetPayload<{ select: typeof selectIdentity }>;
function deliverable(user: Identity) {
  return Boolean(
    user.email && user.emailVerifiedAt && !user.emailUndeliverableAt,
  );
}
function mailbox(value?: string) {
  const email = normalizeEmail(value ?? '');
  if (!validMailbox(email)) throw unavailableEmail();
  return email;
}

@Injectable()
export class EmailIdentityService {
  constructor(
    private readonly database: DatabaseService,
    readonly mail: MailService,
    @Inject(PASSWORD_HASHER) private readonly passwords: PasswordHasher,
    private readonly limits: EmailRateLimits,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  private digest(...parts: string[]) {
    return createHmac('sha256', this.mail.challengeKey())
      .update(parts.join('\0'))
      .digest('hex');
  }
  private async lock(tx: Tx, id: string) {
    await lockAccount(tx, id);
    const user = await tx.user.findUnique({
      where: { id },
      select: selectIdentity,
    });
    if (user?.status !== 'ACTIVE') throw new ApiException('AUTH_REQUIRED', 401);
    return user;
  }
  private async checkPassword(user: Identity, password?: string) {
    if (
      !password ||
      !(await this.passwords.verify(user.passwordHash, password))
    ) {
      throw new ApiException('INVALID_CREDENTIALS', 400, {
        message: '当前密码不正确。',
        fieldErrors: { currentPassword: ['当前密码不正确。'] },
      });
    }
  }
  private async checkPurpose(
    tx: Tx,
    user: Identity,
    purpose: Purpose,
    email: string,
    password?: string,
  ) {
    if (purpose === 'RESET') {
      if (!deliverable(user) || user.email !== email) throw invalidCode();
      return;
    }
    if (purpose === 'CHANGE') await this.checkPassword(user, password);
    if (
      (purpose === 'BIND' && user.email) ||
      (purpose === 'CHANGE' && (!user.email || email === user.email)) ||
      (purpose === 'REVERIFY' && email !== user.email)
    )
      throw unavailableEmail();
    if (
      purpose !== 'REVERIFY' &&
      (await tx.user.findFirst({
        where: { email, id: { not: user.id } },
        select: { id: true },
      }))
    )
      throw unavailableEmail();
  }
  private async target(userId: string, input: RequestCode) {
    if (input.purpose === 'REVERIFY' && input.email == null) {
      const row = await this.database.client.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      return mailbox(row?.email ?? undefined);
    }
    return mailbox(input.email);
  }
  async issue(userId: string, input: RequestCode, ip: string) {
    this.mail.requireAvailable();
    const email = await this.target(userId, input);
    await this.limits.issue(
      this.digest('address', email),
      this.digest('ip', ip),
      userId,
    );
    const challengeId = randomUUID();
    await this.sendChallenge(
      userId,
      email,
      input.purpose,
      challengeId,
      input.currentPassword,
    );
    return { challengeId, maskedEmail: maskEmail(email) };
  }
  async forgot(value: string, ip: string) {
    this.mail.requireAvailable();
    const email = mailbox(value),
      challengeId = randomUUID();
    await this.limits.issue(
      this.digest('address', email),
      this.digest('ip', ip),
    );
    // SMTP latency and account-specific outcomes are invisible to anonymous clients.
    setImmediate(() => {
      void this.issueRecovery(email, challengeId).catch(() => undefined);
    });
    return { challengeId, message: '如果这个邮箱已绑定账号，你会收到验证码' };
  }
  private async issueRecovery(email: string, id: string) {
    const user = await this.database.client.user.findUnique({
      where: { email },
      select: selectIdentity,
    });
    if (!user || user.status !== 'ACTIVE' || !deliverable(user)) return;
    await this.limits.account(user.id);
    await this.sendChallenge(user.id, email, 'RESET', id);
  }
  private async sendChallenge(
    userId: string,
    email: string,
    purpose: Purpose,
    id: string,
    password?: string,
  ) {
    const emailDigest = this.digest('address', email);
    const code = randomInt(1_000_000).toString().padStart(6, '0');
    const codeHash = this.digest(
      'code',
      id,
      userId,
      purpose,
      emailDigest,
      code,
    );
    const emailVersion = await this.database.transaction(async (tx) => {
      const user = await this.lock(tx, userId);
      await this.checkPurpose(tx, user, purpose, email, password);
      await tx.emailChallenge.updateMany({
        where: {
          userId,
          purpose,
          emailDigest,
          status: { in: ['SENDING', 'ACTIVE'] },
        },
        data: { status: 'DISCARDED' },
      });
      const now = this.clock();
      await tx.emailChallenge.create({
        data: {
          id,
          userId,
          purpose,
          emailDigest,
          codeHash,
          emailVersion: user.emailVersion,
          status: 'SENDING',
          createdAt: now,
          expiresAt: new Date(now.getTime() + duration),
        },
      });
      return user.emailVersion;
    });
    const ok = await this.mail
      .sendCode({
        userId,
        email,
        emailVersion,
        purpose: (
          {
            BIND: 'bind',
            REVERIFY: 'reverify',
            CHANGE: 'change',
            RESET: 'reset',
          } as const
        )[purpose],
        code,
        challengeId: id,
      })
      .catch(() => false);
    const activated = await this.database.transaction(async (tx) => {
      await lockAccount(tx, userId);
      const result = await tx.emailChallenge.updateMany({
        where: {
          id,
          status: 'SENDING',
          expiresAt: { gt: this.clock() },
          user: { emailVersion, status: 'ACTIVE' },
        },
        data: { status: ok ? 'ACTIVE' : 'DISCARDED' },
      });
      if (!result.count)
        await tx.emailChallenge.updateMany({
          where: { id, status: 'SENDING' },
          data: { status: 'DISCARDED' },
        });
      return result;
    });
    if (!ok || activated.count !== 1)
      throw new ApiException('VERIFICATION_INVALID', 400, {
        message: '验证码未能发送，请稍后重试。',
      });
  }
  async cancel(userId: string, id: string) {
    this.mail.requireAvailable();
    await this.database.transaction(async (tx) => {
      await lockAccount(tx, userId);
      await tx.emailChallenge.updateMany({
        where: {
          id,
          userId,
          purpose: { not: 'RESET' },
          status: { in: ['ACTIVE', 'SENDING'] },
        },
        data: { status: 'DISCARDED' },
      });
    });
    return accepted;
  }
  async verify(userId: string, input: RequestCode & ConfirmCode, ip: string) {
    this.mail.requireAvailable();
    const email = await this.target(userId, input);
    return this.confirm(
      userId,
      email,
      input.purpose,
      input,
      ip,
      input.currentPassword,
    );
  }
  async reset(
    input: ConfirmCode & { email: string; newPassword: string },
    ip: string,
  ) {
    this.mail.requireAvailable();
    return this.confirm(
      null,
      mailbox(input.email),
      'RESET',
      input,
      ip,
      undefined,
      input.newPassword,
    );
  }
  private async confirm(
    owner: string | null,
    email: string,
    purpose: Purpose,
    input: ConfirmCode,
    ip: string,
    password?: string,
    newPassword?: string,
  ) {
    const emailDigest = this.digest('address', email);
    await this.limits.confirm(emailDigest, this.digest('ip', ip));
    const ok = await this.database
      .transaction(async (tx) => {
        // All operations acquire the user lock before examining mutable challenge state.
        const userId =
          owner ??
          (await tx.user.findUnique({ where: { email }, select: { id: true } }))
            ?.id;
        if (!userId) return false;
        const user = await this.lock(tx, userId).catch((error) => {
          if (purpose === 'RESET' && error instanceof ApiException) return null;
          throw error;
        });
        if (!user) return false;
        const challenge = await tx.emailChallenge.findFirst({
          where: { id: input.challengeId, userId, purpose, emailDigest },
        });
        const now = this.clock();
        if (
          !challenge ||
          challenge.status !== 'ACTIVE' ||
          challenge.expiresAt <= now ||
          challenge.emailVersion !== user.emailVersion
        )
          return false;
        const expected = Buffer.from(challenge.codeHash, 'hex');
        const supplied = Buffer.from(
          this.digest(
            'code',
            challenge.id,
            user.id,
            purpose,
            emailDigest,
            input.code,
          ),
          'hex',
        );
        if (
          expected.length !== supplied.length ||
          !timingSafeEqual(expected, supplied)
        ) {
          const attempts = challenge.attemptCount + 1;
          await tx.emailChallenge.update({
            where: { id: challenge.id },
            data: {
              attemptCount: attempts,
              status: attempts >= 5 ? 'LOCKED' : 'ACTIVE',
            },
          });
          return false; // commit the attempt before raising the public error.
        }
        await this.checkPurpose(tx, user, purpose, email, password);
        const claimed = await tx.emailChallenge.updateMany({
          where: { id: challenge.id, status: 'ACTIVE' },
          data: { status: 'CONSUMED', consumedAt: now },
        });
        if (!claimed.count) return false;
        if (purpose === 'RESET') {
          await tx.user.update({
            where: { id: user.id },
            data: { passwordHash: await this.passwords.hash(newPassword!) },
          });
          await tx.session.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: now },
          });
          await this.mail.enqueue(tx, {
            kind: 'password_reset',
            userId: user.id,
            emailVersion: user.emailVersion,
            eventId: challenge.id,
            occurredAt: now,
          });
        } else {
          await tx.user.update({
            where: { id: user.id },
            data: {
              email,
              emailVerifiedAt: now,
              emailUndeliverableAt: null,
              emailVersion: { increment: 1 },
            },
          });
          if (purpose === 'CHANGE')
            await this.notifyOld(tx, user, 'email_changed', challenge.id, now);
        }
        await this.audit(
          tx,
          user.id,
          {
            RESET: 'auth.email_password_reset',
            BIND: 'auth.email_bound',
            CHANGE: 'auth.email_changed',
            REVERIFY: 'auth.email_reverified',
          }[purpose],
          email,
        );
        return true;
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error &&
          'code' in error &&
          error.code === 'P2002'
        )
          throw unavailableEmail();
        throw error;
      });
    if (!ok) throw invalidCode();
    return accepted;
  }
  async remove(userId: string, password: string) {
    this.mail.requireAvailable();
    return this.database.transaction(async (tx) => {
      const user = await this.lock(tx, userId);
      await this.checkPassword(user, password);
      if (!user.email) throw unavailableEmail();
      const eventId = randomUUID();
      await this.notifyOld(tx, user, 'email_removed', eventId, this.clock());
      await tx.user.update({
        where: { id: userId },
        data: {
          email: null,
          emailVerifiedAt: null,
          emailUndeliverableAt: null,
          emailVersion: { increment: 1 },
        },
      });
      await this.audit(tx, userId, 'auth.email_removed', user.email);
      return accepted;
    });
  }
  private async notifyOld(
    tx: Tx,
    user: Identity,
    kind: 'email_changed' | 'email_removed',
    eventId: string,
    occurredAt: Date,
  ) {
    if (user.email && deliverable(user))
      await this.mail.enqueue(tx, {
        kind,
        userId: user.id,
        emailVersion: user.emailVersion,
        oldEmail: user.email,
        eventId,
        occurredAt,
      });
  }
  private async audit(tx: Tx, userId: string, action: string, email: string) {
    // Insert without RETURNING: account-scope rows are not readable under tenant RLS.
    await tx.auditLog.createMany({
      data: {
        actorType: 'USER',
        actorId: userId,
        action,
        resourceType: 'user',
        resourceId: userId,
        requestId: randomUUID(),
        after: { maskedEmail: maskEmail(email) },
      },
    });
  }
  settings(userId: string) {
    this.mail.requireAvailable();
    return this.database.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: { newDeviceMailEnabled: true },
    });
  }
  updateSettings(userId: string, newDeviceMailEnabled: boolean) {
    this.mail.requireAvailable();
    return this.database.client.user.update({
      where: { id: userId },
      data: { newDeviceMailEnabled },
      select: { newDeviceMailEnabled: true },
    });
  }
}
