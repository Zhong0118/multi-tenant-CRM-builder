import { validMailbox } from './mail-address';

const registered = 'noreply@notice.baijiehub.com';
const productionOrigin = 'https://crm.baijiehub.com';
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function readMailConfig(get: (name: string) => string | undefined) {
  const value = (name: string) => get(name) ?? '';
  const production = value('NODE_ENV') === 'production';
  const host = value('SMTP_HOST');
  const port = Number(value('SMTP_PORT'));
  const local = !production && loopback.has(host);
  const user = value('SMTP_USER');
  const pass = value('SMTP_PASSWORD');
  const from = value('MAIL_FROM');
  const replyTo = value('MAIL_REPLY_TO');
  const secretText = value('MAIL_SECRET');
  const secret =
    /^[a-f0-9]{64,}$/i.test(secretText) && secretText.length % 2 === 0
      ? Buffer.from(secretText, 'hex')
      : Buffer.from(secretText, 'utf8');
  const origins = value('WEB_ORIGIN')
    .split(',')
    .map((s) => s.trim());
  const origin = production
    ? origins.find((s) => s === productionOrigin)
    : origins.find((s) => {
        try {
          const url = new URL(s);
          return (
            loopback.has(url.hostname) &&
            ['http:', 'https:'].includes(url.protocol) &&
            url.origin === s
          );
        } catch {
          return false;
        }
      });
  const issues: string[] = [];
  if (value('MAIL_PROVIDER') !== 'smtp') issues.push('MAIL_PROVIDER');
  else {
    if (!(
      local || ['gz-smtp.qcloudmail.com', 'smtp.qcloudmail.com'].includes(host)
    ))
      issues.push('SMTP_HOST');
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      (!local && port !== 465)
    )
      issues.push('SMTP_PORT');
    if ((!local || pass) && !user.trim()) issues.push('SMTP_USER');
    if ((!local || user) && !pass.trim()) issues.push('SMTP_PASSWORD');
    if (from !== registered && from !== '百杰CRM <' + registered + '>')
      issues.push('MAIL_FROM');
    if (replyTo && !validMailbox(replyTo)) issues.push('MAIL_REPLY_TO');
    if (secret.length < 32 || secretText.trim() !== secretText)
      issues.push('MAIL_SECRET');
    if (!origin) issues.push('WEB_ORIGIN');
  }
  return {
    status: { ready: !issues.length, issues },
    origin: origin ?? '',
    secret,
    host,
    port,
    auth: user ? { user, pass } : undefined,
    from: { name: '百杰CRM', address: registered },
    replyTo: replyTo || undefined,
  };
}
export type MailConfig = ReturnType<typeof readMailConfig>;
