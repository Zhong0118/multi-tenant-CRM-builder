import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
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
}
