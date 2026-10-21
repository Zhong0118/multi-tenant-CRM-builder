import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { AuditService } from '../audit/audit.service';
import { OBJECTS_REPOSITORY } from '../objects/objects.service';
import type { ObjectsRepository } from '../objects/objects.repository';
import { RECORDS_REPOSITORY } from '../records/records.service';
import type { RecordsRepository } from '../records/records.repository';
import {
  requireVisibleRecord,
  type RecordRequestMeta,
} from '../records/record-command';
import { resolveReadablePublishedObjectInTransaction } from '../objects/published-object-transaction';
import {
  automationTarget,
  assertAutomationRole,
  executeAutomation,
  findAutomationExecution,
  previewAutomation,
  type AutomationSession,
} from './automation-runner';
import { validateAutomationRules } from './automation.policy';
import { analyzeAutomationPublication } from './automation-publication';
import type {
  AutomationExecution,
  AutomationRule,
  AutomationValue,
} from './automation.types';
import type {
  ExecuteAutomationDto,
  PreviewDraftAutomationDto,
  RuntimeAutomationDto,
  SaveAutomationsDto,
} from './automation.dto';

@Injectable()
export class AutomationsService {
  constructor(
    @Inject(OBJECTS_REPOSITORY) private readonly objects: ObjectsRepository,
    @Inject(RECORDS_REPOSITORY) private readonly records: RecordsRepository,
    private readonly audit: AuditService,
  ) {}
  get(context: TenantContext, objectId: string) {
    admin(context);
    return this.objects.withTenant(context, async (store) => {
      const draft = await store.findObject(objectId);
      if (!draft) throw new ApiException('OBJECT_NOT_FOUND', 404);
      return {
        objectId,
        version: draft.object.version,
        publishedRules: draft.activeSchema?.automations ?? [],
        rules: draft.automations ?? [],
      };
    });
  }
  save(
    context: TenantContext,
    objectId: string,
    input: SaveAutomationsDto,
    meta: RecordRequestMeta,
  ) {
    admin(context);
    return this.objects.withTenant(context, async (store) => {
      await store.lockLifecycleConfiguration();
      await store.lockObject(objectId);
      const draft = await store.findObject(objectId);
      if (!draft) throw new ApiException('OBJECT_NOT_FOUND', 404);
      if (draft.object.status === 'ARCHIVED')
        throw new ApiException('OBJECT_ARCHIVED', 409);
      if (draft.object.version !== input.expectedVersion)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      draft.automations = validateAutomationRules(
        input.rules,
        draft.object.code,
        draft.fields
          .filter((field) => field.status === 'ACTIVE')
          .map((field) => field.fieldKey),
      );
      draft.actionTargets = await store.findActionTargetObjects(
        draft.automations.map((rule) => rule.targetObjectCode),
      );
      const issues = analyzeAutomationPublication(draft);
      if (issues.length)
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: issues.map((issue) => issue.message).join('；'),
        });
      const saved = await store.saveObject(draft, input.expectedVersion);
      if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit({
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'automation.draft_updated',
        resourceType: 'object_definition',
        resourceId: objectId,
        after: {
          ruleKeys: draft.automations.map((rule) => rule.key),
          objectVersion: saved.object.version,
        },
        requestId: meta.requestId,
        ip: meta.ip,
      });
      return {
        objectId,
        version: saved.object.version,
        publishedRules: saved.activeSchema?.automations ?? [],
        rules: saved.automations ?? [],
      };
    });
  }
  async previewDraft(
    context: TenantContext,
    objectId: string,
    input: PreviewDraftAutomationDto,
  ) {
    admin(context);
    const draft = await this.objects.withTenant(context, (store) =>
      store.findObject(objectId),
    );
    if (!draft) throw new ApiException('OBJECT_NOT_FOUND', 404);
    return this.session(
      context,
      draft.object.code,
      input.sourceRecordId,
      false,
      (session) => {
        const [rule] = validateAutomationRules(
          [input.rule],
          draft.object.code,
          session.resolved.schema.fields.map((field) => field.fieldKey),
        );
        return previewAutomation(
          session,
          { ...rule, enabled: true },
          input.inputs,
        );
      },
    );
  }
  list(context: TenantContext, code: string, recordId: string) {
    return this.session(context, code, recordId, false, async (session) => {
      const items: RuntimeAutomationDto[] = [];
      for (const rule of session.resolved.schema.automations ?? []) {
        if (
          !rule.enabled ||
          rule.trigger.type !== 'MANUAL' ||
          !rule.allowedRoles.includes(context.role)
        )
          continue;
        try {
          const target = await automationTarget(session, rule);
          items.push({
            key: rule.key,
            label: rule.label,
            targetObjectCode: rule.targetObjectCode,
            targetObjectName: target.schema.object.name,
            inputFields: target.schema.fields
              .filter(
                (field) => rule.mappings[field.fieldKey]?.source === 'INPUT',
              )
              .map(
                ({
                  fieldKey,
                  label,
                  type,
                  required,
                  config,
                  defaultValue,
                  validation,
                }) => ({
                  fieldKey,
                  label,
                  type,
                  required,
                  config,
                  defaultValue,
                  validation,
                }),
              ),
          });
        } catch (error) {
          if (!(error instanceof ApiException)) throw error;
        }
      }
      return { items };
    });
  }
  preview(
    context: TenantContext,
    code: string,
    recordId: string,
    key: string,
    inputs: Record<string, AutomationValue>,
  ) {
    return this.session(context, code, recordId, false, (session) =>
      previewAutomation(session, manualRule(session, key), inputs),
    );
  }
  execute(
    context: TenantContext,
    code: string,
    recordId: string,
    key: string,
    input: ExecuteAutomationDto,
    meta: RecordRequestMeta,
  ) {
    return this.session(context, code, recordId, true, async (session) => {
      const rule = manualRule(session, key);
      assertAutomationRole(rule, context);
      const existing = await findAutomationExecution(
        session,
        key,
        `manual:${input.requestId}`,
      );
      if (existing) {
        await automationTarget(session, rule);
        const target = await resolveReadablePublishedObjectInTransaction(
          session.tx,
          context,
          existing.targetObjectCode,
        );
        await requireVisibleRecord(
          session.store,
          target,
          context,
          existing.targetRecordId,
          'READ',
        );
        return existing;
      }
      if (session.source.version !== input.expectedVersion)
        throw new ApiException('RECORD_VERSION_CONFLICT', 409);
      return executeAutomation(
        session,
        rule,
        input.inputs,
        `manual:${input.requestId}`,
        meta,
      );
    });
  }
  history(context: TenantContext, code: string, recordId: string) {
    return this.session(
      context,
      code,
      recordId,
      false,
      async (session) => {
        const rows = await session.tx.$queryRaw<
          Array<{ result: AutomationExecution }>
        >`SELECT result FROM record_automation_executions WHERE tenant_id = ${context.tenantId}::uuid AND source_record_id = ${recordId}::uuid ORDER BY created_at DESC LIMIT 100`;
        const items: AutomationExecution[] = [];
        for (const row of rows) {
          try {
            const target = await resolveReadablePublishedObjectInTransaction(
              session.tx,
              context,
              row.result.targetObjectCode,
            );
            await requireVisibleRecord(
              session.store,
              target,
              context,
              row.result.targetRecordId,
              'READ',
            );
            items.push(row.result);
          } catch (error) {
            if (!(error instanceof ApiException)) throw error;
          }
        }
        return { items };
      },
      'READ',
    );
  }
  private session<T>(
    context: TenantContext,
    code: string,
    recordId: string,
    lock: boolean,
    work: (session: AutomationSession) => Promise<T>,
    action: 'READ' | 'UPDATE' = 'UPDATE',
  ): Promise<T> {
    return this.records.withTenantTransaction(
      context,
      async ({ tx, store }) => {
        const resolved = await resolveReadablePublishedObjectInTransaction(
          tx,
          context,
          code,
        );
        const source = await requireVisibleRecord(
          store,
          resolved,
          context,
          recordId,
          action,
          lock,
        );
        // A relation reads both sides, even where update permission is broader.
        await requireVisibleRecord(store, resolved, context, recordId, 'READ');
        return work({
          tx,
          store,
          context,
          audit: this.audit,
          resolved,
          source,
        });
      },
    );
  }
}
function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
}
function manualRule(session: AutomationSession, key: string): AutomationRule {
  const rule = session.resolved.schema.automations?.find(
    (rule) => rule.key === key && rule.trigger.type === 'MANUAL',
  );
  if (!rule)
    throw new ApiException('VALIDATION_FAILED', 400, {
      message: '该手动规则不存在或尚未发布。',
    });
  return rule;
}
