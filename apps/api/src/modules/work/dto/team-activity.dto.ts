import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import { PERIOD_PRESETS } from '../company-calendar';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TeamActivityQueryDto {
  @ApiPropertyOptional({
    enum: PERIOD_PRESETS,
    description:
      'A period resolved in the company timezone (weeks start on Monday). Wins over from/to.',
  })
  @IsOptional()
  @IsIn(PERIOD_PRESETS)
  preset?: (typeof PERIOD_PRESETS)[number];

  @ApiPropertyOptional({
    example: '2026-10-22',
    description:
      'First day, inclusive, in the company timezone. Default: today.',
  })
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-22',
    description:
      'Last day, inclusive, in the company timezone. Default: the first day.',
  })
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE)
  @IsISO8601({ strict: true })
  to?: string;
}

export class TeamActivityCountsDto {
  @ApiProperty({ description: 'Calls logged (电话 activities).' })
  calls!: number;
  @ApiProperty({ description: 'Calls logged with the outcome 已接通.' })
  connectedCalls!: number;
  @ApiProperty({ description: 'Messages logged (微信/消息 activities).' })
  messages!: number;
  @ApiProperty({
    description:
      'Customers explicitly logged as newly added on WeChat; each member–customer pair once, in the period of its first entry.',
  })
  wechatAdded!: number;
  @ApiProperty({ description: 'Visits logged (拜访 activities).' })
  visits!: number;
  @ApiProperty({ description: 'Notes logged (备注 activities).' })
  notes!: number;
  @ApiProperty({
    description:
      'Distinct records on customer-pool tables with a call, message or visit.',
  })
  customersFollowed!: number;
  @ApiProperty() leadsClaimed!: number;
  @ApiProperty() contactsConfirmed!: number;
  @ApiProperty() recordsCreated!: number;
  @ApiProperty() followUpsDone!: number;
  @ApiProperty({ description: 'Open customer follow-ups past due right now.' })
  followUpsOverdue!: number;
  @ApiProperty({
    description:
      'Customer follow-ups due in the period and not completed by their due time.',
  })
  followUpsOverdueInPeriod!: number;
  @ApiProperty() tasksDone!: number;
  @ApiProperty({ description: 'Open work tasks past due right now.' })
  tasksOverdue!: number;
  @ApiProperty({
    description:
      'Work tasks due in the period and not completed by their due time.',
  })
  tasksOverdueInPeriod!: number;
  @ApiProperty({
    description: 'Daily reports saved for work dates in the period.',
  })
  reportsWritten!: number;
}

export class TeamActivityMemberDto extends TeamActivityCountsDto {
  @ApiProperty({ format: 'uuid' }) memberId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['TENANT_ADMIN', 'EMPLOYEE'] }) role!:
    'TENANT_ADMIN' | 'EMPLOYEE';
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] }) status!: 'ACTIVE' | 'DISABLED';
}

export class TeamActivityResponseDto {
  @ApiProperty() timezone!: string;
  @ApiProperty({ description: 'Today in the company calendar.' })
  today!: string;
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: TeamActivityMemberDto, isArray: true })
  members!: TeamActivityMemberDto[];
  @ApiProperty({ type: TeamActivityCountsDto }) totals!: TeamActivityCountsDto;
}
