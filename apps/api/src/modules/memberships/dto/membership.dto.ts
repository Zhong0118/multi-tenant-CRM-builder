import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsObject,
  ValidateNested,
  IsIn,
  Length,
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
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE'])
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
}

export class ChangeMemberNameDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 100)
  displayName!: string;
}

export class ChangeMemberStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

export class MemberObjectAccessDto {
  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: {
      type: 'string',
      enum: ['EDIT', 'READ_ONLY', 'HIDDEN'],
    },
  })
  @IsOptional()
  @IsObject()
  groupFieldAccess?: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'> | null;

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

  @ApiPropertyOptional({ enum: ['ALL', 'OWN', 'NONE', 'GROUP'] })
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsIn(['ALL', 'OWN', 'NONE', 'GROUP'])
  readScope?: 'ALL' | 'OWN' | 'NONE' | 'GROUP';

  @ApiPropertyOptional({ enum: ['ALL', 'OWN', 'NONE'] })
  @ValidateIf((value: MemberObjectAccessDto) => value.mode === 'OVERRIDE')
  @IsIn(['ALL', 'OWN', 'NONE'])
  updateScope?: 'ALL' | 'OWN' | 'NONE';
}

export class MemberFieldAccessChangeDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fieldId!: string;

  @ApiProperty({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN', 'INHERIT'] })
  @IsIn(['EDIT', 'READ_ONLY', 'HIDDEN', 'INHERIT'])
  access!: 'EDIT' | 'READ_ONLY' | 'HIDDEN' | 'INHERIT';
}

export class BulkMemberAccessDto {
  @ApiProperty({
    type: String,
    isArray: true,
    format: 'uuid',
    minItems: 1,
    maxItems: 100,
    uniqueItems: true,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  memberIds!: string[];

  @ApiPropertyOptional({ type: MemberObjectAccessDto })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @ValidateNested()
  @Type(() => MemberObjectAccessDto)
  objectAccess?: MemberObjectAccessDto;

  @ApiPropertyOptional({ type: MemberFieldAccessChangeDto, isArray: true })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsArray()
  @ArrayUnique((field: MemberFieldAccessChangeDto) => field?.fieldId)
  @ValidateNested({ each: true })
  @Type(() => MemberFieldAccessChangeDto)
  fields?: MemberFieldAccessChangeDto[];
}

export class BulkMemberAccessResponseDto {
  @ApiProperty({ minimum: 1, maximum: 100 }) updated!: number;
}

export class MemberFieldAccessResponseDto {
  @ApiPropertyOptional({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] })
  groupEffective?: 'EDIT' | 'READ_ONLY' | 'HIDDEN';
  @ApiProperty({ format: 'uuid' }) fieldId!: string;
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] }) inherited!:
    'EDIT' | 'READ_ONLY' | 'HIDDEN';
  @ApiProperty({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] }) effective!:
    'EDIT' | 'READ_ONLY' | 'HIDDEN';
  @ApiProperty({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN'], nullable: true })
  override!: 'EDIT' | 'READ_ONLY' | 'HIDDEN' | null;
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
  @ApiPropertyOptional({ description: '小组 ID，NONE 表示未分组' })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== 'NONE',
  )
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description: '按成员展示姓名或手机号搜索',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(0, 100)
  q?: string;

  @ApiPropertyOptional({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  @IsOptional()
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE'])
  role?: 'TENANT_ADMIN' | 'EMPLOYEE';

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

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
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  groupId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) groupName?:
    string | null;
  @ApiPropertyOptional() isGroupLeader?: boolean;

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
  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: {
      type: 'string',
      enum: ['EDIT', 'READ_ONLY', 'HIDDEN'],
    },
  })
  @IsOptional()
  @IsObject()
  groupFieldAccess?: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'> | null;

  @ApiProperty() canCreate!: boolean;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canUpdate!: boolean;
  @ApiProperty({ enum: [false] }) canDelete!: false;
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE', 'GROUP'] })
  readScope!: 'ALL' | 'OWN' | 'NONE' | 'GROUP';
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  updateScope!: 'ALL' | 'OWN' | 'NONE';
}

export class MemberObjectAccessResponseDto {
  @ApiPropertyOptional() titleFieldKey?: string;
  @ApiProperty({ type: MemberFieldAccessResponseDto, isArray: true })
  fields!: MemberFieldAccessResponseDto[];
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
  @ApiPropertyOptional() displayName?: string;
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
