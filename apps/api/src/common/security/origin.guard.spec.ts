import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';

import { ApiException } from '../errors/api.exception';
import { OriginGuard } from './origin.guard';

function contextFor(method: string, origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, headers: { origin } }),
    }),
  } as unknown as ExecutionContext;
}

describe('OriginGuard', () => {
  const config = {
    get: jest.fn(() => 'http://localhost:3000'),
  } as unknown as ConfigService;
  const guard = new OriginGuard(config);

  it('permits safe methods without an Origin header', () => {
    expect(guard.canActivate(contextFor('GET'))).toBe(true);
  });

  it('permits an exact configured origin for unsafe methods', () => {
    expect(guard.canActivate(contextFor('POST', 'http://localhost:3000'))).toBe(
      true,
    );
  });

  it('rejects missing or mismatched origins for unsafe methods', () => {
    expect(() => guard.canActivate(contextFor('POST'))).toThrow(ApiException);
    expect(() =>
      guard.canActivate(contextFor('POST', 'http://localhost:3000.evil.test')),
    ).toThrow(ApiException);
  });
});
