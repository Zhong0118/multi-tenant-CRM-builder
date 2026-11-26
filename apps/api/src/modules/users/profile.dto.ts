import { ApiProperty, PickType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import { RegisterDto, UserResponseDto } from '../auth/dto';

export class AccountNameDto extends PickType(RegisterDto, [
  'displayName',
] as const) {}
export class JobTitleDto {
  @ApiProperty({ maxLength: 50 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(50)
  jobTitle!: string;
}
export class AvatarResponseDto {
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
}
export class AccountProfileDto extends UserResponseDto {
  @ApiProperty({ type: String, nullable: true }) avatarUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) maskedEmail!: string | null;
  @ApiProperty({ enum: ['UNBOUND', 'UNVERIFIED', 'VERIFIED', 'UNDELIVERABLE'] })
  emailStatus!: string;
  @ApiProperty() mailAvailable!: boolean;
  @ApiProperty({ type: String, nullable: true }) jobTitle!: string | null;
}
export class AccountMembershipDto {
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty({ format: 'uuid' }) tenantId!: string;
  @ApiProperty() tenantCode!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] }) role!:
    'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ type: String, nullable: true }) memberDisplayName!:
    string | null;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: String, nullable: true }) jobTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) employeeNo!: string | null;
}
