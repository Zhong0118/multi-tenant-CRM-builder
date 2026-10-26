import { configOf } from '../records/record-pool-config';
import type { PoolConfig } from '../records/record-ownership';
import { Injectable } from '@nestjs/common';
import type { Prisma as PrismaTypes } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { ApiException } from '../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';
import type { ActionPublicationTarget } from '../actions/action-publication.policy';
import type {
  PublicationAnalysis,
  PublicationDraft,
} from './object-publication.policy';
import type { PublishedObjectSchema } from './object-schema';
import { RECORD_TITLE_MAX_LENGTH } from '../records/record-value-engine';
import { lockObjectConfiguration } from './object-configuration-lock';
import {
  lifecycleBlockers,
  type LifecycleBlocker,
} from './object-lifecycle.policy';
import type { PoolProtectionRule } from '../records/record-ownership';
import {
  toWorkflowActions,
  type WorkflowDraft,
} from '../workflows/workflow.types';

export interface ObjectDraft extends PublicationDraft {
  pool?: PoolConfig;
  object: PublicationDraft['object'] & {
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    activePublicationId: string | null;
    publishedAt: string | null;
    archivedAt?: string | null;
    lifecycleVersionOffset?: number;
  };
}

export type ObjectPublicationSummary = PublishedObjectSchema['publication'] & {
  configuration: PublishedObjectSchema;
  changes: PublicationAnalysis['changes'];
};

export interface TemplateInitializationCandidate {
  id: string;
  name: string;
  code: string;
  version: number;
  poolConfigVersion: number;
  templateVersionId: string;
}

export interface ObjectsStore {
  listTemplateInitializationCandidates?(): Promise<
    TemplateInitializationCandidate[]
  >;
  listPublishedPoolConfigurations?(): Promise<
    Array<{ code: string; pool: PoolConfig; schema: PublishedObjectSchema }>
  >;
  lockLifecycleConfiguration(): Promise<void>;
  findLifecycleBlockers(
    objectId: string,
    operation: 'archive' | 'restore',
  ): Promise<LifecycleBlocker[]>;
  countExpiredRecords(objectId: string, now: Date): Promise<number>;
  changeLifecycle(
    draft: ObjectDraft,
    expectedVersion: number,
    now: Date,
  ): Promise<ObjectDraft | null>;
  lockObject(objectId: string): Promise<void>;
  listObjects(): Promise<ObjectDraft[]>;
  findObject(objectId: string): Promise<ObjectDraft | null>;
  createObject(draft: ObjectDraft): Promise<ObjectDraft>;
  /**
   * `bumpVersion: false` records publication bookkeeping without consuming the
   * draft's optimistic lock: publishing does not change the configuration, and
   * bumping the version would make the administrator's open screen stale and
   * report the freshly published draft as changed.
   */
  saveObject(
    draft: ObjectDraft,
    expectedVersion: number,
    options?: { bumpVersion?: boolean },
  ): Promise<ObjectDraft | null>;
  /**
   * Hard delete for a draft that was never published. Returns false when the
   * optimistic lock no longer matches, mirroring `saveObject`.
   */
  deleteObject(objectId: string, expectedVersion: number): Promise<boolean>;
  countActiveRecords(objectId: string): Promise<number>;
  countRecordsByWorkflowState(
    objectId: string,
  ): Promise<Record<string, number>>;
  findWorkflowDraft(objectId: string): Promise<WorkflowDraft | null>;
  /**
   * §25/§26: the CURRENT Active Publication of each referenced Target Object,
   * read inside the caller's tenant transaction. A code that has no object in
   * this tenant is simply absent from the result — the lookup is scoped by the
   * `TenantContext` and never falls back to another tenant's object.
   */
  findActionTargetObjects(
    codes: readonly string[],
  ): Promise<Map<string, ActionPublicationTarget>>;
  nextPublicationNumber(objectId: string): Promise<number>;
  createPublication(input: {
    objectId: string;
    schema: PublishedObjectSchema;
    changes: PublicationAnalysis['changes'];
    publishedByMemberId: string;
  }): Promise<ObjectPublicationSummary>;
  listPublications(objectId: string): Promise<ObjectPublicationSummary[]>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface ObjectsRepository {
  withTenant<T>(
    context: TenantContext,
    work: (store: ObjectsStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrismaObjectsRepository implements ObjectsRepository {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
  ) {}

  withTenant<T>(
    context: TenantContext,
    work: (store: ObjectsStore) => Promise<T>,
  ): Promise<T> {
    return this.runner.withTenant(context, (transaction) =>
      work(new PrismaObjectsStore(transaction, this.audit, context)),
    );
  }
}

class PrismaObjectsStore implements ObjectsStore {
  constructor(
    private readonly transaction: PrismaTypes.TransactionClient,
    private readonly audit: AuditService,
    private readonly context: TenantContext,
  ) {}

  async listTemplateInitializationCandidates(): Promise<
    TemplateInitializationCandidate[]
  > {
    const objects = await this.transaction.objectDefinition.findMany({
      where: {
        tenantId: this.context.tenantId,
        sourceTemplateVersionId: { not: null },
        status: { not: 'ARCHIVED' },
        deletedAt: null,
        archivedAt: null,
        activePublicationId: null,
        publications: { none: {} },
        records: { none: {} },
      },
      select: {
        id: true,
        name: true,
        code: true,
        version: true,
        poolConfigVersion: true,
        sourceTemplateVersionId: true,
      },
      orderBy: { id: 'asc' },
    });
    return objects.map(({ sourceTemplateVersionId, ...object }) => ({
      ...object,
      templateVersionId: sourceTemplateVersionId!,
    }));
  }

  async listPublishedPoolConfigurations() {
    const objects = await this.transaction.objectDefinition.findMany({
      where: {
        tenantId: this.context.tenantId,
        status: 'ACTIVE',
        deletedAt: null,
        archivedAt: null,
        activePublicationId: { not: null },
      },
      include: { activePublication: { select: { configuration: true } } },
    });
    return objects.map((object) => ({
      code: object.code,
      pool: configOf(object),
      schema: object.activePublication!
        .configuration as unknown as PublishedObjectSchema,
    }));
  }

  lockLifecycleConfiguration(): Promise<void> {
    return lockObjectConfiguration(this.transaction, this.context.tenantId);
  }

  async findLifecycleBlockers(
    objectId: string,
    operation: 'archive' | 'restore',
  ): Promise<LifecycleBlocker[]> {
    const objects = await this.transaction.objectDefinition.findMany({
      where: { tenantId: this.context.tenantId, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        poolEnabled: true,
        poolLifecycleEnabled: true,
        poolProtectionRules: true,
        activePublication: { select: { configuration: true } },
      },
      orderBy: { code: 'asc' },
    });
    return lifecycleBlockers(
      objects.map((object) => ({
        ...object,
        schema:
          (object.activePublication
            ?.configuration as unknown as PublishedObjectSchema | null) ?? null,
        protectionRules:
          object.poolProtectionRules as unknown as PoolProtectionRule[],
      })),
      objectId,
      operation,
    );
  }

  countExpiredRecords(objectId: string, now: Date): Promise<number> {
    return this.transaction.record.count({
      where: {
        tenantId: this.context.tenantId,
        objectId,
        deletedAt: null,
        ownerMemberId: { not: null },
        inPublicPool: false,
        OR: [
          { poolStage: null },
          { poolStage: { in: ['PENDING_CONTACT', 'FOLLOWING'] } },
        ],
        ownershipExpiresAt: { lte: now },
      },
    });
  }

  async changeLifecycle(
    draft: ObjectDraft,
    expectedVersion: number,
    now: Date,
  ): Promise<ObjectDraft | null> {
    const restoring = draft.object.status === 'ACTIVE';
    const stoppedAt = draft.object.archivedAt
      ? new Date(draft.object.archivedAt)
      : null;
    const result = await this.transaction.objectDefinition.updateMany({
      where: {
        id: draft.object.id,
        tenantId: this.context.tenantId,
        version: expectedVersion,
      },
      data: {
        status: draft.object.status,
        archivedAt: restoring ? null : now,
        version: { increment: 1 },
        lifecycleVersionOffset: { increment: 1 },
      },
    });
    if (!result.count) return null;
    if (restoring && stoppedAt) {
      const pausedMilliseconds = Math.max(
        0,
        now.getTime() - stoppedAt.getTime(),
      );
      await this.transaction.$executeRaw`
        UPDATE records SET ownership_expires_at = ownership_expires_at + ${pausedMilliseconds} * interval '1 millisecond',
          version = version + 1, updated_at = ${now}
        WHERE tenant_id = ${this.context.tenantId}::uuid AND object_id = ${draft.object.id}::uuid
          AND deleted_at IS NULL AND owner_member_id IS NOT NULL AND NOT in_public_pool
          AND (pool_stage IS NULL OR pool_stage IN ('PENDING_CONTACT', 'FOLLOWING'))
          AND ownership_expires_at > ${stoppedAt}
      `;
    }
    if (restoring) {
      // Evidence can be cancelled in another active table while this table is
      // stopped. Review it once after resume; never remove protection or add a timer.
      // Unconfigured permanent protection retains its original review state.
      const protectedRecords = await this.transaction.$queryRaw<
        Array<{ id: string }>
      >`
        SELECT r.id FROM records r
        JOIN object_definitions o ON o.tenant_id = r.tenant_id AND o.id = r.object_id
        WHERE r.tenant_id = ${this.context.tenantId}::uuid AND r.object_id = ${draft.object.id}::uuid
          AND r.deleted_at IS NULL AND r.pool_stage = 'PROTECTED'
          AND o.pool_enabled AND o.pool_lifecycle_enabled AND jsonb_array_length(o.pool_protection_rules) > 0
        ORDER BY r.id
      `;
      for (const record of protectedRecords) {
        await this.transaction
          .$queryRaw`SELECT public.refresh_record_pool_protection(${this.context.tenantId}::uuid, ${record.id}::uuid, false)::text`;
      }
    }
    return this.findObject(draft.object.id);
  }

  async lockObject(objectId: string): Promise<void> {
    await this.transaction.$queryRaw`
      SELECT id
      FROM object_definitions
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND id = ${objectId}::uuid
      FOR UPDATE
    `;
  }

  async listObjects(): Promise<ObjectDraft[]> {
    const objects = await this.transaction.objectDefinition.findMany({
      where: { tenantId: this.context.tenantId },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    const drafts: ObjectDraft[] = [];
    for (const object of objects) {
      const draft = await this.findObject(object.id);
      if (draft) drafts.push(draft);
    }
    return drafts;
  }

  async findObject(objectId: string): Promise<ObjectDraft | null> {
    const object = await this.transaction.objectDefinition.findFirst({
      where: { id: objectId, tenantId: this.context.tenantId },
      include: {
        fields: {
          orderBy: [{ sortOrder: 'asc' }, { fieldKey: 'asc' }],
        },
        views: {
          where: { code: 'default', status: 'ACTIVE' },
          take: 1,
        },
        permissions: {
          where: { subjectType: 'ROLE', subjectRole: 'EMPLOYEE' },
          take: 1,
        },
        fieldPermissions: {
          where: { subjectRole: 'EMPLOYEE' },
        },
        activePublication: { select: { configuration: true } },
      },
    });
    if (!object) return null;

    const activeSchema = object.activePublication
      ? (object.activePublication
          .configuration as unknown as PublishedObjectSchema)
      : null;
    const publishedFields = new Map(
      (activeSchema?.fields ?? []).map((field) => [field.id, field]),
    );
    if (
      activeSchema &&
      object.fields.some((field) => !publishedFields.has(field.id))
    ) {
      for (const publication of await this.listPublications(objectId)) {
        for (const field of publication.configuration.fields) {
          if (!publishedFields.has(field.id))
            publishedFields.set(field.id, field);
        }
      }
    }

    const activeRecordCount = await this.countActiveRecords(objectId);
    const settings = jsonObject(object.settings);
    const view = object.views[0];
    const employee = object.permissions[0];
    const fieldAccess = new Map(
      object.fieldPermissions.map((permission) => [
        permission.fieldId,
        permission.access,
      ]),
    );

    return {
      object: {
        id: object.id,
        code: object.code,
        name: object.name,
        description:
          typeof settings.description === 'string'
            ? settings.description
            : null,
        titleFieldKey: object.titleFieldKey,
        icon: object.icon,
        sortOrder: object.sortOrder,
        version: object.version,
        status: object.status,
        activePublicationId: object.activePublicationId,
        publishedAt: object.publishedAt?.toISOString() ?? null,
        archivedAt: object.archivedAt?.toISOString() ?? null,
        lifecycleVersionOffset: object.lifecycleVersionOffset ?? 0,
        updatedAt: object.updatedAt.toISOString(),
      },
      fields: object.fields.map((field) => ({
        id: field.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        required: field.required,
        defaultValue: fromPrismaJson(field.defaultValue),
        validation: jsonObject(field.validation),
        config: jsonObject(field.config),
        sortOrder: field.sortOrder,
        isSystem: field.isSystem,
        status: field.status,
        publishedType: publishedFields.get(field.id)?.type ?? null,
        updatedAt: field.updatedAt.toISOString(),
      })),
      defaultView: view
        ? {
            code: 'default',
            name: view.name,
            ...viewColumns(view.columnFieldKeys),
            sort: viewSort(view.sort),
            updatedAt: view.updatedAt.toISOString(),
          }
        : null,
      employeeAccess: employee
        ? {
            canCreate: employee.canCreate,
            canRead: employee.canRead,
            canUpdate: employee.canUpdate,
            canDelete: false,
            readScope: employee.readScope,
            updateScope: employee.updateScope,
            fields: Object.fromEntries(
              object.fields.map((field) => [
                field.fieldKey,
                fieldAccess.get(field.id) ?? 'HIDDEN',
              ]),
            ),
          }
        : null,
      pool: configOf(object),
      activeSchema,
      previousPublishedFields: [...publishedFields.values()],
      automations: (settings.automations ?? []) as unknown as NonNullable<
        ObjectDraft['automations']
      >,
      activeRecordCount,
    };
  }

  async createObject(draft: ObjectDraft): Promise<ObjectDraft> {
    await this.transaction.objectDefinition.create({
      data: {
        id: draft.object.id,
        tenantId: this.context.tenantId,
        name: draft.object.name,
        code: draft.object.code,
        titleFieldKey: draft.object.titleFieldKey,
        icon: draft.object.icon,
        status: draft.object.status,
        lifecycleVersionOffset: draft.object.lifecycleVersionOffset ?? 0,
        sortOrder: draft.object.sortOrder,
        settings: toPrismaJson({
          description: draft.object.description,
          automations: draft.automations ?? [],
        }),
        version: draft.object.version,
      },
    });
    return (await this.findObject(draft.object.id))!;
  }

  async saveObject(
    draft: ObjectDraft,
    expectedVersion: number,
    options: { bumpVersion?: boolean } = {},
  ): Promise<ObjectDraft | null> {
    const locked = await this.transaction.$queryRaw<Array<{ version: number }>>`
      SELECT version
      FROM object_definitions
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND id = ${draft.object.id}::uuid
      FOR UPDATE
    `;
    if (locked[0]?.version !== expectedVersion) return null;
    const databaseNull = await loadDatabaseNull();

    await this.transaction.objectDefinition.update({
      where: { id: draft.object.id },
      data: {
        name: draft.object.name,
        code: draft.object.code,
        titleFieldKey: draft.object.titleFieldKey,
        icon: draft.object.icon,
        status: draft.object.status,
        lifecycleVersionOffset: draft.object.lifecycleVersionOffset ?? 0,
        sortOrder: draft.object.sortOrder,
        settings: toPrismaJson({
          description: draft.object.description,
          automations: draft.automations ?? [],
        }),
        activePublicationId: draft.object.activePublicationId,
        publishedAt: draft.object.publishedAt
          ? new Date(draft.object.publishedAt)
          : null,
        version:
          options.bumpVersion === false ? expectedVersion : { increment: 1 },
      },
    });

    for (const field of draft.fields) {
      const existing = await this.transaction.fieldDefinition.findUnique({
        where: { id: field.id },
        select: { id: true },
      });
      const data = {
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        required: field.required,
        isSystem: field.isSystem,
        defaultValue:
          field.defaultValue === null
            ? databaseNull
            : toPrismaJson(field.defaultValue),
        validation: toPrismaJson(field.validation),
        config: toPrismaJson(field.config),
        sortOrder: field.sortOrder,
        status: field.status,
      };
      if (existing) {
        await this.transaction.fieldDefinition.update({
          where: { id: field.id },
          data,
        });
      } else {
        await this.transaction.fieldDefinition.create({
          data: {
            id: field.id,
            tenantId: this.context.tenantId,
            objectId: draft.object.id,
            ...data,
          },
        });
      }
    }

    if (draft.defaultView) {
      await this.transaction.viewDefinition.upsert({
        where: {
          tenantId_objectId_code: {
            tenantId: this.context.tenantId,
            objectId: draft.object.id,
            code: 'default',
          },
        },
        create: {
          tenantId: this.context.tenantId,
          objectId: draft.object.id,
          code: 'default',
          name: draft.defaultView.name,
          columnFieldKeys: toPrismaJson(viewColumnsJson(draft.defaultView)),
          sort: toPrismaJson(draft.defaultView.sort),
          status: 'ACTIVE',
        },
        update: {
          name: draft.defaultView.name,
          columnFieldKeys: toPrismaJson(viewColumnsJson(draft.defaultView)),
          sort: toPrismaJson(draft.defaultView.sort),
          status: 'ACTIVE',
        },
      });
    }

    if (draft.employeeAccess) {
      const permission = await this.transaction.objectPermission.findFirst({
        where: {
          tenantId: this.context.tenantId,
          objectId: draft.object.id,
          subjectType: 'ROLE',
          subjectRole: 'EMPLOYEE',
        },
        select: { id: true },
      });
      const permissionData = {
        canCreate: draft.employeeAccess.canCreate,
        canRead: draft.employeeAccess.canRead,
        canUpdate: draft.employeeAccess.canUpdate,
        canDelete: false,
        readScope: draft.employeeAccess.readScope,
        updateScope: draft.employeeAccess.updateScope,
      };
      if (permission) {
        await this.transaction.objectPermission.update({
          where: { id: permission.id },
          data: permissionData,
        });
      } else {
        await this.transaction.objectPermission.create({
          data: {
            tenantId: this.context.tenantId,
            objectId: draft.object.id,
            subjectType: 'ROLE',
            subjectRole: 'EMPLOYEE',
            ...permissionData,
          },
        });
      }

      for (const field of draft.fields) {
        await this.transaction.fieldPermission.upsert({
          where: {
            tenantId_fieldId_subjectRole: {
              tenantId: this.context.tenantId,
              fieldId: field.id,
              subjectRole: 'EMPLOYEE',
            },
          },
          create: {
            tenantId: this.context.tenantId,
            objectId: draft.object.id,
            fieldId: field.id,
            subjectRole: 'EMPLOYEE',
            access: draft.employeeAccess.fields[field.fieldKey] ?? 'HIDDEN',
          },
          update: {
            access: draft.employeeAccess.fields[field.fieldKey] ?? 'HIDDEN',
          },
        });
      }
    }

    return this.findObject(draft.object.id);
  }

  countActiveRecords(objectId: string): Promise<number> {
    return this.transaction.record.count({
      where: {
        tenantId: this.context.tenantId,
        objectId,
        deletedAt: null,
      },
    });
  }

  async countRecordsByWorkflowState(
    objectId: string,
  ): Promise<Record<string, number>> {
    const rows = await this.transaction.record.groupBy({
      by: ['statusKey'],
      where: {
        tenantId: this.context.tenantId,
        objectId,
        deletedAt: null,
        statusKey: { not: null },
      },
      _count: { _all: true },
    });
    return Object.fromEntries(
      rows.flatMap((row) =>
        row.statusKey ? [[row.statusKey, row._count._all]] : [],
      ),
    );
  }

  async findWorkflowDraft(objectId: string): Promise<WorkflowDraft | null> {
    const workflow = await this.transaction.objectWorkflowDefinition.findFirst({
      where: {
        tenantId: this.context.tenantId,
        objectDefinitionId: objectId,
      },
      include: {
        states: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
        transitions: { orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }] },
      },
    });
    if (!workflow) return null;
    return {
      isEnabled: workflow.isEnabled,
      initialStateKey: workflow.initialStateKey,
      states: workflow.states.map((state) => ({
        key: state.key,
        label: state.label,
        description: state.description,
        sortOrder: state.sortOrder,
        isTerminal: state.isTerminal,
      })),
      transitions: workflow.transitions.map((transition) => ({
        key: transition.key,
        label: transition.label,
        fromStateKey: transition.fromStateKey,
        toStateKey: transition.toStateKey,
        allowedRoles: transition.allowedRoles,
        requiredFieldKeys: transition.requiredFieldKeys,
        actions: toWorkflowActions(transition.actions),
        sortOrder: transition.sortOrder,
      })),
    };
  }

  async findActionTargetObjects(
    codes: readonly string[],
  ): Promise<Map<string, ActionPublicationTarget>> {
    const unique = [...new Set(codes)];
    if (unique.length === 0) return new Map();
    const objects = await this.transaction.objectDefinition.findMany({
      where: { tenantId: this.context.tenantId, code: { in: unique } },
      select: {
        code: true,
        status: true,
        activePublication: { select: { configuration: true } },
      },
    });
    return new Map(
      objects.map((object) => [
        object.code,
        {
          code: object.code,
          status: object.status,
          schema: object.activePublication
            ? (object.activePublication
                .configuration as unknown as PublishedObjectSchema)
            : null,
        },
      ]),
    );
  }

  async deleteObject(
    objectId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const locked = await this.transaction.$queryRaw<Array<{ version: number }>>`
      SELECT version
      FROM object_definitions
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND id = ${objectId}::uuid
      FOR UPDATE
    `;
    if (locked[0]?.version !== expectedVersion) return false;

    // The active publication pointer references object_publications, so it is
    // cleared first. Publication rows themselves are append-only history and
    // the app role has no DELETE grant on them — a never-published draft has
    // none, and the service refuses to delete anything that published.
    await this.transaction.objectDefinition.update({
      where: { id: objectId },
      data: { activePublicationId: null },
    });
    await this.transaction.fieldPermission.deleteMany({ where: { objectId } });
    await this.transaction.objectPermission.deleteMany({ where: { objectId } });
    await this.transaction.viewDefinition.deleteMany({ where: { objectId } });
    await this.transaction.fieldDefinition.deleteMany({ where: { objectId } });
    await this.transaction.objectDefinition.delete({ where: { id: objectId } });
    return true;
  }

  async nextPublicationNumber(objectId: string): Promise<number> {
    const rows = await this.transaction.$queryRaw<Array<{ number: number }>>`
      SELECT COALESCE(MAX(publication_no), 0)::int + 1 AS number
      FROM object_publications
      WHERE tenant_id = ${this.context.tenantId}::uuid
        AND object_id = ${objectId}::uuid
    `;
    return rows[0]?.number ?? 1;
  }

  async createPublication(input: {
    objectId: string;
    schema: PublishedObjectSchema;
    changes: PublicationAnalysis['changes'];
    publishedByMemberId: string;
  }): Promise<ObjectPublicationSummary> {
    // The cached title is also used by search, export, relations and AI reads.
    // Rebuild it under the publication's configuration lock so hiding a former
    // title field cannot leave its value readable through this cache.
    const titleField = input.schema.fields.find(
      (field) => field.fieldKey === input.schema.object.titleFieldKey,
    )!;
    const labels =
      titleField.type === 'SINGLE_SELECT' &&
      Array.isArray(titleField.config.options)
        ? Object.fromEntries(
            titleField.config.options.flatMap((option) =>
              option &&
              typeof option === 'object' &&
              !Array.isArray(option) &&
              typeof option.key === 'string' &&
              typeof option.label === 'string'
                ? [[option.key, option.label]]
                : [],
            ),
          )
        : {};
    // All allowed title types store strings. Selects use their configured label
    // with the same legacy-key fallback as the record value engine. Deleted
    // records may predate a required field; never retain their former title.
    const [titles] = await this.transaction.$queryRaw<
      Array<{ invalidCount: number }>
    >`
      WITH projected AS (
        SELECT id, COALESCE(
          ${JSON.stringify(labels)}::jsonb ->> (data ->> ${titleField.fieldKey}),
          data ->> ${titleField.fieldKey},
          '#' || record_no::text
        ) AS title
        FROM records
        WHERE tenant_id = ${this.context.tenantId}::uuid
          AND object_id = ${input.objectId}::uuid
      ), refreshed AS (
        UPDATE records AS record
        SET title = projected.title
        FROM projected
        WHERE record.id = projected.id
          AND record.tenant_id = ${this.context.tenantId}::uuid
          AND record.object_id = ${input.objectId}::uuid
          AND char_length(projected.title) <= ${RECORD_TITLE_MAX_LENGTH}
          AND record.title IS DISTINCT FROM projected.title
        RETURNING record.id
      )
      SELECT count(*)::int AS "invalidCount" FROM projected
      WHERE char_length(title) > ${RECORD_TITLE_MAX_LENGTH}
    `;
    if (titles.invalidCount > 0) {
      throw new ApiException('PUBLICATION_BLOCKED', 422, {
        message: `现有记录的新标题超过 ${RECORD_TITLE_MAX_LENGTH} 个字符，请先缩短该字段值。`,
      });
    }
    const publication = await this.transaction.objectPublication.create({
      data: {
        id: input.schema.publication.id,
        tenantId: this.context.tenantId,
        objectId: input.objectId,
        publicationNo: input.schema.publication.number,
        sourceDraftVersion: input.schema.publication.sourceDraftVersion,
        configuration: toPrismaJson(input.schema),
        changeSummary: toPrismaJson(input.changes),
        publishedByMemberId: input.publishedByMemberId,
        publishedAt: new Date(input.schema.publication.publishedAt),
      },
    });
    return {
      id: publication.id,
      number: publication.publicationNo,
      sourceDraftVersion: publication.sourceDraftVersion,
      publishedAt: publication.publishedAt.toISOString(),
      configuration: input.schema,
      changes: input.changes,
    };
  }

  async listPublications(
    objectId: string,
  ): Promise<ObjectPublicationSummary[]> {
    const publications = await this.transaction.objectPublication.findMany({
      where: { tenantId: this.context.tenantId, objectId },
      orderBy: [{ publicationNo: 'desc' }],
    });
    return publications.map((publication) => ({
      id: publication.id,
      number: publication.publicationNo,
      sourceDraftVersion: publication.sourceDraftVersion,
      publishedAt: publication.publishedAt.toISOString(),
      configuration:
        publication.configuration as unknown as PublishedObjectSchema,
      changes:
        publication.changeSummary as unknown as PublicationAnalysis['changes'],
    }));
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

function toPrismaJson(value: unknown): PrismaTypes.InputJsonValue {
  return value as PrismaTypes.InputJsonValue;
}

async function loadDatabaseNull() {
  const { Prisma } = await import('@crm/database');
  return Prisma.DbNull;
}

function fromPrismaJson(value: PrismaTypes.JsonValue | null) {
  return value === null
    ? null
    : (value as PublicationDraft['fields'][number]['defaultValue']);
}

function jsonObject(
  value: PrismaTypes.JsonValue,
): Record<string, PublicationDraft['fields'][number]['defaultValue']> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<
        string,
        PublicationDraft['fields'][number]['defaultValue']
      >)
    : {};
}

function stringArray(value: PrismaTypes.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function viewColumns(value: PrismaTypes.JsonValue): {
  columnFieldKeys: string[];
  searchFieldKeys?: string[];
} {
  if (Array.isArray(value)) {
    return { columnFieldKeys: stringArray(value) };
  }
  const object = jsonObject(value);
  const searchFieldKeys = object.searchFieldKeys;
  return {
    columnFieldKeys: stringArray(object.columnFieldKeys),
    ...(Array.isArray(searchFieldKeys)
      ? { searchFieldKeys: stringArray(searchFieldKeys) }
      : {}),
  };
}

function viewColumnsJson(
  view: NonNullable<ObjectDraft['defaultView']>,
): string[] | Record<string, unknown> {
  if (view.searchFieldKeys === undefined) {
    return view.columnFieldKeys;
  }
  return {
    columnFieldKeys: view.columnFieldKeys,
    searchFieldKeys: view.searchFieldKeys,
  };
}

function viewSort(
  value: PrismaTypes.JsonValue,
): NonNullable<ObjectDraft['defaultView']>['sort'] {
  const object = jsonObject(value);
  const field = object.field;
  const direction = object.direction;
  return {
    field: field === 'createdAt' || field === 'recordNo' ? field : 'updatedAt',
    direction: direction === 'asc' ? 'asc' : 'desc',
  };
}
