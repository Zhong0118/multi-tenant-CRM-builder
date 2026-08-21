import { Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import {
  Allow,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import type { JsonValue } from '../object-schema';

const FIELD_TYPES = [
  'TEXT',
  'TEXTAREA',
  'PHONE',
  'EMAIL',
  'NUMBER',
  'MONEY',
  'DATE',
  'DATETIME',
  'SINGLE_SELECT',
  'MULTI_SELECT',
  'MEMBER',
  'BOOLEAN',
] as const;

export class ExpectedVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

/**
 * A published field default is any JSON value, so it cannot be described by a
 * single scalar type. Declaring the union keeps generated clients usable
 * instead of collapsing the property to an empty object type.
 */
const JSON_VALUE_SCHEMA: ApiPropertyOptions = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: {} },
    { type: 'object', additionalProperties: true },
  ],
  nullable: true,
};

export class CreateObjectDefinitionDto {
  @ApiProperty({ example: '销售线索' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'leads' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string | null;
}

export class UpdateObjectDefinitionDto extends ExpectedVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  titleFieldKey?: string;
}

export class SelectOptionDto {
  @ApiProperty()
  @Matches(/^[a-z0-9][a-z0-9_-]*$/)
  @MaxLength(64)
  key!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class FieldConfigDto {
  @ApiPropertyOptional({ type: SelectOptionDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectOptionDto)
  options?: SelectOptionDto[];
}

export class FieldValidationDto {
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minLength?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxLength?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  min?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  max?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  scale?: number;
}

export class CreateFieldDefinitionDto extends ExpectedVersionDto {
  @ApiProperty({ example: 'customer_name' })
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  @MaxLength(64)
  fieldKey!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiProperty({ enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES)
  type!: (typeof FIELD_TYPES)[number];

  @ApiProperty()
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional(JSON_VALUE_SCHEMA)
  @Allow()
  defaultValue: JsonValue = null;

  @ApiPropertyOptional({ type: FieldValidationDto })
  @ValidateNested()
  @Type(() => FieldValidationDto)
  validation: FieldValidationDto = new FieldValidationDto();

  @ApiPropertyOptional({ type: FieldConfigDto })
  @ValidateNested()
  @Type(() => FieldConfigDto)
  config: FieldConfigDto = new FieldConfigDto();

  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsBoolean()
  isSystem = false;
}

export class UpdateFieldDefinitionDto extends ExpectedVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  fieldKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label?: string;

  @ApiPropertyOptional({ enum: FIELD_TYPES })
  @IsOptional()
  @IsIn(FIELD_TYPES)
  type?: (typeof FIELD_TYPES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional(JSON_VALUE_SCHEMA)
  @IsOptional()
  @Allow()
  defaultValue?: JsonValue;

  @ApiPropertyOptional({ type: FieldValidationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FieldValidationDto)
  validation?: FieldValidationDto;

  @ApiPropertyOptional({ type: FieldConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FieldConfigDto)
  config?: FieldConfigDto;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class ObjectOrderItemDto extends ExpectedVersionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  objectId!: string;
}

export class ObjectOrderDto {
  @ApiProperty({ type: ObjectOrderItemDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ObjectOrderItemDto)
  items!: ObjectOrderItemDto[];
}

export class FieldOrderDto extends ExpectedVersionDto {
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  fieldIds!: string[];
}

export class DefaultViewSortDto {
  @ApiProperty({ enum: ['updatedAt', 'createdAt', 'recordNo'] })
  @IsIn(['updatedAt', 'createdAt', 'recordNo'])
  field!: 'updatedAt' | 'createdAt' | 'recordNo';

  @ApiProperty({ enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

export class DefaultViewDto extends ExpectedVersionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayUnique()
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, { each: true })
  columnFieldKeys!: string[];

  @ApiProperty()
  @ValidateNested()
  @Type(() => DefaultViewSortDto)
  sort!: DefaultViewSortDto;
}

export class EmployeePermissionsDto extends ExpectedVersionDto {
  @ApiProperty() @IsBoolean() canCreate!: boolean;
  @ApiProperty() @IsBoolean() canRead!: boolean;
  @ApiProperty() @IsBoolean() canUpdate!: boolean;
  @ApiProperty({ enum: [false] }) @Equals(false) canDelete!: false;

  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  @IsIn(['ALL', 'OWN', 'NONE'])
  readScope!: 'ALL' | 'OWN' | 'NONE';

  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  @IsIn(['ALL', 'OWN', 'NONE'])
  updateScope!: 'ALL' | 'OWN' | 'NONE';

  @ApiProperty({
    type: 'object',
    additionalProperties: { enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] },
  })
  @IsObject()
  fields!: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'>;
}

export class RuntimeObjectNavigationResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) icon!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() canCreate!: boolean;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canUpdate!: boolean;
}

export class PublishedFieldResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: FIELD_TYPES }) type!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty(JSON_VALUE_SCHEMA) defaultValue!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true })
  validation!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) config!: object;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ enum: ['EDIT', 'READ_ONLY'] }) access!: 'EDIT' | 'READ_ONLY';
}

export class PublishedObjectSchemaResponseDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  publication!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) object!: object;
  @ApiProperty({ type: PublishedFieldResponseDto, isArray: true })
  fields!: PublishedFieldResponseDto[];
  @ApiProperty({ type: 'object', additionalProperties: true })
  defaultView!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) actions!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) scopes!: object;
}

/**
 * Object draft responses for the tenant-admin designer. `ATTACHMENT` exists in
 * the database enum but no route accepts it in this slice, so the response
 * enum stays the supported field types.
 */
export class ObjectDraftObjectResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;
  @ApiProperty() titleFieldKey!: string;
  @ApiProperty({ type: String, nullable: true }) icon!: string | null;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() version!: number;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  status!: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiProperty({ type: Number, nullable: true })
  publicationNumber!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: string | null;
  @ApiProperty() hasUnpublishedChanges!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}

export class ObjectDraftFieldResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty({ enum: FIELD_TYPES }) type!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty(JSON_VALUE_SCHEMA) defaultValue!: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true })
  validation!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) config!: object;
  @ApiProperty() sortOrder!: number;
  @ApiProperty() isSystem!: boolean;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ type: String, enum: FIELD_TYPES, nullable: true })
  publishedType!: string | null;
  @ApiProperty({ enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] })
  employeeAccess!: 'EDIT' | 'READ_ONLY' | 'HIDDEN';
}

export class ObjectDraftDefaultViewResponseDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, isArray: true }) columnFieldKeys!: string[];
  @ApiProperty({ type: DefaultViewSortDto }) sort!: DefaultViewSortDto;
}

export class ObjectDraftEmployeeAccessResponseDto {
  @ApiProperty() canCreate!: boolean;
  @ApiProperty() canRead!: boolean;
  @ApiProperty() canUpdate!: boolean;
  @ApiProperty({ enum: [false] }) canDelete!: false;
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  readScope!: 'ALL' | 'OWN' | 'NONE';
  @ApiProperty({ enum: ['ALL', 'OWN', 'NONE'] })
  updateScope!: 'ALL' | 'OWN' | 'NONE';
}

export class ObjectDraftResponseDto {
  @ApiProperty({ type: ObjectDraftObjectResponseDto })
  object!: ObjectDraftObjectResponseDto;
  @ApiProperty({ type: ObjectDraftFieldResponseDto, isArray: true })
  fields!: ObjectDraftFieldResponseDto[];
  @ApiProperty({
    type: ObjectDraftDefaultViewResponseDto,
    nullable: true,
  })
  defaultView!: ObjectDraftDefaultViewResponseDto | null;
  @ApiProperty({
    type: ObjectDraftEmployeeAccessResponseDto,
    nullable: true,
  })
  employeeAccess!: ObjectDraftEmployeeAccessResponseDto | null;
  @ApiProperty() activeRecordCount!: number;
}

export class PublicationIssueResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional({ type: String }) fieldKey?: string;
}

export class PublicationChangeResponseDto {
  @ApiProperty({ enum: ['ADDED', 'UPDATED', 'INACTIVATED'] })
  kind!: 'ADDED' | 'UPDATED' | 'INACTIVATED';
  @ApiProperty() fieldKey!: string;
}

export class PublicationAnalysisResponseDto {
  @ApiProperty({ type: PublicationIssueResponseDto, isArray: true })
  blocking!: PublicationIssueResponseDto[];
  @ApiProperty({ type: PublicationIssueResponseDto, isArray: true })
  warnings!: PublicationIssueResponseDto[];
  @ApiProperty({ type: PublicationChangeResponseDto, isArray: true })
  changes!: PublicationChangeResponseDto[];
}

export class ObjectPublicationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty() sourceDraftVersion!: number;
  @ApiProperty({ format: 'date-time' }) publishedAt!: string;
  @ApiProperty({ type: PublicationChangeResponseDto, isArray: true })
  changes!: PublicationChangeResponseDto[];
}
