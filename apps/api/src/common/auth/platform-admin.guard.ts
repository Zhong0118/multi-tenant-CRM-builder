import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

import { ApiException } from '../errors/api.exception';
import type { AuthenticatedRequest } from '../../modules/auth/session-auth.guard';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth?.user.isPlatformAdmin) {
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    }
    return true;
  }
}
