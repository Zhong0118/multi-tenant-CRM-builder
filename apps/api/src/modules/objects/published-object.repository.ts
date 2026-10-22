import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { PublishedFieldAccess } from './object-schema';
import type { ObjectAccessPolicy } from './effective-access';

export interface PublishedObjectRecord {
  poolEnabled?: boolean;
  poolLifecycleEnabled?: boolean;
  id: string;
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  sortOrder: number;
  configuration: unknown;
  memberOverride?: ObjectAccessPolicy;
  memberFieldOverrides?: Record<string, PublishedFieldAccess>;
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
          memberFieldPermissions: {
            where: { memberId: context.memberId },
            select: { access: true, field: { select: { fieldKey: true } } },
          },
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
    return this.runner.withTenant(context, (transaction) =>
      findPublishedObjectInTransaction(transaction, context, code),
    );
  }
}

/**
 * Loads one object together with its CURRENT active publication and the
 * caller's own MEMBER permission row inside a transaction the caller already
 * owns. The UI read path reaches it through `withTenant` above; the Action
 * Engine reaches it inside the Transition transaction, so both resolve a
 * target through one query and one interpretation (§46.3).
 */
export async function findPublishedObjectInTransaction(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  code: string,
): Promise<PublishedObjectRecord | null> {
  const object = await transaction.objectDefinition.findFirst({
    where: { tenantId: context.tenantId, code },
    include: {
      activePublication: { select: { configuration: true } },
      memberFieldPermissions: {
        where: { memberId: context.memberId },
        select: { access: true, field: { select: { fieldKey: true } } },
      },
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
}

function toPublishedRecord(object: {
  poolEnabled?: boolean;
  poolLifecycleEnabled?: boolean;
  id: string;
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  sortOrder: number;
  activePublication: { configuration: unknown } | null;
  memberFieldPermissions: Array<{
    access: PublishedFieldAccess;
    field: { fieldKey: string };
  }>;
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
    poolEnabled: object.poolEnabled ?? false,
    poolLifecycleEnabled: object.poolLifecycleEnabled ?? false,
    id: object.id,
    code: object.code,
    status: object.status,
    sortOrder: object.sortOrder,
    configuration: object.activePublication?.configuration ?? null,
    memberFieldOverrides: Object.fromEntries(
      object.memberFieldPermissions.map((permission) => [
        permission.field.fieldKey,
        permission.access,
      ]),
    ),
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
