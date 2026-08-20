import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import type {
  WorkspaceResolution,
  WorkspaceResolver,
} from '../../common/tenancy/workspace.guard';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AuditService } from '../audit/audit.service';
import type {
  InvitationPage,
  InvitationPageQuery,
  MembershipsRepository,
  MembershipStore,
  TenantMemberSummary,
  WorkspaceSummary,
} from './memberships.service';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";
const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";

@Injectable()
export class PrismaMembershipsRepository
  implements MembershipsRepository, WorkspaceResolver
{
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  withTenant<T>(
    context: TenantContext,
    work: (store: MembershipStore) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, context.userId);
      await transaction.$queryRawUnsafe(SET_TENANT, context.tenantId);
      return work(new PrismaMembershipStore(transaction, this.audit));
    });
  }

  listWorkspaces(userId: string): Promise<WorkspaceSummary[]> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, userId);
      const members = await transaction.tenantMember.findMany({
        where: { userId },
        include: { tenant: true },
        orderBy: [{ tenant: { name: 'asc' } }, { id: 'asc' }],
      });
      return members.map((member) => ({
        tenantId: member.tenantId,
        tenantCode: member.tenant.code,
        tenantName: member.tenant.name,
        tenantStatus: member.tenant.status,
        memberId: member.id,
        memberStatus: member.status,
        role: member.role,
      }));
    });
  }

  resolve(
    userId: string,
    tenantCode: string,
  ): Promise<WorkspaceResolution | null> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, userId);
      const memberships = await transaction.tenantMember.findMany({
        where: { userId },
      });
      for (const member of memberships) {
        await transaction.$queryRawUnsafe(SET_TENANT, member.tenantId);
        const tenant = await transaction.tenant.findFirst({
          where: { id: member.tenantId, code: tenantCode },
        });
        if (tenant) {
          return {
            userId,
            tenantId: tenant.id,
            tenantCode: tenant.code,
            tenantName: tenant.name,
            tenantStatus: tenant.status,
            memberId: member.id,
            memberStatus: member.status,
            role: member.role,
          };
        }
      }
      return null;
    });
  }
}

class PrismaMembershipStore implements MembershipStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
  ) {}

  async listMembers(): Promise<TenantMemberSummary[]> {
    const members = await this.transaction.tenantMember.findMany({
      include: { user: { select: { displayName: true, phone: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      tenantId: member.tenantId,
      role: member.role,
      status: member.status,
      displayName: member.user.displayName,
      phone: member.user.phone,
    }));
  }

  async listInvitations(page: InvitationPageQuery): Promise<InvitationPage> {
    const invitations = await this.transaction.tenantInvitation.findMany({
      select: {
        id: true,
        targetPhone: true,
        targetUserId: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: page.cursor ? { id: page.cursor } : undefined,
      skip: page.cursor ? 1 : 0,
      take: page.limit + 1,
    });
    const hasNextPage = invitations.length > page.limit;
    const items = hasNextPage ? invitations.slice(0, page.limit) : invitations;
    return {
      items,
      nextCursor: hasNextPage ? items.at(-1)?.id : undefined,
    };
  }

  async createInvitation(input: {
    tenantId: string;
    targetPhone: string;
    role: 'TENANT_ADMIN' | 'EMPLOYEE';
    invitationCodeHash: string;
    createdByUserId: string;
    expiresAt: Date;
  }): Promise<{ id: string; status: 'PENDING' }> {
    const target = await this.transaction.user.findUnique({
      where: { phone: input.targetPhone },
      select: { id: true },
    });
    try {
      const invitation = await this.transaction.tenantInvitation.create({
        data: { ...input, targetUserId: target?.id, status: 'PENDING' },
        select: { id: true },
      });
      return { id: invitation.id, status: 'PENDING' };
    } catch (error) {
      if (hasErrorCode(error, 'P2002')) {
        throw new ApiException('INVITATION_CONFLICT', 409);
      }
      throw error;
    }
  }

  async findMember(id: string): Promise<TenantMemberSummary | null> {
    const member = await this.transaction.tenantMember.findUnique({
      where: { id },
    });
    return member
      ? {
          id: member.id,
          userId: member.userId,
          tenantId: member.tenantId,
          role: member.role,
          status: member.status,
        }
      : null;
  }

  countActiveAdmins(): Promise<number> {
    return this.transaction.tenantMember.count({
      where: { role: 'TENANT_ADMIN', status: 'ACTIVE' },
    });
  }

  async updateMemberStatus(
    id: string,
    status: 'ACTIVE' | 'DISABLED',
  ): Promise<TenantMemberSummary> {
    const member = await this.transaction.tenantMember.update({
      where: { id },
      data: { status },
    });
    return {
      id: member.id,
      userId: member.userId,
      tenantId: member.tenantId,
      role: member.role,
      status: member.status,
    };
  }

  findInvitation(id: string): Promise<{ id: string; status: string } | null> {
    return this.transaction.tenantInvitation.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }

  async updateInvitation(
    id: string,
    input: Record<string, unknown>,
  ): Promise<void> {
    await this.transaction.tenantInvitation.update({
      where: { id },
      data: input,
    });
  }

  appendAudit(event: Parameters<AuditService['append']>[1]): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  );
}
