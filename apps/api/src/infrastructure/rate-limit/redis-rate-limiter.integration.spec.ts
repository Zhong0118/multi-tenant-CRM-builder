import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import { RedisRateLimiter } from './redis-rate-limiter';

const redisUrl = process.env.TEST_REDIS_URL;

(redisUrl ? describe : describe.skip)('Redis rate-limit windows', () => {
  let redis: Redis;
  let limiter: RedisRateLimiter;
  const keys: string[] = [];

  function input(limit = 5, windowSeconds = 60) {
    const key = `integration:${randomUUID()}`;
    keys.push(`crm:rate-limit:${key}`);
    return { key, limit, windowSeconds };
  }

  beforeAll(async () => {
    redis = new Redis(redisUrl!);
    await redis.ping();
    limiter = new RedisRateLimiter(redisUrl!);
  });

  afterAll(async () => {
    if (keys.length) await redis.del(...keys);
    await limiter.onModuleDestroy();
    await redis.quit();
  });

  it('admits exactly the limit under concurrent requests and expires the counter', async () => {
    const request = input();
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => limiter.consume(request)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(5);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toMatchObject({ code: 'RATE_LIMITED' });
      }
    }
    expect(await redis.ttl(`crm:rate-limit:${request.key}`)).toBeGreaterThan(0);
  });

  it('repairs an existing counter without an expiry even when the request is limited', async () => {
    const request = input(5, 1);
    const key = `crm:rate-limit:${request.key}`;
    await redis.set(key, 5);
    await expect(limiter.consume(request)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(await redis.pttl(key)).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(limiter.consume(request)).resolves.toBeUndefined();
  });

  it('does not extend an existing window when another request arrives', async () => {
    const request = input();
    const key = `crm:rate-limit:${request.key}`;
    await redis.set(key, 1, 'EX', 10);
    await limiter.consume(request);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(10);
  });
});
