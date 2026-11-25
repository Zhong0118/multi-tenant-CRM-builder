import { execFileSync } from 'node:child_process';
import { captureMail } from './helpers/mail-capture';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MailService } from '../src/modules/mail/mail.service';
import {
  MailTransport,
  type SmtpOutcome,
} from '../src/modules/mail/mail-transport';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(90_000);
const ownAddress = 'platform-sentinel@example.test';
const secretEnv = {
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '1025',
  MAIL_FROM: 'noreply@notice.baijiehub.com',
  MAIL_SECRET: 'f'.repeat(64),
};
describe('platform mail HTTP and account delivery', () => {
  let h: CriticalHarness, fixture: CriticalFixture, mail: MailService;
  let capture: ReturnType<typeof captureMail>;
  const route = '/api/v1/platform/mail';
  const path = (actor: { cookie: string }, body: object = {}) =>
    request(h.app.getHttpServer())
      .post(route + '/test')
      .set('Origin', 'http://localhost:3000')
      .set('Cookie', actor.cookie)
      .send(body);
  beforeAll(async () => {
    Object.assign(process.env, secretEnv);
    h = await createCriticalHarness();
    capture = captureMail(h.app.get(MailTransport));
    mail = h.app.get(MailService);
    fixture = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
    for (const key of Object.keys(secretEnv)) delete process.env[key];
  });
  it('allows only the platform administrator, rate limits concurrent attempts, audits the masked recipient', async () => {
    const actor = fixture.tenantBAdmin;
    for (const other of [fixture.admin, fixture.employee]) {
      await path(other).expect(403);
      await request(h.app.getHttpServer())
        .get(route + '/statistics')
        .set('Cookie', other.cookie)
        .expect(403);
    }
    await h.adminDatabase.user.update({
      where: { id: actor.userId },
      data: { isPlatformAdmin: true },
    });
    await path(actor).expect(400);
    await h.adminDatabase.user.update({
      where: { id: actor.userId },
      data: { email: ownAddress, emailVerifiedAt: new Date() },
    });
    await path(actor, { recipient: 'third-party@example.test' }).expect(400);
    capture.outcome = { action: 'sent', providerId: 'test-123' };
    const results = await Promise.all([path(actor), path(actor)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 429]);
    expect(results.find((r) => r.status === 200)?.body).toEqual({
      status: 'sent',
      errorCode: null,
    });
    expect(capture.messages).toHaveLength(1);
    const [sent] = capture.messages;
    expect(sent.recipients).toEqual([ownAddress]);
    const decoded = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          `
import email, email.policy, json, sys
msg = email.message_from_bytes(sys.stdin.buffer.read(), policy=email.policy.default)
print(json.dumps({"to":msg["To"].addresses[0].addr_spec,"subject":str(msg["Subject"]),
  "html":msg.get_body(("html",)).get_content(),"text":msg.get_body(("plain",)).get_content()}))
`,
        ],
        { input: sent.raw, encoding: 'utf8' },
      ),
    ) as { to: string; subject: string; text: string; html: string };
    expect(decoded.to).toBe(ownAddress);
    expect(decoded.subject).toBe('百杰 CRM · 测试邮件');
    expect(decoded.text).toContain('此邮件用于测试平台发信配置。');
    expect(decoded.html).toContain(
      '<p style="line-height:1.6">此邮件用于测试平台发信配置。</p>',
    );
    expect(sent.raw.toString()).not.toMatch(/^List-Unsubscribe:/im);
    const audit = await h.adminDatabase.auditLog.findFirstOrThrow({
      where: { action: 'account.mail_test', actorId: actor.userId },
    });
    expect(audit.after).toEqual({ maskedEmail: 'p***@example.test' });
    const stats = await request(h.app.getHttpServer())
      .get(route + '/statistics')
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(stats.body.items).toContainEqual({
      kind: 'test',
      status: 'sent',
      count: 1,
    });
    expect(JSON.stringify(stats.body)).not.toContain(ownAddress);
    const ready = await request(h.app.getHttpServer())
      .get('/api/v1/platform/runtime-status')
      .set('Cookie', actor.cookie)
      .expect(200);
    expect(ready.body.mail).toEqual({ ready: true, issues: [] });
    expect(ready.body.services).toContainEqual(
      expect.objectContaining({ key: 'mail', status: 'READY' }),
    );
  });
  it('rechecks version, isolates old-address bounces, stops on unknown and backs off only definite retries', async () => {
    const userId = fixture.employee.userId;
    const email = 'employee-sentinel@example.test';
    await h.adminDatabase.user.update({
      where: { id: userId },
      data: { email, emailVerifiedAt: new Date() },
    });
    const event = async (
      kind: 'password_reset' | 'email_changed',
      extra = {},
    ) => {
      const eventId = randomUUID();
      await h.runtimeDatabase.$transaction((tx) =>
        mail.enqueue(tx, { kind, userId, emailVersion: 0, eventId, ...extra }),
      );
      return kind + ':' + eventId;
    };
    const read = async (key: string) =>
      (
        await h.adminDatabase.$queryRaw<
          Array<{
            status: string;
            old_email: string | null;
            attempts: number;
            error_code: string | null;
          }>
        >`SELECT status,old_email,attempts,error_code FROM mail_deliveries WHERE dedupe_key=${key}`
      )[0];
    const bounce: SmtpOutcome = { action: 'failed', code: 'recipient' };
    const old = await event('email_changed', {
      oldEmail: 'previous@example.test',
    });
    capture.outcome = bounce;
    await mail.sweep();
    expect(await read(old)).toMatchObject({
      status: 'failed',
      old_email: null,
    });
    expect(
      (await h.adminDatabase.user.findUniqueOrThrow({ where: { id: userId } }))
        .emailUndeliverableAt,
    ).toBeNull();
    const temporary = await event('password_reset');
    capture.outcome = { action: 'retry', code: 'quota' };
    for (let attempt = 1; attempt <= 6; attempt++) {
      await mail.sweep();
      expect(await read(temporary)).toMatchObject({
        status: attempt < 6 ? 'retry_wait' : 'failed',
        attempts: attempt,
      });
      if (attempt < 6) {
        const [{ minutes }] = await h.adminDatabase.$queryRaw<
          Array<{ minutes: number }>
        >`SELECT round(extract(epoch FROM next_attempt_at-now())/60)::int AS minutes FROM mail_deliveries WHERE dedupe_key=${temporary}`;
        expect(minutes).toBe(2 ** (attempt - 1));
        await h.adminDatabase
          .$executeRaw`UPDATE mail_deliveries SET next_attempt_at=now() WHERE dedupe_key=${temporary}`;
      }
    }
    const unknown = await event('password_reset');
    capture.outcome = { action: 'unknown', code: 'uncertain' };
    await mail.sweep();
    await mail.sweep();
    expect(await read(unknown)).toMatchObject({
      status: 'unknown',
      attempts: 1,
    });
    const stale = await event('password_reset');
    await h.adminDatabase.user.update({
      where: { id: userId },
      data: { emailVersion: 1 },
    });
    await mail.sweep();
    expect(await read(stale)).toMatchObject({ status: 'skipped', attempts: 0 });
    capture.outcome = bounce;
    const challengeId = randomUUID(),
      code = '093814';
    const sent = await mail.sendCode({
      userId,
      email,
      emailVersion: 1,
      purpose: 'reset',
      code,
      challengeId,
    });
    expect(sent).toBe(false);
    expect(
      (await h.adminDatabase.user.findUniqueOrThrow({ where: { id: userId } }))
        .emailUndeliverableAt,
    ).toBeTruthy();
    const [record] = await h.adminDatabase.$queryRaw<
      object[]
    >`SELECT * FROM mail_deliveries WHERE id=${challengeId}::uuid`;
    expect(JSON.stringify(record)).not.toContain(code);
    expect(JSON.stringify(record)).not.toContain(email);
    expect(record).toMatchObject({
      status: 'failed',
      old_email: null,
      token: null,
      attempts: 1,
    });
    // Statistics use the terminal timestamp, including for synchronous attempts.
    await h.adminDatabase
      .$executeRaw`UPDATE mail_deliveries SET finished_at=now()-interval '8 days' WHERE id=${challengeId}::uuid`;
    expect((await mail.statistics()).items).not.toContainEqual(
      expect.objectContaining({ kind: 'code_reset', status: 'failed' }),
    );
  });
});
