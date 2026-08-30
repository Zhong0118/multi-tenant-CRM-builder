import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardConfigurationRecordDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: 'object', additionalProperties: true })
  configuration!: object;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DashboardConfigurationIssueDto {
  @ApiProperty() code!: string;
  @ApiProperty() path!: string;
  @ApiProperty() message!: string;
}

export class DashboardConfigurationEnvelopeDto {
  @ApiPropertyOptional({
    type: DashboardConfigurationRecordDto,
    nullable: true,
  })
  record!: DashboardConfigurationRecordDto | null;

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

export class DashboardOverviewQueryDto {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 366, default: 31 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  days?: number;
}

export class DashboardPeriodDto {
  @ApiProperty({ format: 'date-time' }) from!: string;
  @ApiProperty({ format: 'date-time' }) to!: string;
  @ApiProperty() timezone!: string;
}

export class DashboardMetricDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ type: Number, nullable: true }) value!: number | null;
  @ApiProperty({ enum: ['COUNT', 'MONEY', 'PERCENT'] })
  format!: 'COUNT' | 'MONEY' | 'PERCENT';
}

export class DashboardPipelineItemDto {
  @ApiProperty() optionKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() color!: string;
  @ApiProperty() count!: number;
  @ApiProperty() amount!: number;
}

export class DashboardTrendItemDto {
  @ApiProperty() date!: string;
  @ApiProperty() wonCount!: number;
  @ApiProperty() wonAmount!: number;
}

export class DashboardAttentionItemDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() count!: number;
  @ApiProperty() href!: string;
}

export class DashboardLeaderboardItemDto {
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() wonCount!: number;
  @ApiProperty() wonAmount!: number;
  @ApiProperty() activeAmount!: number;
}

export class DashboardRecordItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  ownerMemberId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) ownerName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) stageKey!: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) amount!: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) dueAt!: string | null;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DashboardOverviewDto {
  @ApiProperty({
    enum: ['READY', 'UNCONFIGURED', 'NEEDS_REPAIR', 'UNAVAILABLE'],
  })
  state!: 'READY' | 'UNCONFIGURED' | 'NEEDS_REPAIR' | 'UNAVAILABLE';
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ type: DashboardPeriodDto }) period!: DashboardPeriodDto;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  configuration?: object;
  @ApiProperty({ type: DashboardConfigurationIssueDto, isArray: true })
  issues!: DashboardConfigurationIssueDto[];
  @ApiProperty({ type: DashboardMetricDto, isArray: true })
  metrics!: DashboardMetricDto[];
  @ApiProperty({ type: DashboardPipelineItemDto, isArray: true })
  pipeline!: DashboardPipelineItemDto[];
  @ApiProperty({ type: DashboardTrendItemDto, isArray: true })
  trend!: DashboardTrendItemDto[];
  @ApiProperty({ type: DashboardAttentionItemDto, isArray: true })
  attention!: DashboardAttentionItemDto[];
  @ApiProperty({ type: DashboardLeaderboardItemDto, isArray: true })
  leaderboard!: DashboardLeaderboardItemDto[];
  @ApiProperty({ type: DashboardRecordItemDto, isArray: true })
  records!: DashboardRecordItemDto[];
}
