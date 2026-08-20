import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PersonalInvitationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ example: '+8613800138000' }) targetPhone!: string;
  @ApiPropertyOptional({ format: 'uuid' }) targetUserId?: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({
    enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'],
  })
  status!: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'REVOKED' | 'EXPIRED';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiPropertyOptional({ format: 'uuid' }) acceptedByUserId?: string;
  @ApiPropertyOptional() tenantName?: string;
  @ApiPropertyOptional() tenantCode?: string;
}

export class InvitationMembershipResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] })
  role!: 'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  status!: 'ACTIVE' | 'DISABLED';
}

export class InvitationActionResponseDto {
  @ApiProperty({ example: true }) accepted!: true;
}
