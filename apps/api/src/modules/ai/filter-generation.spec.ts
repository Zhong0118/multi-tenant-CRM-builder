import { z } from 'zod';
import { filterWireSchema } from './filter-generation';

it('declares an explicit JSON type for each DeepSeek union alternative', () => {
  const declared: unknown[] = [];
  JSON.stringify(z.toJSONSchema(filterWireSchema), (_key, value: unknown) => {
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
