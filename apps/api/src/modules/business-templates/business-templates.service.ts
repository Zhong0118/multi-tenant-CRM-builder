import { Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/errors/api.exception';
import type { AuthenticatedUser } from '../../common/tenancy/tenant-context';
import {
  analyzeTemplatePublication,
  checksumTemplateConfiguration,
  compileTemplateVersion,
  type TemplatePublicationAnalysis,
} from './business-template-publication.policy';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import {
  toTemplateDetail,
  toTemplateSummary,
  type TemplateDetail,
  type TemplateSummary,
} from './business-template.presenter';
import type {
  BusinessTemplateRepository,
  BusinessTemplateVersion,
  TemplatePageQuery,
} from './business-templates.repository';

export const BUSINESS_TEMPLATE_REPOSITORY = Symbol(
  'BUSINESS_TEMPLATE_REPOSITORY',
);

export interface RequestMeta {
  requestId: string;
  ip?: string;
}

export interface CreateTemplateInput {
  code: string;
  name: string;
  description: string | null;
}

export interface SaveTemplateDraftInput {
  expectedVersion: number;
  name: string;
  description: string | null;
  configuration: BusinessTemplateConfiguration;
}

export interface TemplatePage {
  items: TemplateSummary[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class BusinessTemplatesService {
  constructor(
    @Inject(BUSINESS_TEMPLATE_REPOSITORY)
    private readonly repository: BusinessTemplateRepository,
  ) {}

  list(
    actor: AuthenticatedUser,
    query: TemplatePageQuery,
  ): Promise<TemplatePage> {
    return this.repository.withActor(actor.id, async (store) => {
      const page = await store.listTemplates(query);
      return {
        items: page.items.map(toTemplateSummary),
        page: query.page,
        limit: query.limit,
        total: page.total,
      };
    });
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateTemplateInput,
    meta: RequestMeta,
  ): Promise<TemplateDetail> {
    void meta;
    const code = input.code.trim();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code)) {
      throw validationError(
        'code',
        '仅支持小写字母、数字和单个连字符，且必须以字母开头。',
      );
    }
    return this.repository.withActor(actor.id, async (store) => {
      try {
        return toTemplateDetail(
          await store.createTemplate({
            code,
            name: input.name.trim(),
            description: input.description,
            configuration: { schemaVersion: 1, objects: [] },
            createdByUserId: actor.id,
          }),
        );
      } catch (error) {
        if (hasErrorCode(error, 'P2002')) {
          throw validationError('code', '模板代码已被使用。');
        }
        throw error;
      }
    });
  }

  detail(
    actor: AuthenticatedUser,
    templateId: string,
  ): Promise<TemplateDetail> {
    return this.repository.withActor(actor.id, async (store) => {
      const template = await store.findTemplate(templateId);
      if (!template) throw new ApiException('TEMPLATE_NOT_FOUND', 404);
      return toTemplateDetail(template, await store.listVersions(templateId));
    });
  }

  saveDraft(
    actor: AuthenticatedUser,
    templateId: string,
    input: SaveTemplateDraftInput,
    meta: RequestMeta,
  ): Promise<TemplateDetail> {
    void meta;
    return this.repository.withActor(actor.id, async (store) => {
      const before = await store.findTemplate(templateId);
      if (!before) throw new ApiException('TEMPLATE_NOT_FOUND', 404);
      if (before.draftVersion !== input.expectedVersion) {
        throw new ApiException('TEMPLATE_VERSION_CONFLICT', 409);
      }
      const saved = await store.saveDraft(
        templateId,
        {
          name: input.name.trim(),
          description: input.description,
          configuration: structuredClone(input.configuration),
        },
        input.expectedVersion,
      );
      if (!saved) throw new ApiException('TEMPLATE_VERSION_CONFLICT', 409);
      return toTemplateDetail(saved, await store.listVersions(templateId));
    });
  }

  analyzePublication(
    actor: AuthenticatedUser,
    templateId: string,
    expectedVersion: number,
  ): Promise<TemplatePublicationAnalysis> {
    return this.repository.withActor(actor.id, async (store) => {
      const template = await store.findTemplate(templateId);
      if (!template) throw new ApiException('TEMPLATE_NOT_FOUND', 404);
      assertVersion(template.draftVersion, expectedVersion);
      const versions = await store.listVersions(templateId);
      return analyzeTemplatePublication(
        template.configuration,
        template.activeVersion?.configuration ?? null,
        versions
          .sort((left, right) => left.versionNo - right.versionNo)
          .map((version) => version.configuration),
      );
    });
  }

  publish(
    actor: AuthenticatedUser,
    templateId: string,
    expectedVersion: number,
    meta: RequestMeta,
  ): Promise<BusinessTemplateVersion> {
    void meta;
    return this.repository.withActor(actor.id, async (store) => {
      await store.lockTemplate(templateId);
      const template = await store.findTemplate(templateId);
      if (!template) throw new ApiException('TEMPLATE_NOT_FOUND', 404);
      assertVersion(template.draftVersion, expectedVersion);
      if (template.activeVersion?.sourceDraftVersion === expectedVersion) {
        return template.activeVersion;
      }
      const versions = await store.listVersions(templateId);
      const analysis = analyzeTemplatePublication(
        template.configuration,
        template.activeVersion?.configuration ?? null,
        versions
          .sort((left, right) => left.versionNo - right.versionNo)
          .map((version) => version.configuration),
      );
      if (analysis.blocking.length > 0) {
        throw new ApiException('TEMPLATE_PUBLICATION_BLOCKED', 409, {
          fieldErrors: groupPublicationIssues(analysis.blocking),
        });
      }
      const configuration = compileTemplateVersion(template.configuration);
      const version = await store.createVersion({
        templateId,
        versionNo: await store.nextVersionNumber(templateId),
        sourceDraftVersion: template.draftVersion,
        schemaVersion: configuration.schemaVersion,
        configuration,
        configurationChecksum: checksumTemplateConfiguration(configuration),
        changeSummary: analysis.changes,
        publishedByUserId: actor.id,
      });
      await store.activateVersion(templateId, version);
      return version;
    });
  }

  listVersions(
    actor: AuthenticatedUser,
    templateId: string,
  ): Promise<BusinessTemplateVersion[]> {
    return this.repository.withActor(actor.id, async (store) => {
      if (!(await store.findTemplate(templateId))) {
        throw new ApiException('TEMPLATE_NOT_FOUND', 404);
      }
      return store.listVersions(templateId);
    });
  }
}

function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throw new ApiException('TEMPLATE_VERSION_CONFLICT', 409);
  }
}

function groupPublicationIssues(
  issues: TemplatePublicationAnalysis['blocking'],
): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.objectId
      ? `configuration.objects.${issue.objectId}`
      : 'configuration.objects';
    (grouped[key] ??= []).push(issue.message);
  }
  return grouped;
}

function validationError(field: string, message: string): ApiException {
  return new ApiException('VALIDATION_FAILED', 400, {
    fieldErrors: { [field]: [message] },
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
