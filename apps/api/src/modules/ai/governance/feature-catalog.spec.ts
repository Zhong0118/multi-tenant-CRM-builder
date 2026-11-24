import { feature } from './admin.contract';
import { validatePlan } from './admin-platform.service';
import { featureCatalog } from './feature-catalog';

describe('published AI plan capabilities', () => {
  it('lists the three daily tools but rejects selecting any of them', () => {
    expect(
      featureCatalog.filter((item) => !item.released).map((item) => item.key),
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
      ).toThrow();
    }
  });
});
