import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { OBJECT_CODE_REFERENCE_PATTERN } from '../objects/object-code';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateFollowUpDto {
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  @Matches(OBJECT_CODE_REFERENCE_PATTERN)
  objectCode!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() recordId!: string;
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt!: string;
  /** Company administrators may give the task to another member who can work on the record. */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;
}
export class UpdateFollowUpDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ enum: ['DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DONE', 'CANCELLED'])
  status?: 'DONE' | 'CANCELLED';
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  dueAt?: string;
}
export class FollowUpQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'OVERDUE', 'DONE', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['OPEN', 'OVERDUE', 'DONE', 'CANCELLED'])
  status?: 'OPEN' | 'OVERDUE' | 'DONE' | 'CANCELLED';
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  recordId?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
export class FollowUpResponseDto {
  @ApiProperty() assigneeName!: string;
  @ApiProperty() assigneeMemberId!: string;
  @ApiProperty() id!: string;
  @ApiProperty() recordId!: string;
  @ApiProperty() recordTitle!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: ['OPEN', 'DONE', 'CANCELLED'] }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() canManage!: boolean;
}
export class FollowUpPageDto {
  @ApiProperty({ type: FollowUpResponseDto, isArray: true })
  items!: FollowUpResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() openCount!: number;
  @ApiProperty() overdueCount!: number;
}

export class FollowUpRecipientDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
}

/**
 * Personal Workbench read model. Deliberately narrower than
 * `FollowUpResponseDto`: it carries no assignee identity, no tenant/member id,
 * no workflow status and no Record values, because a home page must not become
 * a metadata side channel (§5.3 of the design).
 *
 * `overdue` is the same flag as the full Follow-up list: `dueAt < now` on the
 * single request clock. The overdue bucket is that predicate; today starts at
 * `now`, so the flag cannot contradict the section it renders in.
 */
export class FollowUpWorkbenchItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() recordId!: string;
  @ApiProperty() recordTitle!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty() version!: number;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() canManage!: boolean;
}

export class FollowUpWorkbenchCountsDto {
  @ApiProperty() allOpen!: number;
  @ApiProperty() overdue!: number;
  @ApiProperty() today!: number;
  @ApiProperty() upcoming!: number;
}

export class FollowUpWorkbenchPreviewDto {
  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  overdue!: FollowUpWorkbenchItemDto[];

  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  today!: FollowUpWorkbenchItemDto[];

  @ApiProperty({ type: FollowUpWorkbenchItemDto, isArray: true })
  upcoming!: FollowUpWorkbenchItemDto[];
}

/**
 * A record the actor owns in the staged pool's contact stage: claimed or
 * assigned, not yet confirmed as contacted. Read from the record itself, so it
 * appears the moment a lead is claimed and leaves when contact is confirmed,
 * released or reclaimed — there is no second task row to keep in step.
 */
export class PendingContactItemDto {
  @ApiProperty() recordId!: string;
  @ApiProperty() recordTitle!: string;
  @ApiProperty() objectCode!: string;
  @ApiProperty() objectName!: string;
  /** The table's own name for the contact stage, such as 待联系 or 已加微信. */
  @ApiProperty() stageLabel!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class PendingContactsDto {
  @ApiProperty() count!: number;
  @ApiProperty({ type: PendingContactItemDto, isArray: true })
  items!: PendingContactItemDto[];
}

export class FollowUpWorkbenchResponseDto {
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: FollowUpWorkbenchCountsDto })
  counts!: FollowUpWorkbenchCountsDto;
  @ApiProperty({ type: FollowUpWorkbenchPreviewDto })
  preview!: FollowUpWorkbenchPreviewDto;
  @ApiProperty({ type: PendingContactsDto })
  pendingContacts!: PendingContactsDto;
}
