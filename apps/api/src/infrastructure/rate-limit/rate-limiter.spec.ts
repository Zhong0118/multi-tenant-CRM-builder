import { InMemoryRateLimiter } from './rate-limiter';

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
