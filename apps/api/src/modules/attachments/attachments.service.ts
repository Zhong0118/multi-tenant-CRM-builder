import { Injectable } from '@nestjs/common';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { PublishedObjectService } from '../objects/published-object.service';
import {
  AttachmentsRepository,
  type AttachmentMeta,
} from './attachments.repository';
import { attachmentFilename, validateAttachment } from './attachment-policy';
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly repository: AttachmentsRepository,
    private readonly objects: PublishedObjectService,
  ) {}
  private async scope(
    c: TenantContext,
    code: string,
    recordId: string,
    write = false,
  ) {
    const { schema, access } = await this.objects.resolveRuntimeSchema(c, code);
    if (
      !access.canRead ||
      access.readScope === 'NONE' ||
      (write && (!access.canUpdate || access.updateScope === 'NONE'))
    )
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    return {
      objectId: schema.object.id,
      recordId,
      ownerId:
        access.readScope === 'OWN' || (write && access.updateScope === 'OWN')
          ? c.memberId
          : undefined,
    };
  }
  async list(c: TenantContext, code: string, r: string) {
    return this.repository.list(c, await this.scope(c, code, r));
  }
  async upload(
    c: TenantContext,
    code: string,
    r: string,
    file: { originalname: string; buffer: Buffer } | undefined,
    meta: AttachmentMeta,
  ) {
    const scope = await this.scope(c, code, r, true);
    if (!file)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '请选择附件。',
      });
    const name = attachmentFilename(file.originalname);
    validateAttachment(name, file.buffer);
    return this.repository.create(c, scope, name, file.buffer, meta);
  }
  async download(c: TenantContext, code: string, r: string, id: string) {
    return this.repository.download(c, await this.scope(c, code, r), id);
  }
  async remove(
    c: TenantContext,
    code: string,
    r: string,
    id: string,
    meta: AttachmentMeta,
  ) {
    return this.repository.remove(
      c,
      await this.scope(c, code, r, true),
      id,
      meta,
    );
  }
}
