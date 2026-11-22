import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { isSearchableFieldType } from '../objects/object-schema';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import {
  recordOwnerFilter,
  recordOwnerMatches,
  type RecordOwnerFilter,
} from '../objects/record-read-scope';
import { parseListFilters, queryFields } from './record-filter';
import {
  POOL_STAGES,
  type PoolStage,
  type PoolQuality,
} from './record-ownership';
import type { RecordReadPredicate, RecordsStore } from './records.repository';

interface RecordPredicateInput {
  search?: string;
  scope?: 'mine' | 'pool' | 'group' | 'all';
  poolStage?: PoolStage | 'LEGACY';
  poolQuality?: PoolQuality;
  ownerMemberId?: string;
  filters?: string;
}

export interface RecordViewQueryInput extends RecordPredicateInput {
  viewId?: string;
  sort: string;
  direction: 'asc' | 'desc';
  columns?: string[];
}

export async function resolveStoredViewInput(
  store: RecordsStore,
  resolved: ResolvedObjectSchema,
  viewId: string | undefined,
): Promise<RecordViewQueryInput | undefined> {
  if (!viewId) return undefined;
  const view = await store.resolveRecordView(resolved, viewId);
  return {
    ...view.queryOptions,
    filters: JSON.stringify(view.filterRule),
    sort: view.sort.field,
    direction: view.sort.direction,
    columns: view.columnFieldKeys,
  };
}

export async function resolveRecordReadPredicate(
  context: TenantContext,
  resolved: ResolvedObjectSchema,
  store: RecordsStore,
  input: RecordPredicateInput,
  now: Date,
  timeZone?: string | null,
): Promise<RecordReadPredicate> {
  const scope = poolQueryScope(input.poolStage, input.scope);
  const ownerMemberId = await resolveListOwner(
    context,
    resolved,
    store,
    input.ownerMemberId,
    scope,
  );
  return {
    objectId: resolved.schema.object.id,
    followUpOwnerMemberId: recordOwnerFilter(resolved.access, context.memberId),
    ownerMemberId,
    search: input.search?.trim() || undefined,
    searchFieldKeys: searchableFieldKeys(resolved),
    inPublicPool: scope === 'pool' ? true : undefined,
    poolStage: input.poolStage,
    poolQuality: input.poolQuality,
    filters: await parseListFilters(
      input.filters,
      resolved,
      context,
      store,
      now,
      timeZone,
    ),
  };
}

function searchableFieldKeys(resolved: ResolvedObjectSchema): string[] {
  const titleFieldKey = resolved.schema.object.titleFieldKey;
  const extras =
    resolved.visibleSchema.defaultView.searchFieldKeys ??
    resolved.visibleSchema.defaultView.columnFieldKeys;
  return [
    ...new Set(
      queryFields(resolved)
        .filter(
          (field) =>
            isSearchableFieldType(field.type) &&
            extras.includes(field.fieldKey) &&
            field.fieldKey !== titleFieldKey,
        )
        .map((field) => field.fieldKey),
    ),
  ];
}

export async function resolveListOwner(
  context: TenantContext,
  resolved: ResolvedObjectSchema,
  store: RecordsStore,
  requested: string | undefined,
  scope?: 'mine' | 'pool' | 'group' | 'all',
): Promise<RecordOwnerFilter | null | undefined> {
  if (scope !== undefined && !['mine', 'pool', 'group', 'all'].includes(scope))
    throw new ApiException('VALIDATION_FAILED', 400);
  if (scope === 'pool') {
    if (
      !resolved.poolEnabled ||
      resolved.access.ownTitleHidden ||
      !resolved.access.canRead ||
      resolved.access.readScope === 'NONE'
    )
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    return undefined;
  }
  if (scope === 'all' && resolved.access.readScope !== 'ALL')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  if (scope === 'group' && resolved.access.readScope !== 'GROUP')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  if (scope === 'mine')
    return recordOwnerMatches(
      recordOwnerFilter(resolved.access, context.memberId),
      context.memberId,
    )
      ? context.memberId
      : { in: [] };
  if (resolved.access.readScope === 'GROUP') {
    const owners = recordOwnerFilter(resolved.access, context.memberId);
    if (!requested) return owners;
    if (!resolved.access.groupOwnerMemberIds?.includes(requested))
      throw new ApiException('OWNER_INVALID', 400);
    return recordOwnerMatches(owners, requested) ? requested : { in: [] };
  }
  if (resolved.access.readScope === 'OWN')
    return recordOwnerFilter(resolved.access, context.memberId);
  if (resolved.access.readScope === 'NONE') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
  if (context.role !== 'TENANT_ADMIN' || !requested) return undefined;
  if (requested === 'unassigned') return null;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

function poolQueryScope(
  stage: PoolStage | 'LEGACY' | undefined,
  scope?: 'mine' | 'pool' | 'group' | 'all',
) {
  if (stage !== undefined && stage !== 'LEGACY' && !POOL_STAGES.includes(stage))
    throw new ApiException('VALIDATION_FAILED', 400);
  return stage === 'LEAD_POOL' || stage === 'CUSTOMER_POOL' ? 'pool' : scope;
}
