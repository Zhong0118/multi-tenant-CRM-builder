import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

import { ApiException } from '../../common/errors/api.exception';

const HOUR = 3600_000;
// One server clock and a single atomic admission across all applicable quotas.
const ADMIT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1])*1000 + math.floor(tonumber(clock[2])/1000)
for i,key in ipairs(KEYS) do
  local window = tonumber(ARGV[2*i])
  redis.call('ZREMRANGEBYSCORE',key,'-inf',now-window)
  if redis.call('ZCARD',key) >= tonumber(ARGV[2*i+1]) then return 0 end
end
for i,key in ipairs(KEYS) do
  redis.call('ZADD',key,now,ARGV[1])
  redis.call('PEXPIRE',key,ARGV[2*i])
end
return 1`;

type Quota = [key: string, milliseconds: number, limit: number];

@Injectable()
export class EmailRateLimits implements OnModuleDestroy {
  private readonly redis?: Redis;
  private connecting?: Promise<void>;
  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (url) {
      this.redis = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        commandTimeout: 2500,
      });
      this.redis.on('error', () => {
        /* Public callers receive a sanitized availability error. */
      });
    }
  }

  issue(target: string, ip: string, userId?: string) {
    const quotas: Quota[] = [
      ['minute:' + target, 60_000, 1],
      ['hour:' + target, HOUR, 5],
      ['source:' + ip, HOUR, 20],
    ];
    if (userId) quotas.push(['account:' + userId, 24 * HOUR, 10]);
    return this.admit(quotas);
  }
  account(userId: string) {
    return this.admit([['account:' + userId, 24 * HOUR, 10]]);
  }
  confirm(target: string, ip: string) {
    return this.admit([
      ['confirm-target:' + target, HOUR, 30],
      ['confirm-ip:' + ip, HOUR, 60],
    ]);
  }

  private async admit(quotas: Quota[]) {
    try {
      if (!this.redis) throw new Error();
      if (this.redis.status === 'wait') {
        this.connecting = this.redis.connect().finally(() => {
          this.connecting = undefined;
        });
      }
      if (this.connecting) await this.connecting;
      // ioredis connects asynchronously. Concurrent first requests await readiness.
      if (this.redis.status !== 'ready') throw new Error();
      const result = await this.redis.eval(
        ADMIT,
        quotas.length,
        ...quotas.map(([key]) => 'crm:email-limit:' + key),
        randomUUID(),
        ...quotas.flatMap(([, window, limit]) => [window, limit]),
      );
      if (Number(result) !== 1) throw new ApiException('RATE_LIMITED', 429);
    } catch (error) {
      if (error instanceof ApiException) throw error;
      throw new ApiException('MAIL_SERVICE_UNAVAILABLE', 503);
    }
  }
  onModuleDestroy() {
    this.redis?.disconnect();
  }
}
