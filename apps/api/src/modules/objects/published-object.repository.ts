import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { ObjectAccessPolicy } from './effective-access';

export interface PublishedObjectRecord {
  id: string;
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  sortOrder: number;
  configuration: unknown;
  memberOverride?: ObjectAccessPolicy;
}

export interface PublishedObjectRepository {
  list(context: TenantContext): Promise<PublishedObjectRecord[]>;
  findByCode(
    context: TenantContext,
    code: string,
  ): Promise<PublishedObjectRecord | null>;
}

@Injectable()
export class PrismaPublishedObjectRepository implements PublishedObjectRepository {
  constructor(private readonly runner: DatabaseContextRunner) {}

  list(context: TenantContext): Promise<PublishedObjectRecord[]> {
    return this.runner.withTenant(context, async (transaction) => {
      const objects = await transaction.objectDefinition.findMany({
        where: {
          tenantId: context.tenantId,
          status: 'ACTIVE',
          activePublicationId: { not: null },
        },
        include: {
          activePublication: { select: { configuration: true } },
          permissions: {
            where: {
              subjectType: 'MEMBER',
              subjectMemberId: context.memberId,
            },
            take: 1,
          },
        },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      });
      return objects.map(toPublishedRecord);
    });
  }

  findByCode(
    context: TenantContext,
    code: string,
  ): Promise<PublishedObjectRecord | null> {
    return this.runner.withTenant(context, async (transaction) => {
      const object = await transaction.objectDefinition.findFirst({
        where: { tenantId: context.tenantId, code },
        include: {
          activePublication: { select: { configuration: true } },
          permissions: {
            where: {
              subjectType: 'MEMBER',
              subjectMemberId: context.memberId,
            },
            take: 1,
          },
        },
      });
      return object ? toPublishedRecord(object) : null;
    });
  }
}

function toPublishedRecord(object: {
  id: string;
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  sortOrder: number;
  activePublication: { configuration: unknown } | null;
  permissions: Array<{
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    readScope: 'ALL' | 'OWN' | 'NONE';
    updateScope: 'ALL' | 'OWN' | 'NONE';
  }>;
}): PublishedObjectRecord {
  const override = object.permissions[0];
  return {
    id: object.id,
    code: object.code,
    status: object.status,
    sortOrder: object.sortOrder,
    configuration: object.activePublication?.configuration ?? null,
    memberOverride: override
      ? {
          canCreate: override.canCreate,
          canRead: override.canRead,
          canUpdate: override.canUpdate,
          canDelete: false,
          readScope: override.readScope,
          updateScope: override.updateScope,
        }
      : undefined,
  };
}
