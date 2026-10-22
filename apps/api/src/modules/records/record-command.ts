import type { PoolOrigin, PoolStage } from './record-ownership';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent, DomainAuditCorrelation } from '../audit/audit-event';
import type { ResolvedObjectSchema } from '../objects/published-object.service';
import { projectVisibleValues } from './record-value-engine';
import {
  MEMBER_ACTIVITY_TYPES,
  OUTCOMES_BY_ACTIVITY_TYPE,
  type ActivityOutcome,
  type MemberActivityType,
  type RecordActivity,
} from './record-activity';
import type { RecordActivityResponse, RecordResponse } from './records.service';
import {
  RecordValueError,
  validateRecordMutation,
} from './record-value-engine';
import type {
  DynamicRecord,
  RecordSourcePatch,
  RecordsStore,
  SourceRecordPatchHistory,
} from './records.repository';

/**
 * §24: transaction-aware Record domain commands.
 *
 * These are the single implementation of "create a Record" and "update a
 * Record against a snapshot" that both the ordinary HTTP services and the
 * Action Engine call. They never open a transaction: the caller owns the
 * tenant transaction and hands in a `RecordsStore` bound to it, so a
 * Transition, its Actions, History and Audit commit or roll back together
 * (§4 / §23).
 *
 * All business rules live in `record-value-engine` and the store: these
 * commands only sequence them, so a command can never become a second, weaker
 * copy of the ordinary Record rules.
 */

export interface RecordRequestMeta {
  requestId: string;
  ip?: string;
  /**
   * Optional correlation for Workflow Actions or a confirmed AI operation.
   * The ordinary HTTP path leaves it unset.
   */
  actionAudit?: DomainAuditCorrelation;
}

export interface CreateRecordCommandInput {
  store: RecordsStore;
  resolved: ResolvedObjectSchema;
  context: TenantContext;
  values: Record<string, unknown>;
  ownerMemberId?: string | null;
  ownershipExpiresAt?: string | null;
  poolStage?: PoolStage;
  poolOrigin?: PoolOrigin;
  poolClaimedAt?: string | null;
  poolLastFollowUpAt?: string | null;
  inPublicPool?: boolean;
  meta: RecordRequestMeta;
  clock: () => Date;
  idGenerator: () => string;
}

/**
 * §18: reuses the ordinary Record Create rules — canCreate, field
 * EDIT/HIDDEN/READ_ONLY, required/default, MEMBER active check, owner policy,
 * title calculation, target Workflow initial state, recordNo allocation and
 * the `record.created` audit.
 */
export async function createRecordCommand(
  input: CreateRecordCommandInput,
): Promise<DynamicRecord> {
  const { resolved, context, store } = input;
  const ownerMemberId = await resolveCreateOwner(
    context,
    store,
    input.ownerMemberId,
  );
  const normalized = await assertRecordMutation({
    mode: 'CREATE',
    resolved,
    submitted: input.values,
    memberExists: (memberId) => store.memberExists(memberId),
  });
  await store.lockActiveOwners(ownerMemberId);
  const now = input.clock().toISOString();
  const created = await store.createRecord({
    id: input.idGenerator(),
    objectId: resolved.schema.object.id,
    recordNo: await store.allocateRecordNo(resolved.schema.object.id),
    ownerMemberId,
    ownershipExpiresAt: input.ownershipExpiresAt ?? null,
    ...(input.poolStage
      ? {
          poolStage: input.poolStage,
          poolOrigin: input.poolOrigin,
          poolClaimedAt: input.poolClaimedAt,
          poolLastFollowUpAt: input.poolLastFollowUpAt ?? null,
          inPublicPool: input.inPublicPool,
        }
      : {}),
    workflowStateKey: resolved.schema.workflow?.initialStateKey ?? null,
    title: normalized.title,
    values: normalized.values,
    version: 1,
    createdByMemberId: context.memberId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  await store.appendAudit(
    recordAudit(context, input.meta, 'record.created', created, undefined),
  );
  return created;
}

export interface UpdateRecordCommandInput {
  store: RecordsStore;
  resolved: ResolvedObjectSchema;
  context: TenantContext;
  recordId: string;
  input: {
    version: number;
    values?: Record<string, unknown>;
    ownerMemberId?: string | null;
  };
  meta: RecordRequestMeta;
}

/** Runs inside the caller's tenant transaction; ordinary updates retain their ACTIVE-owner lock. */
export async function updateRecordCommand({
  store,
  resolved,
  context,
  recordId,
  input,
  meta,
}: UpdateRecordCommandInput): Promise<{
  record: RecordResponse;
  auditId: string;
}> {
  const current = await requireVisibleRecord(
    store,
    resolved,
    context,
    recordId,
    'UPDATE',
  );
  if (current.version !== input.version)
    throw new ApiException('RECORD_VERSION_CONFLICT', 409);
  const patch = await prepareSourceRecordPatch({
    store,
    resolved,
    context,
    current,
    values: input.values,
    ownerMemberId: input.ownerMemberId,
  });
  const updated = await applySourceRecordPatch({
    store,
    recordId,
    expectedVersion: input.version,
    patch,
  });
  await store.runFieldAutomations?.(resolved, current, updated, meta);
  const auditId = await store.appendAudit(
    recordAudit(context, meta, 'record.updated', updated, current),
  );
  return { record: projectRecord(updated, resolved), auditId };
}

export interface CreateRecordActivityCommandInput {
  store: RecordsStore;
  resolved: ResolvedObjectSchema;
  context: TenantContext;
  recordId: string;
  input: {
    activityType: MemberActivityType;
    content: string;
    nextActionAt?: string | null;
    outcome?: ActivityOutcome | null;
  };
  meta: RecordRequestMeta;
  clock: () => Date;
  idGenerator: () => string;
}

/** Same validation and audit as the HTTP path; AI must supply literal NOTE. */
export async function createRecordActivityCommand({
  store,
  resolved,
  context,
  recordId,
  input,
  meta,
  clock,
  idGenerator,
}: CreateRecordActivityCommandInput): Promise<{
  activity: RecordActivityResponse;
  auditId: string;
}> {
  const content = validateRecordActivityInput(input);
  const record = await requireVisibleRecord(
    store,
    resolved,
    context,
    recordId,
    'UPDATE',
    true,
  );
  if (
    record.poolStage === 'FOLLOWING' &&
    resolved.poolEnabled &&
    resolved.poolLifecycleEnabled
  ) {
    if (
      context.role !== 'TENANT_ADMIN' &&
      record.ownerMemberId !== context.memberId
    )
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    if (
      record.ownershipExpiresAt &&
      new Date(record.ownershipExpiresAt).getTime() <= clock().getTime()
    )
      throw new ApiException('RECORD_VERSION_CONFLICT', 409, {
        message: '跟进期限已到，请刷新记录。',
      });
  }
  const created = await store.createActivity({
    id: idGenerator(),
    recordId,
    activityType: input.activityType,
    content,
    nextActionAt: input.nextActionAt ?? null,
    outcome: input.outcome ?? null,
    actorMemberId: context.memberId,
    createdAt: clock().toISOString(),
  });
  const auditId = await store.appendAudit({
    tenantId: context.tenantId,
    actorType: 'USER',
    actorId: context.userId,
    action: 'record.activity_created',
    resourceType: 'record_activity',
    resourceId: created.id,
    after: {
      recordId,
      activityType: created.activityType,
      nextActionAt: created.nextActionAt,
      outcome: created.outcome,
      ...(meta.actionAudit ?? {}),
    },
    requestId: meta.requestId,
    ip: meta.ip,
  });
  return { activity: projectActivity(created), auditId };
}

/** HTTP validates before opening a transaction; the command revalidates its callers. */
export function validateRecordActivityInput(
  input: CreateRecordActivityCommandInput['input'],
): string {
  const content = input.content.trim();
  if (content.length === 0)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { content: ['请填写跟进内容。'] },
    });
  if (content.length > 4000)
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { content: ['跟进内容不能超过 4000 字。'] },
    });
  if (!MEMBER_ACTIVITY_TYPES.includes(input.activityType))
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { activityType: ['不支持该跟进类型。'] },
    });
  if (
    input.outcome &&
    !OUTCOMES_BY_ACTIVITY_TYPE[input.activityType].includes(input.outcome)
  )
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { outcome: ['这类跟进不能记录该结果。'] },
    });
  return content;
}

export async function requireVisibleRecord(
  store: RecordsStore,
  resolved: ResolvedObjectSchema,
  context: TenantContext,
  recordId: string,
  action: 'READ' | 'UPDATE',
  lock = false,
): Promise<DynamicRecord> {
  const accessAllowed =
    action === 'READ' ? resolved.access.canRead : resolved.access.canUpdate;
  const scope =
    action === 'READ' ? resolved.access.readScope : resolved.access.updateScope;
  if (!accessAllowed || scope === 'NONE')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const record = lock
    ? await store.lockRecord({
        objectId: resolved.schema.object.id,
        recordId,
        ownerMemberId: scope === 'OWN' ? context.memberId : null,
      })
    : await store.findRecord(resolved.schema.object.id, recordId);
  const poolReadable =
    action === 'READ' && resolved.poolEnabled && record?.inPublicPool;
  if (
    !record ||
    (!poolReadable &&
      scope === 'OWN' &&
      record.ownerMemberId !== context.memberId)
  )
    throw new ApiException('RECORD_NOT_FOUND', 404);
  if (
    action === 'UPDATE' &&
    record.inPublicPool &&
    context.role !== 'TENANT_ADMIN'
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  return record;
}

export function projectRecord(
  record: DynamicRecord,
  resolved: ResolvedObjectSchema,
): RecordResponse {
  return {
    id: record.id,
    recordNo: record.recordNo.toString(),
    ownerMemberId: record.ownerMemberId,
    inPublicPool: record.inPublicPool ?? false,
    ownershipExpiresAt: record.ownershipExpiresAt ?? null,
    ...(record.poolStage === undefined
      ? {}
      : {
          poolStage: record.poolStage ?? null,
          poolOrigin: record.poolOrigin ?? null,
          poolClaimedAt: record.poolClaimedAt ?? null,
          poolLastFollowUpAt: record.poolLastFollowUpAt ?? null,
          poolProtectedAt: record.poolProtectedAt ?? null,
          poolReason: record.poolReason ?? null,
          poolQuality: record.poolQuality ?? null,
          protectionNeedsReview: record.protectionNeedsReview ?? false,
        }),
    title: record.title,
    values: projectVisibleValues(
      resolved.schema,
      resolved.access,
      record.values,
    ),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function projectActivity(
  activity: RecordActivity,
): RecordActivityResponse {
  return {
    id: activity.id,
    activityType: activity.activityType,
    content: activity.content,
    nextActionAt: activity.nextActionAt,
    outcome: activity.outcome,
    actorMemberId: activity.actorMemberId,
    actorDisplayName: activity.actorDisplayName,
    createdAt: activity.createdAt,
  };
}

export interface PreparedSourceRecordPatch {
  values: Record<string, unknown>;
  title: string;
  /** Already created from the supplied snapshot. */
  ownerMemberId: string | null;
}

export interface PrepareSourceRecordPatchInput {
  store: RecordsStore;
  resolved: ResolvedObjectSchema;
  context: TenantContext;
  /** The immutable snapshot the patch is validated against. */
  current: DynamicRecord;
  values?: Record<string, unknown>;
  ownerMemberId?: string | null;
}

/**
 * §19: validates a Source Record patch against the immutable snapshot that
 * entered the Transition and returns the accumulated result. It writes
 * nothing and never touches `version`, so a Transition that runs several
 * `UPDATE_RECORD` / `ASSIGN_OWNER` actions still applies exactly one source
 * update (§14).
 *
 * The snapshot is immutable: callers must re-read it from the store instead of
 * feeding a previously prepared patch back in.
 */
export async function prepareSourceRecordPatch(
  input: PrepareSourceRecordPatchInput,
): Promise<PreparedSourceRecordPatch> {
  const ownerMemberId = await resolveUpdateOwner(
    input.context,
    input.store,
    input.current.ownerMemberId,
    input.ownerMemberId,
  );
  if (
    input.current.poolStage &&
    ownerMemberId !== input.current.ownerMemberId
  ) {
    if (!ownerMemberId)
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403, {
        message:
          '已进入流转的记录需使用释放操作并填写原因；成交保护记录需先由管理员解除保护。',
      });
    await input.store.lockActiveOwners(
      ownerMemberId,
      input.resolved.schema.object.code,
    );
  }
  const normalized = await assertRecordMutation({
    mode: 'UPDATE',
    resolved: input.resolved,
    submitted: input.values ?? {},
    current: input.current.values,
    memberExists: (memberId) => input.store.memberExists(memberId),
  });
  return {
    values: normalized.values,
    title: normalized.title,
    ownerMemberId,
  };
}

export interface ApplySourceRecordPatchInput {
  store: RecordsStore;
  recordId: string;
  expectedVersion: number;
  patch: PreparedSourceRecordPatch;
  /** Next Workflow state; `undefined` leaves the current one unchanged. */
  workflowStateKey?: string;
  /**
   * The Transition History row to write with the patch; a real Transition
   * always has one and an ordinary HTTP update never does. It stays on the
   * shared input type because both write intents build the same statement, but
   * a Transition must apply through `RecordsStore.applyTransition` — the
   * command below routes to `applyRecordPatch`, which takes the ACTIVE-owner
   * lock a Transition deliberately does not.
   */
  history?: SourceRecordPatchHistory;
}

/**
 * §14 / §23: the single final Source Record write for an ORDINARY update. It
 * sets values, title, owner, workflow state and `version + 1` in ONE statement
 * guarded by `expectedVersion`, so the version moves exactly once.
 *
 * It goes through the ordinary-update intent, which locks the ACTIVE owner
 * rows before writing. A transition writes through `applyTransition` instead:
 * both share the same statement but the transition intent deliberately skips
 * that lock (see `RecordsStore.applyTransition`).
 */
export async function applySourceRecordPatch(
  input: ApplySourceRecordPatchInput,
): Promise<DynamicRecord> {
  const patch: RecordSourcePatch = {
    values: input.patch.values,
    title: input.patch.title,
    ownerMemberId: input.patch.ownerMemberId,
    ...(input.workflowStateKey === undefined
      ? {}
      : { workflowStateKey: input.workflowStateKey }),
  };
  const updated = await input.store.applyRecordPatch({
    recordId: input.recordId,
    expectedVersion: input.expectedVersion,
    patch,
    ...(input.history ? { history: input.history } : {}),
  });
  if (!updated) throw new ApiException('RECORD_VERSION_CONFLICT', 409);
  return updated;
}

export function recordAudit(
  context: TenantContext,
  meta: RecordRequestMeta,
  action: string,
  after: DynamicRecord,
  before: DynamicRecord | undefined,
): AuditEvent {
  return {
    tenantId: context.tenantId,
    actorType: 'USER',
    actorId: context.userId,
    action,
    resourceType: 'record',
    resourceId: after.id,
    before: before ? auditRecord(before) : undefined,
    after: { ...auditRecord(after), ...(meta.actionAudit ?? {}) },
    requestId: meta.requestId,
    ip: meta.ip,
  };
}

export function auditRecord(record: DynamicRecord): Record<string, unknown> {
  return {
    objectId: record.objectId,
    recordNo: record.recordNo.toString(),
    ownerMemberId: record.ownerMemberId,
    inPublicPool: record.inPublicPool ?? false,
    ownershipExpiresAt: record.ownershipExpiresAt ?? null,
    ...(record.poolStage === undefined
      ? {}
      : {
          poolStage: record.poolStage ?? null,
          poolOrigin: record.poolOrigin ?? null,
          poolClaimedAt: record.poolClaimedAt ?? null,
          poolLastFollowUpAt: record.poolLastFollowUpAt ?? null,
          poolProtectedAt: record.poolProtectedAt ?? null,
          poolReason: record.poolReason ?? null,
          poolQuality: record.poolQuality ?? null,
          protectionNeedsReview: record.protectionNeedsReview ?? false,
        }),
    title: record.title,
    values: record.values,
    version: record.version,
    deletedAt: record.deletedAt,
  };
}

/**
 * An EMPLOYEE always owns what they create; an admin may name an active
 * member, and otherwise leaves the record unowned.
 */
export async function resolveCreateOwner(
  context: TenantContext,
  store: RecordsStore,
  requested: string | null | undefined,
): Promise<string | null> {
  if (context.role === 'EMPLOYEE') return context.memberId;
  if (requested === undefined || requested === null) return null;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

/**
 * Ordinary update never widens owner rights: an EMPLOYEE keeps the existing
 * owner, and an admin may only name an active member. ASSIGN_OWNER is a
 * separate concern and is deliberately not represented here.
 */
export async function resolveUpdateOwner(
  context: TenantContext,
  store: RecordsStore,
  current: string | null,
  requested: string | null | undefined,
): Promise<string | null> {
  if (context.role === 'EMPLOYEE') return current;
  if (requested === undefined) return current;
  if (requested === null) return null;
  if (!(await store.memberExists(requested))) {
    throw new ApiException('OWNER_INVALID', 400);
  }
  return requested;
}

export async function assertRecordMutation(input: {
  mode: 'CREATE' | 'UPDATE';
  resolved: ResolvedObjectSchema;
  submitted: Record<string, unknown>;
  current?: Record<string, unknown>;
  memberExists: (id: string) => Promise<boolean>;
}) {
  try {
    return await validateRecordMutation({
      mode: input.mode,
      schema: input.resolved.schema,
      access: input.resolved.access,
      submitted: input.submitted,
      current: input.current,
      memberExists: input.memberExists,
    });
  } catch (error) {
    if (error instanceof RecordValueError) {
      const status =
        error.code === 'OBJECT_ACTION_FORBIDDEN' ||
        error.code === 'FIELD_READ_ONLY' ||
        error.code === 'FIELD_HIDDEN'
          ? 403
          : 400;
      throw new ApiException(error.code, status, {
        fieldErrors: error.fieldKey
          ? { [error.fieldKey]: [error.message] }
          : undefined,
      });
    }
    throw error;
  }
}
