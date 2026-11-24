import { pinoHttp } from 'pino-http';

export const HTTP_LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers.set-cookie',
];

export function isModelAdminPath(url?: string): boolean {
  return /^\/api\/v1\/platform\/ai-models(?:[/?]|$)/i.test(url ?? '');
}

export function createHttpLogger() {
  return pinoHttp({
    autoLogging: {
      ignore: (req) => isModelAdminPath(req.url),
    },
    redact: {
      paths: HTTP_LOG_REDACT_PATHS,
      censor: '[Redacted]',
    },
  });
}
