import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { TenantContext } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import {
  analyzePublication,
  compilePublication,
  type DraftFieldType,
  type PublicationDraftField,
} from './object-publication.policy';
import type {
  JsonValue,
  PublishedDataScope,
  PublishedFieldAccess,
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
    input: { name: string; code: string; icon?: string | null },
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

      try {
        const created = await store.createObject(draft);
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
        const publishedField = draft.activeSchema?.fields.find(
          (candidate) => candidate.fieldKey === field.fieldKey,
        );
        if (
          input.type !== undefined &&
          publishedField &&
          input.type !== field.type
        ) {
          throw validationError('type', '字段发布后不能修改类型。');
        }
        if (input.fieldKey !== undefined) {
          const fieldKey = normalizeFieldKey(input.fieldKey);
          if (publishedField && fieldKey !== field.fieldKey) {
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
      for (const [index, item] of input.items.entries()) {
        const draft = await requireDraft(store, item.objectId);
        assertVersion(draft, item.expectedVersion);
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
      draft.activeRecordCount = await store.countActiveRecords(objectId);
      return analyzePublication(draft);
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
      await store.lockObject(objectId);
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, input.expectedVersion);
      draft.activeRecordCount = await store.countActiveRecords(objectId);
      const analysis = analyzePublication(draft);
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

  archive(
    context: TenantContext,
    objectId: string,
    input: { expectedVersion: number },
    meta: RequestMeta,
  ): Promise<ObjectDraft> {
    return this.mutateDraft(
      context,
      objectId,
      input.expectedVersion,
      meta,
      'object.archived',
      (draft) => {
        if (!draft.activeSchema)
          throw new ApiException('OBJECT_NOT_PUBLISHED', 409);
        draft.object.status = 'ARCHIVED';
      },
    );
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
      const draft = await requireDraft(store, objectId);
      assertVersion(draft, expectedVersion);
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

function validationError(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { [field]: [message] },
  });
}

function assignFieldMutation(
  field: PublicationDraftField,
  input: FieldMutationInput,
): void {
  if (input.label !== undefined) field.label = input.label.trim();
  if (input.type !== undefined) field.type = input.type;
  if (input.required !== undefined) field.required = input.required;
  if (input.defaultValue !== undefined) field.defaultValue = input.defaultValue;
  if (input.validation !== undefined)
    field.validation = { ...input.validation };
  if (input.config !== undefined) field.config = { ...input.config };
  if (input.status !== undefined) field.status = input.status;
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
