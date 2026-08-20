import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { ApiException } from '../../common/errors/api.exception';
import type { RateLimiter } from './rate-limiter';

@Injectable()
export class RedisRateLimiter implements RateLimiter, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
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
    if (this.redis.status === 'wait') {
      await this.redis.connect();
    }
    const key = `crm:rate-limit:${input.key}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, input.windowSeconds);
    }
    if (count > input.limit) {
      throw new ApiException('RATE_LIMITED', 429);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status !== 'end') {
      await this.redis.quit().catch(() => this.redis.disconnect());
    }
  }
}
