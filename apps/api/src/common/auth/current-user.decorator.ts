import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { SessionPrincipal } from '../../modules/auth/session.service';
import type { AuthenticatedRequest } from '../../modules/auth/session-auth.guard';

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new Error('SessionAuthGuard must run before CurrentSession');
    }
    return request.auth;
  },
);
