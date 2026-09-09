import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { PlatformAuditQuery } from './platform-operations.types';

@Injectable()
export class CompanyAuditService {
  constructor(private readonly runner: DatabaseContextRunner) {}
  async list(context: TenantContext, query: PlatformAuditQuery) {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner.withTenant(context, async (tx) => {
      const where = {
        tenantId: context.tenantId,
        ...(query.action
          ? { action: { contains: query.action, mode: 'insensitive' as const } }
          : {}),
        ...(query.resourceType
          ? {
              resourceType: {
                contains: query.resourceType,
                mode: 'insensitive' as const,
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        tx.auditLog.count({ where }),
      ]);
      return {
        items: rows.map((row) => ({
          ...row,
          tenantName: context.tenantCode,
          actorName: null,
        })),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  }
}
