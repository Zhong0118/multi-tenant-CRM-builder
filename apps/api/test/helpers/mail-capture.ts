import { createTransport } from 'nodemailer';
import {
  composeMessage,
  type MailTransport,
  type SmtpOutcome,
} from '../../src/modules/mail/mail-transport';

/** Produces the same MIME as SMTP, retaining it only in this isolated test fixture. */
export function captureMail(transport: MailTransport) {
  const stream = createTransport({ streamTransport: true, buffer: true });
  const messages: Array<{
    recipients: string[];
    messageId: string;
    raw: Buffer;
  }> = [];
  const capture = {
    messages,
    outcome: { action: 'sent', providerId: null } as SmtpOutcome,
  };
  transport.deliver = async (to, id, content) => {
    const info = await stream.sendMail(
      composeMessage(transport.config, to, id, content),
    );
    if (!Buffer.isBuffer(info.message))
      throw new Error('Expected buffered MIME capture');
    messages.push({
      recipients: info.envelope.to,
      messageId: info.messageId,
      raw: info.message,
    });
    return capture.outcome;
  };
  return capture;
}
