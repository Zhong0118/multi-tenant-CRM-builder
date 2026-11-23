import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ApiException } from '../../common/errors/api.exception';
import type { CallRateLimiter } from './rate-limiter';

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
export class RedisRateLimiter implements CallRateLimiter, OnModuleDestroy {
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

  async acquire(key: string, owner: string, ttlSeconds: number) {
    await this.ensureConnected();
    return (
      (await this.redis.eval(
        "return redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')",
        1,
        `crm:lease:${key}`,
        owner,
        ttlSeconds,
      )) === 'OK'
    );
  }
  async release(key: string, owner: string) {
    await this.ensureConnected();
    await this.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
      1,
      `crm:lease:${key}`,
      owner,
    );
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
