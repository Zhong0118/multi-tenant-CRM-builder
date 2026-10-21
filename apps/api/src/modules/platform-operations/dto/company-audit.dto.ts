import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

import {
  PlatformAuditItemDto,
  PlatformAuditQueryDto,
} from './platform-operations.dto';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The company audit accepts the platform filters (a `tenantId` is accepted and
 * ignored: the company is always the caller's own) plus who acted and when.
 *
 * `resourceType` is an exact match against a comma-separated list, so「业务记录」
 * (`record`) does not also return attachments (`record_attachment`) and「业务表」
 * can cover both `object_definition` and `object`.
 */
export class CompanyAuditQueryDto extends PlatformAuditQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The acting user (a member’s userId).',
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({
    example: '2026-10-14',
    description: 'First calendar day, inclusive, in the company’s timezone.',
  })
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE)
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-20',
    description: 'Last calendar day, inclusive, in the company’s timezone.',
  })
  @IsOptional()
  @IsString()
  @Matches(CALENDAR_DATE)
  @IsISO8601({ strict: true })
  to?: string;
}

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

/** One changed key between `before` and `after`, with names already resolved. */
export class CompanyAuditChangeDto {
  @ApiProperty({ description: 'Field key or top-level payload key.' })
  key!: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The business field label when the key is a record field.',
  })
  label!: string | null;
  @ApiProperty(JSON_VALUE_SCHEMA) before!: unknown;
  @ApiProperty(JSON_VALUE_SCHEMA) after!: unknown;
}

export class CompanyAuditItemDto extends PlatformAuditItemDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Human name of the resource: record title, business table, member, …',
  })
  resourceName!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The business table the resource belongs to.',
  })
  objectName!: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Title of the record a follow-up, attachment or activity belongs to.',
  })
  recordTitle!: string | null;
  @ApiPropertyOptional({
    type: CompanyAuditChangeDto,
    isArray: true,
    nullable: true,
    description: 'Changed keys when both before and after are objects.',
  })
  changes!: CompanyAuditChangeDto[] | null;
}

export class CompanyAuditPageDto {
  @ApiProperty({ type: CompanyAuditItemDto, isArray: true })
  items!: CompanyAuditItemDto[];
  @ApiProperty({ type: Number, minimum: 1 }) page!: number;
  @ApiProperty({ type: Number, minimum: 1, maximum: 100 }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ example: 'Asia/Shanghai' }) timezone!: string;
}
