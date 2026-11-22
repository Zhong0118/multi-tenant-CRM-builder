import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsUUID,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiProposalChangeDto } from './ai-proposal.dto';

export class ConfirmBatchItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() proposalId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() idempotencyKey!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @ValidateIf((_object, value) => value !== undefined)
  @IsObject()
  edits?: Record<string, unknown>;
}
export class ConfirmAiBatchDto {
  @ApiProperty({ type: [ConfirmBatchItemDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConfirmBatchItemDto)
  items!: ConfirmBatchItemDto[];
}
class ConfirmBatchResultItemDto {
  @ApiProperty({ format: 'uuid' }) proposalId!: string;
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
  @ApiProperty() message!: string;
  @ApiProperty({ type: [AiProposalChangeDto] }) changes!: AiProposalChangeDto[];
}
export class ConfirmAiBatchResultDto {
  @ApiProperty({ type: [ConfirmBatchResultItemDto] })
  items!: ConfirmBatchResultItemDto[];
}
