import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { presentCompanyAudit } from './company-audit-presenter';
import type { PlatformAuditQuery } from './platform-operations.types';

export interface CompanyAuditQuery extends PlatformAuditQuery {
  /** The acting user (`audit_logs.actor_id` is a user id). */
  actorId?: string;
  /** Calendar days (`YYYY-MM-DD`), inclusive, in the company's timezone. */
  from?: string;
  to?: string;
}

interface TenantClock {
  name: string;
  timezone: string;
  fromAt: Date | null;
  toAt: Date | null;
}

@Injectable()
export class CompanyAuditService {
  constructor(private readonly runner: DatabaseContextRunner) {}
  async list(context: TenantContext, query: CompanyAuditQuery) {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner.withTenant(context, async (tx) => {
      // Day boundaries are the company's calendar days, resolved by Postgres
      // so DST and offsets follow the same tz database as the stored instants.
      const [clock] = await tx.$queryRaw<TenantClock[]>`
        SELECT name, timezone,
          (${query.from ?? null}::date::timestamp AT TIME ZONE timezone) AS "fromAt",
          ((${query.to ?? null}::date + 1)::timestamp AT TIME ZONE timezone) AS "toAt"
        FROM tenants WHERE id = ${context.tenantId}::uuid`;
      const resourceTypes = (query.resourceType ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const where: Prisma.AuditLogWhereInput = {
        tenantId: context.tenantId,
        ...(query.action
          ? { action: { contains: query.action, mode: 'insensitive' } }
          : {}),
        ...(resourceTypes.length
          ? { resourceType: { in: resourceTypes } }
          : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(clock?.fromAt || clock?.toAt
          ? {
              createdAt: {
                ...(clock.fromAt ? { gte: clock.fromAt } : {}),
                ...(clock.toAt ? { lt: clock.toAt } : {}),
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
      // The dedicated AI detail endpoint checks today's record and field access.
      // Do not replay its input through a generic audit row sharing the request.
      const correlated = rows.length
        ? await tx.$queryRaw<{ requestId: string }[]>`
            SELECT DISTINCT request_id AS "requestId" FROM audit_logs
            WHERE tenant_id=${context.tenantId}::uuid AND request_id=ANY(${[...new Set(rows.map((row) => row.requestId))]}::text[])
              AND (resource_type IN ('ai_operation','ai_record_draft')
                OR action='ai.table_blueprint_confirmed' OR after ? 'aiOperationId')`
        : [];
      const privateRequests = new Set(correlated.map((row) => row.requestId));
      const safeRows = rows.map((row) =>
        privateRequests.has(row.requestId)
          ? {
              ...row,
              resourceId: null,
              before: null,
              after: null,
              reason: null,
            }
          : row,
      );
      return {
        items: await presentCompanyAudit(
          tx,
          { id: context.tenantId, name: clock?.name ?? context.tenantCode },
          safeRows,
        ),
        page: query.page,
        limit: query.limit,
        total,
        timezone: clock?.timezone ?? 'Asia/Shanghai',
      };
    });
  }
}
