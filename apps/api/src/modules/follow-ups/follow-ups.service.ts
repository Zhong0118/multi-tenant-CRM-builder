import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { PublishedObjectService } from '../objects/published-object.service';
import type {
  CreateFollowUpDto,
  FollowUpQueryDto,
  FollowUpWorkbenchResponseDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import type { FollowUpMeta, FollowUpRecordScope } from './follow-up-command';
import { FollowUpsRepository } from './follow-ups.repository';
import {
  followUpWorkbenchRange,
  isValidFollowUpTimeZone,
} from './follow-up-workbench-time';
export type { FollowUpMeta, FollowUpRecordScope } from './follow-up-command';
export interface FollowUpScope {
  objectId: string;
  ownerMemberId?: string;
  updateOwnerMemberId?: string;
  canUpdate: boolean;
}

export interface AiFollowUpReadInput {
  status?: 'OPEN' | 'DONE' | 'CANCELLED';
  dueFrom?: string;
  dueTo?: string;
  objectCode?: string;
  recordId?: string;
  limit: number;
}

export interface AiFollowUpReadItem {
  id: string;
  objectCode: string;
  objectName: string;
  recordId: string;
  recordTitle: string;
  title: string;
  dueAt: string;
  status: string;
  overdue: boolean;
}

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly repository: FollowUpsRepository,
    private readonly objects: PublishedObjectService,
  ) {}

  async list(context: TenantContext, query: FollowUpQueryDto) {
    return this.repository.list(
      context,
      await this.resolveReadableScopes(context),
      query,
    );
  }

  /**
   * Personal Workbench (§7). Takes the actor context and nothing else: there is
   * deliberately no way for a caller to name another member, because the home
   * page always shows the current actor's own Follow-ups.
   *
   * An unusable tenant timezone fails closed. Falling back to UTC would silently
   * move every user's "today", so the request errors instead.
   */
  async workbench(
    context: TenantContext,
  ): Promise<FollowUpWorkbenchResponseDto> {
    const [scopes, timezone] = await Promise.all([
      this.resolveReadableScopes(context),
      this.repository.getTenantTimezone(context),
    ]);

    if (!isValidFollowUpTimeZone(timezone)) {
      throw new ApiException('INTERNAL_ERROR', 500, {
        message: '租户时区配置无效，请联系平台管理员。',
      });
    }

    return this.repository.workbench(
      context,
      scopes,
      followUpWorkbenchRange(new Date(), timezone),
      timezone,
    );
  }

  /**
   * Personal AI read: always the acting member's own Follow-ups, including
   * Tenant Admin. Optional object/record/date filters still intersect the same
   * readable record scopes as the list page and Workbench.
   */
  async listForAi(
    context: TenantContext,
    input: AiFollowUpReadInput,
  ): Promise<AiFollowUpReadItem[]> {
    let scopes = await this.resolveReadableScopes(context);
    if (input.objectCode) {
      const resolved = await this.objects.resolveRuntimeSchema(
        context,
        input.objectCode,
      );
      const objectId = resolved.schema.object.id;
      scopes = scopes.filter((scope) => scope.objectId === objectId);
    }
    return this.repository.listForAi(context, scopes, input);
  }

  /**
   * The single resolution of "which objects may this actor read, and how deep",
   * shared by the list page, the Workbench, and the AI read tool so those
   * paths cannot drift into different permission models.
   */
  private async resolveReadableScopes(
    context: TenantContext,
  ): Promise<FollowUpScope[]> {
    const navigation = await this.objects.listAccessible(context);
    const scopes: FollowUpScope[] = [];
    for (const object of navigation) {
      try {
        const resolved = await this.objects.resolveRuntimeSchema(
          context,
          object.code,
        );
        scopes.push({
          objectId: resolved.schema.object.id,
          ownerMemberId:
            resolved.access.readScope === 'OWN' ? context.memberId : undefined,
          canUpdate:
            resolved.access.canUpdate && resolved.access.updateScope !== 'NONE',
          updateOwnerMemberId:
            resolved.access.updateScope === 'OWN'
              ? context.memberId
              : undefined,
        });
      } catch (error) {
        if (
          !(error instanceof ApiException) ||
          ![403, 404].includes(error.getStatus())
        )
          throw error;
      }
    }
    return scopes;
  }

  async create(
    context: TenantContext,
    input: CreateFollowUpDto,
    meta: FollowUpMeta,
  ) {
    const scope = await this.requireRecord(
      context,
      input.objectCode,
      input.recordId,
    );
    if (
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      !validDueAt(input.dueAt)
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    /**
     * §24: the HTTP boundary keeps its own tenant transaction (opened by the
     * repository) and runs the shared transaction-aware command inside it, so
     * the Action Engine can later run the same command inside the Transition's
     * transaction. The assignee stays hard-coded to the acting member.
     */
    return this.repository.create(
      context,
      { ...input, title: input.title.trim() },
      meta,
      scope,
    );
  }

  async recipients(context: TenantContext, id: string) {
    const task = await this.repository.find(context, id);
    if (!task) throw new ApiException('RECORD_NOT_FOUND', 404);
    await this.requireRecord(context, task.objectCode, task.recordId);
    const result: Array<{ id: string; displayName: string }> = [];
    for (const member of await this.repository.activeMembers(context)) {
      try {
        await this.requireRecord(
          {
            ...context,
            memberId: member.id,
            userId: member.userId,
            role: member.role,
          },
          task.objectCode,
          task.recordId,
        );
        result.push({
          id: member.id,
          displayName: member.user.displayName ?? member.employeeNo ?? '成员',
        });
      } catch (e) {
        if (!(e instanceof ApiException) || ![403, 404].includes(e.getStatus()))
          throw e;
      }
    }
    return result;
  }
  async update(
    context: TenantContext,
    id: string,
    input: UpdateFollowUpDto,
    meta: FollowUpMeta,
  ) {
    const task = await this.repository.find(context, id);
    if (!task) throw new ApiException('RECORD_NOT_FOUND', 404);
    const scope = await this.requireRecord(
      context,
      task.objectCode,
      task.recordId,
    );
    if (
      (input.status !== undefined &&
        !['DONE', 'CANCELLED'].includes(input.status)) ||
      (input.dueAt !== undefined && !validDueAt(input.dueAt))
    ) {
      throw new ApiException('VALIDATION_FAILED', 400);
    }
    if (task.version !== input.version)
      throw new ApiException('RECORD_VERSION_CONFLICT', 409);
    if (
      task.status !== 'OPEN' ||
      [input.status, input.dueAt, input.assigneeMemberId].filter(Boolean)
        .length !== 1
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '仅待跟进事项可以完成、取消或改期，请选择一个操作。',
      });
    }
    let recipientScope: FollowUpRecordScope | undefined;
    if (input.assigneeMemberId) {
      const member = await this.repository.activeMember(
        context,
        input.assigneeMemberId,
      );
      if (!member)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '请选择在职成员。',
        });
      recipientScope = await this.requireRecord(
        {
          ...context,
          memberId: member.id,
          userId: member.userId,
          role: member.role,
        },
        task.objectCode,
        task.recordId,
      );
    }
    const updated = await this.repository.update(
      context,
      id,
      input,
      meta,
      scope,
      recipientScope,
    );
    if (!updated) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
    return updated;
  }

  private async requireRecord(
    context: TenantContext,
    objectCode: string,
    recordId: string,
  ) {
    const resolved = await this.objects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    const access = resolved.access;
    if (!access.canUpdate || access.updateScope === 'NONE')
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    const record = await this.repository.findRecord(
      context,
      resolved.schema.object.id,
      recordId,
    );
    if (
      !record ||
      ((access.readScope === 'OWN' || access.updateScope === 'OWN') &&
        record.ownerMemberId !== context.memberId)
    ) {
      throw new ApiException('RECORD_NOT_FOUND', 404);
    }
    return {
      objectId: resolved.schema.object.id,
      expectedRole: context.role,
      recordId,
      requiredOwnerMemberId:
        access.readScope === 'OWN' || access.updateScope === 'OWN'
          ? context.memberId
          : undefined,
    };
  }
}
function validDueAt(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
