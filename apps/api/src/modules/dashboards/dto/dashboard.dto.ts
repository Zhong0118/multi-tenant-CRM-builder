import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
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
  @ApiProperty({ minimum: 1 }) draftVersion!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  draftConfiguration!: object;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  activePublicationId!: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  sourceTemplateVersionId!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DashboardPublicationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ minimum: 1 }) number!: number;
  @ApiProperty({ minimum: 1 }) sourceDraftVersion!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
}

export class DashboardConfigurationEnvelopeDto {
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

export class DashboardPeriodDto {
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  from!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  to!: string;

  @ApiProperty()
  @IsString()
  timezone!: string;
}

export class PreviewDashboardDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: DashboardPeriodDto })
  @ValidateNested()
  @Type(() => DashboardPeriodDto)
  period!: DashboardPeriodDto;
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
}

export class DashboardMetricWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['METRIC'] }) type!: 'METRIC';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
}

export class DashboardDistributionWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['STATUS_DISTRIBUTION'] })
  type!: 'STATUS_DISTRIBUTION';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
}

export class DashboardTrendWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['TREND'] }) type!: 'TREND';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
}

export class DashboardLeaderboardWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['LEADERBOARD'] }) type!: 'LEADERBOARD';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
}

export class DashboardRecordListWidgetDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['RECORD_LIST'] }) type!: 'RECORD_LIST';
  @ApiProperty() title!: string;
  @ApiPropertyOptional() description?: string;
  @ApiProperty({ enum: ['QUARTER', 'HALF', 'FULL'] }) width!: string;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ enum: ['READY'] }) state!: 'READY';
  @ApiProperty({ type: 'object', additionalProperties: true }) data!: object;
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

@ApiExtraModels(...dashboardWidgetSchemas)
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

  @ApiPropertyOptional({ type: DashboardPublicationSummaryDto })
  publication?: DashboardPublicationSummaryDto;
}
