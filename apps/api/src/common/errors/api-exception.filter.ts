import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { API_ERROR_MESSAGES, type ApiErrorCode } from './api-error-code';
import { ApiException, type FieldErrors } from './api.exception';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  fieldErrors: FieldErrors;
  requestId: string;
  status: number;
}

interface RequestWithId extends Request {
  requestId?: string;
}

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  toBody(exception: unknown, requestId: string): ApiErrorBody {
    if (exception instanceof ApiException) {
      return {
        code: exception.code,
        message: exception.message,
        fieldErrors: exception.fieldErrors,
        requestId,
        status: exception.getStatus(),
      };
    }

    if (exception instanceof HttpException) {
      return {
        code: 'VALIDATION_FAILED',
        message: API_ERROR_MESSAGES.VALIDATION_FAILED,
        fieldErrors: {},
        requestId,
        status: exception.getStatus(),
      };
    }

    // An unexpected failure is a defect, not a domain outcome. The client only
    // ever sees the generic envelope, so the cause has to reach the server log
    // against its request id or it is unrecoverable in production.
    this.logger.error(
      `Unhandled failure for request ${requestId}: ${describe(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    return {
      code: 'INTERNAL_ERROR',
      message: API_ERROR_MESSAGES.INTERNAL_ERROR,
      fieldErrors: {},
      requestId,
      status: 500,
    };
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const body = this.toBody(exception, request.requestId ?? 'req_unknown');

    response.status(body.status).json(body);
  }
}

function describe(exception: unknown): string {
  if (exception instanceof Error) {
    return `${exception.name}: ${exception.message}`;
  }
  return typeof exception === 'string' ? exception : JSON.stringify(exception);
}
