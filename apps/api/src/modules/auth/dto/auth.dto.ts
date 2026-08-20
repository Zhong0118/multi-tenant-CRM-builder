import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

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
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time' }) revokedAt?: Date;
}
