import { readMailConfig } from './mail-config';
import { classifySmtpError } from './mail-transport';
import { renderMail } from './mail-template';
import { maskEmail } from './mail-address';

const env: Record<string, string> = {
  NODE_ENV: 'production',
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'gz-smtp.qcloudmail.com',
  SMTP_PORT: '465',
  SMTP_USER: 'account',
  SMTP_PASSWORD: 'private',
  MAIL_FROM: '百杰CRM <noreply@notice.baijiehub.com>',
  MAIL_SECRET: 'a'.repeat(64),
  WEB_ORIGIN: 'https://example.org,https://crm.baijiehub.com',
};
const config = (data: Record<string, string>) => readMailConfig((k) => data[k]);
it('reports configuration names and selects the registered origin', () => {
  expect(config({}).status).toEqual({
    ready: false,
    issues: ['MAIL_PROVIDER'],
  });
  expect(config(env).origin).toBe('https://crm.baijiehub.com');
  expect(config(env).status).toEqual({ ready: true, issues: [] });
  for (const k of [
    'SMTP_HOST',
    'SMTP_PORT',
    'SMTP_PASSWORD',
    'SMTP_USER',
    'MAIL_FROM',
    'MAIL_SECRET',
    'WEB_ORIGIN',
  ]) {
    expect(config({ ...env, [k]: '' }).status.issues).toContain(k);
  }
  expect(
    config({ ...env, MAIL_REPLY_TO: 'a@b.co\nBcc: bad@b.co' }).status.issues,
  ).toContain('MAIL_REPLY_TO');
  expect(
    config({ ...env, MAIL_FROM: 'other@example.org' }).status.issues,
  ).toContain('MAIL_FROM');
  expect(
    config({
      ...env,
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:3000',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
    }).status.ready,
  ).toBe(true);
});
it.each([
  [
    { responseCode: 550, response: '550 quota exceeded', command: 'RCPT TO' },
    'quota',
    'retry',
  ],
  [{ responseCode: 451, command: 'DATA' }, 'temporary', 'retry'],
  [{ command: 'CONN', code: 'ECONNREFUSED' }, 'connection', 'retry'],
  [
    { command: 'CONN', code: 'ESOCKET', originalCode: 'ECONNREFUSED' },
    'connection',
    'retry',
  ],
  [
    { command: 'CONN', code: 'ETIMEDOUT', timeoutType: 'GREETING_TIMEOUT' },
    'connection',
    'retry',
  ],
  [
    { command: 'CONN', code: 'ETIMEDOUT', timeoutType: 'SOCKET_TIMEOUT' },
    'uncertain',
    'unknown',
  ],
  [{ command: 'CONN', code: 'ESOCKET' }, 'uncertain', 'unknown'],
  [{ command: 'DATA', code: 'ECONNRESET' }, 'uncertain', 'unknown'],
  [
    {
      responseCode: 550,
      response: '550 5.1.1 mailbox does not exist',
      command: 'RCPT TO',
    },
    'recipient',
    'failed',
  ],
  [
    {
      responseCode: 550,
      response: '550 domain not configured',
      command: 'RCPT TO',
    },
    'rejected',
    'failed',
  ],
  [{ responseCode: 535, command: 'AUTH PLAIN' }, 'auth', 'failed'],
])('classifies the SMTP outcome %j', (error, code, action) => {
  expect(classifySmtpError(error)).toEqual({ code, action });
});
it('renders escaped multipart content and masks recipient addresses', () => {
  expect(maskEmail(' Secret@Example.Org ')).toBe('s***@example.org');
  const code = renderMail(
    'code_bind',
    { code: '012345' },
    env.WEB_ORIGIN.split(',')[1],
  );
  expect(code.subject).not.toContain('012345');
  expect(code.text).toContain('012345');
  expect(code.html).toContain('10 分钟');
  const device = renderMail(
    'new_device',
    {
      device: '<i>Chrome</i>',
      network: '192.0.2.0/24',
      occurredAt: new Date(0),
    },
    'https://crm.baijiehub.com',
  );
  expect(device.html).toContain('&lt;i&gt;Chrome');
  expect(device.html).not.toContain('<i>');
  expect(device.text).toContain('https://crm.baijiehub.com/account/security');
});
