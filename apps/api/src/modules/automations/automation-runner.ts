import { isGroupPeer, recordFieldAccess } from '../objects/effective-access';
import {
  recordOwnerFilter,
  recordOwnerMatches,
} from '../objects/record-read-scope';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { executeActions } from '../actions/action-engine';
import { resolveActionValue } from '../actions/action-value-resolver';
import type { AuditService } from '../audit/audit.service';
import { createFollowUpCommand } from '../follow-ups/follow-up-command';
import { resolvePublishedObjectInTransaction } from '../objects/published-object-transaction';
import {
  isReadable,
  type ResolvedObjectSchema,
} from '../objects/published-object.service';
import {
  createRecordRelationCommand,
  recordRelationScope,
} from '../record-relations/record-relation-command';
import {
  assertRecordMutation,
  applySourceRecordPatch,
  resolveCreateOwner,
  type RecordRequestMeta,
} from '../records/record-command';
import { projectVisibleValues } from '../records/record-value-engine';
import { formatExportValue } from '../records/record-export';
import type {
  DynamicRecord,
  RecordsStore,
} from '../records/records.repository';
import { automationActions } from './automation-publication';
import { matchesFieldChange } from './automation.policy';
import type {
  AutomationExecution,
  AutomationRule,
  AutomationValue,
} from './automation.types';

export interface AutomationSession {
  tx: Prisma.TransactionClient;
  store: RecordsStore;
  context: TenantContext;
  audit: AuditService;
  resolved: ResolvedObjectSchema;
  source: DynamicRecord;
}
export function assertAutomationRole(
  rule: AutomationRule,
  context: TenantContext,
) {
  if (!rule.enabled || !rule.allowedRoles.includes(context.role))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
export async function automationTarget(
  session: AutomationSession,
  rule: AutomationRule,
  previewScope: 'RUNTIME' | 'ADMIN_DRAFT' = 'RUNTIME',
) {
  if (previewScope === 'ADMIN_DRAFT') {
    // Inspect configuration as the administrator, without impersonating a role.
    if (session.context.role !== 'TENANT_ADMIN')
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  } else {
    assertAutomationRole(rule, session.context);
  }
  const target = await resolvePublishedObjectInTransaction(
    session.tx,
    session.context,
    rule.targetObjectCode,
  );
  if (!target.access.canCreate || !isReadable(target.schema, target.access))
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  for (const [key, mapping] of Object.entries(rule.mappings)) {
    if (target.access.fields[key] !== 'EDIT')
      throw new ApiException('FIELD_READ_ONLY', 403);
    if (
      mapping.source === 'SOURCE_FIELD' &&
      !['EDIT', 'READ_ONLY'].includes(
        recordFieldAccess(session.resolved.access, session.source)[
          mapping.fieldKey
        ] ?? 'HIDDEN',
      )
    )
      throw new ApiException('FIELD_HIDDEN', 403);
  }
  return target;
}
export async function previewAutomation(
  session: AutomationSession,
  rule: AutomationRule,
  inputs: Record<string, AutomationValue>,
  previewScope: 'RUNTIME' | 'ADMIN_DRAFT' = 'RUNTIME',
) {
  const { resolved, source, context, store } = session;
  const target = await automationTarget(session, rule, previewScope);
  const allowedInputs = new Set(
    Object.entries(rule.mappings)
      .filter(([, value]) => value.source === 'INPUT')
      .map(([key]) => key),
  );
  if (Object.keys(inputs).some((key) => !allowedInputs.has(key)))
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '只能填写规则要求的字段。',
    });
  const values: Record<string, unknown> = {};
  const now = new Date();
  for (const [key, mapping] of Object.entries(rule.mappings)) {
    const field = target.schema.fields.find((field) => field.fieldKey === key);
    if (mapping.source === 'INPUT' && !(key in inputs)) continue;
    if (mapping.source === 'SOURCE_FIELD') {
      const sourceField = resolved.schema.fields.find(
        (field) => field.fieldKey === mapping.fieldKey,
      );
      if (!sourceField || sourceField.type !== field?.type)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: '来源与目标字段类型不一致。',
        });
    }
    if (
      mapping.source === 'NOW' &&
      !['DATE', 'DATETIME'].includes(field?.type ?? '')
    )
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '当前时间只能写入日期字段。',
      });
    values[key] = resolveActionValue(
      mapping.source === 'INPUT'
        ? { source: 'LITERAL', value: inputs[key] }
        : mapping,
      {
        clock: () => now,
        actor: { memberId: context.memberId },
        source: {
          recordId: source.id,
          title: source.title,
          ownerMemberId: source.ownerMemberId,
          values: source.values,
          fields: new Map(
            resolved.schema.fields.map((field) => [field.fieldKey, field]),
          ),
        },
        outputs: new Map(),
      },
      { targetFieldType: field?.type },
    );
  }
  const requestedOwner =
    rule.owner === 'ACTOR' ? context.memberId : source.ownerMemberId;
  if (!requestedOwner) throw new ApiException('OWNER_INVALID', 400);
  if (context.role === 'EMPLOYEE' && requestedOwner !== context.memberId)
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const ownerMemberId = (await resolveCreateOwner(
    context,
    store,
    requestedOwner,
  ))!;
  const scope = recordRelationScope(resolved, context, source.id, true);
  if (
    !isReadable(resolved.schema, resolved.access) ||
    !recordOwnerMatches(scope.owner, source.ownerMemberId) ||
    !recordOwnerMatches(
      recordOwnerFilter(target.access, context.memberId),
      ownerMemberId,
    )
  )
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  const normalized = await assertRecordMutation({
    mode: 'CREATE',
    resolved: target,
    submitted: values,
    memberExists: (id) => store.memberExists(id),
  });
  const visibleValues = projectVisibleValues(
    target.schema,
    target.access,
    normalized.values,
  );
  const visibleFields = target.schema.fields.filter((field) =>
    Object.hasOwn(visibleValues, field.fieldKey),
  );
  return {
    ruleKey: rule.key,
    targetObjectCode: target.schema.object.code,
    targetObjectName: target.schema.object.name,
    values: visibleValues,
    fieldLabels: Object.fromEntries(
      visibleFields.map((field) => [field.fieldKey, field.label]),
    ),
    valueLabels: Object.fromEntries(
      visibleFields
        .filter(
          (field) =>
            ['SINGLE_SELECT', 'MULTI_SELECT'].includes(field.type) &&
            visibleValues[field.fieldKey] != null,
        )
        .map((field) => [
          field.fieldKey,
          formatExportValue(field, visibleValues[field.fieldKey], new Map()),
        ]),
    ),
    ownerMemberId,
    sourceRecordId: source.id,
  };
}
export async function findAutomationExecution(
  session: AutomationSession,
  key: string,
  dedupKey: string,
): Promise<AutomationExecution | null> {
  const rows = await session.tx.$queryRaw<
    Array<{ result: AutomationExecution }>
  >`
    SELECT result FROM record_automation_executions
    WHERE tenant_id = ${session.context.tenantId}::uuid AND source_record_id = ${session.source.id}::uuid
      AND rule_key = ${key} AND dedup_key = ${dedupKey}
  `;
  return rows[0]?.result ?? null;
}
export async function executeAutomation(
  session: AutomationSession,
  rule: AutomationRule,
  inputs: Record<string, AutomationValue>,
  dedupKey: string,
  meta: RecordRequestMeta,
): Promise<AutomationExecution> {
  try {
    return await executeAutomationSteps(session, rule, inputs, dedupKey, meta);
  } catch (error: unknown) {
    if (error && typeof error === 'object')
      failureAudits.set(error, {
        tenantId: session.context.tenantId,
        actorType: 'USER',
        actorId: session.context.userId,
        action: 'automation.execution_failed',
        resourceType: 'record',
        resourceId: session.source.id,
        after: {
          ruleKey: rule.key,
          publicationId: session.resolved.schema.publication.id,
          sourceVersion:
            session.source.version -
            (rule.trigger.type === 'FIELD_CHANGED' ? 1 : 0),
          code: error instanceof ApiException ? error.code : 'INTERNAL_ERROR',
          dedupKey,
        },
        requestId: meta.requestId,
        ip: meta.ip,
      });
    throw error;
  }
}
/** Record a committed skip without storing inputs or executing actions again. */
export async function auditAutomationDeduplication(
  session: AutomationSession,
  rule: AutomationRule,
  meta: RecordRequestMeta,
) {
  await session.audit.append(session.tx, {
    tenantId: session.context.tenantId,
    actorType: 'USER',
    actorId: session.context.userId,
    action: 'automation.execution_deduplicated',
    resourceType: 'record',
    resourceId: session.source.id,
    after: {
      ruleKey: rule.key,
      publicationId: session.resolved.schema.publication.id,
      triggerType: rule.trigger.type,
    },
    requestId: meta.requestId,
    ip: meta.ip,
  });
}
async function executeAutomationSteps(
  session: AutomationSession,
  rule: AutomationRule,
  inputs: Record<string, AutomationValue>,
  dedupKey: string,
  meta: RecordRequestMeta,
): Promise<AutomationExecution> {
  const preview = await previewAutomation(session, rule, inputs);
  const id = randomUUID();
  const actions = automationActions(rule, inputs);
  // Resolve the snapshot once for preview and execution, including NOW and defaults.
  if (actions[0].type === 'CREATE_RECORD')
    actions[0].values = Object.fromEntries(
      Object.entries(preview.values)
        .filter(
          ([key]) =>
            rule.mappings[key] &&
            (rule.mappings[key].source !== 'INPUT' || key in inputs),
        )
        .map(([key, value]) => [
          key,
          { source: 'LITERAL', value: value as AutomationValue },
        ]),
    );
  const result = await executeActions({
    tx: session.tx,
    context: session.context,
    source: {
      objectCode: session.resolved.schema.object.code,
      resolved: session.resolved,
      snapshot: session.source,
    },
    actions,
    execution: {
      workflowExecutionId: id,
      transitionKey: rule.key,
      transitionLabel: rule.label,
    },
    meta,
    deps: {
      store: session.store,
      audit: session.audit,
      resolveObject: (code) =>
        resolvePublishedObjectInTransaction(session.tx, session.context, code),
      createRelation: createRecordRelationCommand,
      createFollowUp: createFollowUpCommand,
      clock: () => new Date(),
      idGenerator: randomUUID,
    },
  });
  const created = result.outputs.get('create');
  if (created?.type !== 'CREATE_RECORD')
    throw new Error('Automation create output missing');
  if (rule.trigger.type === 'MANUAL') {
    await applySourceRecordPatch({
      store: session.store,
      recordId: session.source.id,
      expectedVersion: session.source.version,
      patch: {
        values: session.source.values,
        title: session.source.title,
        ownerMemberId: session.source.ownerMemberId,
      },
    });
  }
  const execution: AutomationExecution = {
    id,
    ruleKey: rule.key,
    ruleLabel: rule.label,
    triggerType: rule.trigger.type,
    sourceRecordId: session.source.id,
    targetObjectCode: created.objectCode,
    targetRecordId: created.recordId,
    targetRecordNo: created.recordNo,
    actorMemberId: session.context.memberId,
    executedAt: new Date().toISOString(),
    publicationId: session.resolved.schema.publication.id,
  };
  await session.tx.$executeRaw`
    INSERT INTO record_automation_executions (id, tenant_id, source_record_id, target_record_id, rule_key, dedup_key, publication_id, actor_member_id, result)
    VALUES (${id}::uuid, ${session.context.tenantId}::uuid, ${session.source.id}::uuid, ${created.recordId}::uuid, ${rule.key}, ${dedupKey}, ${execution.publicationId}::uuid, ${session.context.memberId}::uuid, ${JSON.stringify(execution)}::jsonb)
  `;
  return execution;
}
export async function runFieldAutomations(
  session: AutomationSession,
  before: DynamicRecord,
  meta: RecordRequestMeta,
): Promise<void> {
  for (const rule of session.resolved.schema.automations ?? []) {
    if (!matchesFieldChange(rule, before.values, session.source.values))
      continue;
    if (
      isGroupPeer(session.resolved.access, session.source) &&
      !recordOwnerMatches(
        recordOwnerFilter(
          session.resolved.access,
          session.context.memberId,
          true,
        ),
        session.source.ownerMemberId,
      )
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, {
        message:
          '该字段变更会触发自动化，但当前权限仅允许修改组员字段。请联系管理员调整原记录操作范围或自动化规则。',
      });
    }
    if (await findAutomationExecution(session, rule.key, 'field:first')) {
      await auditAutomationDeduplication(session, rule, meta);
      continue;
    }
    if (
      rule.trigger.type === 'FIELD_CHANGED' &&
      recordFieldAccess(session.resolved.access, session.source)[
        rule.trigger.fieldKey
      ] === 'HIDDEN'
    )
      throw new ApiException('FIELD_HIDDEN', 403);
    await executeAutomation(session, rule, {}, 'field:first', meta);
  }
}

const failureAudits = new WeakMap<
  object,
  import('../audit/audit-event').AuditEvent
>();
/** Only safe identifiers survive rollback; no input values or error messages. */
export function automationFailureAudit(error: unknown) {
  return error && typeof error === 'object'
    ? failureAudits.get(error)
    : undefined;
}
