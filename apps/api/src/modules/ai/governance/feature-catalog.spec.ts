import { feature } from './admin.contract';
import { validatePlan } from './admin-platform.service';
import { featureCatalog } from './feature-catalog';

describe('published AI plan capabilities', () => {
  it('publishes the three daily tools for explicit individual grants', () => {
    expect(
      featureCatalog
        .filter((item) => item.released && item.group === '销售日常')
        .map((item) => item.key),
    ).toEqual(['daily_brief', 'writing', 'daily_report']);
    for (const key of ['daily_brief', 'writing', 'daily_report']) {
      const value = feature.parse(key);
      expect(() =>
        validatePlan({
          name: '试用',
          description: '',
          assignable: true,
          monthlyTokens: '10',
          features: [value],
        }),
      ).not.toThrow();
    }
  });
});

it('offers import assistance independently as a metered data-processing feature', () => {
  expect(feature.parse('import_assist')).toBe('import_assist');
  expect(featureCatalog).toContainEqual({
    key: 'import_assist',
    label: 'AI 导入',
    purpose: 'text',
    group: '数据处理',
    requires: null,
    released: true,
    outputLimit: 4000,
  });
});
