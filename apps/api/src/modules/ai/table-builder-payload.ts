import type { TableBlueprint } from '@crm/contracts';
import { ApiException } from '../../common/errors/api.exception';

export const TABLE_BUILDER_GENERATION_TIMEOUT_MS = 90_000;
export const TABLE_BUILDER_REQUEST_LIMIT = 2 * 1024 * 1024;
// Reserve room for a JSON-escaped 4,000-character refinement, target and IDs.
const REFINEMENT_ENVELOPE_BYTES = 32 * 1024;

export function assertBlueprintFitsRequest(blueprint: TableBlueprint) {
  if (
    Buffer.byteLength(JSON.stringify(blueprint)) >
    TABLE_BUILDER_REQUEST_LIMIT - REFINEMENT_ENVELOPE_BYTES
  )
    throw new ApiException('VALIDATION_FAILED', 413, {
      message: '建表方案内容过大，请精简字段或选项说明，或分批生成业务表。',
    });
}
