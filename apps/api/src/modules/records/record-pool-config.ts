import { ApiException } from '../../common/errors/api.exception';
import { OBJECT_CODE_REFERENCE_PATTERN } from '../objects/object-code';
import type { PoolConfig, PoolProtectionRule } from './record-ownership';

export function validatePoolConfig(input: PoolConfig): void {
  const hours = (value: unknown) =>
    Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 8760;
  if (
    typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.version) ||
    input.version < 1 ||
    (input.ownershipTtlHours !== null && !hours(input.ownershipTtlHours)) ||
    (input.lifecycleEnabled !== undefined &&
      typeof input.lifecycleEnabled !== 'boolean') ||
    (input.contactTtlHours !== undefined && !hours(input.contactTtlHours)) ||
    (input.followUpTtlHours !== undefined && !hours(input.followUpTtlHours)) ||
    (input.labels !== undefined &&
      (!input.labels ||
        Array.isArray(input.labels) ||
        typeof input.labels !== 'object' ||
        Object.entries(input.labels).some(
          ([key, value]) =>
            ![
              'leadPool',
              'customerPool',
              'pending',
              'following',
              'protected',
            ].includes(key) ||
            typeof value !== 'string' ||
            !value.trim() ||
            value.length > 60,
        ))) ||
    (input.protectionRules !== undefined &&
      (!Array.isArray(input.protectionRules) ||
        input.protectionRules.length > 20 ||
        input.protectionRules.some(
          (rule) =>
            !rule ||
            typeof rule.sourceObjectCode !== 'string' ||
            !OBJECT_CODE_REFERENCE_PATTERN.test(rule.sourceObjectCode) ||
            !Array.isArray(rule.statusKeys) ||
            !rule.statusKeys.length ||
            rule.statusKeys.length > 100 ||
            new Set(rule.statusKeys).size !== rule.statusKeys.length ||
            rule.statusKeys.some(
              (key) => typeof key !== 'string' || !key || key.length > 64,
            ),
        )))
  )
    throw new ApiException('VALIDATION_FAILED', 400);
}

export function configOf(object: {
  poolEnabled: boolean;
  poolOwnershipTtlHours: number | null;
  poolConfigVersion: number;
  poolLifecycleEnabled?: boolean;
  poolContactTtlHours?: number;
  poolFollowUpTtlHours?: number;
  poolLabels?: unknown;
  poolProtectionRules?: unknown;
}): PoolConfig {
  return {
    enabled: object.poolEnabled,
    ownershipTtlHours: object.poolOwnershipTtlHours,
    version: object.poolConfigVersion,
    lifecycleEnabled: object.poolLifecycleEnabled ?? false,
    contactTtlHours: object.poolContactTtlHours ?? 24,
    followUpTtlHours: object.poolFollowUpTtlHours ?? 720,
    labels: object.poolLabels ?? {},
    protectionRules: (object.poolProtectionRules ?? []) as PoolProtectionRule[],
  };
}
