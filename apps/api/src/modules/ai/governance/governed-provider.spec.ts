import { ConfigService } from '@nestjs/config';
import { governedProvider } from './governed-provider';
import { InMemoryRateLimiter } from '../../../infrastructure/rate-limit/rate-limiter';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
const actor = { tenantId: 't', memberId: 'm' } as TenantContext;
const base = {
  purpose: 'text',
  providerId: 'p',
  provider: 'custom',
  revisionId: 'r',
  assignmentVersion: 1,
  model: 'first',
  protocol: 'chat',
  baseURL: 'https://example.test/v1',
  apiKey: 'fixture',
  contextTokens: 64000,
  maxOutputTokens: 16000,
  inputPrice: '1',
  outputPrice: '2',
  currency: 'USD',
};
it('reads the committed assignment for every request, holds the in-flight model and propagates resolution failures', async () => {
  const resolve = jest
    .fn()
    .mockResolvedValueOnce(base)
    .mockResolvedValueOnce({ ...base, model: 'next', assignmentVersion: 2 })
    .mockRejectedValueOnce(new Error('unavailable'));
  const provider = governedProvider.useFactory(
    new ConfigService({
      NODE_ENV: 'development',
      AI_PROVIDER: 'openai',
      AI_MODEL: 'legacy',
      AI_API_KEY: 'fixture',
    }),
    {} as never,
    new InMemoryRateLimiter(),
    { resolve } as never,
  );
  const first = await provider.resolveText(actor);
  const next = await provider.resolveText(actor);
  expect([first.modelKey, next.modelKey]).toEqual(['first', 'next']);
  await expect(provider.resolveText(actor)).rejects.toThrow('unavailable');
  resolve.mockResolvedValueOnce(null);
  expect((await provider.resolveText(actor)).modelKey).toBe('legacy');
  expect(resolve).toHaveBeenCalledTimes(4);
});
