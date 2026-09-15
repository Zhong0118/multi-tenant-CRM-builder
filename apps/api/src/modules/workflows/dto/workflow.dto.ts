import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { WORKFLOW_KEY_PATTERN, WORKFLOW_ROLES } from '../workflow.types';

export class WorkflowStateDraftDto {
  @ApiProperty({ example: 'new' })
  @IsString()
  @Matches(WORKFLOW_KEY_PATTERN)
  key!: string;

  @ApiProperty({ example: '新建' })
  @IsString()
  @MaxLength(100)
  label!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;

  @ApiProperty()
  @IsBoolean()
  isTerminal!: boolean;
}

export class WorkflowTransitionDraftDto {
  @ApiProperty({ example: 'mark-won' })
  @IsString()
  @Matches(WORKFLOW_KEY_PATTERN)
  key!: string;

  @ApiProperty({ example: '标记赢单' })
  @IsString()
  @MaxLength(100)
  label!: string;

  @ApiProperty()
  @IsString()
  @Matches(WORKFLOW_KEY_PATTERN)
  fromStateKey!: string;

  @ApiProperty()
  @IsString()
  @Matches(WORKFLOW_KEY_PATTERN)
  toStateKey!: string;

  @ApiProperty({ enum: WORKFLOW_ROLES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(WORKFLOW_ROLES, { each: true })
  allowedRoles!: Array<(typeof WORKFLOW_ROLES)[number]>;

  @ApiProperty({ type: String, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  requiredFieldKeys!: string[];

  @ApiProperty()
  @IsInt()
  @Min(0)
  sortOrder!: number;
}

export class SaveWorkflowDraftDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedDraftRevision!: number;

  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;

  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @Matches(WORKFLOW_KEY_PATTERN)
  initialStateKey!: string | null;

  @ApiProperty({ type: WorkflowStateDraftDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStateDraftDto)
  states!: WorkflowStateDraftDto[];

  @ApiProperty({ type: WorkflowTransitionDraftDto, isArray: true })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowTransitionDraftDto)
  transitions!: WorkflowTransitionDraftDto[];
}

export class WorkflowDraftResponseDto {
  @ApiProperty() isEnabled!: boolean;
  @ApiPropertyOptional({ nullable: true }) initialStateKey!: string | null;
  @ApiProperty({ type: WorkflowStateDraftDto, isArray: true })
  states!: WorkflowStateDraftDto[];
  @ApiProperty({ type: WorkflowTransitionDraftDto, isArray: true })
  transitions!: WorkflowTransitionDraftDto[];
  @ApiProperty() objectVersion!: number;
}

export class ExecuteWorkflowTransitionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class RuntimeWorkflowStateDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() isTerminal!: boolean;
}

export class RuntimeAvailableTransitionDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional() toState?: { key: string; label: string };
  @ApiProperty({ type: String, isArray: true }) requiredFieldKeys!: string[];
}

export class RuntimeWorkflowResponseDto {
  @ApiPropertyOptional({ type: RuntimeWorkflowStateDto, nullable: true })
  currentState!: RuntimeWorkflowStateDto | null;
  @ApiProperty({ type: RuntimeAvailableTransitionDto, isArray: true })
  availableTransitions!: RuntimeAvailableTransitionDto[];
  @ApiProperty() recordVersion!: number;
}

export class WorkflowHistoryItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() transitionKey!: string;
  @ApiProperty() transitionLabel!: string;
  @ApiPropertyOptional({ nullable: true }) fromStateKey!: string | null;
  @ApiPropertyOptional({ nullable: true }) fromStateLabel!: string | null;
  @ApiProperty() toStateKey!: string;
  @ApiProperty() toStateLabel!: string;
  @ApiProperty() actorMemberId!: string;
  @ApiPropertyOptional({ nullable: true }) actorDisplayName!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WorkflowHistoryPageDto {
  @ApiProperty({ type: WorkflowHistoryItemDto, isArray: true })
  items!: WorkflowHistoryItemDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}

export class WorkflowHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}
