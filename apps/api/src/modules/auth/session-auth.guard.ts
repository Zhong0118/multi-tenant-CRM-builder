import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApiException } from '../../common/errors/api.exception';
import { SessionService, type SessionPrincipal } from './session.service';

export const SESSION_COOKIE_NAME = 'crm_session';

export interface AuthenticatedRequest extends Request {
  auth?: SessionPrincipal;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    request.auth = await this.sessions.authenticate(token);
    return true;
  }
}
