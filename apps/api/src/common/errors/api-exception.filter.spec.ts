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
