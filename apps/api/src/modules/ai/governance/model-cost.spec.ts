import { estimatePlanCost } from './model-cost';
const price = { currency: 'CNY', inputPrice: '1.20', outputPrice: '2.40' };
describe('full plan estimate', () => {
  it('uses the input/output mix only when measured, otherwise gives the price range', () => {
    expect(
      estimatePlanCost('1000000', price, { input: '300', output: '100' }),
    ).toEqual({ currency: 'CNY', low: '1.5', high: '1.5', weighted: true });
    expect(
      estimatePlanCost('1000000', price, { input: '0', output: '0' }),
    ).toEqual({ currency: 'CNY', low: '1.2', high: '2.4', weighted: false });
    expect(
      estimatePlanCost(
        '1000000',
        { ...price, inputPrice: null },
        { input: '0', output: '0' },
      ),
    ).toBeNull();
  });
});
