import { Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

export interface RateLimiter {
  consume(input: {
    key: string;
    limit: number;
    windowSeconds: number;
  }): Promise<void>;
}

@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

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
