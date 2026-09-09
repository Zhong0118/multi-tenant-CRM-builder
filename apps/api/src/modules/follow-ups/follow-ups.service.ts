import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { PublishedObjectService } from '../objects/published-object.service';
import type {
  CreateFollowUpDto,
  FollowUpQueryDto,
  UpdateFollowUpDto,
} from './follow-ups.dto';
import { FollowUpsRepository } from './follow-ups.repository';
export interface FollowUpRecordScope {
  objectId: string;
  recordId: string;
  requiredOwnerMemberId?: string;
}
export interface FollowUpMeta {
  requestId: string;
  ip?: string;
}
export interface FollowUpScope {
  objectId: string;
  ownerMemberId?: string;
  updateOwnerMemberId?: string;
  canUpdate: boolean;
}

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly repository: FollowUpsRepository,
    private readonly objects: PublishedObjectService,
  ) {}

  async list(context: TenantContext, query: FollowUpQueryDto) {
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
    return this.repository.list(context, scopes, query);
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
    return this.repository.create(
      context,
      { ...input, title: input.title.trim() },
      meta,
      scope,
    );
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
      (!input.status && !input.dueAt) ||
      (input.status && input.dueAt)
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '仅待跟进事项可以完成、取消或改期，请选择一个操作。',
      });
    }
    const updated = await this.repository.update(
      context,
      id,
      input,
      meta,
      scope,
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
