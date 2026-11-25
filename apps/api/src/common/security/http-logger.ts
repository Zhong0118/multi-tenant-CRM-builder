import { pinoHttp, type StdSerializedResults } from 'pino-http';

export const HTTP_LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.referer',
  'req.headers.authorization',
  'res.headers.set-cookie',
];

export function isModelAdminPath(url?: string): boolean {
  return /^\/api\/v1\/platform\/ai-models(?:[/?]|$)/i.test(url ?? '');
}

export function isSensitiveAccountPath(url?: string): boolean {
  return /^\/api\/v1\/(?:auth(?:[/?]|$)|me(?:[/?]|$)|mail(?:[/?]|$)|platform\/mail(?:[/?]|$))/i.test(
    url ?? '',
  );
}

export function createHttpLogger(stream?: { write(message: string): void }) {
  return pinoHttp(
    {
      serializers: {
        req: (req: StdSerializedResults['req']) => ({
          ...req,
          url: req.url?.split('?')[0],
          query: undefined,
        }),
      },
      autoLogging: {
        ignore: (req) =>
          isModelAdminPath(req.url) || isSensitiveAccountPath(req.url),
      },
      redact: {
        paths: HTTP_LOG_REDACT_PATHS,
        censor: '[Redacted]',
      },
    },
    stream,
  );
}
