import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { ApiException } from '../../common/errors/api.exception';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';
import type {
  PlatformTenant,
  PlatformTenantRepository,
  PlatformTenantStore,
  TenantStatus,
} from './tenants.service';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";
const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";

@Injectable()
export class PrismaPlatformTenantRepository implements PlatformTenantRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  transaction<T>(
    actorId: string,
    work: (store: PlatformTenantStore) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, actorId);
      return work(new PrismaPlatformTenantStore(transaction, this.audit));
    });
  }

  list(actorId: string): Promise<PlatformTenant[]> {
    return this.transaction(actorId, (store) => store.listTenants());
  }

  find(actorId: string, tenantId: string): Promise<PlatformTenant | null> {
    return this.transaction(actorId, (store) => store.findTenant(tenantId));
  }
}

class PrismaPlatformTenantStore implements PlatformTenantStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
  ) {}

  async createTenant(input: {
    name: string;
    code: string;
  }): Promise<PlatformTenant> {
    try {
      return mapTenant(
        await this.transaction.tenant.create({ data: input }),
        0,
      );
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new ApiException('TENANT_CODE_CONFLICT', 409);
      }
      throw error;
    }
  }

  async enterTenant(tenantId: string): Promise<void> {
    await this.transaction.$queryRawUnsafe(SET_TENANT, tenantId);
  }

  async createFirstAdminInvitation(input: {
    tenantId: string;
    targetPhone: string;
    invitationCodeHash: string;
    createdByUserId: string;
    expiresAt: Date;
    role: 'TENANT_ADMIN';
  }): Promise<{
    id: string;
    targetPhone: string;
    role: 'TENANT_ADMIN';
    status: 'PENDING';
    expiresAt: Date;
  }> {
    const target = await this.transaction.user.findUnique({
      where: { phone: input.targetPhone },
      select: { id: true },
    });
    const invitation = await this.transaction.tenantInvitation.create({
      data: { ...input, status: 'PENDING', targetUserId: target?.id },
      select: {
        id: true,
        targetPhone: true,
        role: true,
        status: true,
        expiresAt: true,
      },
    });
    return {
      id: invitation.id,
      targetPhone: invitation.targetPhone,
      role: 'TENANT_ADMIN',
      status: 'PENDING',
      expiresAt: invitation.expiresAt,
    };
  }

  countActiveAdmins(tenantId: string): Promise<number> {
    return this.transaction.tenantMember.count({
      where: { tenantId, role: 'TENANT_ADMIN', status: 'ACTIVE' },
    });
  }

  async findTenant(id: string): Promise<PlatformTenant | null> {
    const tenant = await this.transaction.tenant.findUnique({ where: { id } });
    if (!tenant) return null;
    await this.enterTenant(tenant.id);
    return this.enrichTenant(tenant);
  }

  async listTenants(): Promise<PlatformTenant[]> {
    const tenants = await this.transaction.tenant.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const enriched: PlatformTenant[] = [];
    for (const tenant of tenants) {
      await this.enterTenant(tenant.id);
      enriched.push(await this.enrichTenant(tenant));
    }
    return enriched;
  }

  async updateTenantStatus(
    id: string,
    status: TenantStatus,
  ): Promise<PlatformTenant> {
    const tenant = await this.transaction.tenant.update({
      where: { id },
      data: {
        status,
        activatedAt: status === 'ACTIVE' ? new Date() : undefined,
      },
    });
    await this.enterTenant(tenant.id);
    return this.enrichTenant(tenant);
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }

  private async enrichTenant(
    tenant: Parameters<typeof mapTenant>[0],
  ): Promise<PlatformTenant> {
    const [activeAdminCount, firstAdminInvitation] = await Promise.all([
      this.countActiveAdmins(tenant.id),
      this.transaction.tenantInvitation.findFirst({
        where: { tenantId: tenant.id, role: 'TENANT_ADMIN' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          targetPhone: true,
          role: true,
          status: true,
          expiresAt: true,
        },
      }),
    ]);
    return {
      ...mapTenant(tenant, activeAdminCount),
      firstAdminInvitation: firstAdminInvitation
        ? {
            id: firstAdminInvitation.id,
            targetPhone: firstAdminInvitation.targetPhone,
            role: 'TENANT_ADMIN',
            status: firstAdminInvitation.status,
            expiresAt: firstAdminInvitation.expiresAt,
          }
        : undefined,
    };
  }
}

function mapTenant(
  input: {
    id: string;
    name: string;
    code: string;
    status: TenantStatus;
    timezone: string;
    locale: string;
    activatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  activeAdminCount: number,
): PlatformTenant {
  return {
    ...input,
    activatedAt: input.activatedAt ?? undefined,
    activeAdminCount,
  };
}

function isUniqueConstraint(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
