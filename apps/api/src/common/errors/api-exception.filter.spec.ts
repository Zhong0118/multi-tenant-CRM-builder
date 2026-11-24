import { Logger } from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';
import { ApiException } from './api.exception';

describe('ApiExceptionFilter', () => {
  it('renders the stable public error contract', () => {
    const filter = new ApiExceptionFilter();

    expect(
      filter.toBody(new ApiException('AUTH_REQUIRED', 401), 'req_test'),
    ).toEqual({
      code: 'AUTH_REQUIRED',
      message: '请先登录。',
      fieldErrors: {},
      requestId: 'req_test',
      status: 401,
    });
  });

  it('renders oversized body-parser requests as 413 without logging a server failure', () => {
    const filter = new ApiExceptionFilter();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
      statusCode: 413,
      limit: 102400,
      length: 214402,
    });

    try {
      expect(filter.toBody(tooLarge, 'req_413')).toEqual({
        code: 'VALIDATION_FAILED',
        message: '请求内容过大，请减少内容或分批提交。',
        fieldErrors: {},
        requestId: 'req_413',
        status: 413,
      });
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('logs an unexpected failure against its request id without leaking it', () => {
    const filter = new ApiExceptionFilter();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const body = filter.toBody(new Error('column does not exist'), 'req_500');

    expect(body).toEqual({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用，请稍后重试。',
      fieldErrors: {},
      requestId: 'req_500',
      status: 500,
    });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('req_500');
    expect(String(error.mock.calls[0][0])).toContain('column does not exist');
    error.mockRestore();
  });

  it('keeps model-request parse errors and unexpected exceptions out of logs', () => {
    const filter = new ApiExceptionFilter();
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const secret = 'model-secret-test-sentinel';
    try {
      const invalid = Object.assign(new SyntaxError(secret), {
        type: 'entity.parse.failed',
        status: 400,
      });
      const bad = filter.toBody(invalid, 'req_model', true);
      const failed = filter.toBody(new Error(secret), 'req_model', true);
      expect(bad.status).toBe(400);
      expect(failed.status).toBe(500);
      expect(
        JSON.stringify([bad, failed, log.mock.calls]).includes(secret),
      ).toBe(false);
    } finally {
      log.mockRestore();
    }
  });

  it('does not log an expected domain error', () => {
    const filter = new ApiExceptionFilter();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    filter.toBody(new ApiException('OBJECT_NOT_FOUND', 404), 'req_404');

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
