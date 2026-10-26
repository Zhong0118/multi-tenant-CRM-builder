import { SaveWorkflowDraftDto } from '../../workflows/dto/workflow.dto';
import { AutomationRuleDto } from '../../automations/automation.dto';
import { UpdateRecordPoolConfigDto } from '../../records/dto/record-pool.dto';
import {
  SaveWorkGoalDto,
  GOAL_METRICS,
  type GoalMetric,
} from '../../work/dto/work-goals.dto';
import { OBJECT_CODE_REFERENCE_PATTERN } from '../../objects/object-code';
import { Transform, Type } from 'class-transformer';
import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
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
  registerDecorator,
  type ValidationOptions,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  FieldConfigDto,
  FieldValidationDto,
} from '../../objects/dto/object.dto';

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

function IsPresent(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isPresent',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: { validate: (value: unknown) => value !== undefined },
    });
}

function IsTemplateFieldAccessRecord(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isTemplateFieldAccessRecord',
      target: target.constructor,
      propertyName: propertyKey.toString(),
      options: validationOptions,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.values(value).every(
            (access) =>
              typeof access === 'string' &&
              ['EDIT', 'READ_ONLY', 'HIDDEN'].includes(access),
          ),
      },
    });
}

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
  @ApiProperty({ type: String, pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' })
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, {
    message: '仅支持小写字母、数字和单个连字符，且必须以字母开头。',
  })
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

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  searchFieldKeys?: string[];

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
  @IsTemplateFieldAccessRecord()
  fields!: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'>;
}

export class TemplateFieldDraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  // Published fields can use legacy camelCase keys; preserve their references.
  @Matches(/^[a-z][a-zA-Z0-9]*(?:_[a-zA-Z0-9]+)*$/)
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
  @ApiProperty(JSON_VALUE_SCHEMA)
  @IsPresent()
  @Allow()
  defaultValue!: unknown;

  @ApiProperty({ type: FieldValidationDto })
  @ValidateNested()
  @Type(() => FieldValidationDto)
  validation!: FieldValidationDto;

  @ApiProperty({ type: FieldConfigDto })
  @ValidateNested()
  @Type(() => FieldConfigDto)
  config!: FieldConfigDto;

  @ApiProperty({ type: Number }) @IsInt() sortOrder!: number;
  @ApiProperty({ type: Boolean }) @IsBoolean() isSystem!: boolean;

  @ApiProperty({ type: String, enum: ['ACTIVE', 'INACTIVE'] })
  @IsIn(['ACTIVE', 'INACTIVE'])
  status!: 'ACTIVE' | 'INACTIVE';
}

export class TemplateWorkflowDto extends OmitType(SaveWorkflowDraftDto, [
  'expectedDraftRevision',
] as const) {}
export class TemplatePoolDto extends OmitType(UpdateRecordPoolConfigDto, [
  'version',
] as const) {}
export class TemplateGoalRuleDto extends OmitType(SaveWorkGoalDto, [
  'expectedVersion',
  'memberIds',
] as const) {
  @ApiProperty({ enum: GOAL_METRICS }) @IsIn(GOAL_METRICS) metric!: GoalMetric;
  @ApiProperty({ enum: ['ALL_EMPLOYEES'] })
  @Equals('ALL_EMPLOYEES')
  declare audience: 'ALL_EMPLOYEES';
}

export class TemplateObjectDraftDto {
  @ApiPropertyOptional({ type: TemplateWorkflowDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplateWorkflowDto)
  workflow?: TemplateWorkflowDto;
  @ApiPropertyOptional({ type: AutomationRuleDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutomationRuleDto)
  automations?: AutomationRuleDto[];
  @ApiPropertyOptional({ type: TemplatePoolDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TemplatePoolDto)
  pool?: TemplatePoolDto;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() id!: string;

  @ApiProperty({ type: String, maxLength: 64 })
  @Matches(OBJECT_CODE_REFERENCE_PATTERN, {
    message: '业务对象代码仅支持小写字母、数字和单个连字符，且必须以字母开头。',
  })
  @MaxLength(64)
  code!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 1000 })
  @ValidateIf((_object, value) => value !== null)
  @IsPresent()
  @IsString()
  @MaxLength(1000)
  description!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 64 })
  @ValidateIf((_object, value) => value !== null)
  @IsPresent()
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
  @ValidateIf((_object, value) => value !== null)
  @IsPresent()
  @ValidateNested()
  @Type(() => TemplateDefaultViewDto)
  defaultView!: TemplateDefaultViewDto | null;

  @ApiProperty({ type: TemplateEmployeeAccessDto, nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsPresent()
  @ValidateNested()
  @Type(() => TemplateEmployeeAccessDto)
  employeeAccess!: TemplateEmployeeAccessDto | null;
}

export class BusinessTemplateConfigurationDto {
  @ApiPropertyOptional({ type: TemplateGoalRuleDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateGoalRuleDto)
  goalRules?: TemplateGoalRuleDto[];
  @ApiProperty({ type: Number, enum: [1] })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({ type: TemplateObjectDraftDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateObjectDraftDto)
  objects!: TemplateObjectDraftDto[];

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  dashboard?: object;
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
  @ValidateIf((_object, value) => value !== null)
  @IsPresent()
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

  @ApiProperty({ type: String, enum: ['OBJECT', 'FIELD', 'GOAL_RULES'] })
  entity!: 'OBJECT' | 'FIELD' | 'GOAL_RULES';

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
  @ApiPropertyOptional({ type: String }) path?: string;
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

export class ApplyBusinessTemplateDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  tenantId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  templateVersionId!: string;
}

export class TemplateApplicationObjectResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) templateObjectId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) objectId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
}

export class TemplateApplicationResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) templateId!: string;
  @ApiProperty({ type: String }) templateCode!: string;
  @ApiProperty({ type: String }) templateName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) templateVersionId!: string;
  @ApiProperty({ type: Number, minimum: 1 }) templateVersionNo!: number;
  @ApiProperty({ type: String, format: 'uuid' }) tenantId!: string;
  @ApiProperty({ type: String }) tenantCode!: string;
  @ApiProperty({ type: String }) tenantName!: string;
  @ApiProperty({ type: String, format: 'uuid' }) appliedByUserId!: string;
  @ApiProperty({ type: String, minLength: 64, maxLength: 64 })
  configurationChecksum!: string;
  @ApiProperty({ type: TemplateApplicationObjectResponseDto, isArray: true })
  objects!: TemplateApplicationObjectResponseDto[];
  @ApiProperty({ type: String, format: 'date-time' }) appliedAt!: Date;
}

export class TenantObjectSummaryResponseDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'] })
  status!: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @ApiProperty() published!: boolean;
  @ApiProperty({ minimum: 0 }) fieldCount!: number;
  @ApiProperty({ minimum: 0 }) recordCount!: number;
  @ApiProperty() fromTemplate!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  archivedAt!: string | null;
}

export class TenantBusinessConfigurationSummaryResponseDto {
  @ApiProperty({ type: Number, minimum: 0 }) objectCount!: number;
  @ApiProperty({ type: Boolean }) canApplyTemplate!: boolean;
  @ApiProperty({
    type: String,
    enum: ['TENANT_NOT_DRAFT', 'TARGET_NOT_EMPTY'],
    nullable: true,
  })
  blockingReason!: 'TENANT_NOT_DRAFT' | 'TARGET_NOT_EMPTY' | null;
  @ApiProperty({ type: TemplateApplicationResponseDto, nullable: true })
  application!: TemplateApplicationResponseDto | null;
  @ApiProperty({ type: TenantObjectSummaryResponseDto, isArray: true })
  objects!: TenantObjectSummaryResponseDto[];
}

export class CaptureBusinessTemplatePreviewDto extends ExpectedTemplateVersionDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceTenantId!: string;
}
export class TemplateCaptureSourceTenantDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
}
export class TemplateCaptureExcludedDto {
  @ApiProperty() unpublishedObjects!: number;
  @ApiProperty() memberOverrides!: number;
  @ApiProperty() selectedGoalRules!: number;
}
export class TemplateCaptureObjectSummaryDto extends TemplateCaptureSourceTenantDto {
  @ApiProperty() fieldCount!: number;
  @ApiProperty() stateCount!: number;
  @ApiProperty() automationCount!: number;
  @ApiProperty() poolEnabled!: boolean;
}
export class TemplateCaptureSummaryDto {
  @ApiProperty({ type: TemplateCaptureObjectSummaryDto, isArray: true })
  objects!: TemplateCaptureObjectSummaryDto[];
  @ApiProperty() goalRuleCount!: number;
}
export class TemplateCaptureIssueDto {
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
  @ApiPropertyOptional() objectId?: string;
  @ApiPropertyOptional() fieldKey?: string;
  @ApiPropertyOptional() path?: string;
}
export class BusinessTemplateCapturePreviewResponseDto {
  @ApiProperty({ type: BusinessTemplateConfigurationResponseDto })
  configuration!: BusinessTemplateConfigurationResponseDto;
  @ApiProperty({ type: TemplateCaptureSourceTenantDto })
  sourceTenant!: TemplateCaptureSourceTenantDto;
  @ApiProperty({ type: TemplateCaptureExcludedDto })
  excluded!: TemplateCaptureExcludedDto;
  @ApiProperty({ type: TemplateCaptureSummaryDto })
  summary!: TemplateCaptureSummaryDto;
  @ApiProperty({ type: TemplateCaptureIssueDto, isArray: true })
  blocking!: TemplateCaptureIssueDto[];
  @ApiProperty({ type: TemplateCaptureIssueDto, isArray: true })
  warnings!: TemplateCaptureIssueDto[];
}
