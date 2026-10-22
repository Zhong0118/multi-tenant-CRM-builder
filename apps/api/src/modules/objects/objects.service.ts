import { analyzeAutomationDependencies } from '../automations/automation-publication';
import { Inject, Injectable } from '@nestjs/common';

import { toObjectDraftResponse } from './object-draft.presenter';
import type { LifecycleBlocker } from './object-lifecycle.policy';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import { collectActionTargetObjectCodes } from '../actions/action-publication.policy';
import type { AuditEvent } from '../audit/audit-event';
import {
  analyzeObjectConfiguration,
  dropIncompatibleSettings,
} from './object-configuration.policy';
import {
  analyzePublication,
  compilePublication,
  type DraftFieldType,
  type PublicationDraftField,
} from './object-publication.policy';
import {
  isSearchableFieldType,
  type JsonValue,
  type PublishedDataScope,
  type PublishedFieldAccess,
} from './object-schema';
import type {
  ObjectDraft,
  ObjectPublicationSummary,
  ObjectsRepository,
  ObjectsStore,
} from './objects.repository';

export const OBJECTS_REPOSITORY = Symbol('OBJECTS_REPOSITORY');
export const OBJECTS_CLOCK = Symbol('OBJECTS_CLOCK');
export const OBJECTS_ID_GENERATOR = Symbol('OBJECTS_ID_GENERATOR');

interface RequestMeta {
  requestId: string;
  ip?: string;
}

interface ObjectMutationInput {
  expectedVersion: number;
  name?: string;
  code?: string;
  description?: string | null;
  icon?: string | null;
  titleFieldKey?: string;
}

interface FieldCreateInput {
  expectedVersion: number;
  fieldKey: string;
  label: string;
  type: DraftFieldType;
  required: boolean;
  defaultValue: JsonValue;
  validation: Record<string, JsonValue>;
  config: Record<string, JsonValue>;
  isSystem: boolean;
}

interface InitialFieldInput {
  fieldKey: string;
  label: string;
  type: DraftFieldType;
  required: boolean;
  defaultValue?: JsonValue;
  validation?: object;
  config?: object;
}

interface FieldMutationInput {
  expectedVersion: number;
  fieldKey?: string;
  label?: string;
  type?: DraftFieldType;
  required?: boolean;
  defaultValue?: JsonValue;
  validation?: Record<string, JsonValue>;
  config?: Record<string, JsonValue>;
  status?: 'ACTIVE' | 'INACTIVE';
}

interface DefaultViewInput {
  expectedVersion: number;
  name: string;
  columnFieldKeys: string[];
  searchFieldKeys?: string[];
  sort: {
    field: 'updatedAt' | 'createdAt' | 'recordNo';
    direction: 'asc' | 'desc';
  };
}

interface EmployeePermissionInput {
  expectedVersion: number;
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: false;
  readScope: PublishedDataScope;
  updateScope: PublishedDataScope;
  fields: Record<string, PublishedFieldAccess>;
}

@Injectable()
export class ObjectsService {
  constructor(
    @Inject(OBJECTS_REPOSITORY)
    private readonly repository: ObjectsRepository,
    @Inject(OBJECTS_CLOCK) private readonly clock: () => Date,
    @Inject(OBJECTS_ID_GENERATOR) private readonly idGenerator: () => string,
  ) {}

  list(context: TenantContext): Promise<ObjectDraft[]> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, (store) => store.listObjects());
  }

  detail(context: TenantContext, objectId: string): Promise<ObjectDraft> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const draft = await store.findObject(objectId);
      if (!draft) throw new ApiException('OBJECT_NOT_FOUND', 404);
      return draft;
    });
  }

  async create(
    context: TenantContext,
    input: {
      name: string;
      code: string;
      icon?: string | null;
      initialFields?: InitialFieldInput[];
      titleFieldKey?: string;
    },
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    assertTenantAdmin(context);
    const code = normalizeObjectCode(input.code);
    return await this.repository.withTenant(context, async (store) => {
      const objects = await store.listObjects();
      const draft: ObjectDraft = {
        object: {
          id: this.idGenerator(),
          code,
          name: input.name.trim(),
          description: null,
          titleFieldKey: 'name',
          icon: input.icon ?? null,
          sortOrder:
            objects.reduce(
              (maximum, item) => Math.max(maximum, item.object.sortOrder),
              0,
            ) + 10,
          version: 1,
          status: 'DRAFT',
          activePublicationId: null,
          publishedAt: null,
        },
        fields: [],
        defaultView: null,
        employeeAccess: null,
        activeSchema: null,
        activeRecordCount: 0,
      };

      if (input.initialFields !== undefined) {
        if (
          !Array.isArray(input.initialFields) ||
          input.initialFields.length < 1 ||
          input.initialFields.length > 40
        ) {
          throw validationError(
            'initialFields',
            '初始字段数量必须为 1–40 个。',
          );
        }
        if (!input.titleFieldKey) {
          throw validationError('titleFieldKey', '请选择标题字段。');
        }
        draft.object.titleFieldKey = normalizeFieldKey(input.titleFieldKey);
        const fieldKeys = new Set<string>();
        draft.fields = input.initialFields.map((field, index) => {
          const fieldKey = normalizeFieldKey(field.fieldKey);
          if (fieldKeys.has(fieldKey)) {
            throw validationError('initialFields', '字段键必须保持唯一。');
          }
          fieldKeys.add(fieldKey);
          if (!field.label.trim()) {
            throw validationError('initialFields', '字段名称不能为空。');
          }
          if (field.type === 'MEMBER' || field.type === 'ATTACHMENT') {
            throw validationError(
              'initialFields',
              '初始字段不支持成员或附件类型。',
            );
          }
          const config = toJsonRecord(field.config ?? {});
          if (Array.isArray(config.options) && config.options.length > 100) {
            throw validationError(
              'initialFields',
              '每个字段最多支持 100 个选项。',
            );
          }
          return {
            id: this.idGenerator(),
            fieldKey,
            label: field.label.trim(),
            type: field.type,
            required: field.required,
            defaultValue: field.defaultValue ?? null,
            validation: toJsonRecord(field.validation ?? {}),
            config,
            sortOrder: (index + 1) * 10,
            isSystem: false,
            status: 'ACTIVE',
          };
        });
        draft.defaultView = {
          code: 'default',
          name: '全部记录',
          columnFieldKeys: draft.fields.map((field) => field.fieldKey),
          sort: { field: 'updatedAt', direction: 'desc' },
        };
        draft.employeeAccess = {
          canCreate: false,
          canRead: false,
          canUpdate: false,
          canDelete: false,
          readScope: 'NONE',
          updateScope: 'NONE',
          fields: Object.fromEntries(
            draft.fields.map((field) => [field.fieldKey, 'HIDDEN']),
          ),
        };
        // A new draft intentionally keeps employees out. Its required hidden
        // fields are reviewed when configuring permissions before publication.
        const blocking = analyzeObjectConfiguration(draft).blocking.filter(
          (issue) => issue.code !== 'REQUIRED_FIELD_HIDDEN',
        );
        if (blocking.length > 0) {
          throw validationError(
            'initialFields',
            blocking.map((issue) => issue.message).join('；'),
          );
        }
      }

      try {
        let created = await store.createObject(draft);
        if (input.initialFields !== undefined) {
          const saved = await store.saveObject(draft, draft.object.version, {
            bumpVersion: false,
          });
          if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
          created = saved;
        }
        await store.appendAudit(
          auditEvent(context, meta, 'object.created', created.object.id, {
            name: created.object.name,
            code: created.object.code,
            status: created.object.status,
          }),
        );
        return created;
      } catch (error) {
        if (hasErrorCode(error, 'P2002')) {
          throw validationError('code', '对象代码已被使用。');
        }
        throw error;
      }
    });
  }

  update(
    context: TenantContext,
    objectId: string,
    input: ObjectMutationInput,
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.updated',
      (draft) => {
        if (input.code !== undefined) {
          const code = normalizeObjectCode(input.code);
          if (draft.activeSchema && code !== draft.object.code) {
            throw validationError('code', '对象发布后不能修改代码。');
          }
          draft.object.code = code;
        }
        if (input.name !== undefined) draft.object.name = input.name.trim();
        if (input.description !== undefined)
          draft.object.description = input.description;
        if (input.icon !== undefined) draft.object.icon = input.icon;
        if (input.titleFieldKey !== undefined)
          draft.object.titleFieldKey = input.titleFieldKey;
      },
    );
  }

  createField(
    context: TenantContext,
    objectId: string,
    input: FieldCreateInput,
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    const fieldKey = normalizeFieldKey(input.fieldKey);
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.field_created',
      (draft) => {
        if (draft.fields.some((field) => field.fieldKey === fieldKey)) {
          throw validationError('fieldKey', '字段键已被使用。');
        }
        draft.fields.push({
          id: this.idGenerator(),
          fieldKey,
          label: input.label.trim(),
          type: input.type,
          required: input.required,
          defaultValue: input.defaultValue,
          validation: { ...input.validation },
          config: { ...input.config },
          sortOrder:
            draft.fields.reduce(
              (maximum, field) => Math.max(maximum, field.sortOrder),
              0,
            ) + 10,
          isSystem: input.isSystem,
          status: 'ACTIVE',
        });
      },
    );
  }

  updateField(
    context: TenantContext,
    objectId: string,
    fieldId: string,
    input: FieldMutationInput,
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.field_updated',
      (draft) => {
        const field = draft.fields.find(
          (candidate) => candidate.id === fieldId,
        );
        if (!field) throw new ApiException('FIELD_UNKNOWN', 404);
        if (input.status === 'INACTIVE') {
          if (field.fieldKey === draft.object.titleFieldKey) {
            throw validationError(
              'status',
              '请先在基本设置中更换记录名称字段，再停用此字段。',
            );
          }
          if (field.isSystem) {
            throw validationError('status', '系统字段不能停用。');
          }
        }
        const publishedField = draft.activeSchema?.fields.find(
          (candidate) => candidate.fieldKey === field.fieldKey,
        );
        const publishedType = field.publishedType ?? publishedField?.type;
        if (
          input.type !== undefined &&
          publishedType &&
          input.type !== publishedType
        ) {
          throw validationError('type', '字段发布后不能修改类型。');
        }
        if (input.fieldKey !== undefined) {
          const fieldKey = normalizeFieldKey(input.fieldKey);
          if (publishedType && fieldKey !== field.fieldKey) {
            throw validationError('fieldKey', '字段发布后不能修改字段键。');
          }
          if (
            draft.fields.some(
              (candidate) =>
                candidate.id !== fieldId && candidate.fieldKey === fieldKey,
            )
          ) {
            throw validationError('fieldKey', '字段键已被使用。');
          }
          field.fieldKey = fieldKey;
        }
        assignFieldMutation(field, input);
        if (input.status === 'INACTIVE' && draft.defaultView) {
          draft.defaultView.columnFieldKeys =
            draft.defaultView.columnFieldKeys.filter(
              (key) => key !== field.fieldKey,
            );
          if (draft.defaultView.searchFieldKeys !== undefined) {
            draft.defaultView.searchFieldKeys =
              draft.defaultView.searchFieldKeys.filter(
                (key) => key !== field.fieldKey,
              );
          }
        }
      },
    );
  }

  async reorderObjects(
    context: TenantContext,
    input: {
      items: Array<{ objectId: string; expectedVersion: number }>;
    },
    meta: RequestMeta,
  ): Promise<ObjectDraft[]> {
    assertTenantAdmin(context);
    if (
      new Set(input.items.map((item) => item.objectId)).size !==
      input.items.length
    ) {
      throw validationError('items', '对象排序不能包含重复项。');
    }
    return this.repository.withTenant(context, async (store) => {
      await store.lockLifecycleConfiguration();
      for (const objectId of input.items.map((item) => item.objectId).sort())
        await store.lockObject(objectId);
      for (const [index, item] of input.items.entries()) {
        const draft = await requireDraft(store, item.objectId);
        assertVersion(draft, item.expectedVersion);
        assertNotArchived(draft);
        draft.object.sortOrder = (index + 1) * 10;
        const saved = await store.saveObject(draft, item.expectedVersion);
        if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      }
      await store.appendAudit(
        auditEvent(context, meta, 'object.order_updated', undefined, {
          objectIds: input.items.map((item) => item.objectId),
        }),
      );
      return store.listObjects();
    });
  }

  reorderFields(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number; fieldIds: string[] },
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.field_order_updated',
      (draft) => {
        const currentIds = draft.fields.map((field) => field.id);
        if (
          new Set(input.fieldIds).size !== currentIds.length ||
          input.fieldIds.some((fieldId) => !currentIds.includes(fieldId))
        ) {
          throw validationError(
            'fieldIds',
            '字段排序必须包含全部且不重复的字段。',
          );
        }
        const order = new Map(
          input.fieldIds.map((fieldId, index) => [fieldId, (index + 1) * 10]),
        );
        for (const field of draft.fields)
          field.sortOrder = order.get(field.id)!;
        draft.fields.sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.fieldKey.localeCompare(right.fieldKey),
        );
      },
    );
  }

  updateDefaultView(
    context: TenantContext,
    objectId: string,
    input: DefaultViewInput,
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.default_view_updated',
      (draft) => {
        draft.defaultView = {
          code: 'default',
          name: input.name.trim(),
          columnFieldKeys: [...input.columnFieldKeys],
          ...(input.searchFieldKeys === undefined
            ? draft.defaultView?.searchFieldKeys === undefined
              ? {}
              : { searchFieldKeys: draft.defaultView.searchFieldKeys }
            : {
                searchFieldKeys: normalizeSearchFieldKeys(
                  input.searchFieldKeys,
                  draft.fields,
                ),
              }),
          sort: { ...input.sort },
        };
      },
    );
  }

  updatePermissions(
    context: TenantContext,
    objectId: string,
    input: EmployeePermissionInput,
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.permissions_updated',
      (draft) => {
        // A granted action with "no access" as its scope is contradictory: the
        // designer showed the switch as on while every record read was denied,
        // and the publication analysis let that reach employees. Rejecting it
        // here keeps one clear meaning per permission.
        if (input.canRead && input.readScope === 'NONE')
          throw new ApiException('VALIDATION_FAILED', 400, {
            fieldErrors: {
              readScope: ['勾选“可以查看记录”后，查看范围不能是“无权访问”。'],
            },
          });
        if (input.canUpdate && input.updateScope === 'NONE')
          throw new ApiException('VALIDATION_FAILED', 400, {
            fieldErrors: {
              updateScope: ['勾选“可以修改记录”后，修改范围不能是“无权访问”。'],
            },
          });
        draft.employeeAccess = {
          canCreate: input.canCreate,
          canRead: input.canRead,
          canUpdate: input.canUpdate,
          canDelete: false,
          readScope: input.readScope,
          updateScope: input.updateScope,
          fields: { ...input.fields },
        };
      },
    );
  }

  analyzePublication(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number },
  ) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, input.expectedVersion);
      assertNotArchived(draft);
      draft.activeRecordCount = await store.countActiveRecords(objectId);
      draft.workflow = await store.findWorkflowDraft(objectId);
      draft.workflowStateRecordCounts =
        await store.countRecordsByWorkflowState(objectId);
      await loadActionTargets(store, draft);
      const analysis = analyzePublication(draft);
      analysis.blocking.push(
        ...analyzeAutomationDependencies(draft, await store.listObjects()),
      );
      return analysis;
    });
  }

  publish(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<ObjectPublicationSummary> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await store.lockLifecycleConfiguration();
      await store.lockObject(objectId);
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, input.expectedVersion);
      assertNotArchived(draft);
      draft.activeRecordCount = await store.countActiveRecords(objectId);
      draft.workflow = await store.findWorkflowDraft(objectId);
      draft.workflowStateRecordCounts =
        await store.countRecordsByWorkflowState(objectId);
      await loadActionTargets(store, draft);
      const analysis = analyzePublication(draft);
      analysis.blocking.push(
        ...analyzeAutomationDependencies(draft, await store.listObjects()),
      );
      if (analysis.blocking.length > 0) {
        throw new ApiException('PUBLICATION_BLOCKED', 422, {
          message: analysis.blocking.map((item) => item.message).join('；'),
        });
      }
      const publication = {
        id: this.idGenerator(),
        number: await store.nextPublicationNumber(objectId),
        sourceDraftVersion: draft.object.version,
        publishedAt: this.clock().toISOString(),
      };
      const schema = compilePublication({ ...draft, publication });
      const created = await store.createPublication({
        objectId,
        schema,
        changes: analysis.changes,
        publishedByMemberId: context.memberId,
      });
      draft.activeSchema = schema;
      draft.object.activePublicationId = publication.id;
      draft.object.publishedAt = publication.publishedAt;
      draft.object.status = 'ACTIVE';
      draft.object.lifecycleVersionOffset = 0;
      const saved = await store.saveObject(draft, input.expectedVersion, {
        bumpVersion: false,
      });
      if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit(
        auditEvent(context, meta, 'object.published', objectId, {
          publicationId: created.id,
          publicationNo: created.number,
          sourceDraftVersion: created.sourceDraftVersion,
        }),
      );
      return created;
    });
  }

  listPublications(
    context: TenantContext,
    objectId: string,
  ): Promise<ObjectPublicationSummary[]> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await requireDraft(store, objectId);
      return store.listPublications(objectId);
    });
  }

  async lifecycle(context: TenantContext, objectId: string) {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const draft = await requireDraft(store, objectId);
      return {
        status: draft.object.status,
        version: draft.object.version,
        recordCount: draft.activeRecordCount,
        activePublicationVersion:
          draft.activeSchema?.publication.number ?? null,
        archivedAt: draft.object.archivedAt ?? null,
        hasUnpublishedChanges:
          toObjectDraftResponse(draft).object.hasUnpublishedChanges,
        blockers: await store.findLifecycleBlockers(
          objectId,
          draft.object.status === 'ARCHIVED' ? 'restore' : 'archive',
        ),
        requiresLegacyTimerAcknowledgement:
          draft.object.status === 'ARCHIVED' && !draft.object.archivedAt,
        expiredRecordCount: await store.countExpiredRecords(
          objectId,
          this.clock(),
        ),
      };
    });
  }

  archive(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.changeLifecycle(context, objectId, input, meta, 'archive');
  }

  restore(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number; acknowledgeLegacyTimers?: boolean },
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.changeLifecycle(context, objectId, input, meta, 'restore');
  }

  private async changeLifecycle(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number; acknowledgeLegacyTimers?: boolean },
    meta: RequestMeta,
    operation: 'archive' | 'restore',
  ): Promise<ObjectDraft> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await store.lockLifecycleConfiguration();
      await store.lockObject(objectId);
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, input.expectedVersion);
      if (!draft.activeSchema || !draft.object.activePublicationId)
        throw new ApiException('OBJECT_NOT_PUBLISHED', 409);
      if (operation === 'archive') assertNotArchived(draft);
      else if (draft.object.status !== 'ARCHIVED')
        throw new ApiException('OBJECT_LIFECYCLE_CONFLICT', 409, {
          message: '只有已停用的业务表可以恢复。',
        });
      const blockers = await store.findLifecycleBlockers(objectId, operation);
      assertNoLifecycleBlockers(blockers);
      if (
        operation === 'restore' &&
        !draft.object.archivedAt &&
        input.acknowledgeLegacyTimers !== true
      )
        throw new ApiException('OBJECT_LIFECYCLE_CONFLICT', 409, {
          message:
            '此表缺少历史停用时间，恢复将保留原持有期限。请查看已到期记录数量后确认。',
        });
      const now = this.clock();
      draft.object.status = operation === 'archive' ? 'ARCHIVED' : 'ACTIVE';
      const saved = await store.changeLifecycle(
        draft,
        input.expectedVersion,
        now,
      );
      if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit(
        auditEvent(
          context,
          meta,
          operation === 'archive' ? 'object.archived' : 'object.restored',
          objectId,
          {
            version: saved.object.version,
            publicationId: saved.object.activePublicationId,
            archivedAt:
              draft.object.archivedAt ??
              (operation === 'archive' ? now.toISOString() : null),
            acknowledgedLegacyTimers:
              operation === 'restore' &&
              !draft.object.archivedAt &&
              input.acknowledgeLegacyTimers === true,
          },
        ),
      );
      return saved;
    });
  }

  /**
   * Hard delete for a draft that was never published. An object that reached a
   * publication keeps its history, so it can only be archived.
   */
  removeDraft(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<{ deleted: true }> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, input.expectedVersion);
      if (draft.activeSchema || draft.object.activePublicationId)
        throw new ApiException('OBJECT_ALREADY_PUBLISHED', 409);
      if (!(await store.deleteObject(objectId, input.expectedVersion)))
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit(
        auditEvent(context, meta, 'object.draft_deleted', objectId, {}),
      );
      return { deleted: true };
    });
  }

  private mutateDraft(
    context: TenantContext,
    objectId: string,
    expectedVersion: number,
    meta: RequestMeta,
    action: string,
    mutate: (draft: ObjectDraft) => void,
  ): Promise<ObjectDraft> {
    assertTenantAdmin(context);
    return this.repository.withTenant(context, async (store) => {
      await store.lockLifecycleConfiguration();
      await store.lockObject(objectId);
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, expectedVersion);
      assertNotArchived(draft);
      mutate(draft);
      const saved = await store.saveObject(draft, expectedVersion);
      if (!saved) throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      await store.appendAudit(
        auditEvent(context, meta, action, objectId, {
          version: saved.object.version,
        }),
      );
      return saved;
    });
  }
}

function assertTenantAdmin(context: TenantContext): void {
  if (context.role !== 'TENANT_ADMIN') {
    throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
  }
}

/**
 * §25/§26: both publication flows resolve the Actions' Target Objects in the
 * SAME tenant transaction before the pure analysis runs, so the analysis the
 * administrator previews and the analysis that gates the write agree.
 */
async function loadActionTargets(
  store: ObjectsStore,
  draft: ObjectDraft,
): Promise<void> {
  const codes = [
    ...(draft.workflow?.isEnabled
      ? collectActionTargetObjectCodes(draft.workflow.transitions)
      : []),
    ...(draft.automations ?? [])
      .filter((rule) => rule.enabled)
      .map((rule) => rule.targetObjectCode),
  ];
  if (!codes.length && !draft.workflow?.isEnabled) return;
  draft.actionTargets = await store.findActionTargetObjects(codes);
}

async function requireDraft(
  store: ObjectsStore,
  objectId: string,
): Promise<ObjectDraft> {
  const draft = await store.findObject(objectId);
  if (!draft) throw new ApiException('OBJECT_NOT_FOUND', 404);
  return structuredClone(draft);
}

function assertVersion(draft: ObjectDraft, expectedVersion: number): void {
  if (draft.object.version !== expectedVersion) {
    throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
  }
}

function normalizeObjectCode(value: string): string {
  const code = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)) {
    throw validationError('code', '仅支持小写字母、数字和单个连字符。');
  }
  return code;
}

function normalizeFieldKey(value: string): string {
  const fieldKey = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(fieldKey)) {
    throw validationError('fieldKey', '仅支持小写字母、数字和下划线。');
  }
  return fieldKey;
}

function normalizeSearchFieldKeys(
  value: string[] | undefined,
  fields: PublicationDraftField[],
): string[] {
  const requested = [...new Set((value ?? []).map(normalizeFieldKey))];
  const active = new Map(
    fields
      .filter((field) => field.status === 'ACTIVE')
      .map((field) => [field.fieldKey, field]),
  );
  for (const fieldKey of requested) {
    const field = active.get(fieldKey);
    if (!field) {
      throw validationError('searchFieldKeys', '搜索字段必须是已启用字段。');
    }
    if (!isSearchableFieldType(field.type)) {
      throw validationError(
        'searchFieldKeys',
        '搜索字段仅支持文本、长文本、电话和邮箱。',
      );
    }
  }
  return requested;
}

function validationError(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { [field]: [message] },
  });
}

function toJsonRecord(value: object): Record<string, JsonValue> {
  // DTO class instances contain omitted properties with undefined values.
  // Match the JSON shape validated and stored by the existing field endpoints.
  return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue>;
}

function assignFieldMutation(
  field: PublicationDraftField,
  input: FieldMutationInput,
): void {
  const previousType = field.type;
  if (input.label !== undefined) field.label = input.label.trim();
  if (input.type !== undefined) field.type = input.type;
  if (input.required !== undefined) field.required = input.required;
  if (input.defaultValue !== undefined) field.defaultValue = input.defaultValue;
  if (input.validation !== undefined)
    field.validation = { ...input.validation };
  if (input.config !== undefined) field.config = { ...input.config };
  if (input.status !== undefined) field.status = input.status;
  if (field.type !== previousType) dropIncompatibleSettings(field);
}

function auditEvent(
  context: TenantContext,
  meta: RequestMeta,
  action: string,
  resourceId: string | undefined,
  after: Record<string, unknown>,
): AuditEvent {
  return {
    tenantId: context.tenantId,
    actorType: 'USER',
    actorId: context.userId,
    action,
    resourceType: 'object_definition',
    resourceId,
    after,
    requestId: meta.requestId,
    ip: meta.ip,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === code
  );
}

function assertNotArchived(draft: ObjectDraft): void {
  if (draft.object.status === 'ARCHIVED')
    throw new ApiException('OBJECT_ARCHIVED', 409);
}

function assertNoLifecycleBlockers(blockers: LifecycleBlocker[]): void {
  if (blockers.length)
    throw new ApiException('OBJECT_LIFECYCLE_BLOCKED', 409, {
      message: blockers.map((blocker) => blocker.description).join('；'),
      fieldErrors: { blockers: blockers.map((blocker) => blocker.description) },
    });
}
