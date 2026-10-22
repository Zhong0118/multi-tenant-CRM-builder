import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { TeamActivityCountsDto } from './team-activity.dto';

const TASK_STATUSES = ['OPEN', 'DONE', 'CANCELLED'] as const;

export class WorkTaskQueryDto {
  @ApiPropertyOptional({
    enum: ['mine', 'team'],
    description: 'team: every member’s tasks (administrators only).',
  })
  @IsOptional()
  @IsIn(['mine', 'team'])
  scope?: 'mine' | 'team';

  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateWorkTaskDto {
  @ApiProperty({ maxLength: 200 }) @IsString() @MaxLength(200) title!: string;
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  dueAt!: string;
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Defaults to the acting member; others only for administrators.',
  })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;
}

export class UpdateWorkTaskDto {
  @ApiProperty() @IsInt() @Min(1) version!: number;
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString({ strict: true })
  dueAt?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string;
  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];
  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  result?: string;
}

export class WorkTaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() notes!: string;
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ enum: TASK_STATUSES }) status!: (typeof TASK_STATUSES)[number];
  @ApiProperty() result!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty() overdue!: boolean;
  @ApiProperty({ format: 'uuid' }) assigneeMemberId!: string;
  @ApiProperty() assigneeName!: string;
  @ApiProperty({ format: 'uuid' }) createdByMemberId!: string;
  @ApiProperty() createdByName!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ description: 'May complete, reopen and record the result.' })
  canComplete!: boolean;
  @ApiProperty({ description: 'May change the plan or cancel.' })
  canManage!: boolean;
  @ApiProperty({ description: 'May hand the task to another member.' })
  canReassign!: boolean;
}

export class WorkTaskPageDto {
  @ApiProperty({ type: WorkTaskDto, isArray: true }) items!: WorkTaskDto[];
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
}

export class SaveDailyReportDto {
  @ApiProperty({
    description: '0 creates the report; otherwise the version being edited.',
  })
  @IsInt()
  @Min(0)
  version!: number;
  @ApiProperty({ maxLength: 4000 }) @IsString() @MaxLength(4000) plans!: string;
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  completed!: string;
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  problems!: string;
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  nextSteps!: string;
}

export class DailyReportDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() workDate!: string;
  @ApiProperty() plans!: string;
  @ApiProperty() completed!: string;
  @ApiProperty() problems!: string;
  @ApiProperty() nextSteps!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class DailyReportTaskDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: TASK_STATUSES }) status!: (typeof TASK_STATUSES)[number];
  @ApiProperty({ format: 'date-time' }) dueAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty() result!: string;
}

export class DailyReportReferenceDto {
  @ApiProperty({ type: TeamActivityCountsDto }) counts!: TeamActivityCountsDto;
  @ApiProperty({ type: DailyReportTaskDto, isArray: true })
  tasks!: DailyReportTaskDto[];
}

export class DailyReportViewDto {
  @ApiProperty() workDate!: string;
  @ApiProperty() today!: string;
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty() memberName!: string;
  @ApiProperty() canEdit!: boolean;
  @ApiProperty({ type: DailyReportDto, nullable: true })
  report!: DailyReportDto | null;
  @ApiProperty({ type: DailyReportReferenceDto })
  reference!: DailyReportReferenceDto;
}

export class DailyReportListItemDto {
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty() memberName!: string;
  @ApiProperty({ type: DailyReportDto, nullable: true })
  report!: DailyReportDto | null;
}

export class DailyReportListDto {
  @ApiProperty() workDate!: string;
  @ApiProperty({ type: DailyReportListItemDto, isArray: true })
  items!: DailyReportListItemDto[];
}
