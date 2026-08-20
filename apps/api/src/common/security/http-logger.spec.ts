import { HTTP_LOG_REDACT_PATHS } from './http-logger';

describe('HTTP logger redaction', () => {
  it('redacts session-bearing request and response headers', () => {
    expect(HTTP_LOG_REDACT_PATHS).toEqual(
      expect.arrayContaining(['req.headers.cookie', 'res.headers.set-cookie']),
    );
  });
});
