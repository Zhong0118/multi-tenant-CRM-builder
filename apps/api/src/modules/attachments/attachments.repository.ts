import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { AuditService } from '../audit/audit.service';
export interface AttachmentScope {
  objectId: string;
  recordId: string;
  ownerId?: string;
}
export interface AttachmentRow {
  id: string;
  filename: string;
  byteSize: number;
  createdAt: Date;
  content?: Buffer;
}
export interface AttachmentMeta {
  requestId: string;
  ip?: string;
}
@Injectable()
export class AttachmentsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}
  private async lock(
    tx: Prisma.TransactionClient,
    c: TenantContext,
    s: AttachmentScope,
  ) {
    const actors = await tx.$queryRaw<
      Array<{ role: string }>
    >`SELECT m.role FROM tenant_members m JOIN users u ON u.id=m.user_id WHERE m.tenant_id=${c.tenantId}::uuid AND m.id=${c.memberId}::uuid AND m.status='ACTIVE' AND u.status='ACTIVE' FOR UPDATE OF m`;
    if (!actors.length || actors[0].role !== c.role)
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    const rows = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM records WHERE tenant_id=${c.tenantId}::uuid AND object_id=${s.objectId}::uuid AND id=${s.recordId}::uuid AND deleted_at IS NULL AND (${s.ownerId ?? null}::uuid IS NULL OR owner_member_id=${s.ownerId ?? null}::uuid) FOR UPDATE`;
    if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
  }
  list(c: TenantContext, s: AttachmentScope) {
    return this.runner.withTenant(c, async (tx) => {
      await this.lock(tx, c, s);
      return tx.$queryRaw<
        AttachmentRow[]
      >`SELECT id,filename,byte_size AS "byteSize",created_at AS "createdAt" FROM record_attachments WHERE tenant_id=${c.tenantId}::uuid AND record_id=${s.recordId}::uuid AND deleted_at IS NULL ORDER BY created_at DESC,id LIMIT 10`;
    });
  }
  create(
    c: TenantContext,
    s: AttachmentScope,
    filename: string,
    content: Buffer,
    meta: AttachmentMeta,
  ) {
    return this.runner.withTenant(c, async (tx) => {
      await this.lock(tx, c, s);
      const [quota] = await tx.$queryRaw<
        Array<{ count: number; bytes: number }>
      >`SELECT count(*)::int AS count,coalesce(sum(byte_size),0)::int AS bytes FROM record_attachments WHERE tenant_id=${c.tenantId}::uuid AND record_id=${s.recordId}::uuid AND deleted_at IS NULL`;
      if (quota.count >= 10 || quota.bytes + content.length > 25 * 1024 * 1024)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '每条记录最多 10 个附件，总计不超过 25 MB。',
        });
      const id = randomUUID();
      const [row] = await tx.$queryRaw<
        AttachmentRow[]
      >`INSERT INTO record_attachments(id,tenant_id,record_id,filename,byte_size,content,created_by_member_id) VALUES (${id}::uuid,${c.tenantId}::uuid,${s.recordId}::uuid,${filename},${content.length},${content},${c.memberId}::uuid) RETURNING id,filename,byte_size AS "byteSize",created_at AS "createdAt"`;
      await this.audit.append(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        actorType: 'USER',
        action: 'attachment.created',
        resourceType: 'record_attachment',
        resourceId: id,
        after: { recordId: s.recordId, filename, byteSize: content.length },
        ...meta,
      });
      return row;
    });
  }
  download(c: TenantContext, s: AttachmentScope, id: string) {
    return this.runner.withTenant(c, async (tx) => {
      await this.lock(tx, c, s);
      const [row] = await tx.$queryRaw<
        AttachmentRow[]
      >`SELECT id,filename,byte_size AS "byteSize",created_at AS "createdAt",content FROM record_attachments WHERE id=${id}::uuid AND tenant_id=${c.tenantId}::uuid AND record_id=${s.recordId}::uuid AND deleted_at IS NULL`;
      if (!row) throw new ApiException('RECORD_NOT_FOUND', 404);
      return row;
    });
  }
  remove(
    c: TenantContext,
    s: AttachmentScope,
    id: string,
    meta: AttachmentMeta,
  ) {
    return this.runner.withTenant(c, async (tx) => {
      await this.lock(tx, c, s);
      const count =
        await tx.$executeRaw`UPDATE record_attachments SET content=NULL,deleted_at=now() WHERE id=${id}::uuid AND tenant_id=${c.tenantId}::uuid AND record_id=${s.recordId}::uuid AND deleted_at IS NULL`;
      if (count !== 1) throw new ApiException('RECORD_NOT_FOUND', 404);
      await this.audit.append(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        actorType: 'USER',
        action: 'attachment.deleted',
        resourceType: 'record_attachment',
        resourceId: id,
        after: { recordId: s.recordId },
        ...meta,
      });
    });
  }
}
