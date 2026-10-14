import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class RecordPoolConfigResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 8760 })
  ownershipTtlHours!: number | null;
  @ApiProperty({ minimum: 1 }) version!: number;
}
export class UpdateRecordPoolConfigDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 8760 })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsInt()
  @Min(1)
  @Max(8760)
  ownershipTtlHours!: number | null;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
}
export class RecordOwnershipDto {
  @ApiProperty({ enum: ['CLAIM', 'RELEASE', 'ASSIGN'] })
  @IsIn(['CLAIM', 'RELEASE', 'ASSIGN'])
  action!: 'CLAIM' | 'RELEASE' | 'ASSIGN';
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerMemberId?: string;
}
export class RecordOwnershipResponseDto {
  @ApiProperty({ format: 'uuid' }) recordId!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
}
