import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type {
  AiFeature,
  AiLedgerService,
} from './governance/ai-ledger.service';

const governanceCodeList = [
  'AI_PLATFORM_DISABLED',
  'AI_FEATURE_NOT_INCLUDED',
  'AI_TENANT_QUOTA_EXHAUSTED',
  'AI_MEMBER_QUOTA_EXHAUSTED',
  'AI_REQUEST_BUDGET_INSUFFICIENT',
  'AI_BUDGET_RESERVED',
  'AI_MODEL_CONTEXT_EXCEEDED',
  'RATE_LIMITED',
] as const;
type GovernanceCode = (typeof governanceCodeList)[number];
const governanceCodes = new Set<string>(governanceCodeList);

export function isAiGovernanceCode(code: string): code is GovernanceCode {
  return governanceCodes.has(code);
}

export function isAiGovernanceError(
  error: unknown,
): error is ApiException & { code: GovernanceCode } {
  return error instanceof ApiException && isAiGovernanceCode(error.code);
}

// The denied business transaction must release its locks before auditing.
export async function recordRolledBackDenial(
  ledger: AiLedgerService,
  actor: TenantContext,
  feature: AiFeature,
  error: unknown,
): Promise<never> {
  if (isAiGovernanceError(error))
    await ledger.recordDenial(actor, feature, error.code);
  throw error;
}
