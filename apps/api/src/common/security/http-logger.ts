import { pinoHttp } from 'pino-http';

export const HTTP_LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers.set-cookie',
];

export function createHttpLogger() {
  return pinoHttp({
    redact: {
      paths: HTTP_LOG_REDACT_PATHS,
      censor: '[Redacted]',
    },
  });
}
