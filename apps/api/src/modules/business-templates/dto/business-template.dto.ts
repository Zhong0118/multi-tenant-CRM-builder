import { Transform, Type } from 'class-transformer';
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
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

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

export class BusinessTemplatePageQueryDto {
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

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  hasActiveVersion?: boolean;
}

export class CreateBusinessTemplateDto {
  @ApiProperty({ type: String, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description!: string | null;
}

export class TemplateDefaultViewSortDto {
  @ApiProperty({ type: String, enum: ['updatedAt', 'createdAt', 'recordNo'] })
  @IsIn(['updatedAt', 'createdAt', 'recordNo'])
  field!: 'updatedAt' | 'createdAt' | 'recordNo';

  @ApiProperty({ type: String, enum: ['asc', 'desc'] })
  @IsIn(['asc', 'desc'])
  direction!: 'asc' | 'desc';
}

export class TemplateDefaultViewDto {
  @ApiProperty({ type: String, enum: ['default'] })
  @Equals('default')
  code!: 'default';

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  columnFieldKeys!: string[];

  @ApiProperty({ type: TemplateDefaultViewSortDto })
  @ValidateNested()
  @Type(() => TemplateDefaultViewSortDto)
  sort!: TemplateDefaultViewSortDto;
}

export class TemplateEmployeeAccessDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() canCreate!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() canRead!: boolean;
  @ApiProperty({ type: Boolean }) @IsBoolean() canUpdate!: boolean;
  @ApiProperty({ type: Boolean, enum: [false] })
  @Equals(false)
  canDelete!: false;

  @ApiProperty({ type: String, enum: ['ALL', 'OWN', 'NONE'] })
  @IsIn(['ALL', 'OWN', 'NONE'])
  readScope!: 'ALL' | 'OWN' | 'NONE';

  @ApiProperty({ type: String, enum: ['ALL', 'OWN', 'NONE'] })
  @IsIn(['ALL', 'OWN', 'NONE'])
  updateScope!: 'ALL' | 'OWN' | 'NONE';

  @ApiProperty({
    type: 'object',
    additionalProperties: { enum: ['EDIT', 'READ_ONLY', 'HIDDEN'] },
  })
  @IsObject()
  fields!: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'>;
}

export class TemplateFieldDraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  @Matches(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  @MaxLength(64)
  fieldKey!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label!: string;

  @ApiProperty({ type: String, enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES)
  type!: (typeof FIELD_TYPES)[number];

  @ApiProperty({ type: Boolean }) @IsBoolean() required!: boolean;
  @ApiProperty(JSON_VALUE_SCHEMA) @Allow() defaultValue!: unknown;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  validation!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiProperty({ type: Number }) @IsInt() sortOrder!: number;
  @ApiProperty({ type: Boolean }) @IsBoolean() isSystem!: boolean;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

export class TemplateObjectDraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  code!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 64 })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon!: string | null;

  @ApiProperty({ type: String }) @IsString() titleFieldKey!: string;
  @ApiProperty({ type: Number }) @IsInt() sortOrder!: number;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';

  @ApiProperty({ type: TemplateFieldDraftDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDraftDto)
  fields!: TemplateFieldDraftDto[];

  @ApiProperty({ type: TemplateDefaultViewDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateDefaultViewDto)
  defaultView!: TemplateDefaultViewDto | null;

  @ApiProperty({ type: TemplateEmployeeAccessDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateEmployeeAccessDto)
  employeeAccess!: TemplateEmployeeAccessDto | null;
}

export class BusinessTemplateConfigurationDto {
  @ApiProperty({ type: Number, enum: [1] })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({ type: TemplateObjectDraftDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateObjectDraftDto)
  objects!: TemplateObjectDraftDto[];
}

export class SaveBusinessTemplateDraftDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description!: string | null;

  @ApiProperty({ type: BusinessTemplateConfigurationDto })
  @ValidateNested()
  @Type(() => BusinessTemplateConfigurationDto)
  configuration!: BusinessTemplateConfigurationDto;
}

export class ExpectedTemplateVersionDto {
  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class TemplateFieldResponseDto extends TemplateFieldDraftDto {
  @ApiProperty({ type: String, nullable: true })
  publishedFieldKey!: string | null;

  @ApiProperty({ type: String, enum: FIELD_TYPES, nullable: true })
  publishedType!: (typeof FIELD_TYPES)[number] | null;
}

export class TemplateObjectResponseDto extends TemplateObjectDraftDto {
  @ApiProperty({ type: String, nullable: true }) publishedCode!: string | null;

  @ApiProperty({ type: TemplateFieldResponseDto, isArray: true })
  declare fields: TemplateFieldResponseDto[];
}

export class BusinessTemplateConfigurationResponseDto extends BusinessTemplateConfigurationDto {
  @ApiProperty({ type: TemplateObjectResponseDto, isArray: true })
  declare objects: TemplateObjectResponseDto[];
}

export class TemplatePublicationChangeResponseDto {
  @ApiProperty({ type: String, enum: ['ADDED', 'UPDATED', 'INACTIVATED'] })
  kind!: 'ADDED' | 'UPDATED' | 'INACTIVATED';

  @ApiProperty({ type: String, enum: ['OBJECT', 'FIELD'] })
  entity!: 'OBJECT' | 'FIELD';

  @ApiProperty({ type: String, format: 'uuid' }) objectId!: string;
  @ApiPropertyOptional({ type: String }) fieldKey?: string;
}

export class BusinessTemplateVersionResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) templateId!: string;
  @ApiProperty({ type: Number, minimum: 1 }) versionNo!: number;
  @ApiProperty({ type: Number, minimum: 1 }) sourceDraftVersion!: number;
  @ApiProperty({ type: Number, enum: [1] }) schemaVersion!: number;
  @ApiProperty({ type: BusinessTemplateConfigurationDto })
  configuration!: BusinessTemplateConfigurationDto;
  @ApiProperty({ type: String }) configurationChecksum!: string;
  @ApiProperty({ type: TemplatePublicationChangeResponseDto, isArray: true })
  changeSummary!: TemplatePublicationChangeResponseDto[];
  @ApiProperty({ type: String, format: 'uuid' }) publishedByUserId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) publishedAt!: Date;
}

export class BusinessTemplateActiveVersionResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number, minimum: 1 }) versionNo!: number;
  @ApiProperty({ type: Number, minimum: 1 }) sourceDraftVersion!: number;
  @ApiProperty({ type: String, format: 'date-time' }) publishedAt!: Date;
}

export class BusinessTemplateSummaryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: Number, minimum: 1 }) draftVersion!: number;
  @ApiProperty({
    type: BusinessTemplateActiveVersionResponseDto,
    nullable: true,
  })
  activeVersion!: BusinessTemplateActiveVersionResponseDto | null;
  @ApiProperty({ type: Boolean }) hasUnpublishedChanges!: boolean;
  @ApiProperty({
    type: String,
    enum: ['DRAFT', 'PUBLISHED', 'CHANGED', 'ARCHIVED'],
  })
  status!: 'DRAFT' | 'PUBLISHED' | 'CHANGED' | 'ARCHIVED';
  @ApiProperty({ type: Number, minimum: 0 }) objectCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) fieldCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) applicationCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  publishedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class BusinessTemplateDetailResponseDto extends BusinessTemplateSummaryResponseDto {
  @ApiProperty({ type: BusinessTemplateConfigurationResponseDto })
  configuration!: BusinessTemplateConfigurationResponseDto;
}

export class BusinessTemplatePageResponseDto {
  @ApiProperty({ type: BusinessTemplateSummaryResponseDto, isArray: true })
  items!: BusinessTemplateSummaryResponseDto[];
  @ApiProperty({ type: Number, minimum: 1 }) page!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ type: Number, minimum: 0 }) total!: number;
}

export class TemplatePublicationIssueResponseDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) message!: string;
  @ApiProperty({ type: String }) objectId!: string;
  @ApiPropertyOptional({ type: String }) fieldKey?: string;
}

export class TemplatePublicationAnalysisResponseDto {
  @ApiProperty({ type: TemplatePublicationIssueResponseDto, isArray: true })
  blocking!: TemplatePublicationIssueResponseDto[];
  @ApiProperty({ type: TemplatePublicationIssueResponseDto, isArray: true })
  warnings!: TemplatePublicationIssueResponseDto[];
  @ApiProperty({ type: TemplatePublicationChangeResponseDto, isArray: true })
  changes!: TemplatePublicationChangeResponseDto[];
  @ApiProperty({ type: Number, minimum: 0 }) objectCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) fieldCount!: number;
}
