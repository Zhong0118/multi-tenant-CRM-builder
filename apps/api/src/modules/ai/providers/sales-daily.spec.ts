import { z } from 'zod';
import { FakeAiProvider } from './fake-ai.provider';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
describe('sales daily provider', () => {
  it('generates from the supplied facts and marks an actual send once', async () => {
    const onSend = jest.fn();
    const result = await new FakeAiProvider().generateSalesDaily({
      actor: {} as TenantContext,
      feature: 'daily_brief',
      system: 'fixture',
      schema: z.unknown(),
      prompt: JSON.stringify({
        records: [{ recordRef: 'R1', facts: [{ ref: 'F1' }] }],
      }),
      onSend,
    });
    expect(result).toMatchObject({
      items: [{ recordRef: 'R1', reasonFactRefs: ['F1'] }],
    });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
