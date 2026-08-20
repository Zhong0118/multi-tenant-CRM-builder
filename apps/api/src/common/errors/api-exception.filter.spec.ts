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
});
