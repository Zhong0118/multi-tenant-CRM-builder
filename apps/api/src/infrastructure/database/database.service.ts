import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, PrismaClient } from '@crm/database';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private clientInstance?: PrismaClient;

  constructor(private readonly config: ConfigService) {}

  get client(): PrismaClient {
    if (!this.clientInstance) {
      throw new Error('DatabaseService has not been initialized');
    }

    return this.clientInstance;
  }

  async onModuleInit(): Promise<void> {
    const { createDatabaseClient } = await import('@crm/database');
    this.clientInstance = createDatabaseClient(
      this.config.get<string>(
        'DATABASE_URL',
        'postgresql://crm_app:crm_app@localhost:5432/crm',
      ),
    );
  }

  transaction<T>(
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(work);
  }

  async onModuleDestroy(): Promise<void> {
    await this.clientInstance?.$disconnect();
  }
}
