import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class PlatformPageQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PlatformAuditQueryDto extends PlatformPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resourceType?: string;
}

/** The platform audit list's own filters; company audit defines its own range. */
export class PlatformAuditFilterDto extends PlatformAuditQueryDto {
  @ApiPropertyOptional({ enum: ['USER', 'SYSTEM', 'INTEGRATION'] })
  @IsOptional()
  @IsIn(['USER', 'SYSTEM', 'INTEGRATION'])
  actorType?: 'USER' | 'SYSTEM' | 'INTEGRATION';

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day, inclusive, in Beijing time.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-22',
    description: 'Last day, inclusive, in Beijing time.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  to?: string;
}

export class PlatformAuditFacetQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class PlatformAuditFacetDto {
  @ApiProperty() value!: string;
  @ApiProperty() count!: number;
}

export class PlatformAuditFacetsDto {
  @ApiProperty({ type: PlatformAuditFacetDto, isArray: true })
  actions!: PlatformAuditFacetDto[];
  @ApiProperty({ type: PlatformAuditFacetDto, isArray: true })
  resourceTypes!: PlatformAuditFacetDto[];
}

export class PlatformAuditItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  tenantId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) tenantName!:
    string | null;
  @ApiProperty({ enum: ['USER', 'SYSTEM', 'INTEGRATION'] })
  actorType!: 'USER' | 'SYSTEM' | 'INTEGRATION';
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  actorId!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) actorName!:
    string | null;
  @ApiProperty() action!: string;
  @ApiProperty() resourceType!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  resourceId!: string | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  before!: object | null;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  after!: object | null;
  @ApiPropertyOptional({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty() requestId!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) ip!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: Date;
}

export class PlatformAuditPageDto {
  @ApiProperty({ type: PlatformAuditItemDto, isArray: true })
  items!: PlatformAuditItemDto[];
  @ApiProperty({ type: Number, minimum: 1 }) page!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class PlatformOperationItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['TEMPLATE_APPLICATION'] })
  kind!: 'TEMPLATE_APPLICATION';
  @ApiProperty({ enum: ['SUCCEEDED'] }) status!: 'SUCCEEDED';
  @ApiProperty({ format: 'uuid' }) templateId!: string;
  @ApiProperty() templateName!: string;
  @ApiProperty({ minimum: 1 }) templateVersionNo!: number;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty() tenantCode!: string;
  @ApiProperty({ format: 'uuid' }) appliedByUserId!: string;
  @ApiProperty() appliedByName!: string;
  @ApiProperty({ minimum: 0 }) objectCount!: number;
  @ApiProperty({ format: 'date-time' }) appliedAt!: Date;
}

export class PlatformOperationPageDto {
  @ApiProperty({ type: PlatformOperationItemDto, isArray: true })
  items!: PlatformOperationItemDto[];
  @ApiProperty({ type: Number, minimum: 1 }) page!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class RuntimeServiceStatusDto {
  @ApiProperty({ enum: ['database', 'redis', 'sms', 'webOrigin'] })
  key!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: ['READY', 'DEVELOPMENT', 'ACTION_REQUIRED'] })
  status!: string;
  @ApiProperty() detail!: string;
}

export class RuntimePoliciesDto {
  @ApiProperty() sessionTtlDays!: number;
  @ApiProperty() sessionHistoryRetentionDays!: number;
  @ApiProperty() verificationTtlMinutes!: number;
  @ApiProperty() verificationRetentionDays!: number;
}

export class RuntimeStatusDto {
  @ApiProperty() environment!: string;
  @ApiProperty({ type: RuntimeServiceStatusDto, isArray: true })
  services!: RuntimeServiceStatusDto[];
  @ApiProperty({ type: RuntimePoliciesDto }) policies!: RuntimePoliciesDto;
}
