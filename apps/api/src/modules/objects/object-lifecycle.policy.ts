import { collectActionTargetObjectCodes } from '../actions/action-publication.policy';
import type { PoolProtectionRule } from '../records/record-ownership';
import type { PublishedObjectSchema } from './object-schema';

export interface LifecycleBlocker {
  kind: 'WORKFLOW' | 'POOL_PROTECTION';
  objectCode: string;
  objectName: string;
  description: string;
}

export interface LifecycleObject {
  id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  schema: PublishedObjectSchema | null;
  poolEnabled: boolean;
  poolLifecycleEnabled: boolean;
  protectionRules: PoolProtectionRule[];
}

/** Only published actions and enabled protection rules are runtime dependencies. */
export function lifecycleBlockers(
  objects: LifecycleObject[],
  objectId: string,
  operation: 'archive' | 'restore',
): LifecycleBlocker[] {
  const subject = objects.find((object) => object.id === objectId);
  if (!subject) return [];
  const blockers: LifecycleBlocker[] = [];
  const byCode = new Map(objects.map((object) => [object.code, object]));
  const candidates =
    operation === 'archive'
      ? objects.filter(
          (object) => object.id !== objectId && object.status === 'ACTIVE',
        )
      : [subject];
  for (const source of candidates) {
    for (const transition of source.schema?.workflow?.transitions ?? []) {
      for (const code of collectActionTargetObjectCodes([transition])) {
        if (code === source.code) continue;
        const target = byCode.get(code);
        if (
          operation === 'archive'
            ? code !== subject.code
            : target?.status === 'ACTIVE' && target.schema !== null
        )
          continue;
        const referenced = operation === 'archive' ? source : target;
        blockers.push({
          kind: 'WORKFLOW',
          objectCode: referenced?.code ?? code,
          objectName: referenced?.name ?? code,
          description:
            operation === 'archive'
              ? `“${source.name}”的已发布流程“${transition.label}”需要读写此表，请先修改并发布该流程。`
              : `已发布流程“${transition.label}”依赖的业务表“${target?.name ?? code}”未启用，请先恢复该表。`,
        });
      }
    }
    if (!source.poolEnabled || !source.poolLifecycleEnabled) continue;
    for (const rule of source.protectionRules) {
      const target = byCode.get(rule.sourceObjectCode);
      if (
        operation === 'archive'
          ? rule.sourceObjectCode !== subject.code
          : rule.sourceObjectCode === source.code ||
            (target?.status === 'ACTIVE' &&
              rule.statusKeys.every((key) =>
                target.schema?.workflow?.states.some(
                  (state) => state.key === key,
                ),
              ))
      )
        continue;
      const referenced = operation === 'archive' ? source : target;
      blockers.push({
        kind: 'POOL_PROTECTION',
        objectCode: referenced?.code ?? rule.sourceObjectCode,
        objectName: referenced?.name ?? rule.sourceObjectCode,
        description:
          operation === 'archive'
            ? `“${source.name}”的公海成交保护依赖此表，请先调整保护规则。`
            : `公海保护依据“${target?.name ?? rule.sourceObjectCode}”已停用或发布状态已变化，请先恢复来源表及所需状态。`,
      });
    }
  }
  return blockers;
}
