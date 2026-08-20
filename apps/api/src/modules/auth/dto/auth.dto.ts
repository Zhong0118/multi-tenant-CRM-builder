import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @Length(6, 6) code!: string;
  @IsString() @Length(1, 100) displayName!: string;
  @IsString() @MinLength(8) @MaxLength(200) password!: string;
  @IsString() @MaxLength(300) deviceSummary!: string;
}

export class LoginDto {
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsString() @Length(8, 200) deviceKey!: string;
  @IsString() @MaxLength(300) deviceSummary!: string;
}

export class ForgotPasswordDto {
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @Length(8, 200) deviceKey!: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty() phone!: string;
  @IsString() @Length(6, 6) code!: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword!: string;
}

export class ChangePasswordDto {
  @IsString() @MaxLength(200) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(200) newPassword!: string;
}
