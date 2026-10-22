import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class TeamActivityQueryDto {
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
  @ApiProperty() calls!: number;
  @ApiProperty() messages!: number;
  @ApiProperty() visits!: number;
  @ApiProperty() notes!: number;
  @ApiProperty() customersFollowed!: number;
  @ApiProperty() contactsConfirmed!: number;
  @ApiProperty() leadsClaimed!: number;
  @ApiProperty() tasksDone!: number;
  @ApiProperty() tasksOverdue!: number;
  @ApiProperty() recordsCreated!: number;
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
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty({ type: TeamActivityMemberDto, isArray: true })
  members!: TeamActivityMemberDto[];
  @ApiProperty({ type: TeamActivityCountsDto }) totals!: TeamActivityCountsDto;
}
