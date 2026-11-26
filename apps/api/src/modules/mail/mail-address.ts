import { isEmail } from 'class-validator';

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function validMailbox(value: string) {
  return (
    value.length <= 320 && !/[\s<>,;:\p{Cc}]/u.test(value) && isEmail(value)
  );
}

export function maskEmail(value: string) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf('@');
  return at > 0 ? email[0] + '***' + email.slice(at) : '***';
}
