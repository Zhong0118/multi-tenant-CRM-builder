import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { PlatformOperationsRepository } from './platform-operations.service';
import type {
  PageResult,
  PlatformAuditFacets,
  PlatformAuditItem,
  PlatformAuditQuery,
  PlatformOperationItem,
} from './platform-operations.types';

@Injectable()
export class PrismaPlatformOperationsRepository implements PlatformOperationsRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  /** The actions and resource types that actually occur, most frequent first. */
  auditFacets(
    actorId: string,
    tenantId?: string,
  ): Promise<PlatformAuditFacets> {
    return this.runner.withUser(actorId, async (transaction) => {
      const where = tenantId ? { tenantId } : {};
      const [actions, resourceTypes] = await Promise.all([
        transaction.auditLog.groupBy({
          by: ['action'],
          where,
          _count: { _all: true },
          orderBy: { _count: { action: 'desc' } },
          take: 200,
        }),
        transaction.auditLog.groupBy({
          by: ['resourceType'],
          where,
          _count: { _all: true },
          orderBy: { _count: { resourceType: 'desc' } },
          take: 100,
        }),
      ]);
      return {
        actions: actions.map((row) => ({
          value: row.action,
          count: row._count._all,
        })),
        resourceTypes: resourceTypes.map((row) => ({
          value: row.resourceType,
          count: row._count._all,
        })),
      };
    });
  }

  listAudit(
    actorId: string,
    query: PlatformAuditQuery,
  ): Promise<PageResult<PlatformAuditItem>> {
    return this.runner.withUser(actorId, async (transaction) => {
      const where: Prisma.AuditLogWhereInput = {
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.action
          ? { action: { contains: query.action, mode: 'insensitive' } }
          : {}),
        ...(query.resourceType
          ? {
              resourceType: {
                contains: query.resourceType,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query.actorType ? { actorType: query.actorType } : {}),
        ...(query.from || query.to
          ? {
              createdAt: {
                ...(query.from ? { gte: beijingDayStart(query.from) } : {}),
                ...(query.to ? { lt: beijingDayStart(query.to, 1) } : {}),
              },
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        transaction.auditLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        transaction.auditLog.count({ where }),
      ]);
      const tenantIds = rows.flatMap((row) =>
        row.tenantId ? [row.tenantId] : [],
      );
      const actorIds = rows.flatMap((row) =>
        row.actorId ? [row.actorId] : [],
      );
      const [tenants, actors] = await Promise.all([
        transaction.tenant.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, name: true },
        }),
        transaction.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true },
        }),
      ]);
      const tenantNames = new Map(tenants.map((item) => [item.id, item.name]));
      const actorNames = new Map(
        actors.map((item) => [item.id, item.displayName]),
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          tenantName: row.tenantId
            ? (tenantNames.get(row.tenantId) ?? null)
            : null,
          actorType: row.actorType,
          actorId: row.actorId,
          actorName: row.actorId ? (actorNames.get(row.actorId) ?? null) : null,
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          before: row.before,
          after: row.after,
          reason: row.reason,
          requestId: row.requestId,
          ip: row.ip,
          createdAt: row.createdAt,
        })),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  }

  listOperations(
    actorId: string,
    query: { page: number; limit: number },
  ): Promise<PageResult<PlatformOperationItem>> {
    return this.runner.withUser(actorId, async (transaction) => {
      const [rows, total] = await Promise.all([
        transaction.businessTemplateApplication.findMany({
          include: {
            tenant: { select: { id: true, name: true, code: true } },
            appliedBy: { select: { id: true, displayName: true } },
            templateVersion: {
              select: {
                versionNo: true,
                template: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        transaction.businessTemplateApplication.count(),
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          kind: 'TEMPLATE_APPLICATION',
          status: 'SUCCEEDED',
          templateId: row.templateVersion.template.id,
          templateName: row.templateVersion.template.name,
          templateVersionNo: row.templateVersion.versionNo,
          tenantId: row.tenant.id,
          tenantName: row.tenant.name,
          tenantCode: row.tenant.code,
          appliedByUserId: row.appliedBy.id,
          appliedByName: row.appliedBy.displayName,
          objectCount: Object.keys(jsonObject(row.objectIdMap)).length,
          appliedAt: row.appliedAt,
        })),
        page: query.page,
        limit: query.limit,
        total,
      };
    });
  }
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/** Midnight of a Beijing calendar day (UTC+8, no daylight saving), plus `days`. */
function beijingDayStart(day: string, days = 0): Date {
  const start = new Date(`${day}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() + days);
  return start;
}
