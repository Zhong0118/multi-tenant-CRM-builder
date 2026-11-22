import { defaultViewColumns } from '@crm/contracts';
import { isUUID } from 'class-validator';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import {
  parseListSort,
  validateRecordFilterRule,
} from '../records/record-filter';
import { POOL_STAGES, type PoolStage } from '../records/record-ownership';
import type { RecordViewQueryOptionsDto, RecordViewSortDto } from './dto';

export const emptyRecordViewRule = {
  version: 1,
  match: 'all',
  conditions: [],
} as const;
const systemColumns = [
  'recordNo',
  'ownerMemberId',
  'nextFollowUpAt',
  'latestActivity',
  'createdAt',
  'updatedAt',
];

export type StoredSettings = {
  filterRule: unknown;
  queryOptions: unknown;
  sort: unknown;
  columnFieldKeys: unknown;
  columnWidths: unknown;
};

function invalid(): never {
  throw new ApiException('VALIDATION_FAILED', 400, {
    message: '视图配置无效或不可用。',
  });
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid();
  return value as Record<string, unknown>;
}

function normalizeSort(
  raw: unknown,
  resolved: ResolvedObjectSchema,
): RecordViewSortDto {
  const { field, direction, ...extra } = object(
    raw ?? resolved.visibleSchema.defaultView.sort,
  );
  if (
    typeof field !== 'string' ||
    (direction !== 'asc' && direction !== 'desc') ||
    Object.keys(extra).length
  )
    invalid();
  parseListSort(field, resolved);
  return { field, direction };
}

async function normalizeOptions(
  raw: unknown,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  memberExists: (id: string) => Promise<boolean>,
): Promise<RecordViewQueryOptionsDto> {
  const { search, scope, poolStage, poolQuality, ownerMemberId, ...extra } =
    object(raw);
  if (Object.keys(extra).length) invalid();
  const options: RecordViewQueryOptionsDto = {};
  if (search !== undefined) {
    if (typeof search !== 'string' || search.length > 300) invalid();
    options.search = search.trim();
  }
  if (scope !== undefined) {
    if (
      scope !== 'mine' &&
      scope !== 'all' &&
      scope !== 'pool' &&
      scope !== 'group'
    )
      invalid();
    if (scope === 'group' && resolved.access.readScope !== 'GROUP') invalid();
    if (scope === 'all' && resolved.access.readScope !== 'ALL') invalid();
    options.scope = scope;
  }
  if (
    (scope === 'pool' ||
      poolStage !== undefined ||
      poolQuality !== undefined) &&
    !resolved.poolEnabled
  )
    invalid();
  if (poolStage !== undefined) {
    if (poolStage !== 'LEGACY' && !POOL_STAGES.includes(poolStage as PoolStage))
      invalid();
    options.poolStage = poolStage as PoolStage | 'LEGACY';
  }
  if (poolQuality !== undefined) {
    if (
      poolQuality !== 'INVALID' &&
      poolQuality !== 'DUPLICATE' &&
      poolQuality !== 'LOST'
    )
      invalid();
    options.poolQuality = poolQuality;
  }
  if (ownerMemberId !== undefined) {
    if (
      typeof ownerMemberId !== 'string' ||
      scope === 'mine' ||
      scope === 'pool' ||
      poolStage === 'LEAD_POOL' ||
      poolStage === 'CUSTOMER_POOL'
    )
      invalid();
    if (resolved.access.readScope === 'GROUP') {
      if (!resolved.access.groupOwnerMemberIds?.includes(ownerMemberId))
        invalid();
    } else if (
      context.role !== 'TENANT_ADMIN' ||
      resolved.access.readScope !== 'ALL' ||
      (ownerMemberId !== 'unassigned' &&
        (!isUUID(ownerMemberId) || !(await memberExists(ownerMemberId))))
    )
      invalid();
    options.ownerMemberId = ownerMemberId;
  }
  return options;
}

// Reads project hidden layout keys; writes reject new references to invisible fields.
export async function resolveViewSettings(
  stored: StoredSettings,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  memberExists: (id: string) => Promise<boolean>,
  changedLayout: { columnFieldKeys?: unknown; columnWidths?: unknown } = {},
) {
  const filterRule = await validateRecordFilterRule(
    stored.filterRule,
    resolved,
    context,
    memberExists,
  );
  const sort = normalizeSort(stored.sort, resolved);
  const queryOptions = await normalizeOptions(
    stored.queryOptions,
    resolved,
    context,
    memberExists,
  );
  const visible = new Set([
    ...systemColumns,
    ...(resolved.poolEnabled ? ['poolStatus'] : []),
    ...resolved.visibleSchema.fields.map((field) => field.fieldKey),
  ]);
  const columns =
    stored.columnFieldKeys ??
    defaultViewColumns(
      resolved.visibleSchema.object.titleFieldKey,
      resolved.visibleSchema.defaultView.columnFieldKeys,
      resolved.visibleSchema.fields.find(
        (f) => f.fieldKey === 'stage' || f.label.includes('阶段'),
      )?.fieldKey,
      resolved.poolEnabled,
    );
  if (
    !Array.isArray(columns) ||
    !columns.every((key): key is string => typeof key === 'string') ||
    new Set(columns).size !== columns.length
  )
    invalid();
  const widths = object(stored.columnWidths);
  if (
    changedLayout.columnFieldKeys != null &&
    columns.some((key) => !visible.has(key))
  )
    invalid();
  const columnWidths: Record<string, number> = {};
  for (const [key, width] of Object.entries(widths)) {
    if (
      !Number.isInteger(width) ||
      typeof width !== 'number' ||
      width < 88 ||
      width > 640
    )
      invalid();
    if (visible.has(key)) columnWidths[key] = width;
    else if (changedLayout.columnWidths !== undefined) invalid();
  }
  return {
    filterRule,
    queryOptions,
    sort,
    columnFieldKeys: columns.filter((key) => visible.has(key)),
    columnWidths,
  };
}
