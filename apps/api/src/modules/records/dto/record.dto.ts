import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class RecordListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string;

  @ApiPropertyOptional({
    maxLength: 4000,
    description:
      '按已发布字段筛选的 JSON 对象，支持选项、日期范围或相对时间、数值区间、是否、成员、文本包含，以及有值/空值。',
    example: '{"lead_status":["new","following"]}',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  filters?: string;

  @ApiPropertyOptional({
    type: String,
    default: 'updatedAt',
    description:
      'updatedAt、createdAt、recordNo，或当前业务表中可排序的已发布字段键。',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sort = 'updatedAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    description:
      'Personal visible field keys for this list or export. Hidden fields are ignored. Omit to use the published default list columns.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, { each: true })
  columns?: string[];
}

export class CreateRecordDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  values!: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string | null;
}

export class UpdateRecordDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string | null;
}

export class DeleteRecordDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class RecordResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() recordNo!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  ownerMemberId!: string | null;
  @ApiProperty() title!: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) values!: object;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class RecordPageResponseDto {
  @ApiProperty({ type: RecordResponseDto, isArray: true })
  items!: RecordResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}

export class DeleteRecordResponseDto {
  @ApiProperty({ enum: [true] }) accepted!: true;
}

const MEMBER_ACTIVITY_TYPES = ['CALL', 'MESSAGE', 'MEETING', 'NOTE'] as const;

export class RecordActivityListQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateRecordActivityDto {
  @ApiProperty({ enum: MEMBER_ACTIVITY_TYPES })
  @IsIn(MEMBER_ACTIVITY_TYPES)
  activityType!: (typeof MEMBER_ACTIVITY_TYPES)[number];

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  content!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsDateString({ strict: true })
  nextActionAt?: string | null;
}

export class RecordActivityResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: MEMBER_ACTIVITY_TYPES })
  activityType!: (typeof MEMBER_ACTIVITY_TYPES)[number];
  @ApiProperty() content!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextActionAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorMemberId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  actorDisplayName!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class RecordActivityPageResponseDto {
  @ApiProperty({ type: RecordActivityResponseDto, isArray: true })
  items!: RecordActivityResponseDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}
