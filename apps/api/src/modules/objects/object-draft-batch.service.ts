import { Inject, Injectable } from '@nestjs/common';
import {
  tableEmployeePresetAccess,
  type TableEmployeePreset,
  type TableBlueprint,
  type TableBuilderTarget,
  type FieldPlan,
  type TablePlan,
} from '@crm/contracts';
import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { blueprintFieldConfig, validateBlueprint } from '../ai/table-blueprint';
import type { ActionPublicationTarget } from '../actions/action-publication.policy';
import { analyzeAutomationDependencies } from '../automations/automation-publication';
import { analyzePoolProtectionSources } from '../records/record-pool-config';
import type {
  AnalyzeDraftGroupDto,
  PublishDraftGroupDto,
  PublishTemplateInitializationDto,
} from './dto/template-initialization.dto';
import { analyzeObjectConfiguration } from './object-configuration.policy';
import { toObjectDraftResponse } from './object-draft.presenter';
import { analyzePublication } from './object-publication.policy';
import { isPublishedFieldType } from './object-schema';
import type {
  ObjectDraft,
  ObjectsStore,
  ObjectsRepository,
} from './objects.repository';
import {
  OBJECTS_REPOSITORY,
  OBJECTS_ID_GENERATOR,
  ObjectsService,
  type RequestMeta,
  type FieldCreateInput,
  assertTenantAdmin,
  requireDraft,
  assertNotArchived,
  assertVersion,
  auditEvent,
  validationError,
  updateObject,
  appendField,
  orderFields,
  setDefaultView,
  setEmployeeAccess,
  toJsonRecord,
} from './objects.service';

@Injectable()
export class ObjectDraftBatchService {
  constructor(
    @Inject(OBJECTS_REPOSITORY) private readonly repository: ObjectsRepository,
    @Inject(OBJECTS_ID_GENERATOR) private readonly idGenerator: () => string,
    private readonly objects: ObjectsService,
  ) {}

  templateInitialization(context: TenantContext) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const groups = new Map<
        string,
        Array<{
          id: string;
          name: string;
          code: string;
          version: number;
          poolConfigVersion: number;
        }>
      >();
      for (const {
        templateVersionId,
        ...object
      } of await store.listTemplateInitializationCandidates!()) {
        const objects = groups.get(templateVersionId) ?? [];
        objects.push(object);
        groups.set(templateVersionId, objects);
      }
      return {
        groups: [...groups].map(([templateVersionId, objects]) => ({
          templateVersionId,
          objects,
        })),
      };
    });
  }

  publishTemplateInitialization(
    context: TenantContext,
    input: PublishTemplateInitializationDto,
    meta: RequestMeta,
  ) {
    return this.publishGroup(context, input, meta, input.templateVersionId);
  }

  analyzeDraftGroup(context: TenantContext, input: AnalyzeDraftGroupDto) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const drafts = await this.loadGroup(store, input.objectIds);
      const { analyses, blocking } = await this.analyzeGroup(store, drafts);
      return {
        objects: await Promise.all(
          drafts.map(async ({ object, pool }, index) => ({
            nextPublicationNumber: await store.nextPublicationNumber(object.id),
            id: object.id,
            name: object.name,
            code: object.code,
            version: object.version,
            poolConfigVersion: pool?.version ?? 1,
            analysis: analyses[index],
          })),
        ),
        blocking,
      };
    });
  }

  publishDraftGroup(
    context: TenantContext,
    input: PublishDraftGroupDto,
    meta: RequestMeta,
  ) {
    return this.publishGroup(context, input, meta);
  }

  private publishGroup(
    context: TenantContext,
    input: PublishDraftGroupDto,
    meta: RequestMeta,
    templateVersionId?: string,
  ) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const drafts = await this.loadGroup(
        store,
        input.objects.map((o) => o.id),
        templateVersionId,
      );
      for (const [index, draft] of drafts.entries()) {
        const expected = input.objects[index];
        assertVersion(draft, expected.expectedVersion);
        if ((draft.pool?.version ?? 1) !== expected.expectedPoolConfigVersion)
          throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      }
      const { analyses, blocking } = await this.analyzeGroup(store, drafts);
      if (blocking.length)
        throw new ApiException('PUBLICATION_BLOCKED', 422, {
          message: blocking.map((issue) => issue.message).join('；'),
          fieldErrors: Object.fromEntries(
            blocking.map((issue) => [
              `objects.${issue.objectId}${issue.fieldKey ? '.fields.' + issue.fieldKey : issue.transitionKey ? '.transitions.' + issue.transitionKey : ''}`,
              [issue.message],
            ]),
          ),
        });
      for (const [index, draft] of drafts.entries())
        await this.objects.commitPublication(
          store,
          context,
          draft,
          analyses[index],
          meta,
        );
      return {
        published: drafts.map((draft) => ({
          id: draft.object.id,
          code: draft.object.code,
          name: draft.object.name,
        })),
      };
    });
  }

  private async loadGroup(
    store: ObjectsStore,
    ids: string[],
    templateVersionId?: string,
  ) {
    if (!ids.length || new Set(ids).size !== ids.length)
      throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
    await store.lockLifecycleConfiguration();
    await store.assertActiveAdmin();
    for (const id of [...ids].sort()) await store.lockObject(id);
    const templates = await store.listTemplateInitializationCandidates!();
    const selected = new Set(ids);
    if (templateVersionId !== undefined) {
      const group = templates.filter(
        (o) => o.templateVersionId === templateVersionId,
      );
      if (group.length !== ids.length || group.some((o) => !selected.has(o.id)))
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
    } else if (templates.some((o) => selected.has(o.id))) {
      throw validationError('objectIds', '请从模板初始化页面发布完整模板。');
    }
    const drafts: ObjectDraft[] = [];
    for (const id of ids) {
      const draft = await requireDraft(store, id);
      assertNotArchived(draft);
      if (!toObjectDraftResponse(draft).object.hasUnpublishedChanges)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      drafts.push(draft);
    }
    return drafts;
  }

  private async analyzeGroup(store: ObjectsStore, drafts: ObjectDraft[]) {
    const targets = new Map<string, ActionPublicationTarget>();
    const existing = await store.listPublishedPoolConfigurations!();
    for (const object of existing)
      targets.set(object.code, {
        code: object.code,
        status: 'ACTIVE',
        schema: object.schema,
      });
    for (const draft of drafts) {
      draft.workflow = await store.findWorkflowDraft(draft.object.id);
      draft.workflowStateRecordCounts = await store.countRecordsByWorkflowState(
        draft.object.id,
      );
      targets.set(draft.object.code, {
        code: draft.object.code,
        status: 'ACTIVE',
        schema: {
          fields: draft.fields.flatMap((f) =>
            f.status === 'ACTIVE' && isPublishedFieldType(f.type)
              ? [{ ...f, type: f.type }]
              : [],
          ),
          employeeAccess: draft.employeeAccess,
        },
      });
    }
    const states = new Map(
      existing.map((o) => [
        o.code,
        o.schema.workflow?.states.map((s) => s.key) ?? [],
      ]),
    );
    for (const draft of drafts)
      states.set(
        draft.object.code,
        draft.workflow?.isEnabled
          ? draft.workflow.states.map((s) => s.key)
          : [],
      );
    const objects = await store.listObjects();
    const analyses = drafts.map((draft) => {
      draft.actionTargets = targets;
      const analysis = analyzePublication(draft);
      analysis.blocking.push(...analyzeAutomationDependencies(draft, objects));
      if (draft.pool)
        analysis.blocking.push(
          ...analyzePoolProtectionSources(draft.pool, states),
        );
      return analysis;
    });
    const blocking = analyses.flatMap((analysis, index) =>
      analysis.blocking.map((issue) => ({
        ...issue,
        objectId: drafts[index].object.id,
      })),
    );
    for (const object of existing)
      blocking.push(
        ...analyzePoolProtectionSources(object.pool, states).map((issue) => ({
          ...issue,
          objectId: object.schema.object.id,
        })),
      );
    return { analyses, blocking };
  }

  blueprintMetadata(context: TenantContext) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await store.assertActiveAdmin();
      return store.listObjectStructures();
    });
  }

  async confirmTableBlueprint(
    context: TenantContext,
    submitted: TableBlueprint,
    target: TableBuilderTarget | undefined,
    meta: RequestMeta,
    employeePresets?: Record<string, TableEmployeePreset>,
  ) {
    assertTenantAdmin(context);
    return this.repository.withTenant(
      context,
      async (store) => {
        await store.lockLifecycleConfiguration();
        await store.assertActiveAdmin();
        if (target) await store.lockObject(target.objectId);
        const structures = await store.listObjectStructures();
        const { blueprint, issues } = validateBlueprint(
          submitted,
          structures,
          target,
        );
        const blocking = issues.filter((i) => i.blocking);
        if (blocking.length) {
          const conflict = blocking.some((i) => i.code === 'NAME_IN_USE');
          throw new ApiException(
            conflict ? 'CONFIG_VERSION_CONFLICT' : 'VALIDATION_FAILED',
            conflict ? 409 : 400,
            {
              fieldErrors: Object.fromEntries(
                blocking.map((i) => [
                  [i.tableId, i.fieldId, i.path].filter(Boolean).join('.'),
                  [i.message],
                ]),
              ),
            },
          );
        }
        const objects: { id: string; code: string; version: number }[] = [];
        for (const [index, table] of blueprint.tables.entries()) {
          const keys = executionKeys(submitted.tables[index]);
          const canonical = executionKeys(table);
          if (
            keys.length !== canonical.length ||
            keys.some((k, i) => k !== canonical[i])
          )
            throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
          const draft = target
            ? await requireDraft(store, target.objectId)
            : await this.objects.createInStore(
                store,
                context,
                {
                  name: table.name,
                  code: table.code,
                  icon: table.icon,
                  titleFieldKey: table.fields.find(
                    (f) => f.id === table.titleFieldId,
                  )!.fieldKey,
                  initialFields: table.fields
                    .filter((f) => f.type !== 'MEMBER')
                    .map(projectField),
                },
                meta,
                structures,
              );
          assertNotArchived(draft);
          const updated = await this.applyTablePlan(
            store,
            context,
            draft,
            table,
            !!target,
            meta,
            employeePresets?.[table.id] ?? 'CLOSED',
          );
          const { id, code, version } = updated.object;
          objects.push({ id, code, version });
          if (!target)
            structures.push({ ...updated.object, fields: updated.fields });
        }
        return { objects };
      },
      { timeout: 30_000 },
    );
  }

  private async applyTablePlan(
    store: ObjectsStore,
    context: TenantContext,
    draft: ObjectDraft,
    table: TablePlan,
    appendOnly: boolean,
    meta: RequestMeta,
    preset: TableEmployeePreset,
  ) {
    const preexisting = new Set(
      appendOnly
        ? draftConfigurationBlockers(draft).map((i) => JSON.stringify(i))
        : [],
    );
    const additions = appendOnly
      ? table.fields
      : table.fields.filter((f) => f.type === 'MEMBER');
    if (additions.length) {
      const previousCount = draft.fields.length;
      for (const field of additions)
        appendField(draft, projectField(field), this.idGenerator());
      const added = draft.fields.slice(previousCount);
      const updated = await store.appendHiddenFields(
        draft.object.id,
        draft.object.version,
        added,
      );
      if (!updated) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      draft = updated;
      for (const field of added)
        await store.appendAudit(
          auditEvent(context, meta, 'object.field_created', draft.object.id, {
            fieldKey: field.fieldKey,
            version: draft.object.version,
          }),
        );
    }
    if (!appendOnly) {
      let previous = structuredClone(draft);
      const save = async (action: string) => {
        draft = await this.objects.saveChange(
          store,
          context,
          draft,
          action,
          meta,
          previous,
        );
        previous = structuredClone(draft);
      };

      if (table.description !== undefined) {
        updateObject(draft, { description: table.description });
        await save('object.updated');
      }
      if (additions.length) {
        orderFields(draft, {
          fieldIds: table.fields.map(
            (f) => draft.fields.find((d) => d.fieldKey === f.fieldKey)!.id,
          ),
        });
        await save('object.field_order_updated');
      }
      setDefaultView(draft, {
        name: '全部记录',
        columnFieldKeys: table.view.columnIds.map(
          (id) => table.fields.find((f) => f.id === id)!.fieldKey,
        ),
        sort: { field: 'updatedAt', direction: 'desc' },
      });
      await save('object.default_view_updated');
      const { fieldAccess, ...objectAccess } =
        tableEmployeePresetAccess(preset);
      setEmployeeAccess(draft, {
        ...objectAccess,
        fields: Object.fromEntries(
          draft.fields.map((f) => [f.fieldKey, fieldAccess]),
        ),
      });
      await save('object.permissions_updated');
    }
    const blocking = draftConfigurationBlockers(draft).filter(
      (i) => !preexisting.has(JSON.stringify(i)),
    );
    if (blocking.length)
      throw validationError(
        'fields',
        blocking.map((i) => i.message).join('；'),
      );
    return draft;
  }
}

function projectField(f: FieldPlan): Omit<FieldCreateInput, 'expectedVersion'> {
  return {
    fieldKey: f.fieldKey,
    label: f.label,
    type: f.type,
    required: f.required,
    defaultValue: null,
    isSystem: false,
    validation: toJsonRecord(f.validation ?? {}),
    config: toJsonRecord(blueprintFieldConfig(f)),
  };
}

function executionKeys(table: TablePlan) {
  return [
    table.code,
    ...table.fields.flatMap((f) => [
      f.fieldKey,
      ...(f.options ?? []).map((o) => o.key),
    ]),
  ];
}

function draftConfigurationBlockers(draft: ObjectDraft) {
  return analyzeObjectConfiguration({
    ...draft,
    previousFields: draft.activeSchema?.fields,
    historicalFields: draft.previousPublishedFields,
  }).blocking.filter((i) => i.code !== 'REQUIRED_FIELD_HIDDEN');
}
