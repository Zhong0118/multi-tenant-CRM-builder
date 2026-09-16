import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import { PublishedObjectService } from '../objects/published-object.service';
import { AuditService } from '../audit/audit.service';
import {
  checkRelationRecord,
  createRecordRelationCommand,
  lockRelationActor,
  resolveRecordRelationScope,
  type RecordRelationScope,
} from './record-relation-command';
type Scope = RecordRelationScope;
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
    return resolveRecordRelationScope(this.objects, context, code, id, write);
  }
  async list(context: TenantContext, code: string, id: string) {
    id = id.toLowerCase();
    const source = await this.scope(context, code, id, false);
    const links = await this.runner.withTenant(context, async (tx) => {
      await checkRelationRecord(tx, context, source);
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
          checkRelationRecord(tx, context, target),
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
    /**
     * §21 / §24: the HTTP boundary keeps its own tenant transaction and runs
     * the shared transaction-aware command inside it, so the Action Engine can
     * later run the same command inside the Transition's transaction.
     */
    return this.runner.withTenant(context, async (tx) => {
      const { success } = await createRecordRelationCommand(
        tx,
        context,
        {
          code,
          id,
          objectCode: input.objectCode,
          recordId: input.recordId,
        },
        meta,
        {
          resolveScope: (ctx, objectCode, recordId, write) =>
            this.scope(ctx, objectCode, recordId, write),
          audit: this.audit,
        },
      );
      // The command additionally reports the canonical `relationId` (§16, for
      // the Action Engine). This HTTP endpoint's contract stays exactly
      // `RelationResultDto = { success: boolean }`.
      return { success };
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
      await lockRelationActor(tx, context);
      for (const scope of [source, target].sort((a, b) =>
        a.id.localeCompare(b.id),
      ))
        await checkRelationRecord(tx, context, scope, true);
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
