import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiException } from '../errors/api.exception';
import type { AuthenticatedRequest } from '../../modules/auth/session-auth.guard';
import type { TenantContext } from './tenant-context';

export const WORKSPACE_RESOLVER = Symbol('WORKSPACE_RESOLVER');

export interface WorkspaceResolution extends TenantContext {
  tenantName: string;
  tenantStatus: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  memberStatus: 'ACTIVE' | 'DISABLED';
}

export interface WorkspaceResolver {
  resolve(
    userId: string,
    tenantCode: string,
  ): Promise<WorkspaceResolution | null>;
}

export interface WorkspaceRequest extends AuthenticatedRequest {
  tenantContext?: TenantContext;
  workspace?: WorkspaceResolution;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @Inject(WORKSPACE_RESOLVER) private readonly resolver: WorkspaceResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const userId = request.auth?.user.id;
    const tenantCodeValue = request.params.tenantCode;
    const tenantCode = Array.isArray(tenantCodeValue)
      ? tenantCodeValue[0]
      : tenantCodeValue;
    if (!userId || !tenantCode)
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);

    const workspace = await this.resolver.resolve(userId, tenantCode);
    if (!workspace) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    if (workspace.memberStatus !== 'ACTIVE') {
      throw new ApiException('MEMBERSHIP_INACTIVE', 403);
    }
    if (workspace.tenantStatus !== 'ACTIVE') {
      throw new ApiException('TENANT_INACTIVE', 403);
    }
    request.workspace = workspace;
    request.tenantContext = {
      userId: workspace.userId,
      tenantId: workspace.tenantId,
      tenantCode: workspace.tenantCode,
      memberId: workspace.memberId,
      role: workspace.role,
    };
    return true;
  }
}
