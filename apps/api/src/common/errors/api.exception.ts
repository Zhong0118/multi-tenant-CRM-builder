import { HttpException } from '@nestjs/common';

import { API_ERROR_MESSAGES, type ApiErrorCode } from './api-error-code';

export type FieldErrors = Record<string, string[]>;

export interface ApiExceptionOptions {
  fieldErrors?: FieldErrors;
  message?: string;
}

export class ApiException extends HttpException {
  readonly code: ApiErrorCode;
  readonly fieldErrors: FieldErrors;

  constructor(
    code: ApiErrorCode,
    status: number,
    options: ApiExceptionOptions = {},
  ) {
    const message = options.message ?? API_ERROR_MESSAGES[code];
    super(message, status);
    this.code = code;
    this.fieldErrors = options.fieldErrors ?? {};
  }
}
