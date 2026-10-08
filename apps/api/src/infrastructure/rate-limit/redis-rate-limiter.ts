import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ApiException } from '../../common/errors/api.exception';
import type { RateLimiter } from './rate-limiter';

interface RedisClient {
  status: string;
  connect(): Promise<unknown>;
  eval(
    script: string,
    keyCount: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

const CONSUME_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class RedisRateLimiter implements RateLimiter, OnModuleDestroy {
  private readonly redis: RedisClient;
  private connectionPromise?: Promise<void>;

  constructor(redisUrl: string, redis?: RedisClient) {
    this.redis =
      redis ??
      new Redis(redisUrl, {
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
  }

  async consume(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void> {
    await this.ensureConnected();
    const key = `crm:rate-limit:${input.key}`;
    const count = Number(
      await this.redis.eval(CONSUME_WINDOW, 1, key, input.windowSeconds),
    );
    if (count > input.limit) {
      throw new ApiException('RATE_LIMITED', 429);
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === 'ready') return;

    if (!this.connectionPromise) {
      this.connectionPromise = Promise.resolve(this.redis.connect())
        .then(() => undefined)
        .catch((error: unknown) => {
          this.connectionPromise = undefined;
          throw error;
        });
    }
    await this.connectionPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit().catch(() => this.redis.disconnect());
    }
  }
}
