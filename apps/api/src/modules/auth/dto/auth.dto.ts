import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
  Max,
  Min,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export const STRONG_PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d)[\s\S]*$/;
export const PASSWORD_LENGTH_PATTERN = /^[\s\S]{10,72}$/u;

export class VerificationChallengeDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ enum: ['REGISTER', 'RESET_PASSWORD'] })
  @IsIn(['REGISTER', 'RESET_PASSWORD'])
  purpose!: 'REGISTER' | 'RESET_PASSWORD';

  @ApiProperty({ description: '浏览器生成并持久化的非敏感设备标识' })
  @IsString()
  @Length(8, 200)
  deviceKey!: string;
}

export class RegisterDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ minLength: 6, maxLength: 6, example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  displayName!: string;
  @ApiProperty({
    minLength: 10,
    maxLength: 72,
    format: 'password',
    pattern: STRONG_PASSWORD_PATTERN.source,
  })
  @IsString()
  @Matches(PASSWORD_LENGTH_PATTERN)
  @Matches(STRONG_PASSWORD_PATTERN)
  password!: string;
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  deviceSummary!: string;
}

export class LoginDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ maxLength: 200, format: 'password' })
  @IsString()
  @MaxLength(200)
  password!: string;
  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @Length(8, 200)
  deviceKey!: string;
  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  deviceSummary!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ minLength: 8, maxLength: 200 })
  @IsString()
  @Length(8, 200)
  deviceKey!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
  @ApiProperty({ minLength: 6, maxLength: 6, example: '123456' })
  @IsString()
  @Length(6, 6)
  code!: string;
  @ApiProperty({
    minLength: 10,
    maxLength: 72,
    format: 'password',
    pattern: STRONG_PASSWORD_PATTERN.source,
  })
  @IsString()
  @Matches(PASSWORD_LENGTH_PATTERN)
  @Matches(STRONG_PASSWORD_PATTERN)
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ maxLength: 200, format: 'password' })
  @IsString()
  @MaxLength(200)
  currentPassword!: string;
  @ApiProperty({
    minLength: 10,
    maxLength: 72,
    format: 'password',
    pattern: STRONG_PASSWORD_PATTERN.source,
  })
  @IsString()
  @Matches(PASSWORD_LENGTH_PATTERN)
  @Matches(STRONG_PASSWORD_PATTERN)
  newPassword!: string;
}

export class AcceptedResponseDto {
  @ApiProperty({ example: true }) accepted!: true;
}

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ example: '+8613800138000' }) phone!: string;
  @ApiProperty() isPlatformAdmin!: boolean;
}

export class AuthenticatedResponseDto {
  @ApiProperty({ example: true }) accepted!: true;
  @ApiProperty({ type: UserResponseDto }) user!: UserResponseDto;
}

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  lastUsedAt?: Date;
  @ApiPropertyOptional() deviceSummary?: string;
  @ApiPropertyOptional() ipSummary?: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) revokedAt?: Date;
}

export class SessionPageQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'HISTORY'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'HISTORY'])
  kind: 'ACTIVE' | 'HISTORY' = 'ACTIVE';

  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class SessionPageResponseDto {
  @ApiProperty({ type: SessionResponseDto, isArray: true })
  items!: SessionResponseDto[];
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
}
