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
import { parsePublishedObjectSchema } from '../objects/published-object.service';
import type {
  InvitationPage,
  InvitationPageQuery,
  MemberPageQuery,
  MembershipsRepository,
  MembershipStore,
  MemberObjectAccessSource,
  MemberObjectPolicy,
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
      return work(
        new PrismaMembershipStore(transaction, this.audit, context.tenantId),
      );
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
      // `tenants_member_select` only exposes a company while the membership is
      // ACTIVE, so the relation comes back empty for a member whose access was
      // revoked even though the foreign key guarantees a row exists. Returning
      // the membership anyway used to dereference null and answer 500; the
      // caller gets an empty list, which the account page already renders.
      return members.flatMap((member) => {
        const tenant = member.tenant as typeof member.tenant | null;
        if (!tenant) return [];
        return [
          {
            tenantId: member.tenantId,
            tenantCode: tenant.code,
            tenantName: tenant.name,
            tenantStatus: tenant.status,
            memberId: member.id,
            memberStatus: member.status,
            role: member.role,
          },
        ];
      });
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
    private readonly tenantId: string,
  ) {}

  async lockAdminRoster(): Promise<void> {
    await this.transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${this.tenantId}, 0))::text
    `;
  }

  async isUsableMember(id: string) {
    return (
      (await this.transaction.tenantMember.count({
        where: {
          id,
          tenantId: this.tenantId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      })) === 1
    );
  }

  async lockMembers(ids: string[]) {
    for (const id of ids)
      await this.transaction
        .$queryRaw`SELECT id FROM tenant_members WHERE tenant_id = ${this.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  }

  async updateMemberRole(id: string, role: 'TENANT_ADMIN' | 'EMPLOYEE') {
    return this.transaction.tenantMember.update({
      where: { id, tenantId: this.tenantId },
      data: { role },
    });
  }

  async offboardingCounts(id: string) {
    const records = await this.transaction.record.count({
      where: { tenantId: this.tenantId, ownerMemberId: id },
    });
    const openTasks = await this.transaction.recordFollowUp.count({
      where: { tenantId: this.tenantId, assigneeMemberId: id, status: 'OPEN' },
    });
    return { records, openTasks };
  }

  async offboardingRecipients(id: string) {
    const members = await this.transaction.tenantMember.findMany({
      where: {
        tenantId: this.tenantId,
        id: { not: id },
        user: { status: 'ACTIVE' },
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
      },
      include: { user: { select: { displayName: true, phone: true } } },
      orderBy: { id: 'asc' },
    });
    return members.map((member) => ({
      ...member,
      displayName: member.user.displayName,
      phone: member.user.phone,
    }));
  }

  async transferWork(source: string, recipient: string) {
    const records = await this.transaction.record.updateMany({
      where: { tenantId: this.tenantId, ownerMemberId: source },
      data: { ownerMemberId: recipient, version: { increment: 1 } },
    });
    const tasks = await this.transaction.recordFollowUp.updateMany({
      where: {
        tenantId: this.tenantId,
        assigneeMemberId: source,
        status: 'OPEN',
      },
      data: { assigneeMemberId: recipient, version: { increment: 1 } },
    });
    return { records: records.count, openTasks: tasks.count };
  }

  async listMembers(page: MemberPageQuery) {
    const [members, total, activeAdminCount] = await Promise.all([
      this.transaction.tenantMember.findMany({
        include: { user: { select: { displayName: true, phone: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page.page - 1) * page.limit,
        take: page.limit,
      }),
      this.transaction.tenantMember.count(),
      this.countActiveAdmins(),
    ]);
    return {
      items: members.map((member) => ({
        id: member.id,
        userId: member.userId,
        tenantId: member.tenantId,
        role: member.role,
        status: member.status,
        displayName: member.user.displayName,
        phone: member.user.phone,
      })),
      page: page.page,
      limit: page.limit,
      total,
      activeAdminCount,
    };
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

  async listPublishedObjectAccess(
    memberId: string,
  ): Promise<MemberObjectAccessSource[]> {
    const objects = await this.transaction.objectDefinition.findMany({
      where: {
        tenantId: this.tenantId,
        status: 'ACTIVE',
        activePublicationId: { not: null },
        deletedAt: null,
      },
      include: {
        activePublication: { select: { configuration: true } },
        permissions: {
          where: {
            subjectType: 'MEMBER',
            subjectMemberId: memberId,
          },
          take: 1,
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return objects.map((object) => {
      const schema = parsePublishedObjectSchema(
        object.activePublication?.configuration,
      );
      const override = object.permissions[0];
      return {
        objectId: object.id,
        objectCode: object.code,
        objectName: object.name,
        inherited: {
          canCreate: schema.employeeAccess.canCreate,
          canRead: schema.employeeAccess.canRead,
          canUpdate: schema.employeeAccess.canUpdate,
          canDelete: false,
          readScope: schema.employeeAccess.readScope,
          updateScope: schema.employeeAccess.updateScope,
        },
        override: override
          ? {
              canCreate: override.canCreate,
              canRead: override.canRead,
              canUpdate: override.canUpdate,
              canDelete: false,
              readScope: override.readScope,
              updateScope: override.updateScope,
            }
          : null,
      };
    });
  }

  async replaceMemberObjectAccess(
    memberId: string,
    objectId: string,
    policy: MemberObjectPolicy,
  ): Promise<void> {
    await this.transaction.objectPermission.deleteMany({
      where: {
        tenantId: this.tenantId,
        objectId,
        subjectType: 'MEMBER',
        subjectMemberId: memberId,
      },
    });
    await this.transaction.objectPermission.create({
      data: {
        tenantId: this.tenantId,
        objectId,
        subjectType: 'MEMBER',
        subjectRole: null,
        subjectMemberId: memberId,
        canCreate: policy.canCreate,
        canRead: policy.canRead,
        canUpdate: policy.canUpdate,
        canDelete: false,
        readScope: policy.readScope,
        updateScope: policy.updateScope,
      },
    });
  }

  async deleteMemberObjectAccess(
    memberId: string,
    objectId: string,
  ): Promise<void> {
    await this.transaction.objectPermission.deleteMany({
      where: {
        tenantId: this.tenantId,
        objectId,
        subjectType: 'MEMBER',
        subjectMemberId: memberId,
      },
    });
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
    const changed = await this.transaction.tenantInvitation.updateMany({
      where: { id, tenantId: this.tenantId, status: 'PENDING' },
      data: input,
    });
    if (changed.count !== 1)
      throw new ApiException('INVITATION_NOT_FOUND', 409);
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
