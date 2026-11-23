import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface CallRateLimiter extends RateLimiter {
  acquire(key: string, owner: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
}
export interface RateLimiter {
  consume(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void>;
}

@Injectable()
export class InMemoryRateLimiter implements CallRateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  private readonly leases = new Map<
    string,
    { owner: string; expires: number }
  >();
  acquire(key: string, owner: string, ttlSeconds: number) {
    const previous = this.leases.get(key);
    if (previous && previous.expires > Date.now())
      return Promise.resolve(false);
    this.leases.set(key, { owner, expires: Date.now() + ttlSeconds * 1000 });
    return Promise.resolve(true);
  }
  release(key: string, owner: string) {
    if (this.leases.get(key)?.owner === owner) this.leases.delete(key);
    return Promise.resolve();
  }

  consume(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void> {
    const now = Date.now();
    const current = this.windows.get(input.key);
    const window =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + input.windowSeconds * 1000 }
        : current;
    window.count += 1;
    this.windows.set(input.key, window);

    if (window.count > input.limit) {
      return Promise.reject(new ApiException('RATE_LIMITED', 429));
    }
    return Promise.resolve();
  }
}
