import type { ExecutionContext } from '@nestjs/common';

import { WorkspaceGuard } from './workspace.guard';

const active = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  tenantCode: 'company-one',
  tenantName: '公司一',
  tenantStatus: 'ACTIVE' as const,
  memberId: 'member-1',
  memberStatus: 'ACTIVE' as const,
  role: 'EMPLOYEE' as const,
};

describe('WorkspaceGuard', () => {
  it('attaches a verified tenant context', async () => {
    const request = {
      params: { tenantCode: 'company-one' },
      auth: { user: { id: 'user-1' } },
    };
    const guard = new WorkspaceGuard({
      resolve: jest.fn().mockResolvedValue(active),
    });
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request).toMatchObject({
      tenantContext: {
        userId: 'user-1',
        tenantId: 'tenant-1',
        tenantCode: 'company-one',
        memberId: 'member-1',
        role: 'EMPLOYEE',
      },
    });
  });

  it('rejects a disabled membership distinctly', async () => {
    const request = {
      params: { tenantCode: 'company-one' },
      auth: { user: { id: 'user-1' } },
    };
    const guard = new WorkspaceGuard({
      resolve: jest
        .fn()
        .mockResolvedValue({ ...active, memberStatus: 'DISABLED' }),
    });
    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({
      code: 'MEMBERSHIP_INACTIVE',
    });
  });
});

function contextFor(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
