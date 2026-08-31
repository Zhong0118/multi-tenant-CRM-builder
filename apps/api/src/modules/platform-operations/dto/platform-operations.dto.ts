import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
