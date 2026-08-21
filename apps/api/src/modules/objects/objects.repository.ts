import { Injectable } from '@nestjs/common';
import type { Prisma as PrismaTypes } from '@crm/database';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../infrastructure/database/context-runner';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';
import type {
  PublicationAnalysis,
  PublicationDraft,
} from './object-publication.policy';
import type { PublishedObjectSchema } from './object-schema';

export interface ObjectDraft extends PublicationDraft {
  object: PublicationDraft['object'] & {
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    activePublicationId: string | null;
    publishedAt: string | null;
  };
}

export type ObjectPublicationSummary = PublishedObjectSchema['publication'] & {
  configuration: PublishedObjectSchema;
  changes: PublicationAnalysis['changes'];
};

export interface ObjectsStore {
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
  countActiveRecords(objectId: string): Promise<number>;
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
        updatedAt: field.updatedAt.toISOString(),
      })),
      defaultView: view
        ? {
            code: 'default',
            name: view.name,
            columnFieldKeys: stringArray(view.columnFieldKeys),
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
      activeSchema: object.activePublication
        ? (object.activePublication
            .configuration as unknown as PublishedObjectSchema)
        : null,
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
        sortOrder: draft.object.sortOrder,
        settings: toPrismaJson({ description: draft.object.description }),
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
        sortOrder: draft.object.sortOrder,
        settings: toPrismaJson({ description: draft.object.description }),
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
          columnFieldKeys: toPrismaJson(draft.defaultView.columnFieldKeys),
          sort: toPrismaJson(draft.defaultView.sort),
          status: 'ACTIVE',
        },
        update: {
          name: draft.defaultView.name,
          columnFieldKeys: toPrismaJson(draft.defaultView.columnFieldKeys),
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
