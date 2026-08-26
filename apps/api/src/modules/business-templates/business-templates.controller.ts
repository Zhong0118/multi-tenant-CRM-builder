import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
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

import { CurrentSession } from '../../common/auth/current-user.decorator';
import { PlatformAdminGuard } from '../../common/auth/platform-admin.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import type { SessionPrincipal } from '../auth/session.service';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import { BusinessTemplatesService } from './business-templates.service';
import {
  BusinessTemplateDetailResponseDto,
  BusinessTemplatePageQueryDto,
  BusinessTemplatePageResponseDto,
  BusinessTemplateVersionResponseDto,
  CreateBusinessTemplateDto,
  ExpectedTemplateVersionDto,
  SaveBusinessTemplateDraftDto,
  TemplatePublicationAnalysisResponseDto,
} from './dto';

interface RequestWithId extends Request {
  requestId?: string;
}

@UseGuards(SessionAuthGuard, PlatformAdminGuard)
@ApiTags('platform-business-templates')
@ApiCookieAuth('crm_session')
@Controller('platform/business-templates')
export class BusinessTemplatesController {
  constructor(private readonly templates: BusinessTemplatesService) {}

  @Get()
  @ApiOkResponse({ type: BusinessTemplatePageResponseDto })
  list(
    @CurrentSession() current: SessionPrincipal,
    @Query() query: BusinessTemplatePageQueryDto,
  ) {
    return this.templates.list(current.user, query);
  }

  @Post()
  @ApiCreatedResponse({ type: BusinessTemplateDetailResponseDto })
  create(
    @CurrentSession() current: SessionPrincipal,
    @Body() dto: CreateBusinessTemplateDto,
    @Req() request: RequestWithId,
  ) {
    return this.templates.create(current.user, dto, requestMeta(request));
  }

  @Get(':templateId')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOkResponse({ type: BusinessTemplateDetailResponseDto })
  detail(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
  ) {
    return this.templates.detail(current.user, templateId);
  }

  @Put(':templateId/draft')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOkResponse({ type: BusinessTemplateDetailResponseDto })
  saveDraft(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: SaveBusinessTemplateDraftDto,
    @Req() request: RequestWithId,
  ) {
    return this.templates.saveDraft(
      current.user,
      templateId,
      {
        ...dto,
        configuration: jsonConfiguration(dto.configuration),
      },
      requestMeta(request),
    );
  }

  @Post(':templateId/publication-analysis')
  @HttpCode(200)
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOkResponse({ type: TemplatePublicationAnalysisResponseDto })
  analyzePublication(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: ExpectedTemplateVersionDto,
  ) {
    return this.templates.analyzePublication(
      current.user,
      templateId,
      dto.expectedVersion,
    );
  }

  @Post(':templateId/versions')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiCreatedResponse({ type: BusinessTemplateVersionResponseDto })
  publish(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
    @Body() dto: ExpectedTemplateVersionDto,
    @Req() request: RequestWithId,
  ) {
    return this.templates.publish(
      current.user,
      templateId,
      dto.expectedVersion,
      requestMeta(request),
    );
  }

  @Get(':templateId/versions')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOkResponse({ type: BusinessTemplateVersionResponseDto, isArray: true })
  versions(
    @CurrentSession() current: SessionPrincipal,
    @Param('templateId', new ParseUUIDPipe()) templateId: string,
  ) {
    return this.templates.listVersions(current.user, templateId);
  }
}

function requestMeta(request: RequestWithId) {
  return { requestId: request.requestId ?? 'req_unknown', ip: request.ip };
}

function jsonConfiguration(value: object): BusinessTemplateConfiguration {
  return JSON.parse(JSON.stringify(value)) as BusinessTemplateConfiguration;
}
