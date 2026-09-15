import type { Prisma } from '@crm/database';

import {
  ApiException,
  type FieldErrors,
} from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditService } from '../audit/audit.service';
import { createFollowUpCommand } from '../follow-ups/follow-up-command';
import type { FollowUpRecordScope } from '../follow-ups/follow-up-command';
import type { PublishedField } from '../objects/object-schema';
import {
  isReadable,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import {
  createRecordRelationCommand,
  recordRelationScope,
  type CreateRecordRelationCommandDeps,
  type RecordRelationMeta,
  type RecordRelationScope,
} from '../record-relations/record-relation-command';
import {
  createRecordCommand,
  prepareSourceRecordPatch,
  type PreparedSourceRecordPatch,
  type RecordRequestMeta,
} from '../records/record-command';
import type {
  DynamicRecord,
  RecordsStore,
} from '../records/records.repository';
import type {
  ActionMemberSource,
  ActionOutput,
  ActionRecordRef,
  ActionValueSource,
  WorkflowActionDraft,
  WorkflowActionType,
} from './action.types';
import {
  ActionValueError,
  resolveActionValue,
  resolveDateTimeSource,
  resolveMemberSource,
  resolveStringSource,
  type ActionValueContext,
} from './action-value-resolver';

/**
 * §12–§32: the Action Engine core.
 *
 * It executes the ordered Action steps of ONE already-resolved Transition
 * inside a tenant transaction the CALLER owns. It never opens or nests a
 * transaction (§4/§24), never writes the Source Record (§14) and never
 * re-implements a domain rule: records go through the Task 5 commands,
 * relations through the Task 6 relation command, follow-ups through the Task 6
 * follow-up command, and every target schema through the Task 4
 * transaction-aware resolver (§25/§46.3).
 *
 * It returns the accumulated Source Patch, the per-Action outputs and a
 * lightweight effect summary. The caller (the workflow execute path, a later
 * task) applies the patch and the next state in ONE source update and writes
 * the Transition history and audits — so a failing Action leaves nothing
 * behind (§4, step 9: "any Action failure → whole Transition rollback").
 */

/** §31: what an Action did, safe to summarise in a runtime response. */
export type ActionEffectKind =
  | 'RECORD_CREATED'
  | 'SOURCE_RECORD_UPDATED'
  | 'SOURCE_OWNER_ASSIGNED'
  | 'RELATION_CREATED'
  | 'FOLLOW_UP_CREATED';

export interface ActionEffectSummary {
  actionKey: string;
  type: WorkflowActionType;
  effect: ActionEffectKind;
  /** The record the effect concerns (for a relation: its writing side). */
  recordId: string;
}

export interface ActionRequestMeta {
  requestId: string;
  ip?: string;
}

/** §12: the execution identity of one Action-bearing Transition. */
export interface ActionExecutionIdentity {
  workflowExecutionId: string;
  transitionKey: string;
}

export interface ActionSourceInput {
  objectCode: string;
  /** The Source Object's resolved schema and the actor's effective access. */
  resolved: ResolvedObjectSchema;
  /** §12/§13: the immutable snapshot taken before any Action ran. */
  snapshot: DynamicRecord;
}

/**
 * §24: every transaction-scoped dependency is injected, so the engine can run
 * in the caller's transaction and tests can drive it with fakes. Nothing here
 * can open a transaction of its own.
 */
export interface ActionEngineDeps {
  /** A `RecordsStore` bound to `tx`. */
  store: RecordsStore;
  /** The audit writer, used with `tx`. */
  audit: AuditService;
  /**
   * §25/§46.3: resolves a Target Object's CURRENT Active Publication and the
   * actor's Effective Access through `resolvePublishedObjectInTransaction`.
   * It deliberately omits the read gate; this engine re-applies it wherever an
   * Action actually READS (§21/§22).
   */
  resolveObject: (objectCode: string) => Promise<ResolvedObjectSchema>;
  /** §21: the shared transaction-aware relation command. */
  createRelation: typeof createRecordRelationCommand;
  /** §22: the shared transaction-aware follow-up command. */
  createFollowUp: typeof createFollowUpCommand;
  clock: () => Date;
  idGenerator: () => string;
}

export interface ExecuteActionsInput {
  /** The caller's tenant transaction (§4): the engine nests nothing. */
  tx: Prisma.TransactionClient;
  context: TenantContext;
  source: ActionSourceInput;
  /** §28: array order IS execution order. */
  actions: readonly WorkflowActionDraft[];
  execution: ActionExecutionIdentity;
  meta: ActionRequestMeta;
  deps: ActionEngineDeps;
}

export interface ActionExecutionResult {
  /** §16: outputs keyed by Action Key, for later Actions of this Transition. */
  outputs: Map<string, ActionOutput>;
  /**
   * §14: the accumulated Source Record patch, or `null` when no Action touched
   * the Source Record. The caller applies it once together with the next
   * Workflow state.
   */
  sourcePatch: PreparedSourceRecordPatch | null;
  effects: ActionEffectSummary[];
}

/** §22: `record_follow_ups.title` is VARCHAR(200). */
export const FOLLOW_UP_TITLE_MAX_LENGTH = 200;

/**
 * An `ActionValueError` that is attributable to one named property of one
 * Action, so §32's field path can be `actions.<actionKey>.<fieldKey>`.
 */
class ActionFieldError extends Error {
  constructor(
    readonly fieldKey: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'ActionFieldError';
  }
}

interface RecordRefTarget {
  objectCode: string;
  recordId: string;
}

export async function executeActions(
  input: ExecuteActionsInput,
): Promise<ActionExecutionResult> {
  const { context, deps, source } = input;
  const outputs = new Map<string, ActionOutput>();
  /** Maps an Action Key to the record its output points at (§16/§17). */
  const recordRefs = new Map<string, RecordRefTarget>();
  const effects: ActionEffectSummary[] = [];

  /** §14: at most one write per source field and one owner change. */
  const writtenSourceFields = new Set<string>();
  const sourceFields = new Map(
    source.resolved.schema.fields.map((field) => [field.fieldKey, field]),
  );
  let sourceValues: Record<string, unknown> = {};
  let pendingOwnerMemberId: string | undefined;
  let sourcePatch: PreparedSourceRecordPatch | null = null;

  /**
   * §13: the value context is built from the immutable pre-Transition snapshot
   * only. `outputs` is the one channel that exposes an earlier Action, and it
   * grows as the Actions complete.
   */
  const valueContext = (): ActionValueContext => ({
    clock: deps.clock,
    actor: { memberId: context.memberId },
    source: {
      recordId: source.snapshot.id,
      title: source.snapshot.title,
      ownerMemberId: source.snapshot.ownerMemberId,
      values: source.snapshot.values,
      fields: sourceFields,
    },
    outputs,
  });

  const actionMeta = (action: WorkflowActionDraft): RecordRequestMeta => ({
    requestId: input.meta.requestId,
    ip: input.meta.ip,
    // §30: keep the domain action, add the execution correlation.
    actionAudit: {
      workflowExecutionId: input.execution.workflowExecutionId,
      transitionKey: input.execution.transitionKey,
      actionKey: action.key,
      actionType: action.type,
    },
  });

  const resolveFieldMappings = (
    values: Record<string, ActionValueSource>,
    fields: PublishedField[],
  ): Record<string, unknown> => {
    const byKey = new Map(fields.map((field) => [field.fieldKey, field]));
    const resolvedValues: Record<string, unknown> = {};
    for (const [fieldKey, valueSource] of Object.entries(values)) {
      resolvedValues[fieldKey] = resolveField(fieldKey, () =>
        resolveActionValue(valueSource, valueContext(), {
          // The target field's own type decides the representation of a
          // temporal source (§15). An unknown field key is left for the record
          // value engine to reject, so FIELD_UNKNOWN is not duplicated here.
          targetFieldType: byKey.get(fieldKey)?.type,
        }),
      );
    }
    return resolvedValues;
  };

  const resolveField = <T>(fieldKey: string, read: () => T): T => {
    try {
      return read();
    } catch (error) {
      throw asFieldError(fieldKey, error);
    }
  };

  const resolveMember = (
    fieldKey: string,
    memberSource: ActionMemberSource,
  ): string =>
    resolveField(fieldKey, () =>
      resolveMemberSource(memberSource, valueContext()),
    );

  const resolveRecordRef = (
    ref: ActionRecordRef,
    fieldKey: string,
  ): RecordRefTarget => {
    if (ref.source === 'SOURCE_RECORD') {
      return { objectCode: source.objectCode, recordId: source.snapshot.id };
    }
    const target = recordRefs.get(ref.actionKey);
    if (!target) {
      throw new ActionFieldError(
        fieldKey,
        `动作「${ref.actionKey}」的输出不可用，只能引用前序执行动作。`,
      );
    }
    return target;
  };

  const resolveObjectFor = (
    objectCode: string,
  ): Promise<ResolvedObjectSchema> =>
    objectCode === source.objectCode
      ? Promise.resolve(source.resolved)
      : deps.resolveObject(objectCode);

  /**
   * §19: the Source Record write rules of the ordinary update path
   * (`records.service.requireVisibleRecord(..., 'UPDATE')`): `canUpdate`, an
   * update scope other than `NONE`, and an OWN scope that must match the
   * snapshot's owner. `prepareSourceRecordPatch` owns the field-level rules.
   */
  const assertSourceWritable = (): void => {
    const { access } = source.resolved;
    if (!access.canUpdate || access.updateScope === 'NONE') {
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    }
    if (
      access.updateScope === 'OWN' &&
      source.snapshot.ownerMemberId !== context.memberId
    ) {
      throw new ApiException('RECORD_NOT_FOUND', 404);
    }
  };

  const refreshSourcePatch = async (): Promise<void> => {
    sourcePatch = await prepareSourceRecordPatch({
      store: deps.store,
      resolved: source.resolved,
      context,
      current: source.snapshot,
      values: sourceValues,
      ownerMemberId: pendingOwnerMemberId,
    });
  };

  /**
   * §21/§22/§46.3: the read gate the transaction-bound resolver omits. The
   * ordinary HTTP relation and follow-up paths resolve their objects through
   * `resolveRuntimeSchema`, which gates every side it reads; an Action must not
   * silently gain that read access.
   */
  const resolveScope = async (
    scopeContext: TenantContext,
    objectCode: string,
    id: string,
    write: boolean,
  ): Promise<RecordRelationScope> => {
    const resolvedObject = await resolveObjectFor(objectCode);
    if (!isReadable(resolvedObject.schema, resolvedObject.access)) {
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    }
    return recordRelationScope(resolvedObject, scopeContext, id, write);
  };

  const relationDeps: CreateRecordRelationCommandDeps = {
    resolveScope,
    audit: deps.audit,
  };
  const relationMeta = (action: WorkflowActionDraft): RecordRelationMeta =>
    actionMeta(action);

  for (const action of input.actions) {
    try {
      switch (action.type) {
        case 'CREATE_RECORD': {
          // §18/§25/§46.3: the Target's CURRENT Active Publication, resolved in
          // this transaction and WITHOUT the read gate (create-only targets are
          // legal); `createRecordCommand` then enforces canCreate, field
          // permission, required/default, title, initial state, recordNo and the
          // audit — never a raw `tx.record.create`.
          const target = await deps.resolveObject(action.targetObjectCode);
          const values = resolveFieldMappings(
            action.values,
            target.schema.fields,
          );
          const owner = action.owner;
          const created = await createRecordCommand({
            store: deps.store,
            resolved: target,
            context,
            values,
            ownerMemberId: owner ? resolveMember('owner', owner) : undefined,
            meta: actionMeta(action),
            clock: deps.clock,
            idGenerator: deps.idGenerator,
          });
          outputs.set(action.key, {
            type: 'CREATE_RECORD',
            recordId: created.id,
            objectCode: target.schema.object.code,
            recordNo: created.recordNo.toString(),
          });
          recordRefs.set(action.key, {
            recordId: created.id,
            objectCode: target.schema.object.code,
          });
          effects.push({
            actionKey: action.key,
            type: action.type,
            effect: 'RECORD_CREATED',
            recordId: created.id,
          });
          break;
        }

        case 'UPDATE_RECORD': {
          // §19: only the Source Record, and never a write of its own — the
          // patch accumulates and the caller applies it once (§14).
          assertSourceWritable();
          const clashes = Object.keys(action.values).filter((fieldKey) =>
            writtenSourceFields.has(fieldKey),
          );
          if (clashes.length > 0) {
            throw new ApiException(
              'WORKFLOW_ACTION_SOURCE_PATCH_CONFLICT',
              400,
              {
                message: `多个执行动作不能更新当前记录的同一字段：${clashes.join('、')}。`,
              },
            );
          }
          const mapped = resolveFieldMappings(
            action.values,
            source.resolved.schema.fields,
          );
          for (const fieldKey of Object.keys(mapped)) {
            writtenSourceFields.add(fieldKey);
          }
          sourceValues = { ...sourceValues, ...mapped };
          await refreshSourcePatch();
          outputs.set(action.key, {
            type: 'UPDATE_RECORD',
            recordId: source.snapshot.id,
          });
          recordRefs.set(action.key, {
            recordId: source.snapshot.id,
            objectCode: source.objectCode,
          });
          effects.push({
            actionKey: action.key,
            type: action.type,
            effect: 'SOURCE_RECORD_UPDATED',
            recordId: source.snapshot.id,
          });
          break;
        }

        case 'ASSIGN_OWNER': {
          // §20/§46.5: V1 has no Employee owner-change capability, and an
          // ignored ASSIGN_OWNER would be a silent no-op — so it fails.
          if (context.role === 'EMPLOYEE') {
            throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403, {
              message: '员工不能通过流程动作变更记录负责人。',
            });
          }
          if (action.owner.source !== 'ACTOR') {
            throw new ApiException('WORKFLOW_ACTION_INVALID', 400, {
              message: 'V1 只支持把当前记录分配给执行人。',
            });
          }
          if (pendingOwnerMemberId !== undefined) {
            throw new ApiException('WORKFLOW_ACTION_INVALID', 400, {
              message: '同一流程动作中只能有一个变更负责人的动作。',
            });
          }
          // §20: the owner change still needs the ordinary source update
          // permission and scope; it grants nothing by itself.
          assertSourceWritable();
          pendingOwnerMemberId = context.memberId;
          await refreshSourcePatch();
          outputs.set(action.key, {
            type: 'ASSIGN_OWNER',
            recordId: source.snapshot.id,
            ownerMemberId: context.memberId,
          });
          recordRefs.set(action.key, {
            recordId: source.snapshot.id,
            objectCode: source.objectCode,
          });
          // §30: assigning the record to the member who already owns it is a
          // legal Action that changes nothing, so it emits NO effect — and
          // therefore no `record.owner_assigned` audit row claiming a change
          // that did not happen (the immutable snapshot decides, not the patch
          // the Action just staged).
          if (source.snapshot.ownerMemberId !== context.memberId) {
            effects.push({
              actionKey: action.key,
              type: action.type,
              effect: 'SOURCE_OWNER_ASSIGNED',
              recordId: source.snapshot.id,
            });
          }
          break;
        }

        case 'CREATE_RELATION': {
          const left = resolveRecordRef(action.left, 'left');
          const right = resolveRecordRef(action.right, 'right');
          // The writing side is the record whose relation list is being
          // extended: the SOURCE_RECORD when it takes part (the Transition is
          // acting on it), otherwise the left ref. The other side is only read,
          // exactly like the ordinary HTTP `add()` call.
          const sourceIsLeft = action.left.source === 'SOURCE_RECORD';
          const sourceIsRight = action.right.source === 'SOURCE_RECORD';
          const writeSide = sourceIsRight && !sourceIsLeft ? right : left;
          const readSide = writeSide === left ? right : left;
          const { relationId } = await deps.createRelation(
            input.tx,
            context,
            {
              code: writeSide.objectCode,
              id: writeSide.recordId,
              objectCode: readSide.objectCode,
              recordId: readSide.recordId,
            },
            relationMeta(action),
            relationDeps,
          );
          outputs.set(action.key, { type: 'CREATE_RELATION', relationId });
          effects.push({
            actionKey: action.key,
            type: action.type,
            effect: 'RELATION_CREATED',
            recordId: writeSide.recordId,
          });
          break;
        }

        case 'CREATE_FOLLOW_UP': {
          const target = resolveRecordRef(action.target, 'target');
          const resolvedObject = await resolveObjectFor(target.objectCode);
          if (!isReadable(resolvedObject.schema, resolvedObject.access)) {
            throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
          }
          // The ordinary follow-up path requires update access on the record's
          // object and scopes OWN reads/writes to the acting member.
          const { access } = resolvedObject;
          if (!access.canUpdate || access.updateScope === 'NONE') {
            throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
          }
          const scope: FollowUpRecordScope = {
            objectId: resolvedObject.schema.object.id,
            recordId: target.recordId,
            expectedRole: context.role,
            requiredOwnerMemberId:
              access.readScope === 'OWN' || access.updateScope === 'OWN'
                ? context.memberId
                : undefined,
          };
          const title = normalizeFollowUpTitle(
            resolveField('title', () =>
              resolveStringSource(action.title, valueContext()),
            ),
          );
          const dueAt = resolveField('dueAt', () =>
            resolveDateTimeSource(action.dueAt, valueContext()),
          );
          const created = await deps.createFollowUp(
            input.tx,
            context,
            {
              recordId: target.recordId,
              title,
              dueAt,
              assigneeMemberId: resolveMember('assignee', action.assignee),
            },
            actionMeta(action),
            scope,
            { audit: deps.audit },
          );
          outputs.set(action.key, {
            type: 'CREATE_FOLLOW_UP',
            followUpId: created.id,
            recordId: target.recordId,
          });
          recordRefs.set(action.key, {
            recordId: target.recordId,
            objectCode: target.objectCode,
          });
          effects.push({
            actionKey: action.key,
            type: action.type,
            effect: 'FOLLOW_UP_CREATED',
            recordId: target.recordId,
          });
          break;
        }
      }
    } catch (error) {
      throw actionFailure(action, input.execution.transitionKey, error);
    }
  }

  return { outputs, sourcePatch, effects };
}

function normalizeFollowUpTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized) {
    throw new ActionFieldError('title', '跟进标题不能为空。');
  }
  if ([...normalized].length > FOLLOW_UP_TITLE_MAX_LENGTH) {
    throw new ActionFieldError(
      'title',
      `跟进标题不能超过 ${FOLLOW_UP_TITLE_MAX_LENGTH} 个字符。`,
    );
  }
  return normalized;
}

function asFieldError(fieldKey: string, error: unknown): unknown {
  return error instanceof ActionValueError
    ? new ActionFieldError(fieldKey, error.reason)
    : error;
}

/**
 * §32: a failing Action is reported as `ACTION_EXECUTION_FAILED` with the field
 * path `actions.<actionKey>.<fieldKey>`, keeping the underlying domain message
 * for that field.
 *
 * Two errors stay untouched:
 * - `RECORD_VERSION_CONFLICT` belongs to the OUTER Source Record write, not to
 *   an Action, so it keeps its own code and status.
 * - anything that is not a domain failure (a programming error) is not turned
 *   into a client-facing action error.
 */
function actionFailure(
  action: WorkflowActionDraft,
  transitionKey: string,
  error: unknown,
): unknown {
  if (error instanceof ApiException) {
    if (error.code === 'RECORD_VERSION_CONFLICT') return error;
  } else if (
    !(error instanceof ActionFieldError) &&
    !(error instanceof ActionValueError)
  ) {
    return error;
  }

  const prefix = `actions.${action.key}`;
  const fieldErrors: FieldErrors = {};
  if (error instanceof ActionFieldError) {
    fieldErrors[`${prefix}.${error.fieldKey}`] = [error.reason];
  } else if (error instanceof ActionValueError) {
    fieldErrors[prefix] = [error.reason];
  } else if (error instanceof ApiException) {
    const fields = Object.entries(error.fieldErrors);
    if (fields.length === 0) {
      fieldErrors[prefix] = [error.message];
    } else {
      for (const [fieldKey, messages] of fields) {
        fieldErrors[`${prefix}.${fieldKey}`] = messages;
      }
    }
  }

  const status =
    error instanceof ApiException && error.getStatus() < 500
      ? error.getStatus()
      : 400;
  return new ApiException('ACTION_EXECUTION_FAILED', status, {
    message: `无法完成“${transitionKey}”：步骤“${action.key}”失败。所有变更均未保存。`,
    fieldErrors,
  });
}
