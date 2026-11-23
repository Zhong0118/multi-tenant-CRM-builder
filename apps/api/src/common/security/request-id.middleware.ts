import { Injectable, type NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const requestExecution = new AsyncLocalStorage<{
  requestId: string;
  // This server-created map lives for one HTTP request, even when a client reuses its ID.
  aiRatePermits: Map<string, Promise<void>>;
}>();
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;

export interface RequestWithId extends Request {
  requestId: string;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
        ? incoming
        : randomUUID();

    (request as RequestWithId).requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    requestExecution.run({ requestId, aiRatePermits: new Map() }, next);
  }
}
