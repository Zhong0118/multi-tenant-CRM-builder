import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
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
    return this.database
      .transaction(async (transaction) => {
        await transaction.$queryRawUnsafe(SET_USER, context.userId);
        await transaction.$queryRawUnsafe(SET_TENANT, context.tenantId);
        return work(transaction);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('POOL_PROTECTION_OWNER_REQUIRED')) {
          throw new ApiException('VALIDATION_FAILED', 400, {
            message: '请管理员先分配关联记录的负责人，再确认成交。',
          });
        }
        if (message.includes('POOL_PROTECTION_EXPIRED')) {
          throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
            message:
              '关联记录的持有期限已到，请刷新并由管理员重新分配后再确认成交。',
          });
        }
        if (message.includes('Record follow-up deadline expired')) {
          throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
            message: '跟进期限已到，请刷新记录并重新领取或由管理员分配。',
          });
        }
        if (message.includes('POOL_PROTECTION_FORBIDDEN')) {
          throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
        }
        throw error;
      });
  }
}
