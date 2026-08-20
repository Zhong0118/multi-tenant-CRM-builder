import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
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

export class InvitationPageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
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

export class TenantInvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: '+8613800138000' }) targetPhone!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
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
