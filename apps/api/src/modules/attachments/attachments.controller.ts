import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiCookieAuth,
  ApiParam,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiConsumes,
  ApiBody,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AttachmentsService } from './attachments.service';
import { AttachmentDto } from './attachments.dto';
import { MAX_ATTACHMENT_BYTES } from './attachment-policy';
@Controller(
  'workspaces/:tenantCode/objects/:objectCode/records/:recordId/attachments',
)
@ApiTags('attachments')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@ApiParam({ name: 'objectCode', type: String })
@ApiParam({ name: 'recordId', format: 'uuid' })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}
  @Get()
  @ApiOkResponse({ type: AttachmentDto, isArray: true })
  list(
    @CurrentTenant() c: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) r: string,
  ) {
    return this.service.list(c, code, r);
  }
  @Post()
  @ApiCreatedResponse({ type: AttachmentDto })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0 },
    }),
  )
  upload(
    @CurrentTenant() c: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) r: string,
    @UploadedFile() file: { originalname: string; buffer: Buffer } | undefined,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.upload(c, code, r, file, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(
    @CurrentTenant() c: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const item = await this.service.download(c, code, r, id);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(item.filename)}`,
    );
    res.send(Buffer.from(item.content!));
  }
  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @HttpCode(204)
  @ApiNoContentResponse()
  remove(
    @CurrentTenant() c: TenantContext,
    @Param('objectCode') code: string,
    @Param('recordId', ParseUUIDPipe) r: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { requestId?: string },
  ) {
    return this.service.remove(c, code, r, id, {
      requestId: req.requestId ?? 'unknown',
      ip: req.ip,
    });
  }
}
