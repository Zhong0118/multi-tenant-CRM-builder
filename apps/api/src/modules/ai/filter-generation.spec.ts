import { z } from 'zod';
import { generateText } from 'ai';
import { editableFilterRules, filterModelSchema } from './filter-generation';
import { VercelOpenAiProvider } from './providers/vercel-openai.provider';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  Output: { object: (definition: unknown) => definition },
}));

const large = { fieldKey: 'size', operator: 'in', value: ['large'] };
const own = { fieldKey: '$owner', operator: 'in', value: ['$me'] };
const quote = { fieldKey: 'stage', operator: 'in', value: ['quote'] };
const flatOr = { version: 1, match: 'any', conditions: [own, quote] };

it('rejects the required subgroup and cannot accept two complete rules as OR branches', async () => {
  const nested = {
    match: 'all',
    conditions: [large, { match: 'any', conditions: [own, quote] }],
    clarification: null,
  };
  const text = '大型客户，而且是我负责或者处于报价阶段';
  (generateText as jest.Mock).mockResolvedValueOnce({
    output: filterModelSchema.parse(nested),
  });
  const provider = new VercelOpenAiProvider({
    apiKey: 'test',
    modelKey: 'test',
  });
  const preview = await provider.generateFilter(
    {
      text,
      currentRule: { version: 1, match: 'all', conditions: [] },
      fields: [],
      relativeDates: [],
      followUpAssignees: ['$me'],
      today: '2026-11-22',
    },
    new AbortController().signal,
  );
  expect(preview).toEqual({ rules: [] });
  expect(jest.mocked(generateText).mock.lastCall?.[0]?.output).toEqual({
    name: 'filter_preview',
    schema: filterModelSchema,
  });
  const split = [own, quote].map((term) => ({
    version: 1,
    match: 'all',
    conditions: [large, term],
  }));
  expect(filterModelSchema.safeParse({ rules: split }).success).toBe(false);
});

it('preserves root OR and complete alternatives for an ambiguous date range', () => {
  const disjunction = filterModelSchema.parse({
    match: flatOr.match,
    conditions: flatOr.conditions,
    clarification: null,
  });
  expect(editableFilterRules(disjunction, '我负责或处于报价阶段')).toEqual({
    rules: [flatOr],
  });
  const interpretations = ['past_7_days', 'past_30_days'].map((value) => [
    { fieldKey: 'contacted', operator: 'relative', value },
  ]);
  const ambiguous = filterModelSchema.parse({
    match: 'all',
    conditions: [own],
    clarification: { phrase: '最近', interpretations },
  });
  expect(editableFilterRules(ambiguous, '我负责且最近联系过的客户')).toEqual({
    rules: interpretations.map((terms) => ({
      version: 1,
      match: 'all',
      conditions: [own, ...terms],
    })),
  });
  expect(editableFilterRules(ambiguous, '我负责的客户')).toEqual({ rules: [] });
});

it('declares an explicit JSON type for each DeepSeek union alternative', () => {
  const declared: unknown[] = [];
  JSON.stringify(z.toJSONSchema(filterModelSchema), (_key, value: unknown) => {
    if (
      value &&
      typeof value === 'object' &&
      'anyOf' in value &&
      Array.isArray(value.anyOf)
    )
      for (const variant of value.anyOf as unknown[]) {
        declared.push(
          variant && typeof variant === 'object' && 'type' in variant
            ? variant.type
            : undefined,
        );
      }
    return value;
  });
  expect(declared.length).toBeGreaterThan(0);
  expect(declared).not.toContain(undefined);
});
