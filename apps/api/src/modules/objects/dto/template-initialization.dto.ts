import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
export class TemplateInitializationObjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() version!: number;
  @ApiProperty() poolConfigVersion!: number;
}
export class TemplateInitializationGroupDto {
  @ApiProperty({ format: 'uuid' }) templateVersionId!: string;
  @ApiProperty({ type: TemplateInitializationObjectDto, isArray: true })
  objects!: TemplateInitializationObjectDto[];
}
export class TemplateInitializationResponseDto {
  @ApiProperty({ type: TemplateInitializationGroupDto, isArray: true })
  groups!: TemplateInitializationGroupDto[];
}
export class TemplateInitializationExpectedObjectDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedPoolConfigVersion!: number;
}
export class PublishTemplateInitializationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() templateVersionId!: string;
  @ApiProperty({ type: TemplateInitializationExpectedObjectDto, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TemplateInitializationExpectedObjectDto)
  objects!: TemplateInitializationExpectedObjectDto[];
}
export class TemplateInitializationPublishedObjectDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class TemplateInitializationPublishedResponseDto {
  @ApiProperty({
    type: TemplateInitializationPublishedObjectDto,
    isArray: true,
  })
  published!: TemplateInitializationPublishedObjectDto[];
}
