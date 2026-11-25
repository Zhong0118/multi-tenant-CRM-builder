import type { Prisma } from '@crm/database';
import ipaddr from 'ipaddr.js';
import { createHash, randomBytes } from 'node:crypto';

const DAY = 86400_000;
export const DEVICE_COOKIE = 'crm_device';
export const DEVICE_LIFETIME = 365 * DAY;

export function deviceFingerprint(userAgent?: string, ip?: string) {
  if (!userAgent || !ip || !ipaddr.isValid(ip)) return null;
  const browsers: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\//, 'Edge'],
    [/OPR\//, 'Opera'],
    [/(?:Firefox|FxiOS)\//, 'Firefox'],
    [/(?:Chrome|CriOS)\//, 'Chrome'],
    [/Safari\//, 'Safari'],
  ];
  const systems: [RegExp, string][] = [
    [/Android/, 'Android'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Windows/, 'Windows'],
    [/CrOS/, 'ChromeOS'],
    [/Mac OS/, 'macOS'],
    [/Linux/, 'Linux'],
  ];
  const browser = browsers.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser || !system) return null;
  const bytes = ipaddr.process(ip).toByteArray();
  const prefix = bytes.length === 4 ? 24 : 64;
  bytes.fill(0, prefix / 8);
  return {
    device: browser + ' / ' + system,
    network: ipaddr.fromByteArray(bytes).toString() + '/' + prefix,
  };
}

export async function lockAccount(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true), id FROM users WHERE id=${userId}::uuid FOR UPDATE`;
}

export async function rememberDevice(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date,
  input: { deviceCookie?: string; userAgent?: string; ip?: string },
) {
  await lockAccount(tx, userId);
  await tx.loginDevice.deleteMany({
    where: { userId, expiresAt: { lte: now } },
  });
  const digest = (value: string) =>
    createHash('sha256').update(value).digest('hex');
  const known =
    typeof input.deviceCookie === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(input.deviceCookie)
      ? await tx.loginDevice.findUnique({
          where: {
            userId_tokenHash: { userId, tokenHash: digest(input.deviceCookie) },
          },
        })
      : null;
  const fingerprint = deviceFingerprint(input.userAgent, input.ip);
  let notify = false;
  if (!known && fingerprint) {
    const recent = {
      userId,
      lastUsedAt: { gt: new Date(now.getTime() - 90 * DAY) },
      device: { not: null },
      network: { not: null },
    };
    const baseline = await tx.loginDevice.findFirst({
      where: recent,
      select: { tokenHash: true },
    });
    if (baseline)
      notify = !(await tx.loginDevice.findFirst({
        where: { ...recent, ...fingerprint },
        select: { tokenHash: true },
      }));
  }
  // Keep the previous row as a 90-day fallback when a familiar browser changes
  // network or family. The renewed cookie identifies its new observation.
  const sameObservation =
    known &&
    (!fingerprint ||
      (fingerprint.device === known.device &&
        fingerprint.network === known.network));
  const cookie = sameObservation
    ? input.deviceCookie!
    : randomBytes(32).toString('base64url');
  const values = {
    ...fingerprint,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + DEVICE_LIFETIME),
  };
  const tokenHash = digest(cookie);
  await tx.loginDevice.upsert({
    where: { userId_tokenHash: { userId, tokenHash } },
    update: values,
    create: { userId, tokenHash, ...values },
  });
  return { cookie, notification: notify ? fingerprint : null };
}
