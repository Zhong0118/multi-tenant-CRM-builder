import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
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
      '按已发布选项、日期、数值、是否、成员或文本字段筛选的 JSON 对象。',
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
