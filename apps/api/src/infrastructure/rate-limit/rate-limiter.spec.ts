import { InMemoryRateLimiter } from './rate-limiter';
import { RedisRateLimiter } from './redis-rate-limiter';

describe('InMemoryRateLimiter', () => {
  it('rejects consumption beyond the configured window limit', async () => {
    const limiter = new InMemoryRateLimiter();
    const input = { key: 'login:user', limit: 2, windowSeconds: 60 };

    await limiter.consume(input);
    await limiter.consume(input);

    await expect(limiter.consume(input)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('RedisRateLimiter', () => {
  it('shares the cold Redis connection across concurrent consumption', async () => {
    const redis = {
      status: 'wait',
      connect: jest.fn(async () => {
        await Promise.resolve();
        redis.status = 'ready';
      }),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    const limiter = new RedisRateLimiter('redis://unused.test:6379', redis);

    await Promise.all([
      limiter.consume({ key: 'phone:1', limit: 5, windowSeconds: 60 }),
      limiter.consume({ key: 'ip:1', limit: 5, windowSeconds: 60 }),
      limiter.consume({ key: 'device:1', limit: 5, windowSeconds: 60 }),
    ]);

    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.incr).toHaveBeenCalledTimes(3);
  });
});
