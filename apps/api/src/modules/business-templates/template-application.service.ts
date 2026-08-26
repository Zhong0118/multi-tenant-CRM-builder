import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import type { AuditEvent } from '../audit/audit-event';
import {
  checksumTemplateConfiguration,
  findTemplateIdentityBlockers,
} from './business-template-publication.policy';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import type {
  HydratedTenantConfiguration,
  TemplateApplicationEligibility,
  TemplateApplicationInput,
  TemplateApplicationRepository,
  TemplateApplicationResult,
} from './template-application.repository';
import type { RequestMeta } from './business-templates.service';

export const TEMPLATE_APPLICATION_REPOSITORY = Symbol(
  'TEMPLATE_APPLICATION_REPOSITORY',
);
export const TEMPLATE_APPLICATION_ID_GENERATOR = Symbol(
  'TEMPLATE_APPLICATION_ID_GENERATOR',
);

export type TemplateApplicationBlockingReason =
  'TENANT_NOT_DRAFT' | 'TARGET_NOT_EMPTY';

export interface TenantBusinessConfigurationSummary {
  objectCount: number;
  canApplyTemplate: boolean;
  blockingReason: TemplateApplicationBlockingReason | null;
  application: TemplateApplicationResult | null;
}

type IdGenerator = () => string;

@Injectable()
export class TemplateApplicationService {
  constructor(
    @Inject(TEMPLATE_APPLICATION_REPOSITORY)
    private readonly repository: TemplateApplicationRepository,
    @Inject(TEMPLATE_APPLICATION_ID_GENERATOR)
    private readonly idGenerator: IdGenerator,
  ) {}

  summarizeTarget(
    actor: AuthenticatedUser,
    tenantId: string,
  ): Promise<TenantBusinessConfigurationSummary> {
    return this.repository.transaction(actor.id, async (store) => {
      const target = await store.findTarget(tenantId);
      if (!target) throw new ApiException('TENANT_NOT_FOUND', 404);
      const application = await store.findLatestApplication(tenantId);
      await store.enterTenant(tenantId);
      const objectCount = await store.countTenantObjects(tenantId);
      const blockingReason =
        target.status !== 'DRAFT'
          ? 'TENANT_NOT_DRAFT'
          : objectCount > 0
            ? 'TARGET_NOT_EMPTY'
            : null;
      return {
        objectCount,
        canApplyTemplate: blockingReason === null,
        blockingReason,
        application,
      };
    });
  }

  async apply(
    actor: AuthenticatedUser,
    input: TemplateApplicationInput,
    meta: RequestMeta,
  ): Promise<TemplateApplicationResult> {
    try {
      return await this.repository.transaction(actor.id, async (store) => {
        const repeated = await store.findApplication(
          input.tenantId,
          input.templateVersionId,
          input.templateId,
        );
        if (repeated) return repeated;

        await store.lockTemplate(input.templateId);
        await store.lockTenant(input.tenantId);
        const concurrent = await store.findApplication(
          input.tenantId,
          input.templateVersionId,
          input.templateId,
        );
        if (concurrent) return concurrent;

        const eligibility = await store.requireApplicableVersion(input);
        const { source, target } = requireApplicable(eligibility);

        if (
          checksumTemplateConfiguration(source.configuration) !==
          source.configurationChecksum
        ) {
          throw applicationNotAllowed('模板发布版本校验失败，不能应用。');
        }
        if (findTemplateIdentityBlockers(source.configuration).length > 0) {
          throw applicationNotAllowed(
            '模板发布版本包含重复的对象或字段身份，不能应用。',
          );
        }

        await store.enterTenant(input.tenantId);
        if (!(await store.assertTenantEmpty(input.tenantId))) {
          throw applicationNotAllowed(
            '目标公司已经存在业务对象，不能使用初始化模板覆盖。',
          );
        }

        const hydrated = hydrateTenantConfiguration(
          source.configuration,
          target.id,
          source.id,
          this.idGenerator,
        );
        await store.insertTenantConfiguration(hydrated);
        const application = await store.createApplication({
          id: this.idGenerator(),
          templateId: source.templateId,
          templateCode: source.templateCode,
          templateName: source.templateName,
          templateVersionId: source.id,
          templateVersionNo: source.versionNo,
          tenantId: target.id,
          tenantCode: target.code,
          tenantName: target.name,
          appliedByUserId: actor.id,
          configurationChecksum: source.configurationChecksum,
          objects: hydrated.objectsResult,
        });
        await store.appendAudit(applicationAudit(application, actor.id, meta));
        return application;
      });
    } catch (error) {
      if (!hasErrorCode(error, 'P2002')) throw error;
      return this.repository.transaction(actor.id, async (store) => {
        const winner = await store.findApplication(
          input.tenantId,
          input.templateVersionId,
          input.templateId,
        );
        if (winner) return winner;
        throw error;
      });
    }
  }
}

export function hydrateTenantConfiguration(
  configuration: BusinessTemplateConfiguration,
  tenantId: string,
  sourceTemplateVersionId: string,
  idGenerator: IdGenerator,
): HydratedTenantConfiguration {
  const hydrated: HydratedTenantConfiguration = {
    tenantId,
    objects: [],
    fields: [],
    views: [],
    objectPermissions: [],
    fieldPermissions: [],
    objectsResult: [],
  };

  for (const sourceObject of configuration.objects.filter(
    (object) => object.status === 'ACTIVE',
  )) {
    if (!sourceObject.defaultView || !sourceObject.employeeAccess) {
      throw applicationNotAllowed('模板发布版本配置不完整，不能应用。');
    }
    const objectId = idGenerator();
    hydrated.objects.push({
      id: objectId,
      tenantId,
      code: sourceObject.code,
      name: sourceObject.name,
      description: sourceObject.description,
      icon: sourceObject.icon,
      titleFieldKey: sourceObject.titleFieldKey,
      sortOrder: sourceObject.sortOrder,
      status: 'DRAFT',
      settings: { description: sourceObject.description },
      sourceTemplateVersionId,
      activePublicationId: null,
      publishedAt: null,
      version: 1,
    });
    hydrated.objectsResult.push({
      templateObjectId: sourceObject.id,
      objectId,
      code: sourceObject.code,
      name: sourceObject.name,
    });

    const fieldIdByKey = new Map<string, string>();
    for (const sourceField of sourceObject.fields.filter(
      (field) => field.status === 'ACTIVE',
    )) {
      const fieldId = idGenerator();
      fieldIdByKey.set(sourceField.fieldKey, fieldId);
      hydrated.fields.push({
        ...structuredClone(sourceField),
        id: fieldId,
        tenantId,
        objectId,
        isSensitive: false,
        status: 'ACTIVE',
      });
    }

    hydrated.views.push({
      id: idGenerator(),
      tenantId,
      objectId,
      code: 'default',
      name: sourceObject.defaultView.name,
      type: 'TABLE',
      columnFieldKeys: [...sourceObject.defaultView.columnFieldKeys],
      sort: { ...sourceObject.defaultView.sort },
      status: 'ACTIVE',
    });
    hydrated.objectPermissions.push({
      id: idGenerator(),
      tenantId,
      objectId,
      subjectType: 'ROLE',
      subjectRole: 'EMPLOYEE',
      subjectMemberId: null,
      canCreate: sourceObject.employeeAccess.canCreate,
      canRead: sourceObject.employeeAccess.canRead,
      canUpdate: sourceObject.employeeAccess.canUpdate,
      canDelete: false,
      readScope: sourceObject.employeeAccess.readScope,
      updateScope: sourceObject.employeeAccess.updateScope,
    });
    for (const [fieldKey, fieldId] of fieldIdByKey) {
      hydrated.fieldPermissions.push({
        id: idGenerator(),
        tenantId,
        objectId,
        fieldId,
        subjectRole: 'EMPLOYEE',
        access: sourceObject.employeeAccess.fields[fieldKey] ?? 'HIDDEN',
      });
    }
  }
  return hydrated;
}

function requireApplicable(
  eligibility: TemplateApplicationEligibility,
): Extract<TemplateApplicationEligibility, { kind: 'APPLICABLE' }> {
  if (eligibility.kind === 'TEMPLATE_NOT_FOUND') {
    throw new ApiException('TEMPLATE_NOT_FOUND', 404);
  }
  if (eligibility.kind === 'TENANT_NOT_FOUND') {
    throw new ApiException('TENANT_NOT_FOUND', 404);
  }
  if (eligibility.kind === 'NOT_ALLOWED') {
    const reason =
      eligibility.reason === 'TENANT_NOT_DRAFT'
        ? '目标公司必须处于草稿状态。'
        : eligibility.reason === 'TEMPLATE_ARCHIVED'
          ? '已归档模板不能应用。'
          : '只能应用模板当前的发布版本。';
    throw applicationNotAllowed(reason);
  }
  return eligibility;
}

function applicationNotAllowed(message: string): ApiException {
  return new ApiException('TEMPLATE_APPLICATION_NOT_ALLOWED', 409, {
    message,
    fieldErrors: { application: [message] },
  });
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  );
}

function applicationAudit(
  application: TemplateApplicationResult,
  actorId: string,
  meta: RequestMeta,
): AuditEvent {
  return {
    tenantId: application.tenantId,
    actorType: 'USER',
    actorId,
    action: 'platform.template.applied',
    resourceType: 'business_template_application',
    resourceId: application.id,
    after: {
      templateId: application.templateId,
      templateVersionId: application.templateVersionId,
      templateVersionNo: application.templateVersionNo,
      objectCount: application.objects.length,
      objectIdMap: Object.fromEntries(
        application.objects.map((object) => [
          object.templateObjectId,
          object.objectId,
        ]),
      ),
    },
    requestId: meta.requestId,
    ip: meta.ip,
  };
}
