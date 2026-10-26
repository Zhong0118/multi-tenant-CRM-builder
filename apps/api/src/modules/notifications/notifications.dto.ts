import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';

export const NOTIFICATION_KINDS = [
  'CONTACT_DUE',
  'FOLLOW_UP_DUE',
  'TASK_OVERDUE',
  'POOL_RECLAIMED',
  'PROTECTION_REVIEW',
  'WORK_GOAL_BEHIND',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export class NotificationsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number;
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean;
}
export class ReadAllNotificationsDto {
  @ApiProperty()
  @IsString()
  @MaxLength(65536)
  @ValidateBy({
    name: 'notificationSnapshot',
    validator: { validate: validSnapshot },
  })
  snapshot!: string;
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  before!: string;
}
export class NotificationItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: NOTIFICATION_KINDS }) kind!: NotificationKind;
  @ApiProperty() title!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) dueAt!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt!:
    string | null;
  @ApiProperty() canOpen!: boolean;
}
export class NotificationPageDto {
  @ApiProperty() snapshot!: string;
  @ApiProperty({ type: NotificationItemDto, isArray: true })
  items!: NotificationItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty() unreadCount!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ format: 'date-time' }) serverTime!: string;
}
export class NotificationOkDto {
  @ApiProperty({ enum: [true] }) ok!: true;
}
export class NotificationTargetDto {
  @ApiProperty({ type: String, nullable: true }) href!: string | null;
}

function validSnapshot(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.length > 65536 ||
    !/^\d{1,20}:\d{1,20}:(?:\d{1,20}(?:,\d{1,20})*)?$/.test(value)
  )
    return false;
  const [low, high, pending] = value.split(':');
  const min = BigInt(low),
    max = BigInt(high);
  if (min < 1n || min > max || max > 18446744073709551615n) return false;
  let previous = min - 1n;
  for (const text of pending ? pending.split(',') : []) {
    const xid = BigInt(text);
    if (xid < min || xid >= max || xid <= previous) return false;
    previous = xid;
  }
  return true;
}
