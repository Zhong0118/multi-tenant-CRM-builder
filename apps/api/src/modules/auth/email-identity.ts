import { maskEmail } from '../mail/mail-address';

interface EmailIdentity {
  email: string | null;
  emailVerifiedAt: Date | null;
  emailUndeliverableAt: Date | null;
}

export function emailPresentation(user: EmailIdentity) {
  const maskedEmail = user.email ? maskEmail(user.email) : null;
  const emailStatus = !user.email
    ? 'UNBOUND'
    : user.emailUndeliverableAt
      ? 'UNDELIVERABLE'
      : user.emailVerifiedAt
        ? 'VERIFIED'
        : 'UNVERIFIED';
  return { maskedEmail, emailStatus } as const;
}
