import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
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
export const TELEPHONY_REASONS = [
  'NOT_ENABLED',
  'PLATFORM_NOT_READY',
  'MINUTES_EXHAUSTED',
  'MEMBER_NOT_CONFIGURED',
] as const;
export type TelephonyReason = (typeof TELEPHONY_REASONS)[number];
export const SEAT_STATUSES = ['NONE', 'READY', 'FAILED'] as const;
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
  @ApiProperty({ type: [TelephonyPhoneFieldsDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TelephonyPhoneFieldsDto)
  phoneFields!: TelephonyPhoneFieldsDto[];
}
export class TelephonyPlanSummaryDto {
  @ApiProperty() name!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
}
export class TelephonyUsageDto {
  /** First day of the company's month, YYYY-MM-DD. */
  @ApiProperty() month!: string;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  /** Plan minutes plus this month's added minutes. */
  @ApiProperty() allowance!: number;
  @ApiProperty() seatsEnabled!: number;
}
/** What a company administrator sees: never money or the platform account. */
export class TelephonySettingsResponseDto {
  @ApiProperty() version!: number;
  @ApiProperty({ type: [TelephonyPhoneFieldsDto] })
  phoneFields!: TelephonyPhoneFieldsDto[];
  @ApiProperty({ type: TelephonyPlanSummaryDto, nullable: true })
  plan!: TelephonyPlanSummaryDto | null;
  @ApiProperty({ type: TelephonyUsageDto }) usage!: TelephonyUsageDto;
  @ApiProperty() lineReady!: boolean;
}
export class UpdateTelephonyBindingDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty() @IsString() @MaxLength(20) phone!: string;
}
export class TelephonyBindingResponseDto {
  @ApiProperty() memberId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() phone!: string;
  @ApiProperty({ enum: SEAT_STATUSES }) seatStatus!:
    'NONE' | 'READY' | 'FAILED';
  /** The supplier's reason when creating or updating the seat failed. */
  @ApiProperty({ type: String, nullable: true }) seatError!: string | null;
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
  /** The company has a plan. */
  @ApiProperty() enabled!: boolean;
  /** The company has calls on record, so the call log stays reachable. */
  @ApiProperty() hasHistory!: boolean;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() available!: boolean;
  @ApiProperty({ enum: TELEPHONY_REASONS, nullable: true })
  reason!: TelephonyReason | null;
  @ApiProperty({ type: String, nullable: true }) callerPhone!: string | null;
  @ApiProperty() liveEnabled!: boolean;
  /** The member's call that has not finished yet, if any. */
  @ApiProperty({ type: String, nullable: true }) openCallId!: string | null;
  @ApiProperty({ type: [TelephonyRuntimeFieldDto] })
  fields!: TelephonyRuntimeFieldDto[];
}
export class TelephonyCallConfirmationDto {
  @ApiProperty({ enum: TELEPHONY_MODES })
  @IsIn(TELEPHONY_MODES)
  mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20) callerPhone!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20) calleePhone!: string;
}
export class CreateTelephonyCallDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() requestId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) objectCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recordId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) fieldKey!: string;
  @ApiProperty({ type: TelephonyCallConfirmationDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => TelephonyCallConfirmationDto)
  confirmation!: TelephonyCallConfirmationDto;
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
  @ApiProperty() actorName!: string;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty({ enum: CALL_STATUSES }) status!: string;
  @ApiProperty() callerPhone!: string;
  @ApiProperty({ type: String, nullable: true }) calleePhone!: string | null;
  @ApiProperty({ type: String, nullable: true }) objectCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordId!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) fieldKey!: string | null;
  @ApiProperty({ type: String, nullable: true }) recordingUrl!: string | null;
  /** The supplier's short refusal text when it rejected the dial. */
  @ApiProperty({ type: String, nullable: true }) failureReason!: string | null;
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
// 话单 / 录音 (push_type 1 / 2) and 挂断状态 (no push_type, status=End) share
// one URL. The credential is a Bearer header or the URL's `token` query.
export class TelephonyHookDto {
  @ApiPropertyOptional({ enum: [1, 2] })
  @IsOptional()
  @Type(() => Number)
  @IsIn([1, 2])
  push_type?: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) bind_id!: string;
  @ApiPropertyOptional({
    oneOf: [
      { type: 'string', minLength: 1, maxLength: 100 },
      { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    ],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? String(value)
      : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  seats_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telA?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) telB?: string;
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
  /** 挂断状态回调: when the call ended. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  time?: string;
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
