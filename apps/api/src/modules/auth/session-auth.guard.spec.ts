import type { ExecutionContext } from '@nestjs/common';

import { SessionAuthGuard } from './session-auth.guard';

describe('SessionAuthGuard', () => {
  it('rejects a request without the session cookie', async () => {
    const guard = new SessionAuthGuard({ authenticate: jest.fn() } as never);
    const request = { cookies: {} };

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
  });

  it('authenticates the opaque cookie and attaches only the principal', async () => {
    const principal = {
      sessionId: 'session-1',
      user: { id: 'user-1', phone: '+8613800138000', isPlatformAdmin: false },
    };
    const authenticate = jest.fn().mockResolvedValue(principal);
    const guard = new SessionAuthGuard({ authenticate } as never);
    const request = { cookies: { crm_session: 'opaque-token' } };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('opaque-token');
    expect(request).toMatchObject({ auth: principal });
  });
});

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
