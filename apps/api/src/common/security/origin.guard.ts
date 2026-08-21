import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { ApiException } from '../errors/api.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const allowedOrigins = this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000,http://127.0.0.1:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (
      !request.headers.origin ||
      !allowedOrigins.includes(request.headers.origin)
    ) {
      throw new ApiException('CSRF_REJECTED', 403);
    }

    return true;
  }
}
