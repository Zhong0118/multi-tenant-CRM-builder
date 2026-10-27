import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { AuditService } from '../audit/audit.service';
import { lockObjectConfiguration } from '../objects/object-configuration-lock';
import type {
  CreateMemberGroupDto,
  MemberGroupDto,
  MemberGroupListDto,
  UpdateMemberGroupDto,
} from './dto/member-groups.dto';

const include = {
  members: { select: { id: true }, orderBy: { id: 'asc' } },
} as const;
type Group = Prisma.MemberGroupGetPayload<{ include: typeof include }>;
type Meta = { requestId: string; ip?: string };

@Injectable()
export class MemberGroupsService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  list(context: TenantContext): Promise<MemberGroupListDto> {
    return this.withAdmin(context, async (tx) => {
      const [groups, members] = await Promise.all([
        tx.memberGroup.findMany({
          where: { tenantId: context.tenantId },
          include,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId },
          include: { user: { select: { displayName: true, status: true } } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      ]);
      return {
        items: groups.map(present),
        members: members.map((member) => ({
          id: member.id,
          displayName: member.displayName ?? member.user.displayName ?? '成员',
          status: member.user.status === 'ACTIVE' ? member.status : 'DISABLED',
          role: member.role,
          groupId: member.groupId,
        })),
      };
    });
  }

  create(context: TenantContext, input: CreateMemberGroupDto, meta: Meta) {
    return this.save(context, undefined, input, meta);
  }

  update(
    context: TenantContext,
    id: string,
    input: UpdateMemberGroupDto,
    meta: Meta,
  ) {
    return this.save(context, id, input, meta);
  }

  private save(
    context: TenantContext,
    id: string | undefined,
    input: CreateMemberGroupDto | UpdateMemberGroupDto,
    meta: Meta,
  ) {
    return this.withAdmin(context, async (tx) => {
      const before = id
        ? await tx.memberGroup.findFirst({
            where: { tenantId: context.tenantId, id },
            include,
          })
        : null;
      if (id && !before) throw missingGroup();
      if (
        before &&
        (!('expectedVersion' in input) ||
          before.version !== input.expectedVersion)
      )
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      const name = input.name.trim();
      if (
        !name ||
        name.length > 100 ||
        input.memberIds.length > 1000 ||
        new Set(input.memberIds).size !== input.memberIds.length
      )
        throw invalidMembers();
      if (
        await tx.memberGroup.count({
          where: {
            tenantId: context.tenantId,
            name,
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw duplicateName();

      const selected = await tx.tenantMember.findMany({
        where: { tenantId: context.tenantId, id: { in: input.memberIds } },
        include: { user: { select: { status: true } } },
      });
      if (
        selected.length !== input.memberIds.length ||
        selected.some(
          (member) =>
            member.role !== 'EMPLOYEE' ||
            ((member.status !== 'ACTIVE' || member.user.status !== 'ACTIVE') &&
              (!before || member.groupId !== before.id)),
        )
      )
        throw invalidMembers();
      if (
        input.leaderMemberId &&
        !selected.some(
          (member) =>
            member.id === input.leaderMemberId &&
            member.status === 'ACTIVE' &&
            member.user.status === 'ACTIVE',
        )
      )
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '组长必须是本组内的在职员工。',
        });
      if (
        await tx.memberGroup.count({
          where: {
            tenantId: context.tenantId,
            leaderMemberId: { in: input.memberIds },
            ...(id ? { id: { not: id } } : {}),
          },
        })
      )
        throw new ApiException('VALIDATION_FAILED', 409, {
          message: '所选员工是其他小组的组长，请先为原小组更换组长。',
        });

      const sourceGroupIds = [
        ...new Set(
          selected.flatMap((member) =>
            member.groupId && member.groupId !== id ? [member.groupId] : [],
          ),
        ),
      ];
      // All roster changes share the tenant lock. Invalidate source-group forms
      // when a move changes their membership so stale forms cannot move it back.
      if (sourceGroupIds.length)
        await tx.memberGroup.updateMany({
          where: { tenantId: context.tenantId, id: { in: sourceGroupIds } },
          data: { version: { increment: 1 } },
        });
      const group = before
        ? await tx.memberGroup.update({
            where: { id: before.id, tenantId: context.tenantId },
            data: {
              name,
              leaderMemberId: input.leaderMemberId,
              version: { increment: 1 },
            },
          })
        : await tx.memberGroup.create({
            data: {
              tenantId: context.tenantId,
              name,
              leaderMemberId: input.leaderMemberId,
            },
          });
      await tx.tenantMember.updateMany({
        where: {
          tenantId: context.tenantId,
          groupId: group.id,
          id: { notIn: input.memberIds },
        },
        data: { groupId: null },
      });
      if (input.memberIds.length)
        await tx.tenantMember.updateMany({
          where: { tenantId: context.tenantId, id: { in: input.memberIds } },
          data: { groupId: group.id },
        });
      const after = present({
        ...group,
        members: [...input.memberIds]
          .sort()
          .map((memberId) => ({ id: memberId })),
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: before ? 'member_group.updated' : 'member_group.created',
        resourceType: 'member_group',
        resourceId: group.id,
        before: before ? { ...present(before) } : undefined,
        after: { ...after, movedFromGroupIds: sourceGroupIds },
        ...meta,
      });
      return after;
    });
  }

  delete(
    context: TenantContext,
    id: string,
    expectedVersion: number,
    meta: Meta,
  ) {
    return this.withAdmin(context, async (tx) => {
      const before = await tx.memberGroup.findFirst({
        where: { tenantId: context.tenantId, id },
        include,
      });
      if (!before) throw missingGroup();
      if (before.version !== expectedVersion)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      await tx.memberGroup.update({
        where: { id, tenantId: context.tenantId },
        data: { leaderMemberId: null },
      });
      await tx.tenantMember.updateMany({
        where: { tenantId: context.tenantId, groupId: id },
        data: { groupId: null },
      });
      await tx.memberGroup.delete({
        where: { id, tenantId: context.tenantId },
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'member_group.deleted',
        resourceType: 'member_group',
        resourceId: id,
        before: { ...present(before) },
        ...meta,
      });
      return { ok: true };
    });
  }

  private withAdmin<T>(
    context: TenantContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (context.role !== 'TENANT_ADMIN')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return this.runner
      .withTenant(context, async (tx) => {
        await lockObjectConfiguration(tx, context.tenantId);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.tenantId}, 0))::text`;
        await tx.$queryRaw`SELECT id FROM tenant_members WHERE tenant_id = ${context.tenantId}::uuid AND id = ${context.memberId}::uuid FOR NO KEY UPDATE`;
        if (
          !(await tx.tenantMember.count({
            where: {
              id: context.memberId,
              tenantId: context.tenantId,
              userId: context.userId,
              role: 'TENANT_ADMIN',
              status: 'ACTIVE',
              user: { status: 'ACTIVE' },
            },
          }))
        )
          throw new ApiException('WORKSPACE_FORBIDDEN', 403);
        return work(tx);
      })
      .catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        )
          throw duplicateName();
        throw error;
      });
  }
}

function present(group: Group): MemberGroupDto {
  return {
    id: group.id,
    name: group.name,
    version: group.version,
    leaderMemberId: group.leaderMemberId,
    memberIds: group.members.map((member) => member.id),
  };
}
function invalidMembers() {
  return new ApiException('VALIDATION_FAILED', 400, {
    message: '请选择本公司的在职员工；已停用成员只能保留在原小组或移出。',
  });
}
function missingGroup() {
  return new ApiException('VALIDATION_FAILED', 404, {
    message: '小组不存在或已被解散。',
  });
}
function duplicateName() {
  return new ApiException('VALIDATION_FAILED', 409, {
    message: '本公司已存在同名小组，请使用其他名称。',
  });
}
