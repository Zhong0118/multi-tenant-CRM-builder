import { ApiException } from '../../common/errors/api.exception';

/** The pg adapter preserves the trigger's SQLSTATE and server message for
 * both raw queries (P2010) and model writes (P2039). */
export function translatePoolTriggerError(error: unknown): unknown {
  if (!(error instanceof Error) || !('meta' in error)) return error;
  const meta = error.meta as {
    driverAdapterError?: {
      cause?: { originalCode?: string; originalMessage?: string };
    };
  } | null;
  const cause = meta?.driverAdapterError?.cause;
  if (cause?.originalCode !== 'P0001') return error;
  switch (cause.originalMessage) {
    case 'POOL_PROTECTION_OWNER_REQUIRED':
      return new ApiException('VALIDATION_FAILED', 400, {
        message: '请管理员先分配关联记录的负责人，再确认成交。',
      });
    case 'POOL_PROTECTION_EXPIRED':
      return new ApiException('RECORD_VERSION_CONFLICT', 409, {
        message:
          '关联记录的持有期限已到，请刷新并由管理员重新分配后再确认成交。',
      });
    case 'Record follow-up deadline expired':
      return new ApiException('RECORD_VERSION_CONFLICT', 409, {
        message: '跟进期限已到，请刷新记录并重新领取或由管理员分配。',
      });
    case 'POOL_PROTECTION_FORBIDDEN':
      return new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    default:
      return error;
  }
}
