import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE'])
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
}

export class ChangeMemberStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

export class MemberObjectAccessDto {
  @ApiProperty({ enum: ['INHERIT', 'OVERRIDE'] })
  @IsIn(['INHERIT', 'OVERRIDE'])
  mode!: 'INHERIT' | 'OVERRIDE';

  @ApiPropertyOptional()
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsBoolean()
  canCreate?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsBoolean()
  canRead?: boolean;

  @ApiPropertyOptional()
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsBoolean()
  canUpdate?: boolean;

  @ApiPropertyOptional({ enum: ['ALL', 'OWN', 'NONE'] })
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsIn(['ALL', 'OWN', 'NONE'])
  readScope?: 'ALL' | 'OWN' | 'NONE';

  @ApiPropertyOptional({ enum: ['ALL', 'OWN', 'NONE'] })
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsIn(['ALL', 'OWN', 'NONE'])
  updateScope?: 'ALL' | 'OWN' | 'NONE';
}

export class InvitationPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class MemberPageQueryDto {
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

export class WorkspaceSummaryResponseDto {
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantCode!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED'] })
  tenantStatus!: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  memberStatus!: 'ACTIVE' | 'DISABLED';
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
}

export class TenantMemberResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';
  @ApiPropertyOptional() displayName?: string;
  @ApiPropertyOptional({ example: '+8613800138000' }) phone?: string;
}

export class TenantMemberPageResponseDto {
  @ApiProperty({ type: TenantMemberResponseDto, isArray: true })
  items!: TenantMemberResponseDto[];
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) activeAdminCount!: number;
}

export class MemberObjectPolicyResponseDto {
  @ApiProperty() canCreate!: boolean;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canUpdate!: boolean;
  @ApiProperty({ enum: [false] }) canDelete!: false;
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  readScope!: 'ALL' | 'OWN' | 'NONE';
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  updateScope!: 'ALL' | 'OWN' | 'NONE';
}

export class MemberObjectAccessResponseDto {
  @ApiProperty({ format: 'uuid' }) objectId!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty({ enum: ['INHERIT', 'OVERRIDE'] })
  mode!: 'INHERIT' | 'OVERRIDE';
  @ApiProperty({ type: MemberObjectPolicyResponseDto })
  inherited!: MemberObjectPolicyResponseDto;
  @ApiProperty({ type: MemberObjectPolicyResponseDto, nullable: true })
  override!: MemberObjectPolicyResponseDto | null;
  @ApiProperty({ type: MemberObjectPolicyResponseDto })
  effective!: MemberObjectPolicyResponseDto;
}

export class TenantInvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+8613800138000' }) targetPhone!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  targetUserId!: string | null;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({
    enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'],
  })
  status!: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class InvitationPageResponseDto {
  @ApiProperty({ type: TenantInvitationResponseDto, isArray: true })
  items!: TenantInvitationResponseDto[];
  @ApiPropertyOptional({ format: 'uuid' }) nextCursor?: string;
}

export class CreatedInvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['PENDING'] }) status!: 'PENDING';
}

export class InvitationResentResponseDto {
  @ApiProperty({ example: true }) accepted!: true;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
}

export class MembershipActionResponseDto {
  @ApiProperty({ example: true }) accepted!: true;
}

export class ChangeMemberRoleDto {
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE'])
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
}

export class MemberRecipientDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  recipientMemberId!: string;
}

export class OffboardingCountsResponseDto {
  @ApiProperty() records!: number;
  @ApiProperty() openTasks!: number;
}

export class OffboardingPreviewResponseDto extends OffboardingCountsResponseDto {
  @ApiProperty({ type: TenantMemberResponseDto, isArray: true })
  recipients!: TenantMemberResponseDto[];
}
