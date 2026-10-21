import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { AutomationRule, AutomationValue } from './automation.types';

const VALUE_SCHEMA = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'array', items: { type: 'string' } },
  ],
  nullable: true,
};
export class AutomationRuleDto implements AutomationRule {
  @ApiProperty() @IsString() @Matches(/^[a-z][a-z0-9-]{0,63}$/) key!: string;
  @ApiProperty() @IsString() @MaxLength(100) label!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'], isArray: true })
  @IsArray()
  @IsIn(['TENANT_ADMIN', 'EMPLOYEE'], { each: true })
  allowedRoles!: AutomationRule['allowedRoles'];
  @ApiProperty({
    oneOf: [
      {
        type: 'object',
        required: ['type'],
        properties: { type: { type: 'string', enum: ['MANUAL'] } },
      },
      {
        type: 'object',
        required: ['type', 'fieldKey', 'equals'],
        properties: {
          type: { type: 'string', enum: ['FIELD_CHANGED'] },
          fieldKey: { type: 'string' },
          equals: VALUE_SCHEMA,
        },
      },
    ],
  })
  @IsObject()
  trigger!: AutomationRule['trigger'];
  @ApiProperty() @IsString() targetObjectCode!: string;
  @ApiProperty({ enum: ['ACTOR', 'SOURCE_OWNER'] })
  @IsIn(['ACTOR', 'SOURCE_OWNER'])
  owner!: AutomationRule['owner'];
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      oneOf: [
        {
          type: 'object',
          required: ['source', 'fieldKey'],
          properties: {
            source: { type: 'string', enum: ['SOURCE_FIELD'] },
            fieldKey: { type: 'string' },
          },
        },
        {
          type: 'object',
          required: ['source', 'value'],
          properties: {
            source: { type: 'string', enum: ['LITERAL'] },
            value: VALUE_SCHEMA,
          },
        },
        {
          type: 'object',
          required: ['source'],
          properties: { source: { type: 'string', enum: ['NOW', 'INPUT'] } },
        },
      ],
    },
  })
  @IsObject()
  mappings!: AutomationRule['mappings'];
}
export class SaveAutomationsDto {
  @ApiProperty() @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty({ type: AutomationRuleDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AutomationRuleDto)
  rules!: AutomationRuleDto[];
}
export class AutomationConfigurationDto {
  @ApiProperty() objectId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ type: AutomationRuleDto, isArray: true })
  publishedRules!: AutomationRuleDto[];
  @ApiProperty({ type: AutomationRuleDto, isArray: true })
  rules!: AutomationRuleDto[];
}
export class PreviewAutomationDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: VALUE_SCHEMA,
  })
  @IsObject()
  inputs!: Record<string, AutomationValue>;
}
export class PreviewDraftAutomationDto extends PreviewAutomationDto {
  @ApiProperty({ type: AutomationRuleDto })
  @ValidateNested()
  @Type(() => AutomationRuleDto)
  rule!: AutomationRuleDto;
  @ApiProperty() @IsUUID() sourceRecordId!: string;
}
export class ExecuteAutomationDto extends PreviewAutomationDto {
  @ApiProperty() @IsInt() @Min(1) expectedVersion!: number;
  @ApiProperty()
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{8,100}$/)
  requestId!: string;
}
export class AutomationInputFieldDto {
  @ApiProperty() fieldKey!: string;
  @ApiProperty() label!: string;
  @ApiProperty() type!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty({ type: Object, additionalProperties: true }) config!: Record<
    string,
    unknown
  >;
  @ApiProperty({ ...VALUE_SCHEMA })
  defaultValue!: unknown;
  @ApiProperty({ type: Object, additionalProperties: true })
  validation!: Record<string, unknown>;
}
export class RuntimeAutomationDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() targetObjectCode!: string;
  @ApiProperty() targetObjectName!: string;
  @ApiProperty({ type: AutomationInputFieldDto, isArray: true })
  inputFields!: AutomationInputFieldDto[];
}
export class RuntimeAutomationsDto {
  @ApiProperty({ type: RuntimeAutomationDto, isArray: true })
  items!: RuntimeAutomationDto[];
}
export class AutomationPreviewDto {
  @ApiProperty() ruleKey!: string;
  @ApiProperty() targetObjectCode!: string;
  @ApiProperty() targetObjectName!: string;
  @ApiProperty({ type: Object, additionalProperties: true }) values!: Record<
    string,
    unknown
  >;
  @ApiProperty() ownerMemberId!: string;
  @ApiProperty() sourceRecordId!: string;
}
export class AutomationExecutionDto {
  @ApiProperty() id!: string;
  @ApiProperty() ruleKey!: string;
  @ApiProperty() ruleLabel!: string;
  @ApiProperty({ enum: ['MANUAL', 'FIELD_CHANGED'] }) triggerType!:
    'MANUAL' | 'FIELD_CHANGED';
  @ApiProperty() sourceRecordId!: string;
  @ApiProperty() targetObjectCode!: string;
  @ApiProperty() targetRecordId!: string;
  @ApiProperty() targetRecordNo!: string;
  @ApiProperty() actorMemberId!: string;
  @ApiProperty() executedAt!: string;
  @ApiProperty() publicationId!: string;
}
export class AutomationHistoryDto {
  @ApiProperty({ type: AutomationExecutionDto, isArray: true })
  items!: AutomationExecutionDto[];
}
