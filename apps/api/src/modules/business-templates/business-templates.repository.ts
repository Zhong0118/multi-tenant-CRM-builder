import { Injectable } from '@nestjs/common';
import type { Prisma } from '@crm/database';

import { DatabaseService } from '../../infrastructure/database/database.service';
import type { BusinessTemplateConfiguration } from './business-template.schema';
import type { TemplatePublicationChange } from './business-template-publication.policy';

const SET_USER = "SELECT set_config('app.user_id', $1, true)";

export interface TemplatePageQuery {
  page: number;
  limit: number;
  hasActiveVersion?: boolean;
}

export interface BusinessTemplateVersion {
  id: string;
  templateId: string;
  versionNo: number;
  sourceDraftVersion: number;
  schemaVersion: number;
  configuration: BusinessTemplateConfiguration;
  configurationChecksum: string;
  changeSummary: TemplatePublicationChange[];
  publishedByUserId: string;
  publishedAt: Date;
}

export interface BusinessTemplateRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  draftVersion: number;
  configuration: BusinessTemplateConfiguration;
  activeVersionId: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  activeVersion: BusinessTemplateVersion | null;
  applicationCount: number;
}

export interface CreateBusinessTemplateRecord {
  code: string;
  name: string;
  description: string | null;
  configuration: BusinessTemplateConfiguration;
  createdByUserId: string;
}

export interface SaveBusinessTemplateRecord {
  name: string;
  description: string | null;
  configuration: BusinessTemplateConfiguration;
}

export interface CreateBusinessTemplateVersion {
  templateId: string;
  versionNo: number;
  sourceDraftVersion: number;
  schemaVersion: number;
  configuration: BusinessTemplateConfiguration;
  configurationChecksum: string;
  changeSummary: TemplatePublicationChange[];
  publishedByUserId: string;
}

export interface BusinessTemplateStore {
  listTemplates(query: TemplatePageQuery): Promise<{
    items: BusinessTemplateRecord[];
    total: number;
  }>;
  findTemplate(templateId: string): Promise<BusinessTemplateRecord | null>;
  createTemplate(
    input: CreateBusinessTemplateRecord,
  ): Promise<BusinessTemplateRecord>;
  saveDraft(
    templateId: string,
    input: SaveBusinessTemplateRecord,
    expectedVersion: number,
  ): Promise<BusinessTemplateRecord | null>;
  lockTemplate(templateId: string): Promise<void>;
  nextVersionNumber(templateId: string): Promise<number>;
  createVersion(
    input: CreateBusinessTemplateVersion,
  ): Promise<BusinessTemplateVersion>;
  activateVersion(
    templateId: string,
    version: BusinessTemplateVersion,
  ): Promise<BusinessTemplateRecord | null>;
  listVersions(templateId: string): Promise<BusinessTemplateVersion[]>;
}

export interface BusinessTemplateRepository {
  withActor<T>(
    actorId: string,
    work: (store: BusinessTemplateStore) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class PrismaBusinessTemplateRepository
  implements BusinessTemplateRepository
{
  constructor(private readonly database: DatabaseService) {}

  withActor<T>(
    actorId: string,
    work: (store: BusinessTemplateStore) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(SET_USER, actorId);
      return work(new PrismaBusinessTemplateStore(transaction));
    });
  }
}

class PrismaBusinessTemplateStore implements BusinessTemplateStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async listTemplates(query: TemplatePageQuery) {
    const where =
      query.hasActiveVersion === undefined
        ? {}
        : query.hasActiveVersion
          ? { activeVersionId: { not: null } }
          : { activeVersionId: null };
    const [rows, total] = await Promise.all([
      this.transaction.businessTemplate.findMany({
        where,
        include: { activeVersion: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.transaction.businessTemplate.count({ where }),
    ]);
    return {
      items: await Promise.all(rows.map((row) => this.mapTemplate(row))),
      total,
    };
  }

  async findTemplate(templateId: string) {
    const row = await this.transaction.businessTemplate.findUnique({
      where: { id: templateId },
      include: { activeVersion: true },
    });
    return row ? this.mapTemplate(row) : null;
  }

  async createTemplate(input: CreateBusinessTemplateRecord) {
    const row = await this.transaction.businessTemplate.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description,
        draftConfiguration: jsonInput(input.configuration),
        createdByUserId: input.createdByUserId,
      },
      include: { activeVersion: true },
    });
    return this.mapTemplate(row);
  }

  async saveDraft(
    templateId: string,
    input: SaveBusinessTemplateRecord,
    expectedVersion: number,
  ) {
    const result = await this.transaction.businessTemplate.updateMany({
      where: { id: templateId, draftVersion: expectedVersion },
      data: {
        name: input.name,
        description: input.description,
        draftConfiguration: jsonInput(input.configuration),
        draftVersion: { increment: 1 },
      },
    });
    return result.count === 1 ? this.findTemplate(templateId) : null;
  }

  async lockTemplate(templateId: string): Promise<void> {
    await this.transaction.$queryRaw`
      SELECT id
      FROM business_templates
      WHERE id = ${templateId}::uuid
      FOR UPDATE
    `;
  }

  async nextVersionNumber(templateId: string): Promise<number> {
    const aggregate = await this.transaction.businessTemplateVersion.aggregate({
      where: { templateId },
      _max: { versionNo: true },
    });
    return (aggregate._max.versionNo ?? 0) + 1;
  }

  async createVersion(input: CreateBusinessTemplateVersion) {
    return mapVersion(
      await this.transaction.businessTemplateVersion.create({
        data: {
          templateId: input.templateId,
          versionNo: input.versionNo,
          sourceDraftVersion: input.sourceDraftVersion,
          schemaVersion: input.schemaVersion,
          configuration: jsonInput(input.configuration),
          configurationChecksum: input.configurationChecksum,
          changeSummary: jsonInput(input.changeSummary),
          publishedByUserId: input.publishedByUserId,
        },
      }),
    );
  }

  async activateVersion(
    templateId: string,
    version: BusinessTemplateVersion,
  ) {
    await this.transaction.businessTemplate.update({
      where: { id: templateId },
      data: {
        activeVersionId: version.id,
        publishedAt: version.publishedAt,
      },
    });
    return this.findTemplate(templateId);
  }

  async listVersions(templateId: string) {
    const rows = await this.transaction.businessTemplateVersion.findMany({
      where: { templateId },
      orderBy: [{ versionNo: 'desc' }],
    });
    return rows.map(mapVersion);
  }

  private async mapTemplate(row: TemplateDatabaseRow) {
    const applicationCount = await this.transaction.businessTemplateApplication.count(
      { where: { templateVersion: { templateId: row.id } } },
    );
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      draftVersion: row.draftVersion,
      configuration: row.draftConfiguration as unknown as BusinessTemplateConfiguration,
      activeVersionId: row.activeVersionId,
      publishedAt: row.publishedAt,
      archivedAt: row.archivedAt,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      activeVersion: row.activeVersion ? mapVersion(row.activeVersion) : null,
      applicationCount,
    } satisfies BusinessTemplateRecord;
  }
}

type TemplateDatabaseRow = Prisma.BusinessTemplateGetPayload<{
  include: { activeVersion: true };
}>;

function mapVersion(
  row: Prisma.BusinessTemplateVersionGetPayload<Record<string, never>>,
): BusinessTemplateVersion {
  return {
    id: row.id,
    templateId: row.templateId,
    versionNo: row.versionNo,
    sourceDraftVersion: row.sourceDraftVersion,
    schemaVersion: row.schemaVersion,
    configuration: row.configuration as unknown as BusinessTemplateConfiguration,
    configurationChecksum: row.configurationChecksum,
    changeSummary: row.changeSummary as unknown as TemplatePublicationChange[],
    publishedByUserId: row.publishedByUserId,
    publishedAt: row.publishedAt,
  };
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
