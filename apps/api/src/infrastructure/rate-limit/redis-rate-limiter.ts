import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ApiException } from '../../common/errors/api.exception';
import type { RateLimiter } from './rate-limiter';

interface RedisClient {
  status: string;
  connect(): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

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
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, input.windowSeconds);
    }
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
