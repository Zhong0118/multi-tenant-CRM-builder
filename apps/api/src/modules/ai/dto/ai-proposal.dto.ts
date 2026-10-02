import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConfirmAiProposalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  idempotencyKey!: string;
}

export class AiProposalChangeDto {
  @ApiProperty() label!: string;
  @ApiPropertyOptional() before?: string;
  @ApiPropertyOptional() after?: string;
}

export class AiProposalResponseDto {
  @ApiProperty({ format: 'uuid' }) proposalId!: string;
  @ApiProperty({
    enum: ['UPDATE_RECORD', 'CREATE_FOLLOW_UP', 'ADD_ACTIVITY_NOTE'],
  })
  operation!: string;
  @ApiProperty({
    enum: [
      'PROPOSED',
      'REJECTED',
      'EXPIRED',
      'CONFLICTED',
      'FAILED',
      'EXECUTED',
    ],
  })
  status!: string;
  @ApiProperty() title!: string;
  @ApiProperty() targetSummary!: string;
  @ApiProperty({ type: AiProposalChangeDto, isArray: true })
  changes!: AiProposalChangeDto[];
  @ApiProperty({ type: String, isArray: true }) validationWarnings!: string[];
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) failureCode!:
    string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  })
  fieldErrors!: Record<string, string[]>;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'uuid' })
  auditId!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  result!: object | null;
}
