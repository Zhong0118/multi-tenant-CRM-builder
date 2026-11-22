import { z } from 'zod';
import { parseFilterRule } from '@crm/contracts';
import { ApiException } from '../../../common/errors/api.exception';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class StartAiTurnDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  content!: string;
}

const text = z.string().regex(/\S/);
const optionId = text.max(80);
export const answerSchema = z.union([
  z.strictObject({ kind: z.literal('choose_record'), optionId }),
  z.strictObject({ kind: z.literal('choose_option'), optionId }),
  z.strictObject({
    kind: z.literal('choose_option'),
    otherText: text.max(4000),
  }),
  z.strictObject({
    kind: z.literal('fill_fields'),
    values: z.record(z.string(), z.unknown()),
  }),
]);
const hint = z.strictObject({
  objectCode: text.max(64),
  recordId: z.uuid().optional(),
  viewId: z.uuid().optional(),
});
const assistantTurn = z.union([
  z.strictObject({
    conversationId: z.uuid().optional(),
    content: text,
    context: hint.optional(),
    filterDraft: z.unknown().optional(),
  }),
  z.strictObject({ conversationId: z.uuid(), regenerateProposalId: z.uuid() }),
  z.strictObject({
    conversationId: z.uuid(),
    answer: z.strictObject({ questionId: z.uuid(), value: answerSchema }),
    context: hint.optional(),
  }),
]);
export const assistantTurnOpenApi = z.toJSONSchema(assistantTurn, {
  target: 'openapi-3.0',
  io: 'input',
});

export function parseAssistantTurn(value: unknown) {
  const result = assistantTurn.safeParse(value);
  if (!result.success) throw new ApiException('VALIDATION_FAILED', 400);
  if ('answer' in result.data || 'regenerateProposalId' in result.data)
    return result.data;
  const { filterDraft, ...start } = result.data;
  if (filterDraft === undefined) return start;
  try {
    return { ...start, filterDraft: parseFilterRule(filterDraft) };
  } catch {
    throw new ApiException('RECORD_FILTER_INVALID', 400);
  }
}
