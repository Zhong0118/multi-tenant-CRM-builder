import {
  Body,
  Controller,
  Get,
  HttpCode,
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
  ObjectDraftResponseDto,
  ObjectOrderDto,
  ObjectPublicationResponseDto,
  PublicationAnalysisResponseDto,
  PublishedObjectSchemaResponseDto,
  RuntimeObjectNavigationResponseDto,
  UpdateFieldDefinitionDto,
  UpdateObjectDefinitionDto,
} from './dto';
import {
  toObjectDraftResponse,
  toObjectPublicationResponse,
} from './object-draft.presenter';
import type { JsonValue } from './object-schema';
import { ObjectsService } from './objects.service';
import { PublishedObjectService } from './published-object.service';

interface RequestWithId extends Request {
  requestId?: string;
}

@Controller('workspaces/:tenantCode')
@ApiTags('object-definitions')
@ApiCookieAuth('crm_session')
@ApiParam({ name: 'tenantCode', type: String })
@UseGuards(SessionAuthGuard, WorkspaceGuard)
export class ObjectsController {
  constructor(
    private readonly objects: ObjectsService,
    private readonly publishedObjects: PublishedObjectService,
  ) {}

  @Get('objects')
  @ApiOkResponse({ type: RuntimeObjectNavigationResponseDto, isArray: true })
  runtimeObjects(@CurrentTenant() context: TenantContext) {
    return this.publishedObjects.listAccessible(context);
  }

  @Get('objects/:objectCode/schema')
  @ApiParam({ name: 'objectCode' })
  @ApiOkResponse({ type: PublishedObjectSchemaResponseDto })
  async runtimeSchema(
    @CurrentTenant() context: TenantContext,
    @Param('objectCode') objectCode: string,
  ) {
    const resolved = await this.publishedObjects.resolveRuntimeSchema(
      context,
      objectCode,
    );
    return resolved.visibleSchema;
  }

  @Get('object-definitions')
  @ApiOkResponse({ type: ObjectDraftResponseDto, isArray: true })
  async list(@CurrentTenant() context: TenantContext) {
    const drafts = await this.objects.list(context);
    return drafts.map(toObjectDraftResponse);
  }

  @Post('object-definitions')
  @ApiCreatedResponse({ type: ObjectDraftResponseDto })
  async create(
    @CurrentTenant() context: TenantContext,
    @Body() dto: CreateObjectDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.create(context, dto, requestMeta(request)),
    );
  }

  @Put('object-definitions/order')
  @ApiOkResponse({ type: ObjectDraftResponseDto, isArray: true })
  async reorderObjects(
    @CurrentTenant() context: TenantContext,
    @Body() dto: ObjectOrderDto,
    @Req() request: RequestWithId,
  ) {
    const drafts = await this.objects.reorderObjects(
      context,
      dto,
      requestMeta(request),
    );
    return drafts.map(toObjectDraftResponse);
  }

  @Get('object-definitions/:objectId')
  @ApiParam({ name: 'objectId', format: 'uuid' })
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async detail(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
  ) {
    return toObjectDraftResponse(await this.objects.detail(context, objectId));
  }

  @Patch('object-definitions/:objectId')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async update(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: UpdateObjectDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.update(context, objectId, dto, requestMeta(request)),
    );
  }

  @Post('object-definitions/:objectId/fields')
  @ApiCreatedResponse({ type: ObjectDraftResponseDto })
  async createField(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: CreateFieldDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.createField(
        context,
        objectId,
        {
          ...dto,
          validation: toJsonRecord(dto.validation),
          config: toJsonRecord(dto.config),
        },
        requestMeta(request),
      ),
    );
  }

  @Patch('object-definitions/:objectId/fields/:fieldId')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async updateField(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Param('fieldId') fieldId: string,
    @Body() dto: UpdateFieldDefinitionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.updateField(
        context,
        objectId,
        fieldId,
        {
          ...dto,
          validation: dto.validation ? toJsonRecord(dto.validation) : undefined,
          config: dto.config ? toJsonRecord(dto.config) : undefined,
        },
        requestMeta(request),
      ),
    );
  }

  @Put('object-definitions/:objectId/field-order')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async reorderFields(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: FieldOrderDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.reorderFields(
        context,
        objectId,
        dto,
        requestMeta(request),
      ),
    );
  }

  @Put('object-definitions/:objectId/default-view')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async updateDefaultView(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: DefaultViewDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.updateDefaultView(
        context,
        objectId,
        dto,
        requestMeta(request),
      ),
    );
  }

  @Put('object-definitions/:objectId/permissions')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async updatePermissions(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: EmployeePermissionsDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.updatePermissions(
        context,
        objectId,
        dto,
        requestMeta(request),
      ),
    );
  }

  @Post('object-definitions/:objectId/publication-analysis')
  @HttpCode(200)
  @ApiOkResponse({ type: PublicationAnalysisResponseDto })
  analyzePublication(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
  ) {
    return this.objects.analyzePublication(context, objectId, dto);
  }

  @Post('object-definitions/:objectId/publications')
  @ApiCreatedResponse({ type: ObjectPublicationResponseDto })
  async publish(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectPublicationResponse(
      await this.objects.publish(context, objectId, dto, requestMeta(request)),
    );
  }

  @Get('object-definitions/:objectId/publications')
  @ApiOkResponse({ type: ObjectPublicationResponseDto, isArray: true })
  async publications(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
  ) {
    const publications = await this.objects.listPublications(context, objectId);
    return publications.map(toObjectPublicationResponse);
  }

  @Post('object-definitions/:objectId/archive')
  @ApiOkResponse({ type: ObjectDraftResponseDto })
  async archive(
    @CurrentTenant() context: TenantContext,
    @Param('objectId') objectId: string,
    @Body() dto: ExpectedVersionDto,
    @Req() request: RequestWithId,
  ) {
    return toObjectDraftResponse(
      await this.objects.archive(context, objectId, dto, requestMeta(request)),
    );
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

function toJsonRecord(value: object): Record<string, JsonValue> {
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}
