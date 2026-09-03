import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';

export class DashboardConfigurationIssueDto {
  @ApiProperty() code!: string;
  @ApiProperty() path!: string;
  @ApiProperty() message!: string;
}

export class DashboardDraftDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: 'ACTIVE' | 'ARCHIVED';
  @ApiProperty({ enum: ['ALL', 'TENANT_ADMIN', 'EMPLOYEE'] })
  audience!: 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ minimum: 1 }) draftVersion!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  draftConfiguration!: object;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  activePublicationId!: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  sourceTemplateVersionId!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DashboardListItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] }) status!: 'ACTIVE' | 'ARCHIVED';
  @ApiProperty({ enum: ['ALL', 'TENANT_ADMIN', 'EMPLOYEE'] })
  audience!: 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty() sortOrder!: number;
  @ApiProperty() hasPublishedVersion!: boolean;
  @ApiProperty() isDefaultAdmin!: boolean;
  @ApiProperty() isDefaultEmployee!: boolean;
}

export class DashboardDefaultsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  adminDashboardCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  employeeDashboardCode?: string;
}

export class CreateDashboardDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ enum: ['ALL', 'TENANT_ADMIN', 'EMPLOYEE'] })
  @IsOptional()
  @IsIn(['ALL', 'TENANT_ADMIN', 'EMPLOYEE'])
  audience?: 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  copyFrom?: string;
}

export class UpdateDashboardDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ['ALL', 'TENANT_ADMIN', 'EMPLOYEE'] })
  @IsOptional()
  @IsIn(['ALL', 'TENANT_ADMIN', 'EMPLOYEE'])
  audience?: 'ALL' | 'TENANT_ADMIN' | 'EMPLOYEE';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class DashboardOrderDto {
  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, { each: true })
  dashboardCodes!: string[];
}

export class DashboardPublicationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) number!: number;
  @ApiProperty({ minimum: 1 }) sourceDraftVersion!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
}

export class DashboardConfigurationEnvelopeDto {
  @ApiProperty() timezone!: string;

  @ApiProperty({ type: DashboardListItemDto, isArray: true })
  dashboards!: DashboardListItemDto[];

  @ApiPropertyOptional({ type: DashboardListItemDto, nullable: true })
  dashboard!: DashboardListItemDto | null;

  @ApiPropertyOptional({ type: DashboardDraftDto, nullable: true })
  draft!: DashboardDraftDto | null;

  @ApiPropertyOptional({ type: DashboardPublicationSummaryDto, nullable: true })
  activePublication!: DashboardPublicationSummaryDto | null;

  @ApiProperty({ type: 'object', additionalProperties: true, isArray: true })
  candidates!: object[];

  @ApiProperty({ type: DashboardConfigurationIssueDto, isArray: true })
  issues!: DashboardConfigurationIssueDto[];
}

export class SaveDashboardConfigurationDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  configuration!: object;
}

export class PublishDashboardDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class DashboardPeriodInputDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  to!: string;
}

export class DashboardPeriodDto {
  @ApiProperty({ format: 'date-time' })
  from!: string;

  @ApiProperty({ format: 'date-time' })
  to!: string;

  @ApiProperty()
  timezone!: string;
}

export class PreviewDashboardDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: DashboardPeriodInputDto })
  @ValidateNested()
  @Type(() => DashboardPeriodInputDto)
  period!: DashboardPeriodInputDto;
}

export class DashboardOverviewQueryDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 366, default: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  dashboardCode?: string;
}

export class DashboardMetricDataDto {
  @ApiProperty({ type: Number, nullable: true }) value!: number | null;
  @ApiPropertyOptional({ enum: ['NUMBER', 'MONEY', 'PERCENT'] })
  format?: 'NUMBER' | 'MONEY' | 'PERCENT';
}

export class DashboardDistributionPointDto {
  @ApiProperty() optionKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() color!: string;
  @ApiProperty() value!: number;
}

export class DashboardDistributionDataDto {
  @ApiProperty({ enum: ['FUNNEL', 'BAR', 'DONUT'] })
  display!: 'FUNNEL' | 'BAR' | 'DONUT';
  @ApiProperty({ type: DashboardDistributionPointDto, isArray: true })
  items!: DashboardDistributionPointDto[];
}

export class DashboardTrendPointDto {
  @ApiProperty() date!: string;
  @ApiProperty() value!: number;
}

export class DashboardTrendDataDto {
  @ApiProperty({ type: DashboardTrendPointDto, isArray: true })
  items!: DashboardTrendPointDto[];
}

export class DashboardLeaderboardRowDto {
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() value!: number;
}

export class DashboardLeaderboardDataDto {
  @ApiProperty({ type: DashboardLeaderboardRowDto, isArray: true })
  items!: DashboardLeaderboardRowDto[];
}

export class DashboardPublishedFieldDto {
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({
    enum: [
      'TEXT',
      'TEXTAREA',
      'PHONE',
      'EMAIL',
      'NUMBER',
      'MONEY',
      'DATE',
      'DATETIME',
      'SINGLE_SELECT',
      'MULTI_SELECT',
      'MEMBER',
      'BOOLEAN',
    ],
  })
  type!: string;
}

export class DashboardRecordListRowDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() recordNo!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  ownerMemberId!: string | null;
  @ApiProperty({ type: String, nullable: true }) ownerName!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  values!: Record<string, unknown>;
}

export class DashboardRecordListDataDto {
  @ApiProperty({ type: DashboardPublishedFieldDto, isArray: true })
  fields!: DashboardPublishedFieldDto[];
  @ApiProperty({ type: DashboardRecordListRowDto, isArray: true })
  items!: DashboardRecordListRowDto[];
}

export class DashboardMetricWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['METRIC'] }) type!: 'METRIC';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: DashboardMetricDataDto }) data!: DashboardMetricDataDto;
}

export class DashboardDistributionWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['STATUS_DISTRIBUTION'] })
  type!: 'STATUS_DISTRIBUTION';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: DashboardDistributionDataDto })
  data!: DashboardDistributionDataDto;
}

export class DashboardTrendWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['TREND'] }) type!: 'TREND';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: DashboardTrendDataDto }) data!: DashboardTrendDataDto;
}

export class DashboardLeaderboardWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['LEADERBOARD'] }) type!: 'LEADERBOARD';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: DashboardLeaderboardDataDto })
  data!: DashboardLeaderboardDataDto;
}

export class DashboardRecordListWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['RECORD_LIST'] }) type!: 'RECORD_LIST';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: DashboardRecordListDataDto })
  data!: DashboardRecordListDataDto;
}

export class DashboardUnavailableWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    enum: [
      'METRIC',
      'STATUS_DISTRIBUTION',
      'TREND',
      'LEADERBOARD',
      'RECORD_LIST',
    ],
  })
  type!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['UNAVAILABLE'] }) state!: 'UNAVAILABLE';
  @ApiPropertyOptional({
    enum: [
      'AUDIENCE_EXCLUDED',
      'OBJECT_UNAVAILABLE',
      'OBJECT_ACCESS_DENIED',
      'FIELD_HIDDEN',
      'QUERY_FAILED',
    ],
  })
  reason?: string;
}

const dashboardWidgetSchemas = [
  DashboardMetricWidgetDto,
  DashboardDistributionWidgetDto,
  DashboardTrendWidgetDto,
  DashboardLeaderboardWidgetDto,
  DashboardRecordListWidgetDto,
  DashboardUnavailableWidgetDto,
];

const dashboardWidgetDataSchemas = [
  DashboardMetricDataDto,
  DashboardDistributionPointDto,
  DashboardDistributionDataDto,
  DashboardTrendPointDto,
  DashboardTrendDataDto,
  DashboardLeaderboardRowDto,
  DashboardLeaderboardDataDto,
  DashboardPublishedFieldDto,
  DashboardRecordListRowDto,
  DashboardRecordListDataDto,
];

@ApiExtraModels(...dashboardWidgetSchemas, ...dashboardWidgetDataSchemas)
export class DashboardRuntimeDto {
  @ApiProperty() title!: string;
  @ApiProperty({ type: DashboardPeriodDto }) period!: DashboardPeriodDto;
  @ApiProperty({
    isArray: true,
    oneOf: dashboardWidgetSchemas.map((schema) => ({
      $ref: getSchemaPath(schema),
    })),
  })
  widgets!: object[];
}

export class DashboardOverviewDto extends DashboardRuntimeDto {
  @ApiProperty({ enum: ['READY', 'UNCONFIGURED'] })
  state!: 'READY' | 'UNCONFIGURED';

  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';

  @ApiPropertyOptional()
  dashboardCode?: string;

  @ApiProperty({ type: DashboardListItemDto, isArray: true })
  dashboards!: DashboardListItemDto[];

  @ApiPropertyOptional({ type: DashboardPublicationSummaryDto })
  publication?: DashboardPublicationSummaryDto;
}
