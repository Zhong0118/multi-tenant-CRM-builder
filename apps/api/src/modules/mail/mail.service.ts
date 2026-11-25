import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { hkdfSync, randomUUID } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { appendAccountAudit } from '../users/account-audit';
import { maskEmail, normalizeEmail, validMailbox } from './mail-address';
import { MailTransport, type SmtpOutcome } from './mail-transport';
import {
  renderMail,
  type CodePurpose,
  type MailKind,
  type SecurityKind,
} from './mail-template';

type Tx = Prisma.TransactionClient;
interface Recipient {
  status: string;
  email: string | null;
  email_version: number;
  email_verified_at: Date | null;
  email_undeliverable_at: Date | null;
  new_device_mail_enabled: boolean;
  is_platform_admin: boolean;
}
interface SecurityEvent {
  kind: SecurityKind;
  userId: string;
  emailVersion: number;
  eventId: string;
  oldEmail?: string;
  device?: string;
  network?: string;
  occurredAt?: Date;
}
interface Claim {
  id: string;
  token: string;
  kind: SecurityKind;
  user_id: string;
  email_version: number;
  old_email: string | null;
  device: string | null;
  network: string | null;
  occurred_at: Date;
}
interface DirectInput {
  userId: string;
  email: string;
  emailVersion: number;
  purpose: CodePurpose;
  code: string;
  challengeId: string;
}
interface Attempt {
  id: string;
  token: string;
  userId: string;
  version: number;
  email: string;
  canMarkBounce: boolean;
}

async function recipient(tx: Tx, userId: string) {
  const [user] = await tx.$queryRaw<
    Recipient[]
  >`SELECT status::text,email,email_version,email_verified_at,email_undeliverable_at,
    new_device_mail_enabled,is_platform_admin FROM users WHERE id=${userId}::uuid FOR UPDATE`;
  return user;
}
function currentAddress(user: Recipient | undefined, version: number) {
  return user &&
    user.status === 'ACTIVE' &&
    user.email_version === version &&
    user.email_verified_at &&
    !user.email_undeliverable_at &&
    user.email &&
    validMailbox(user.email)
    ? user.email
    : null;
}
function oldAddressEvent(kind: MailKind) {
  return kind === 'email_changed' || kind === 'email_removed';
}

@Injectable()
export class MailService {
  constructor(
    private readonly database: DatabaseService,
    private readonly transport: MailTransport,
  ) {}
  get available() {
    return this.transport.config.status.ready;
  }
  requireAvailable() {
    if (!this.available)
      throw new ApiException('MAIL_SERVICE_UNAVAILABLE', 503);
  }
  challengeKey() {
    this.requireAvailable();
    return Buffer.from(
      hkdfSync(
        'sha256',
        this.transport.config.secret,
        'crm-account-mail',
        'challenge-address-v1',
        32,
      ),
    );
  }

  async enqueue(tx: Tx, event: SecurityEvent): Promise<void> {
    if (!this.available) return;
    const user = await recipient(tx, event.userId);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      (event.kind === 'new_device' && !user.new_device_mail_enabled)
    )
      return;
    const old = oldAddressEvent(event.kind) ? event.oldEmail : undefined;
    const email = oldAddressEvent(event.kind)
      ? old
      : currentAddress(user, event.emailVersion);
    if (!email || !validMailbox(email)) return;
    const dedupe = event.kind + ':' + event.eventId;
    const when = event.occurredAt ?? new Date();
    await tx.$queryRaw`SELECT public.mail_enqueue(${dedupe},${event.kind},${event.userId}::uuid,${event.emailVersion}::int,
      ${maskEmail(email)},${old ?? null},${event.device ?? null},${event.network ?? null},${when}::timestamptz)`;
  }

  private async begin(tx: Tx, kind: MailKind, a: Attempt) {
    const [row] = await tx.$queryRaw<
      { ok: boolean }[]
    >`SELECT public.mail_begin_direct(${a.id}::uuid,${kind},${a.userId}::uuid,
      ${a.version}::int,${maskEmail(a.email)},${a.token}::uuid) AS ok`;
    return row.ok;
  }
  async sendCode(input: DirectInput) {
    this.requireAvailable();
    const kind: MailKind = `code_${input.purpose}`;
    const email = normalizeEmail(input.email);
    if (!validMailbox(email)) return false;
    const attempt: Attempt = {
      id: input.challengeId,
      token: randomUUID(),
      userId: input.userId,
      version: input.emailVersion,
      email,
      canMarkBounce: input.purpose === 'reset' || input.purpose === 'reverify',
    };
    const message = renderMail(
      kind,
      { code: input.code },
      this.transport.config.origin,
    );
    const accepted = await this.database.transaction(async (tx) => {
      const user = await recipient(tx, input.userId);
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.email_version !== input.emailVersion
      )
        return false;
      if (
        input.purpose === 'reset' &&
        currentAddress(user, attempt.version) !== email
      )
        return false;
      return this.begin(tx, kind, attempt);
    });
    if (!accepted) return false;
    const result = await this.transport.deliver(email, attempt.id, message);
    const status = await this.finish(attempt, result);
    return status === 'sent';
  }

  async test(userId: string, requestId: string) {
    this.requireAvailable();
    const attempt = await this.database.transaction(async (tx) => {
      const user = await recipient(tx, userId);
      if (!user?.is_platform_admin || user.status !== 'ACTIVE')
        throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      const email = currentAddress(user, user.email_version);
      if (!email)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '请先验证本人可投递的邮箱。',
        });
      const [recent] = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT public.mail_test_recent(${userId}::uuid) AS ok`;
      if (recent.ok)
        throw new ApiException('RATE_LIMITED', 429, { retryAfterSeconds: 60 });
      const a: Attempt = {
        id: randomUUID(),
        token: randomUUID(),
        userId,
        email,
        version: user.email_version,
        canMarkBounce: true,
      };
      await this.begin(tx, 'test', a);
      await appendAccountAudit(
        tx,
        userId,
        'account.mail_test',
        { requestId },
        { maskedEmail: maskEmail(email) },
      );
      return a;
    });
    const result = await this.transport.deliver(
      attempt.email,
      attempt.id,
      renderMail(
        'test',
        { occurredAt: new Date() },
        this.transport.config.origin,
      ),
    );
    const status = await this.finish(attempt, result);
    return {
      status: status ?? 'unknown',
      errorCode: result.action === 'sent' ? null : result.code,
    };
  }
  async statistics() {
    const items = await this.database.client.$queryRaw<
      { kind: string; status: string; count: number }[]
    >`SELECT * FROM public.mail_statistics()`;
    return { days: 7, items };
  }

  private finish(a: Attempt, outcome: SmtpOutcome) {
    return this.database.transaction(async (tx) => {
      const code = outcome.action === 'sent' ? null : outcome.code;
      const provider = outcome.action === 'sent' ? outcome.providerId : null;
      const [row] = await tx.$queryRaw<
        { status: string | null }[]
      >`SELECT public.mail_finish(${a.id}::uuid,${a.token}::uuid,
        ${outcome.action},${code},${provider}) AS status`;
      if (row.status === 'failed' && a.canMarkBounce && code === 'recipient') {
        await tx.$executeRaw`UPDATE users SET email_undeliverable_at=now() WHERE id=${a.userId}::uuid
          AND email_version=${a.version}::int AND email=${a.email} AND email_verified_at IS NOT NULL AND email_undeliverable_at IS NULL`;
      }
      return row.status;
    });
  }

  async sweep() {
    await this.database.client.$queryRaw`SELECT public.mail_maintain(), public.auth_prune_email_identity()`;
    if (!this.available) return;
    const batch = await this.database.client.$queryRaw<
      Claim[]
    >`SELECT * FROM public.mail_claim(8)`;
    // Each claim has its own lease. Render and commit the sending fence before opening SMTP.
    await Promise.all(batch.map((c) => this.sendClaim(c)));
  }
  private async sendClaim(c: Claim) {
    const prepared = await this.database.transaction(async (tx) => {
      const user = await recipient(tx, c.user_id);
      const email = oldAddressEvent(c.kind)
        ? c.old_email
        : currentAddress(user, c.email_version);
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        !email ||
        !validMailbox(email) ||
        (c.kind === 'new_device' && !user.new_device_mail_enabled)
      ) {
        await tx.$queryRaw`SELECT public.mail_finish(${c.id}::uuid,${c.token}::uuid,'skipped','ineligible',NULL)`;
        return null;
      }
      const content = renderMail(
        c.kind,
        {
          occurredAt: c.occurred_at,
          device: c.device ?? undefined,
          network: c.network ?? undefined,
        },
        this.transport.config.origin,
      );
      const [armed] = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT public.mail_start(${c.id}::uuid,${c.token}::uuid) AS ok`;
      return armed.ok ? { email, content } : null;
    });
    if (!prepared) return;
    const outcome = await this.transport.deliver(
      prepared.email,
      c.id,
      prepared.content,
    );
    await this.finish(
      {
        id: c.id,
        token: c.token,
        userId: c.user_id,
        version: c.email_version,
        email: prepared.email,
        canMarkBounce: !oldAddressEvent(c.kind),
      },
      outcome,
    );
  }
}
