import { RuntimeHealthService } from './runtime-health.service';
import type { ConfigService } from '@nestjs/config';
import type { DatabaseService } from '../../infrastructure/database/database.service';

jest.mock('ioredis', () => ({
  __esModule: true,
  default: class {
    on() {}
    connect() {
      return Promise.reject(new Error('redis://secret unavailable'));
    }
    disconnect() {}
  },
}));

it('reports unreachable Redis as failed even when a URL is configured', async () => {
  const database = {
    client: {
      $transaction: (work: (tx: unknown) => Promise<void>) =>
        work({
          $executeRawUnsafe: () => Promise.resolve(),
          $queryRawUnsafe: () => Promise.resolve([{ '?column?': 1 }]),
        }),
    },
  };
  const health = new RuntimeHealthService(
    database as unknown as DatabaseService,
    { get: () => 'redis://secret' } as unknown as ConfigService,
  );
  await expect(health.check()).resolves.toEqual({
    database: true,
    redis: false,
  });
});

it('bounds an unresponsive database probe', async () => {
  jest.useFakeTimers();
  try {
    const database = {
      client: { $transaction: () => new Promise(() => undefined) },
    };
    const health = new RuntimeHealthService(
      database as unknown as DatabaseService,
      { get: () => undefined } as unknown as ConfigService,
    );
    const result = health.check();
    await jest.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toEqual({ database: false, redis: false });
  } finally {
    jest.useRealTimers();
  }
});
