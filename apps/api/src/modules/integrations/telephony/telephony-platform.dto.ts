import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TELEPHONY_MODES } from './telephony.dto';

/** Money in yuan: up to 10 integer digits and 2 decimals. */
export const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
/** A per-minute rate in yuan: up to 6 integer digits and 4 decimals. */
export const RATE = /^\d{1,6}(\.\d{1,4})?$/;
const MONTH_START = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UpdatePlatformTelephonyDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ enum: TELEPHONY_MODES })
  @IsOptional()
  @IsIn(TELEPHONY_MODES)
  mode?: 'MOCK' | 'KUAIMA';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companyId?: string;
  /** Blank keeps the saved secret; it is never read back. */
  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  appSecret?: string;
  @ApiPropertyOptional({ example: '0.1500' })
  @IsOptional()
  @IsString()
  @Matches(RATE)
  costPerMinute?: string;
  @ApiPropertyOptional({ example: '10.00' })
  @IsOptional()
  @IsString()
  @Matches(MONEY)
  seatMonthlyCost?: string;
}
export class PlatformTelephonyResponseDto {
  @ApiProperty() version!: number;
  @ApiProperty({ enum: TELEPHONY_MODES }) mode!: 'MOCK' | 'KUAIMA';
  @ApiProperty() companyId!: string;
  @ApiProperty() hasAppSecret!: boolean;
  @ApiProperty() hasCallbackToken!: boolean;
  /** The callback URL without its credential, for display. */
  @ApiProperty() callbackEndpoint!: string;
  /** The server switch for real supplier calls (TELEPHONY_LIVE_ENABLED). */
  @ApiProperty() liveEnabled!: boolean;
  /** False in production, where the simulated line is forbidden. */
  @ApiProperty() mockAllowed!: boolean;
  @ApiProperty({ example: '0.1500' }) costPerMinute!: string;
  @ApiProperty({ example: '10.00' }) seatMonthlyCost!: string;
  @ApiProperty() ready!: boolean;
  /** What keeps the line from dialing, in words for the platform admin. */
  @ApiProperty({ type: [String] }) problems!: string[];
  /** Real supplier seats created across all companies. */
  @ApiProperty() seats!: number;
}
export class PlatformTelephonyTokenResponseDto {
  @ApiProperty({ type: PlatformTelephonyResponseDto })
  settings!: PlatformTelephonyResponseDto;
  /** Shown once: the full URL to give the supplier, credential included. */
  @ApiProperty() callbackUrl!: string;
}
export class TelephonyPlanInputDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  @Matches(/\S/)
  name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10_000) seats!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_000) monthlyMinutes!: number;
  @ApiProperty({ example: '120.00' })
  @IsString()
  @Matches(MONEY)
  monthlyPrice!: string;
  @ApiProperty() @IsBoolean() assignable!: boolean;
}
export class UpdateTelephonyPlanDto extends TelephonyPlanInputDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
}
export class TelephonyPlanResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty({ example: '120.00' }) monthlyPrice!: string;
  @ApiProperty() assignable!: boolean;
  @ApiProperty() version!: number;
  /** Companies on this plan now. */
  @ApiProperty() companies!: number;
}
export class TelephonyPlanVersionQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) version!: number;
}
export class TelephonyMinuteAdditionDto {
  @ApiProperty() month!: string;
  @ApiProperty() minutes!: number;
  @ApiProperty() price!: string;
  @ApiProperty() note!: string;
  @ApiProperty() createdAt!: string;
}
export class PlatformTenantTelephonyResponseDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, nullable: true }) planId!: string | null;
  @ApiProperty({ type: String, nullable: true }) planName!: string | null;
  @ApiProperty() seats!: number;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty() month!: string;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  @ApiProperty() allowance!: number;
  @ApiProperty() seatsEnabled!: number;
  @ApiProperty({ type: [TelephonyMinuteAdditionDto] })
  additions!: TelephonyMinuteAdditionDto[];
}
export class AssignTelephonyPlanDto {
  @ApiProperty() @IsInt() @Min(0) version!: number;
  /** Null sets the company back to 未开通. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  planId!: string | null;
}
export class AddTelephonyMinutesDto {
  @ApiProperty({ example: '2026-11-01' }) @Matches(MONTH_START) month!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1_000_000) minutes!: number;
  @ApiProperty({ example: '30.00' }) @IsString() @Matches(MONEY) price!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{8,100}$/) idempotencyKey!: string;
}
export class AddTelephonyMinutesResponseDto {
  @ApiProperty() applied!: boolean;
  @ApiProperty() month!: string;
}
export class TelephonyReportQueryDto {
  @ApiProperty({ example: '2026-11' }) @Matches(MONTH) month!: string;
}
export class TelephonyReportRowDto {
  @ApiProperty() tenantId!: string;
  @ApiProperty() tenantName!: string;
  @ApiProperty({ type: String, nullable: true }) planName!: string | null;
  @ApiProperty() monthlyMinutes!: number;
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() extraMinutes!: number;
  @ApiProperty() allowance!: number;
  @ApiProperty() planPrice!: string;
  @ApiProperty() extraPrice!: string;
  @ApiProperty() revenue!: string;
  @ApiProperty() minuteCost!: string;
  @ApiProperty() seatCost!: string;
  @ApiProperty() cost!: string;
  @ApiProperty() margin!: string;
  @ApiProperty() seatsProvisioned!: number;
}
export class TelephonyReportTotalDto {
  @ApiProperty() usedMinutes!: number;
  @ApiProperty() revenue!: string;
  @ApiProperty() cost!: string;
  @ApiProperty() margin!: string;
}
export class TelephonyReportResponseDto {
  @ApiProperty() month!: string;
  /** Seat cost uses the current monthly seat price; it is not kept per month. */
  @ApiProperty() seatMonthlyCost!: string;
  @ApiProperty({ type: [TelephonyReportRowDto] })
  rows!: TelephonyReportRowDto[];
  @ApiProperty({ type: TelephonyReportTotalDto })
  total!: TelephonyReportTotalDto;
}
