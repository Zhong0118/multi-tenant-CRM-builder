import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { readMailConfig, type MailConfig } from './mail-config';

type Failure = {
  action: 'retry' | 'failed' | 'unknown';
  code:
    | 'quota'
    | 'temporary'
    | 'connection'
    | 'uncertain'
    | 'recipient'
    | 'auth'
    | 'rejected';
};
export type SmtpOutcome =
  Failure | { action: 'sent'; providerId: string | null };

export function classifySmtpError(error: unknown): Failure {
  const e = (typeof error === 'object' && error ? error : {}) as Record<
    string,
    unknown
  >;
  const response = typeof e.response === 'string' ? e.response : '';
  const status = Number(e.responseCode);
  const command = typeof e.command === 'string' ? e.command : '';
  // Providers use both 4xx and 5xx for their daily sending budget and rate limits.
  if (
    /rate[ -]?limit|throttl|too (?:many|frequent)|quota[ -]?(?:exceeded|limit)|limit[ -]?(?:exceeded|reached)|frequency|频率|额度/i.test(
      response,
    )
  )
    return { action: 'retry', code: 'quota' };
  if (status >= 400 && status < 500)
    return { action: 'retry', code: 'temporary' };
  if (status >= 500 && status < 600) {
    if (command.startsWith('AUTH') || e.code === 'EAUTH')
      return { action: 'failed', code: 'auth' };
    if (
      command === 'RCPT TO' &&
      /\b5\.1\.[16]\b|no such (?:user|mailbox)|(?:unknown|invalid) (?:user|recipient)|(?:user|mailbox|recipient) (?:unknown|not found|does not exist)/i.test(
        response,
      )
    )
      return { action: 'failed', code: 'recipient' };
    return { action: 'failed', code: 'rejected' };
  }
  // Nodemailer can report generic socket errors with command CONN even after DATA.
  const systemCode = e.originalCode ?? e.code;
  if (
    [
      'ECONNREFUSED',
      'EDNS',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EHOSTUNREACH',
    ].includes(typeof systemCode === 'string' ? systemCode : '') ||
    ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(
      typeof e.timeoutType === 'string' ? e.timeoutType : '',
    )
  )
    return { action: 'retry', code: 'connection' };
  if (['EHLO', 'HELO', 'STARTTLS', 'MAIL FROM', 'RCPT TO'].includes(command))
    return { action: 'retry', code: 'connection' };
  return { action: 'unknown', code: 'uncertain' };
}

export type MailContent = { subject: string; html: string; text: string };

export function composeMessage(
  config: MailConfig,
  to: string,
  id: string,
  content: MailContent,
) {
  return {
    from: config.from,
    replyTo: config.replyTo,
    to: { name: '', address: to },
    messageId: '<' + id + '@notice.baijiehub.com>',
    ...content,
  };
}

@Injectable()
export class MailTransport {
  readonly config;
  private readonly smtp;
  constructor(config: ConfigService) {
    this.config = readMailConfig((k) => config.get<string>(k));
    const c = this.config;
    this.smtp = c.status.ready
      ? createTransport({
          host: c.host,
          port: c.port,
          secure: c.port === 465,
          auth: c.auth,
          tls: { rejectUnauthorized: true },
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 10000,
          disableUrlAccess: true,
          disableFileAccess: true,
          logger: false,
          debug: false,
        })
      : undefined;
  }
  async deliver(
    to: string,
    id: string,
    content: MailContent,
  ): Promise<SmtpOutcome> {
    if (!this.smtp) return { action: 'failed', code: 'rejected' };
    try {
      const info = await this.smtp.sendMail({
        ...composeMessage(this.config, to, id, content),
        signal: AbortSignal.timeout(25_000),
      });
      if (info.accepted.length !== 1)
        return { action: 'unknown', code: 'uncertain' };
      const match = /\bqueued as ([A-Za-z0-9_-]{1,64})\s*$/i.exec(
        info.response,
      );
      return { action: 'sent', providerId: match?.[1] ?? null };
    } catch (error) {
      return classifySmtpError(error);
    }
  }
}
