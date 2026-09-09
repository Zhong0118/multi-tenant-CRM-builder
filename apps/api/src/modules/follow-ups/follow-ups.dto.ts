import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFollowUpDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z][a-z0-9_]*$/)
  objectCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recordId!: string;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt!: string;
}
export class UpdateFollowUpDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ enum: ['DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DONE', 'CANCELLED'])
  status?: 'DONE' | 'CANCELLED';
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string;
}
export class FollowUpQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'OVERDUE', 'DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['OPEN', 'OVERDUE', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'OVERDUE' | 'DONE' | 'CANCELLED';
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  recordId?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
export class FollowUpResponseDto {
  @ApiProperty() assigneeName!: string;
  @ApiProperty() assigneeMemberId!: string;
  @ApiProperty() id!: string;
  @ApiProperty() recordId!: string;
  @ApiProperty() recordTitle!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: ['OPEN', 'DONE', 'CANCELLED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() canManage!: boolean;
}
export class FollowUpPageDto {
  @ApiProperty({ type: FollowUpResponseDto, isArray: true })
  items!: FollowUpResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() openCount!: number;
  @ApiProperty() overdueCount!: number;
}

export class FollowUpRecipientDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
}
