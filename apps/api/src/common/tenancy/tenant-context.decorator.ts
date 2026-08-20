import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { TenantContext } from './tenant-context';
import type { WorkspaceRequest } from './workspace.guard';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.tenantContext)
      throw new Error('WorkspaceGuard must run before CurrentTenant');
    return request.tenantContext;
  },
);

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.workspace)
      throw new Error('WorkspaceGuard must run before CurrentWorkspace');
    return request.workspace;
  },
);
