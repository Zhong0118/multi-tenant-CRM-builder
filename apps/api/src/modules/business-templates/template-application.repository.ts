import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuditEvent } from '../audit/audit-event';
import { AuditService } from '../audit/audit.service';
import type {
  BusinessTemplateConfiguration,
  TemplateFieldConfiguration,
} from './business-template.schema';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";
const SET_TENANT = "SELECT set_config('app.tenant_id', $1, true)";

export interface TemplateApplicationInput {
  templateId: string;
  templateVersionId: string;
  tenantId: string;
}

export interface TemplateApplicationTarget {
  id: string;
  code: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

export interface TemplateApplicationSource {
  id: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  versionNo: number;
  configuration: BusinessTemplateConfiguration;
  configurationChecksum: string;
}

export type TemplateApplicationEligibility =
  | {
      kind: 'APPLICABLE';
      source: TemplateApplicationSource;
      target: TemplateApplicationTarget;
    }
  | { kind: 'TEMPLATE_NOT_FOUND' }
  | { kind: 'TENANT_NOT_FOUND' }
  | {
      kind: 'NOT_ALLOWED';
      reason?: 'TEMPLATE_ARCHIVED' | 'VERSION_NOT_ACTIVE' | 'TENANT_NOT_DRAFT';
    };

export interface TemplateApplicationObjectResult {
  templateObjectId: string;
  objectId: string;
  code: string;
  name: string;
}

export interface TemplateApplicationResult {
  id: string;
  templateId: string;
  templateCode: string;
  templateName: string;
  templateVersionId: string;
  templateVersionNo: number;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  appliedByUserId: string;
  configurationChecksum: string;
  objects: TemplateApplicationObjectResult[];
  appliedAt: Date;
}

export type CreateTemplateApplication = Omit<
  TemplateApplicationResult,
  'appliedAt'
>;

export interface HydratedTenantConfiguration {
  tenantId: string;
  objects: Array<{
    id: string;
    tenantId: string;
    code: string;
    name: string;
    description: string | null;
    icon: string | null;
    titleFieldKey: string;
    sortOrder: number;
    status: 'DRAFT' | 'ARCHIVED';
    settings: { description: string | null };
    sourceTemplateVersionId: string | null;
    activePublicationId: null;
    publishedAt: null;
    version: 1;
  }>;
  fields: Array<
    Pick<
      TemplateFieldConfiguration,
      | 'id'
      | 'fieldKey'
      | 'label'
      | 'type'
      | 'required'
      | 'defaultValue'
      | 'validation'
      | 'config'
      | 'sortOrder'
      | 'isSystem'
      | 'status'
    > & {
      tenantId: string;
      objectId: string;
      isSensitive: false;
    }
  >;
  views: Array<{
    id: string;
    tenantId: string;
    objectId: string;
    code: 'default';
    name: string;
    type: 'TABLE';
    columnFieldKeys: string[];
    sort: {
      field: 'updatedAt' | 'createdAt' | 'recordNo';
      direction: 'asc' | 'desc';
    };
    status: 'ACTIVE';
  }>;
  objectPermissions: Array<{
    id: string;
    tenantId: string;
    objectId: string;
    subjectType: 'ROLE';
    subjectRole: 'EMPLOYEE';
    subjectMemberId: null;
    canCreate: boolean;
    canRead: boolean;
    canUpdate: boolean;
    canDelete: false;
    readScope: 'ALL' | 'OWN' | 'NONE';
    updateScope: 'ALL' | 'OWN' | 'NONE';
  }>;
  fieldPermissions: Array<{
    id: string;
    tenantId: string;
    objectId: string;
    fieldId: string;
    subjectRole: 'EMPLOYEE';
    access: 'EDIT' | 'READ_ONLY' | 'HIDDEN';
  }>;
  objectsResult: TemplateApplicationObjectResult[];
}

export interface TemplateApplicationStore {
  findApplication(
    tenantId: string,
    templateVersionId: string,
    templateId: string,
  ): Promise<TemplateApplicationResult | null>;
  findLatestApplication(
    tenantId: string,
  ): Promise<TemplateApplicationResult | null>;
  findTarget(tenantId: string): Promise<TemplateApplicationTarget | null>;
  lockTemplate(templateId: string): Promise<void>;
  lockTenant(tenantId: string): Promise<void>;
  requireApplicableVersion(
    input: TemplateApplicationInput,
  ): Promise<TemplateApplicationEligibility>;
  enterTenant(tenantId: string): Promise<void>;
  countTenantObjects(tenantId: string): Promise<number>;
  assertTenantEmpty(tenantId: string): Promise<boolean>;
  insertTenantConfiguration(
    hydrated: HydratedTenantConfiguration,
  ): Promise<void>;
  createApplication(
    application: CreateTemplateApplication,
  ): Promise<TemplateApplicationResult>;
  appendAudit(event: AuditEvent): Promise<void>;
}

export interface TemplateApplicationRepository {
  transaction<T>(
    actorId: string,
    work: (store: TemplateApplicationStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrismaTemplateApplicationRepository implements TemplateApplicationRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  transaction<T>(
    actorId: string,
    work: (store: TemplateApplicationStore) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, actorId);
      return work(new PrismaTemplateApplicationStore(transaction, this.audit));
    });
  }
}

class PrismaTemplateApplicationStore implements TemplateApplicationStore {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly audit: AuditService,
  ) {}

  async findApplication(
    tenantId: string,
    templateVersionId: string,
    templateId: string,
  ) {
    const application =
      await this.transaction.businessTemplateApplication.findFirst({
        where: {
          tenantId,
          templateVersionId,
          templateVersion: { templateId },
        },
        include: {
          tenant: true,
          templateVersion: { include: { template: true } },
        },
      });
    return application ? mapApplication(application) : null;
  }

  async findLatestApplication(tenantId: string) {
    const application =
      await this.transaction.businessTemplateApplication.findFirst({
        where: { tenantId },
        include: {
          tenant: true,
          templateVersion: { include: { template: true } },
        },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
      });
    return application ? mapApplication(application) : null;
  }

  async findTarget(
    tenantId: string,
  ): Promise<TemplateApplicationTarget | null> {
    return this.transaction.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true, status: true },
    });
  }

  async lockTemplate(templateId: string): Promise<void> {
    await this.transaction.$queryRaw`
      SELECT id
      FROM business_templates
      WHERE id = ${templateId}::uuid
      FOR UPDATE
    `;
  }

  async lockTenant(tenantId: string): Promise<void> {
    await this.transaction.$queryRaw`
      SELECT id
      FROM tenants
      WHERE id = ${tenantId}::uuid
      FOR UPDATE
    `;
  }

  async requireApplicableVersion(
    input: TemplateApplicationInput,
  ): Promise<TemplateApplicationEligibility> {
    const [template, target] = await Promise.all([
      this.transaction.businessTemplate.findUnique({
        where: { id: input.templateId },
        include: { activeVersion: true },
      }),
      this.findTarget(input.tenantId),
    ]);
    if (!template) return { kind: 'TEMPLATE_NOT_FOUND' };
    if (!target) return { kind: 'TENANT_NOT_FOUND' };
    if (template.archivedAt) {
      return { kind: 'NOT_ALLOWED', reason: 'TEMPLATE_ARCHIVED' };
    }
    if (
      template.activeVersionId !== input.templateVersionId ||
      !template.activeVersion ||
      template.activeVersion.id !== input.templateVersionId ||
      template.activeVersion.templateId !== input.templateId
    ) {
      return { kind: 'NOT_ALLOWED', reason: 'VERSION_NOT_ACTIVE' };
    }
    if (target.status !== 'DRAFT') {
      return { kind: 'NOT_ALLOWED', reason: 'TENANT_NOT_DRAFT' };
    }
    return {
      kind: 'APPLICABLE',
      source: {
        id: template.activeVersion.id,
        templateId: template.id,
        templateCode: template.code,
        templateName: template.name,
        versionNo: template.activeVersion.versionNo,
        configuration: template.activeVersion
          .configuration as unknown as BusinessTemplateConfiguration,
        configurationChecksum: template.activeVersion.configurationChecksum,
      },
      target,
    };
  }

  async enterTenant(tenantId: string): Promise<void> {
    await this.transaction.$queryRawUnsafe(SET_TENANT, tenantId);
  }

  countTenantObjects(tenantId: string): Promise<number> {
    return this.transaction.objectDefinition.count({ where: { tenantId } });
  }

  async assertTenantEmpty(tenantId: string): Promise<boolean> {
    return (await this.countTenantObjects(tenantId)) === 0;
  }

  async insertTenantConfiguration(
    hydrated: HydratedTenantConfiguration,
  ): Promise<void> {
    const databaseNull = await loadDatabaseNull();
    for (const object of hydrated.objects) {
      await this.transaction.objectDefinition.create({
        data: {
          id: object.id,
          tenantId: object.tenantId,
          code: object.code,
          name: object.name,
          kind: 'GENERIC',
          titleFieldKey: object.titleFieldKey,
          icon: object.icon,
          status: object.status,
          sortOrder: object.sortOrder,
          settings: jsonInput(object.settings),
          sourceTemplateVersionId: object.sourceTemplateVersionId,
          activePublicationId: null,
          publishedAt: null,
          version: 1,
        },
      });
      for (const field of hydrated.fields.filter(
        (candidate) => candidate.objectId === object.id,
      )) {
        await this.transaction.fieldDefinition.create({
          data: {
            id: field.id,
            tenantId: field.tenantId,
            objectId: field.objectId,
            fieldKey: field.fieldKey,
            label: field.label,
            type: field.type,
            required: field.required,
            isSystem: field.isSystem,
            isSensitive: false,
            defaultValue:
              field.defaultValue === null
                ? databaseNull
                : jsonInput(field.defaultValue),
            validation: jsonInput(field.validation),
            config: jsonInput(field.config),
            sortOrder: field.sortOrder,
            status: field.status,
          },
        });
      }
      for (const view of hydrated.views.filter(
        (candidate) => candidate.objectId === object.id,
      )) {
        await this.transaction.viewDefinition.create({
          data: {
            ...view,
            columnFieldKeys: jsonInput(view.columnFieldKeys),
            sort: jsonInput(view.sort),
          },
        });
      }
      for (const permission of hydrated.objectPermissions.filter(
        (candidate) => candidate.objectId === object.id,
      )) {
        await this.transaction.objectPermission.create({ data: permission });
      }
      for (const permission of hydrated.fieldPermissions.filter(
        (candidate) => candidate.objectId === object.id,
      )) {
        await this.transaction.fieldPermission.create({ data: permission });
      }
    }
  }

  async createApplication(application: CreateTemplateApplication) {
    const saved = await this.transaction.businessTemplateApplication.create({
      data: {
        id: application.id,
        templateVersionId: application.templateVersionId,
        tenantId: application.tenantId,
        appliedByUserId: application.appliedByUserId,
        configurationChecksum: application.configurationChecksum,
        objectIdMap: jsonInput(
          Object.fromEntries(
            application.objects.map((object) => [
              object.templateObjectId,
              object.objectId,
            ]),
          ),
        ),
      },
      include: {
        tenant: true,
        templateVersion: { include: { template: true } },
      },
    });
    return mapApplication(saved);
  }

  appendAudit(event: AuditEvent): Promise<void> {
    return this.audit.append(this.transaction, event);
  }
}

type ApplicationDatabaseRow = Prisma.BusinessTemplateApplicationGetPayload<{
  include: {
    tenant: true;
    templateVersion: { include: { template: true } };
  };
}>;

function mapApplication(
  row: ApplicationDatabaseRow,
): TemplateApplicationResult {
  const configuration = row.templateVersion
    .configuration as unknown as BusinessTemplateConfiguration;
  const objectIdMap = jsonObject(row.objectIdMap);
  return {
    id: row.id,
    templateId: row.templateVersion.templateId,
    templateCode: row.templateVersion.template.code,
    templateName: row.templateVersion.template.name,
    templateVersionId: row.templateVersionId,
    templateVersionNo: row.templateVersion.versionNo,
    tenantId: row.tenantId,
    tenantCode: row.tenant.code,
    tenantName: row.tenant.name,
    configurationChecksum: row.configurationChecksum,
    objects: configuration.objects.flatMap((object) => {
      const objectId = objectIdMap[object.id];
      return typeof objectId === 'string'
        ? [
            {
              templateObjectId: object.id,
              objectId,
              code: object.code,
              name: object.name,
            },
          ]
        : [];
    }),
    appliedAt: row.appliedAt,
    appliedByUserId: row.appliedByUserId,
  };
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Prisma.JsonValue>)
    : {};
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function loadDatabaseNull() {
  const { Prisma } = await import('@crm/database');
  return Prisma.DbNull;
}
