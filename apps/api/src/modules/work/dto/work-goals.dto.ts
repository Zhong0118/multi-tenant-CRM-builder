import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
export const GOAL_METRICS = [
  'calls',
  'connectedCalls',
  'wechatAdded',
  'customersFollowed',
  'followUpsDone',
  'tasksDone',
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
const AUDIENCES = ['ALL_EMPLOYEES', 'SELECTED_MEMBERS'] as const;
export class SaveWorkGoalDto {
  @ApiProperty() @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @ApiProperty({ minimum: 1, maximum: 100000 })
  @IsInt()
  @Min(1)
  @Max(100000)
  target!: number;
  @ApiProperty({ example: '17:00' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  remindAt!: string;
  @ApiProperty({ type: Number, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  weekdays!: number[];
  @ApiProperty({ enum: AUDIENCES })
  @IsIn(AUDIENCES)
  audience!: (typeof AUDIENCES)[number];
  @ApiProperty({ type: String, isArray: true, format: 'uuid' })
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  memberIds!: string[];
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
export class WorkGoalDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: GOAL_METRICS }) metric!: GoalMetric;
  @ApiProperty() target!: number;
  @ApiProperty() remindAt!: string;
  @ApiProperty({ type: Number, isArray: true }) weekdays!: number[];
  @ApiProperty({ enum: AUDIENCES }) audience!: (typeof AUDIENCES)[number];
  @ApiProperty({ type: String, isArray: true }) memberIds!: string[];
  @ApiProperty() enabled!: boolean;
  @ApiProperty() version!: number;
}
export class WorkGoalMemberDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}
export class WorkGoalSettingsDto {
  @ApiProperty() timezone!: string;
  @ApiProperty({ type: WorkGoalDto, isArray: true }) rules!: WorkGoalDto[];
  @ApiProperty({ type: WorkGoalMemberDto, isArray: true })
  members!: WorkGoalMemberDto[];
}
export class WorkGoalProgressQueryDto {
  @ApiPropertyOptional({ enum: ['mine', 'team'], default: 'mine' })
  @IsOptional()
  @IsIn(['mine', 'team'])
  scope?: 'mine' | 'team';
}
export class WorkGoalProgressItemDto {
  @ApiProperty() ruleId!: string;
  @ApiProperty({ enum: GOAL_METRICS }) metric!: GoalMetric;
  @ApiProperty() memberId!: string;
  @ApiProperty() memberName!: string;
  @ApiProperty() target!: number;
  @ApiProperty() actual!: number;
  @ApiProperty() remindAt!: string;
  @ApiProperty() scheduledToday!: boolean;
}
export class WorkGoalProgressDto {
  @ApiProperty() timezone!: string;
  @ApiProperty() today!: string;
  @ApiProperty({ type: WorkGoalProgressItemDto, isArray: true })
  items!: WorkGoalProgressItemDto[];
}
