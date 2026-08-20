import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
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
