import { Type } from 'class-transformer';
import type { PoolOrigin, PoolQuality } from '../record-ownership';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsArray,
  IsObject,
  IsString,
  MaxLength,
  ValidateNested,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class PoolLabelsDto {
  @ApiPropertyOptional() leadPool?: string;
  @ApiPropertyOptional() customerPool?: string;
  @ApiPropertyOptional() pending?: string;
  @ApiPropertyOptional() following?: string;
  @ApiPropertyOptional() protected?: string;
}
export class PoolProtectionRuleDto {
  @ApiProperty() @IsString() sourceObjectCode!: string;
  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @IsString({ each: true })
  statusKeys!: string[];
}
export class PoolPreviewDto {
  @ApiProperty() legacyUnassigned!: number;
  @ApiProperty() legacyPool!: number;
  @ApiProperty() legacyOwned!: number;
  @ApiProperty() expiredCount!: number;
}
export class PoolPermissionsDto {
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canUpdate!: boolean;
  @ApiProperty({ enum: ['ALL', 'OWN', 'GROUP', 'NONE'] }) readScope!:
    'ALL' | 'OWN' | 'GROUP' | 'NONE';
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] }) updateScope!:
    'ALL' | 'OWN' | 'NONE';
}
export class PoolProtectionStateDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
}
export class PoolProtectionSourceDto {
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty({ type: PoolProtectionStateDto, isArray: true })
  states!: PoolProtectionStateDto[];
}
export class RecordPoolConfigResponseDto {
  @ApiPropertyOptional() lifecycleEnabled?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 8760, default: 24 })
  contactTtlHours?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 8760, default: 720 })
  followUpTtlHours?: number;
  @ApiPropertyOptional({ type: PoolLabelsDto }) labels?: PoolLabelsDto;
  @ApiPropertyOptional({ type: PoolProtectionRuleDto, isArray: true })
  protectionRules?: PoolProtectionRuleDto[];
  @ApiPropertyOptional({ format: 'date-time' }) serverTime?: string;
  @ApiPropertyOptional({ type: PoolPreviewDto }) preview?: PoolPreviewDto;
  @ApiPropertyOptional({ type: PoolPermissionsDto })
  permissions?: PoolPermissionsDto;
  @ApiPropertyOptional({ type: PoolProtectionSourceDto, isArray: true })
  protectionSources?: PoolProtectionSourceDto[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 8760 })
  ownershipTtlHours!: number | null;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class UpdateRecordPoolConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() lifecycleEnabled?: boolean;
  @ApiPropertyOptional({ minimum: 1, maximum: 8760 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  contactTtlHours?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 8760 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  followUpTtlHours?: number;
  @ApiPropertyOptional({ type: PoolLabelsDto })
  @IsOptional()
  @IsObject()
  labels?: PoolLabelsDto;
  @ApiPropertyOptional({ type: PoolProtectionRuleDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoolProtectionRuleDto)
  protectionRules?: PoolProtectionRuleDto[];
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 8760 })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(8760)
  ownershipTtlHours!: number | null;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class RecordOwnershipDto {
  @ApiProperty({
    enum: [
      'CLAIM',
      'RELEASE',
      'ASSIGN',
      'CONFIRM_CONTACT',
      'UNPROTECT_RELEASE',
    ],
  })
  @IsIn(['CLAIM', 'RELEASE', 'ASSIGN', 'CONFIRM_CONTACT', 'UNPROTECT_RELEASE'])
  action!:
    'CLAIM' | 'RELEASE' | 'ASSIGN' | 'CONFIRM_CONTACT' | 'UNPROTECT_RELEASE';
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
  @ApiPropertyOptional({ enum: ['INVALID', 'DUPLICATE', 'LOST'] })
  @IsOptional()
  @IsIn(['INVALID', 'DUPLICATE', 'LOST'])
  quality?: PoolQuality;
  @ApiPropertyOptional({ enum: ['LEAD_POOL', 'CUSTOMER_POOL'] })
  @IsOptional()
  @IsIn(['LEAD_POOL', 'CUSTOMER_POOL'])
  poolStage?: PoolOrigin;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string;
}
export class RecordOwnershipResponseDto {
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}
