import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { PublishedObjectService } from '../objects/published-object.service';
import { AuditService } from '../audit/audit.service';
type Scope = { id: string; objectId: string; owner?: string };
@Injectable()
export class RecordRelationsService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly objects: PublishedObjectService,
    private readonly audit: AuditService,
  ) {}
  async scope(
    context: TenantContext,
    code: string,
    id: string,
    write: boolean,
  ): Promise<Scope> {
    const { schema, access } = await this.objects.resolveRuntimeSchema(
      context,
      code,
    );
    if (write && (!access.canUpdate || access.updateScope === 'NONE'))
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    return {
      id: id.toLowerCase(),
      objectId: schema.object.id,
      owner:
        access.readScope === 'OWN' || (write && access.updateScope === 'OWN')
          ? context.memberId
          : undefined,
    };
  }
  private async lockActor(
    tx: Prisma.TransactionClient,
    context: TenantContext,
  ) {
    const actors = await tx.$queryRaw<
      Array<{ role: string }>
    >`SELECT m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${context.tenantId}::uuid AND m.id=${context.memberId}::uuid AND m.user_id=${context.userId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m`;
    if (actors.length !== 1 || actors[0].role !== context.role)
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
  }
  private async check(
    tx: Prisma.TransactionClient,
    context: TenantContext,
    scope: Scope,
    lock = false,
  ) {
    if (lock) {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM records WHERE tenant_id=${context.tenantId}::uuid AND id=${scope.id}::uuid AND object_id=${scope.objectId}::uuid AND deleted_at IS NULL AND (${scope.owner ?? null}::uuid IS NULL OR owner_member_id=${scope.owner ?? null}::uuid) FOR UPDATE`;
      if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
    }
    const record = await tx.record.findFirst({
      where: {
        tenantId: context.tenantId,
        id: scope.id,
        objectId: scope.objectId,
        ownerMemberId: scope.owner,
        deletedAt: null,
      },
      include: { object: true },
    });
    if (!record) throw new ApiException('RECORD_NOT_FOUND', 404);
    return record;
  }
  async list(context: TenantContext, code: string, id: string) {
    id = id.toLowerCase();
    const source = await this.scope(context, code, id, false);
    const links = await this.runner.withTenant(context, async (tx) => {
      await this.check(tx, context, source);
      return tx.$queryRaw<
        Array<{ id: string; targetId: string; objectCode: string }>
      >`SELECT l.id, r.id AS "targetId", o.code AS "objectCode" FROM record_relations l JOIN records r ON r.tenant_id=l.tenant_id AND r.id=CASE WHEN l.source_record_id=${id}::uuid THEN l.target_record_id ELSE l.source_record_id END JOIN object_definitions o ON o.tenant_id=r.tenant_id AND o.id=r.object_id WHERE l.tenant_id=${context.tenantId}::uuid AND (l.source_record_id=${id}::uuid OR l.target_record_id=${id}::uuid) AND r.deleted_at IS NULL ORDER BY l.created_at DESC`;
    });
    const visible = [];
    for (const link of links) {
      try {
        const target = await this.scope(
          context,
          link.objectCode,
          link.targetId,
          false,
        );
        const record = await this.runner.withTenant(context, (tx) =>
          this.check(tx, context, target),
        );
        visible.push({
          id: link.id,
          recordId: record.id,
          objectCode: link.objectCode,
          title: record.title,
        });
      } catch (e) {
        if (!(e instanceof ApiException) || ![403, 404].includes(e.getStatus()))
          throw e;
      }
    }
    return visible;
  }
  async add(
    context: TenantContext,
    code: string,
    id: string,
    input: { objectCode: string; recordId: string },
    meta: { requestId: string; ip?: string },
  ) {
    id = id.toLowerCase();
    input = { ...input, recordId: input.recordId.toLowerCase() };
    if (id === input.recordId) throw new ApiException('VALIDATION_FAILED', 400);
    const source = await this.scope(context, code, id, true);
    const target = await this.scope(
      context,
      input.objectCode,
      input.recordId,
      false,
    );
    return this.runner.withTenant(context, async (tx) => {
      await this.lockActor(tx, context);
      for (const scope of [source, target].sort((a, b) =>
        a.id.localeCompare(b.id),
      ))
        await this.check(tx, context, scope, true);
      const pair = [id, input.recordId].sort();
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`INSERT INTO record_relations (id,tenant_id,source_record_id,target_record_id) VALUES (${randomUUID()}::uuid,${context.tenantId}::uuid,${pair[0]}::uuid,${pair[1]}::uuid) ON CONFLICT (tenant_id,source_record_id,target_record_id) DO NOTHING RETURNING id`;
      if (rows.length)
        await this.audit.append(tx, {
          tenantId: context.tenantId,
          actorType: 'USER',
          actorId: context.userId,
          action: 'record.relation_added',
          resourceType: 'record',
          resourceId: id,
          after: { targetRecordId: input.recordId },
          ...meta,
        });
      return { success: true };
    });
  }
  async remove(
    context: TenantContext,
    code: string,
    id: string,
    relationId: string,
    meta: { requestId: string; ip?: string },
  ) {
    id = id.toLowerCase();
    relationId = relationId.toLowerCase();
    const links = await this.list(context, code, id);
    const link = links.find((item) => item.id === relationId);
    if (!link) throw new ApiException('RECORD_NOT_FOUND', 404);
    const source = await this.scope(context, code, id, true);
    const target = await this.scope(
      context,
      link.objectCode,
      link.recordId,
      false,
    );
    return this.runner.withTenant(context, async (tx) => {
      await this.lockActor(tx, context);
      for (const scope of [source, target].sort((a, b) =>
        a.id.localeCompare(b.id),
      ))
        await this.check(tx, context, scope, true);
      const count =
        await tx.$executeRaw`DELETE FROM record_relations WHERE tenant_id=${context.tenantId}::uuid AND id=${relationId}::uuid AND (source_record_id=${id}::uuid OR target_record_id=${id}::uuid)`;
      if (!count) throw new ApiException('RECORD_NOT_FOUND', 404);
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'record.relation_removed',
        resourceType: 'record',
        resourceId: id,
        before: { targetRecordId: link.recordId },
        ...meta,
      });
      return { success: true };
    });
  }
}
