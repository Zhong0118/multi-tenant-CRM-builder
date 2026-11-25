import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { EmailRateLimits } from './email-rate-limits';

const url = process.env.TEST_REDIS_URL;
(url ? describe : describe.skip)('email challenge quotas in Redis', () => {
  const prefix = randomUUID();
  let redis: Redis, limits: EmailRateLimits;
  beforeAll(() => {
    redis = new Redis(url!);
    limits = new EmailRateLimits(new ConfigService({ REDIS_URL: url }));
  });
  afterAll(async () => {
    const keys = await redis.keys('crm:email-limit:*' + prefix + '*');
    if (keys.length) await redis.del(...keys);
    limits.onModuleDestroy();
    await redis.quit();
  });
  it('admits exactly one simultaneous first request to the same target', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) =>
        limits.issue(prefix + 'concurrent', prefix + 'ip' + i),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const error of outcomes)
      if (error.status === 'rejected')
        expect(error.reason).toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('shares address and account quotas across purposes, honoring a rolling hour and daily quota', async () => {
    const target = prefix + 'rolling',
      hourKey = 'crm:email-limit:hour:' + target,
      minuteKey = 'crm:email-limit:minute:' + target;
    const account = prefix + 'user',
      ip = prefix + 'source';
    await limits.issue(target, ip, account);
    const timestamp = Date.now();
    await redis.zadd(minuteKey, timestamp - 59_000, 'first');
    await expect(limits.issue(target, ip)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await redis.del(minuteKey);
    for (let i = 0; i < 4; i++)
      await redis.zadd(hourKey, timestamp - 3_599_000 + i, 'hist' + i);
    await expect(limits.issue(target, ip)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    await redis.zadd(hourKey, timestamp - 3_601_000, 'hist0');
    await expect(limits.issue(target, ip)).resolves.toBeUndefined();
    for (let i = 0; i < 9; i++) await limits.account(account);
    await expect(
      limits.issue(prefix + 'another', ip, account),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('limits IP across targets and confirmations across IPs', async () => {
    const ip = prefix + 'alltargets',
      target = prefix + 'allconfirm';
    for (let i = 0; i < 20; i++) await limits.issue(prefix + 'iptest' + i, ip);
    await expect(limits.issue(prefix + 'extra', ip)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    for (let i = 0; i < 30; i++) await limits.confirm(target, prefix + 'c' + i);
    await expect(
      limits.confirm(target, prefix + 'new-ip'),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
