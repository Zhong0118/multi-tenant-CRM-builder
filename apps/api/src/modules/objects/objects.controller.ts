import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { CurrentTenant } from '../../common/tenancy/tenant-context.decorator';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { WorkspaceGuard } from '../../common/tenancy/workspace.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import {
  CreateFieldDefinitionDto,
  CreateObjectDefinitionDto,
  DefaultViewDto,
  EmployeePermissionsDto,
  ExpectedVersionDto,
  FieldOrderDto,
  ObjectOrderDto,
  UpdateFieldDefinitionDto,
  UpdateObjectDefinitionDto,
} from './dto';
import type { JsonValue } from './object-schema';
import { ObjectsService } from './objects.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller('workspaces/:tenantCode')
@ApiTags('object-definitions')
@ApiCookieAuth('crm_session')
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Get('object-definitions')
  @ApiParam({ name: 'tenantCode' })
  @ApiOkResponse({ description: '对象草稿列表' })
  list(@CurrentTenant() context: TenantContext) {
    return this.objects.list(context);
  }

  @Post('object-definitions')
  @ApiCreatedResponse({ description: '已创建对象草稿' })
  create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateObjectDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.create(context, dto, requestMeta(request));
  }

  @Put('object-definitions/order')
  @ApiOkResponse({ description: '已更新对象排序' })
  reorderObjects(
    @CurrentTenant() context: TenantContext,
    @Body() dto: ObjectOrderDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.reorderObjects(context, dto, requestMeta(request));
  }

  @Get('object-definitions/:objectId')
  @ApiParam({ name: 'objectId', format: 'uuid' })
  @ApiOkResponse({ description: '对象草稿详情' })
  detail(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
  ) {
    return this.objects.detail(context, objectId);
  }

  @Patch('object-definitions/:objectId')
  @ApiOkResponse({ description: '已更新对象草稿' })
  update(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: UpdateObjectDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.update(context, objectId, dto, requestMeta(request));
  }

  @Post('object-definitions/:objectId/fields')
  @ApiCreatedResponse({ description: '已创建字段' })
  createField(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: CreateFieldDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.createField(
      context,
      objectId,
      {
        ...dto,
        validation: toJsonRecord(dto.validation),
        config: toJsonRecord(dto.config),
      },
      requestMeta(request),
    );
  }

  @Patch('object-definitions/:objectId/fields/:fieldId')
  @ApiOkResponse({ description: '已更新字段' })
  updateField(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateFieldDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.updateField(
      context,
      objectId,
      fieldId,
      {
        ...dto,
        validation: dto.validation ? toJsonRecord(dto.validation) : undefined,
        config: dto.config ? toJsonRecord(dto.config) : undefined,
      },
      requestMeta(request),
    );
  }

  @Put('object-definitions/:objectId/field-order')
  @ApiOkResponse({ description: '已更新字段排序' })
  reorderFields(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: FieldOrderDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.reorderFields(
      context,
      objectId,
      dto,
      requestMeta(request),
    );
  }

  @Put('object-definitions/:objectId/default-view')
  @ApiOkResponse({ description: '已更新默认视图' })
  updateDefaultView(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: DefaultViewDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.updateDefaultView(
      context,
      objectId,
      dto,
      requestMeta(request),
    );
  }

  @Put('object-definitions/:objectId/permissions')
  @ApiOkResponse({ description: '已更新员工角色权限' })
  updatePermissions(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: EmployeePermissionsDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.updatePermissions(
      context,
      objectId,
      dto,
      requestMeta(request),
    );
  }

  @Post('object-definitions/:objectId/publication-analysis')
  @ApiOkResponse({ description: '发布前分析结果' })
  analyzePublication(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
  ) {
    return this.objects.analyzePublication(context, objectId, dto);
  }

  @Post('object-definitions/:objectId/publications')
  @ApiCreatedResponse({ description: '已发布对象配置快照' })
  publish(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.publish(context, objectId, dto, requestMeta(request));
  }

  @Get('object-definitions/:objectId/publications')
  @ApiOkResponse({ description: '对象发布历史' })
  publications(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
  ) {
    return this.objects.listPublications(context, objectId);
  }

  @Post('object-definitions/:objectId/archive')
  @ApiOkResponse({ description: '已归档对象' })
  archive(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
    @Req() request: RequestWithId,
  ) {
    return this.objects.archive(context, objectId, dto, requestMeta(request));
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

function toJsonRecord(value: object): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
