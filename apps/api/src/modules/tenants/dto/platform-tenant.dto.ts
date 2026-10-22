import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePlatformTenantDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;
  @ApiProperty({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  code!: string;
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  firstAdminPhone!: string;

  @ApiPropertyOptional({
    enum: ['BLANK', 'TEMPLATE'],
    default: 'BLANK',
    description:
      'BLANK: the company admin builds tables from scratch. TEMPLATE: the chosen published template is copied in the same transaction as unpublished drafts.',
  })
  @IsOptional()
  @IsIn(['BLANK', 'TEMPLATE'])
  initialization?: 'BLANK' | 'TEMPLATE';

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf(
    (dto: CreatePlatformTenantDto) => dto.initialization === 'TEMPLATE',
  )
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The template version shown when choosing; must still be current.',
  })
  @ValidateIf(
    (dto: CreatePlatformTenantDto) => dto.initialization === 'TEMPLATE',
  )
  @IsUUID()
  templateVersionId?: string;
}

export class TenantInitializationResponseDto {
  @ApiProperty() templateName!: string;
  @ApiProperty() templateVersionNo!: number;
  @ApiProperty({ description: 'Business tables copied as unpublished drafts.' })
  objectCount!: number;
}

export class ChangeTenantStatusDto {
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] })
  @IsIn(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'])
  status!: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class TenantNameConflictQueryDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;
}

export class TenantNameConflictResponseDto {
  @ApiProperty() name!: string;
  @ApiProperty({ minimum: 0 }) count!: number;
}

export class PlatformTenantPageQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'])
  status?: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

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

export class FirstAdminInvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+8613800138000' }) targetPhone!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN'] }) role!: 'TENANT_ADMIN';
  @ApiProperty({
    enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'],
  })
  status!: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}

export class PlatformTenantResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] })
  status!: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  @ApiPropertyOptional() timezone?: string;
  @ApiPropertyOptional() locale?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  activatedAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) createdAt?: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) updatedAt?: Date;
  @ApiProperty({ minimum: 0 })
  @IsInt()
  activeAdminCount!: number;
  @ApiPropertyOptional({ type: FirstAdminInvitationResponseDto })
  firstAdminInvitation?: FirstAdminInvitationResponseDto;
  @ApiPropertyOptional({ type: TenantInitializationResponseDto })
  initialization?: TenantInitializationResponseDto;
}

export class PlatformTenantPageResponseDto {
  @ApiProperty({ type: PlatformTenantResponseDto, isArray: true })
  items!: PlatformTenantResponseDto[];
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}

export class PlatformTenantSummaryDto {
  @ApiProperty({ type: Number, minimum: 0 }) total!: number;
  @ApiProperty({ type: Number, minimum: 0 }) draft!: number;
  @ApiProperty({ type: Number, minimum: 0 }) active!: number;
  @ApiProperty({ type: Number, minimum: 0 }) suspended!: number;
  @ApiProperty({ type: Number, minimum: 0 }) closed!: number;
}

export class CorrectFirstAdminPhoneDto {
  @ApiProperty({ example: '13900139000' })
  @IsString()
  @IsNotEmpty()
  firstAdminPhone!: string;
}
