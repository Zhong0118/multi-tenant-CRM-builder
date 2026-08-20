import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseService } from './database.service';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";
const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";

@Injectable()
export class DatabaseContextRunner {
  constructor(private readonly database: DatabaseService) {}

  withUser<T>(
    userId: string,
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, userId);
      return work(transaction);
    });
  }

  withTenant<T>(
    context: TenantContext,
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, context.userId);
      await transaction.$queryRawUnsafe(SET_TENANT, context.tenantId);
      return work(transaction);
    });
  }
}
