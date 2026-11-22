import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  POOL_STAGES,
  type PoolStage,
  type PoolQuality,
} from '../../records/record-ownership';

export class RecordViewSortDto {
  @ApiProperty() field!: string;
  @ApiProperty({ enum: ['asc', 'desc'] }) direction!: 'asc' | 'desc';
}

export class RecordViewQueryOptionsDto {
  @ApiPropertyOptional({ maxLength: 300 }) search?: string;
  @ApiPropertyOptional({ enum: ['mine', 'pool', 'group', 'all'] }) scope?:
    'mine' | 'pool' | 'group' | 'all';
  @ApiPropertyOptional({ enum: [...POOL_STAGES, 'LEGACY'] }) poolStage?:
    PoolStage | 'LEGACY';
  @ApiPropertyOptional({ enum: ['INVALID', 'DUPLICATE', 'LOST'] })
  poolQuality?: PoolQuality;
  @ApiPropertyOptional() ownerMemberId?: string;
}

class RecordViewSettingsDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: '版本化筛选规则 FilterRule',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  filterRule?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    nullable: true,
    description: 'null 继承发布视图的列',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  columnFieldKeys?: string[] | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer', minimum: 88, maximum: 640 },
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  columnWidths?: Record<string, number>;

  @ApiPropertyOptional({
    type: RecordViewSortDto,
    nullable: true,
    description: 'null 继承发布视图的排序',
  })
  @IsOptional()
  @IsObject()
  sort?: RecordViewSortDto | null;

  @ApiPropertyOptional({ type: RecordViewQueryOptionsDto })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  queryOptions?: RecordViewQueryOptionsDto;
}

export class CreateRecordViewDto extends RecordViewSettingsDto {
  @ApiProperty({ maxLength: 100 }) @IsString() @Length(1, 100) name!: string;
  @ApiProperty({ enum: ['PERSONAL', 'SHARED'] })
  @IsIn(['PERSONAL', 'SHARED'])
  scope!: 'PERSONAL' | 'SHARED';
  @ApiPropertyOptional({
    maxLength: 256,
    description: '本机个人筛选方案的稳定来源指纹',
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(1, 256)
  importKey?: string;
}

export class UpdateRecordViewDto extends RecordViewSettingsDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedRevision!: number;
  @ApiPropertyOptional({ maxLength: 100 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class ArchiveRecordViewDto {
  @ApiPropertyOptional({ minimum: 1 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(1)
  expectedRevision?: number;
}

export class RecordViewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['PERSONAL', 'SHARED'] }) scope!: 'PERSONAL' | 'SHARED';
  @ApiProperty() revision!: number;
  @ApiProperty() available!: boolean;
  @ApiProperty() canEdit!: boolean;
  @ApiPropertyOptional() unavailableReason?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  filterRule?: object;
  @ApiPropertyOptional({ type: String, isArray: true })
  columnFieldKeys?: string[];
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'integer' },
  })
  columnWidths?: Record<string, number>;
  @ApiPropertyOptional({ type: RecordViewSortDto }) sort?: RecordViewSortDto;
  @ApiPropertyOptional({ type: RecordViewQueryOptionsDto })
  queryOptions?: RecordViewQueryOptionsDto;
}

export class RecordViewListResponseDto {
  @ApiProperty({ type: RecordViewResponseDto, isArray: true })
  items!: RecordViewResponseDto[];
}
