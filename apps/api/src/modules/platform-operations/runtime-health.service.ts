import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DatabaseService } from '../../infrastructure/database/database.service';

@Injectable()
export class RuntimeHealthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<{ database: boolean; redis: boolean }> {
    const [database, redis] = await Promise.all([
      this.databaseProbe(),
      this.redisProbe(),
    ]);
    return { database, redis };
  }

  private databaseProbe() {
    return bounded(async () => {
      await this.database.client.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
          await tx.$queryRawUnsafe('SELECT 1');
        },
        { maxWait: 1500, timeout: 2000 },
      );
    });
  }

  private async redisProbe() {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return false;
    const redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1500,
      commandTimeout: 1500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on('error', () => undefined);
    try {
      return await bounded(async () => {
        await redis.connect();
        if ((await redis.ping()) !== 'PONG') throw new Error('Probe failed');
      });
    } finally {
      redis.disconnect();
    }
  }
}

async function bounded(probe: () => Promise<void>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(probe)
        .then(
          () => true,
          () => false,
        ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 2500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
