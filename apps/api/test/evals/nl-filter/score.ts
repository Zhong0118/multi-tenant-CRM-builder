import type { FilterPreview, FilterRule } from '@crm/contracts';

export interface Sample {
  id: string;
  category: string;
  text: string;
  currentRule: FilterRule;
  expected:
    | Exclude<FilterPreview, { kind: 'clarify' }>
    | { kind: 'clarify'; candidates: FilterRule[] };
}

// Contract arrays contain unordered conditions, selection values, or candidates.
// JSON primitive types, duplicate entries and group boundaries stay significant.
function canonical(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(canonical).sort().join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function score(
  sample: Pick<Sample, 'expected'>,
  preview: FilterPreview,
): string[] {
  const { expected } = sample;
  if (expected.kind !== preview.kind)
    return [`期望 ${expected.kind}，得到 ${preview.kind}`];
  if (
    expected.kind === 'rule' &&
    preview.kind === 'rule' &&
    canonical(expected.rule) !== canonical(preview.rule)
  )
    return ['规则的匹配模式、条件或值与标注不同'];
  if (expected.kind === 'clarify' && preview.kind === 'clarify') {
    const { options } = preview;
    if (
      options.length < 2 ||
      options.length > 4 ||
      ['id', 'label'].some((key) => {
        const values = options.map((o) => o[key as 'id' | 'label'].trim());
        return values.includes('') || new Set(values).size !== values.length;
      })
    )
      return ['候选数量、标识或可见标签无法区分'];
    if (
      canonical(expected.candidates) !== canonical(options.map((o) => o.value))
    )
      return ['候选未完整覆盖标注，或共同条件、候选条件不符'];
  }
  return [];
}
