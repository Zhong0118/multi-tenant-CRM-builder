import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TELEPHONY_MODES = ['MOCK', 'KUAIMA'] as const;
export const CALL_STATUSES = [
  'REQUESTED',
  'ACCEPTED',
  'UNKNOWN',
  'CONNECTED',
  'NOT_CONNECTED',
  'ENDED',
  'FAILED',
] as const;
export class TelephonyPhoneFieldsDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) objectCode!: string;
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  fieldKeys!: string[];
}
export class UpdateTelephonySettingsDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional({ enum: TELEPHONY_MODES })
  @IsOptional()
  @IsIn(TELEPHONY_MODES)
  mode?: 'MOCK' | 'KUAIMA';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyId?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  appSecret?: string;
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  callbackToken?: string;
  @ApiPropertyOptional({ type: [TelephonyPhoneFieldsDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TelephonyPhoneFieldsDto)
  phoneFields?: TelephonyPhoneFieldsDto[];
}
export class TelephonySettingsResponseDto {
  @ApiProperty() version!: number;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() companyId!: string;
  @ApiProperty() hasAppSecret!: boolean;
  @ApiProperty() hasCallbackToken!: boolean;
  @ApiProperty({ type: [TelephonyPhoneFieldsDto] })
  phoneFields!: TelephonyPhoneFieldsDto[];
}
export class UpdateTelephonyBindingDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsString() @MaxLength(100) seatId!: string;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
}
export class TelephonyBindingResponseDto {
  @ApiProperty() memberId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() seatId!: string;
  @ApiProperty() phone!: string;
}
export class TelephonyBindingsResponseDto {
  @ApiProperty({ type: [TelephonyBindingResponseDto] })
  members!: TelephonyBindingResponseDto[];
}
export class TelephonyRuntimeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  objectCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() recordId?: string;
}
export class TelephonyRuntimeFieldDto {
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
}
export class TelephonyRuntimeResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() available!: boolean;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, nullable: true }) callerPhone!: string | null;
  @ApiProperty() liveEnabled!: boolean;
  @ApiProperty({ type: [TelephonyRuntimeFieldDto] })
  fields!: TelephonyRuntimeFieldDto[];
}
export class CreateTelephonyCallDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() requestId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) objectCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recordId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) fieldKey!: string;
}
export class TelephonyCallQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  objectCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() recordId?: string;
  @ApiPropertyOptional({ enum: CALL_STATUSES })
  @IsOptional()
  @IsIn(CALL_STATUSES)
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() memberId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
}
export class TelephonyCallResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() requestId!: string;
  @ApiProperty() actorMemberId!: string;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty({ enum: CALL_STATUSES }) status!: string;
  @ApiProperty() callerPhone!: string;
  @ApiProperty({ type: String, nullable: true }) calleePhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) objectCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordId!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) fieldKey!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordingUrl!: string | null;
  @ApiProperty({ type: Number, nullable: true }) durationSeconds!:
    number | null;
  @ApiProperty({ type: String, nullable: true }) beganAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) endedAt!: string | null;
  @ApiProperty() createdAt!: string;
}
export class TelephonyCallPageResponseDto {
  @ApiProperty({ type: [TelephonyCallResponseDto] })
  items!: TelephonyCallResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
// Header authentication is a proposed local integration contract, pending supplier agreement.
export class TelephonyHookDto {
  @ApiProperty({ enum: [1, 2] })
  @Type(() => Number)
  @IsIn([1, 2])
  push_type!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) bind_id!: string;
  @ApiProperty({
    oneOf: [
      { type: 'string', minLength: 1, maxLength: 100 },
      { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    ],
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  seats_id!: string;
  @ApiProperty() @IsString() @MaxLength(20) telA!: string;
  @ApiProperty() @IsString() @MaxLength(20) telB!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telX?: string;
  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', enum: ['1', '0', 'End'] },
      { type: 'integer', enum: [1, 0] },
    ],
  })
  @IsOptional()
  @Type(() => String)
  @IsIn(['1', '0', 'End'])
  status?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  begin_time?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  end_time?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(604800)
  duration?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  audio_url?: string;
}
export class TelephonyHookResponseDto {
  @ApiProperty({ enum: [0] }) code!: number;
}
