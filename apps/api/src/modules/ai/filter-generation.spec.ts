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

it('converts quoted NUMBER bounds from model output without rounding or changing MONEY', async () => {
  const output = filterModelSchema.parse({
    match: 'all',
    conditions: [
      own,
      { fieldKey: 'amount', operator: 'gt', value: '100000' },
      {
        fieldKey: 'amount',
        operator: 'between',
        value: { from: '0.50', to: 2 },
      },
      { fieldKey: 'price', operator: 'gt', value: '100000.00' },
      { fieldKey: 'amount', operator: 'lt', value: '9007199254740993' },
      { fieldKey: 'amount', operator: 'lt', value: '0x10' },
    ],
    clarification: null,
  });
  (generateText as jest.Mock).mockResolvedValueOnce({ output });
  const provider = new VercelOpenAiProvider({
    apiKey: 'test',
    modelKey: 'test',
  });
  const preview = await provider.generateFilter(
    {
      text: '找我负责的、金额超过 10 万的记录',
      currentRule: { version: 1, match: 'all', conditions: [] },
      fields: [
        {
          fieldKey: 'amount',
          label: '金额',
          type: 'NUMBER',
          operators: ['gt', 'between', 'lt'],
        },
        { fieldKey: 'price', label: '价格', type: 'MONEY', operators: ['gt'] },
      ],
      relativeDates: [],
      followUpAssignees: ['$me'],
      today: '2026-11-23',
    },
    new AbortController().signal,
  );
  expect(preview.rules[0].conditions).toEqual([
    own,
    { fieldKey: 'amount', operator: 'gt', value: 100000 },
    { fieldKey: 'amount', operator: 'between', value: { from: 0.5, to: 2 } },
    ...output.conditions.slice(3),
  ]);
});
