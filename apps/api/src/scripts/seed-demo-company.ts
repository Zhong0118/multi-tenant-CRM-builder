import { randomUUID } from 'node:crypto';

import argon2 from 'argon2';
import { createDatabaseClient, Prisma } from '@crm/database';

import {
  analyzeTemplatePublication,
  checksumTemplateConfiguration,
  compileTemplateVersion,
} from '../modules/business-templates/business-template-publication.policy';
import { hydrateTenantConfiguration } from '../modules/business-templates/template-application.service';
import { normalizeChineseMobile } from '../modules/auth/phone-number';
import {
  buildDemoCompanyFixture,
  DEMO_COMPANY_CODE,
  DEMO_DASHBOARD_CONFIGURATION,
  DEMO_TEMPLATE_CODE,
  type DemoCompanyFixture,
} from './demo-company-fixture';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required');

  const fixture = buildDemoCompanyFixture();
  const analysis = analyzeTemplatePublication(
    fixture.template.configuration,
    null,
  );
  if (analysis.blocking.length > 0) {
    throw new Error(
      `Demo template is invalid: ${analysis.blocking
        .map(({ message }) => message)
        .join('; ')}`,
    );
  }
  const publishedConfiguration = compileTemplateVersion(
    fixture.template.configuration,
  );
  const configurationChecksum = checksumTemplateConfiguration(
    publishedConfiguration,
  );
  const passwordHash = await argon2.hash(fixture.password, {
    type: argon2.argon2id,
  });
  const database = createDatabaseClient(databaseUrl);

  try {
    const result = await database.$transaction(
      async (transaction) => {
        const existingTenant = await transaction.tenant.findUnique({
          where: { code: DEMO_COMPANY_CODE },
          include: {
            members: true,
            objects: true,
            records: true,
          },
        });
        if (existingTenant) {
          await reconcileExistingDemoTenant(
            transaction,
            existingTenant,
            fixture,
          );
          return {
            created: false,
            reconciled: true,
            tenantId: existingTenant.id,
            memberCount: existingTenant.members.length,
            objectCount: existingTenant.objects.length,
            recordCount: existingTenant.records.length,
          };
        }

        const [existingTemplate, conflictingUsers, platformAdmin] =
          await Promise.all([
            transaction.businessTemplate.findUnique({
              where: { code: DEMO_TEMPLATE_CODE },
            }),
            transaction.user.findMany({
              where: {
                phone: {
                  in: fixture.users.map(({ phone }) =>
                    normalizeChineseMobile(phone),
                  ),
                },
              },
              select: { phone: true },
            }),
            transaction.user.findFirst({
              where: {
                isPlatformAdmin: true,
                status: 'ACTIVE',
              },
              orderBy: { createdAt: 'asc' },
            }),
          ]);

        if (existingTemplate) {
          throw new Error(
            `Template code ${DEMO_TEMPLATE_CODE} already exists without the demo company`,
          );
        }
        if (conflictingUsers.length > 0) {
          throw new Error(
            `Demo phone numbers already exist: ${conflictingUsers
              .map(({ phone }) => phone)
              .join(', ')}`,
          );
        }
        if (!platformAdmin) {
          throw new Error('An active platform administrator is required');
        }

        const now = new Date();
        const tenantId = randomUUID();
        const templateId = randomUUID();
        const templateVersionId = randomUUID();

        await transaction.businessTemplate.create({
          data: {
            id: templateId,
            code: fixture.template.code,
            name: fixture.template.name,
            description: fixture.template.description,
            draftVersion: 1,
            draftConfiguration: jsonInput(publishedConfiguration),
            createdByUserId: platformAdmin.id,
          },
        });
        await transaction.businessTemplateVersion.create({
          data: {
            id: templateVersionId,
            templateId,
            versionNo: 1,
            sourceDraftVersion: 1,
            schemaVersion: 1,
            configuration: jsonInput(publishedConfiguration),
            configurationChecksum,
            changeSummary: jsonInput(analysis.changes),
            publishedByUserId: platformAdmin.id,
            publishedAt: now,
          },
        });
        await transaction.businessTemplate.update({
          where: { id: templateId },
          data: { activeVersionId: templateVersionId, publishedAt: now },
        });

        await transaction.tenant.create({
          data: {
            id: tenantId,
            name: fixture.company.name,
            code: fixture.company.code,
            status: 'DRAFT',
          },
        });

        const userIdByEmployeeNo = new Map<string, string>();
        const memberIdByEmployeeNo = new Map<string, string>();
        for (const user of fixture.users) {
          const userId = randomUUID();
          const memberId = randomUUID();
          userIdByEmployeeNo.set(user.employeeNo, userId);
          memberIdByEmployeeNo.set(user.employeeNo, memberId);
          await transaction.user.create({
            data: {
              id: userId,
              displayName: user.displayName,
              phone: normalizeChineseMobile(user.phone),
              phoneVerifiedAt: now,
              passwordHash,
              status: 'ACTIVE',
            },
          });
          await transaction.tenantMember.create({
            data: {
              id: memberId,
              tenantId,
              userId,
              role: user.role,
              status: 'ACTIVE',
              employeeNo: user.employeeNo,
              joinedAt: now,
            },
          });
        }

        const hydrated = hydrateTenantConfiguration(
          publishedConfiguration,
          tenantId,
          templateVersionId,
          randomUUID,
        );
        for (const object of hydrated.objects) {
          await transaction.objectDefinition.create({
            data: {
              id: object.id,
              tenantId,
              code: object.code,
              name: object.name,
              kind: 'GENERIC',
              titleFieldKey: object.titleFieldKey,
              icon: object.icon,
              status: 'DRAFT',
              sortOrder: object.sortOrder,
              settings: jsonInput(object.settings),
              sourceTemplateVersionId: templateVersionId,
              version: 1,
            },
          });
        }
        for (const field of hydrated.fields) {
          await transaction.fieldDefinition.create({
            data: {
              id: field.id,
              tenantId,
              objectId: field.objectId,
              fieldKey: field.fieldKey,
              label: field.label,
              type: field.type,
              required: field.required,
              isSystem: field.isSystem,
              isSensitive: false,
              defaultValue:
                field.defaultValue === null
                  ? Prisma.DbNull
                  : jsonInput(field.defaultValue),
              validation: jsonInput(field.validation),
              config: jsonInput(field.config),
              sortOrder: field.sortOrder,
              status: field.status,
            },
          });
        }
        for (const view of hydrated.views) {
          await transaction.viewDefinition.create({
            data: {
              ...view,
              columnFieldKeys: jsonInput(view.columnFieldKeys),
              sort: jsonInput(view.sort),
            },
          });
        }
        await transaction.objectPermission.createMany({
          data: hydrated.objectPermissions,
        });
        await transaction.fieldPermission.createMany({
          data: hydrated.fieldPermissions,
        });
        await transaction.businessTemplateApplication.create({
          data: {
            id: randomUUID(),
            templateVersionId,
            tenantId,
            appliedByUserId: platformAdmin.id,
            configurationChecksum,
            objectIdMap: jsonInput(
              Object.fromEntries(
                hydrated.objectsResult.map((object) => [
                  object.templateObjectId,
                  object.objectId,
                ]),
              ),
            ),
            appliedAt: now,
          },
        });

        const objectIdByCode = new Map(
          hydrated.objects.map((object) => [object.code, object.id]),
        );
        const firstAdmin = fixture.users.find(
          ({ role }) => role === 'TENANT_ADMIN',
        );
        if (!firstAdmin) throw new Error('A demo company admin is required');
        const publishingMemberId = memberIdByEmployeeNo.get(
          firstAdmin.employeeNo,
        );
        if (!publishingMemberId) {
          throw new Error('Demo company admin member was not created');
        }

        for (const sourceObject of publishedConfiguration.objects) {
          const objectId = objectIdByCode.get(sourceObject.code);
          if (
            !objectId ||
            !sourceObject.defaultView ||
            !sourceObject.employeeAccess
          ) {
            throw new Error(
              `Hydrated object ${sourceObject.code} is incomplete`,
            );
          }
          const tenantFields = hydrated.fields
            .filter((field) => field.objectId === objectId)
            .sort((left, right) => left.sortOrder - right.sortOrder);
          const publicationId = randomUUID();
          const configuration = {
            publication: {
              id: publicationId,
              number: 1,
              sourceDraftVersion: 1,
              publishedAt: now.toISOString(),
            },
            object: {
              id: objectId,
              code: sourceObject.code,
              name: sourceObject.name,
              description: sourceObject.description,
              titleFieldKey: sourceObject.titleFieldKey,
              icon: sourceObject.icon,
              sortOrder: sourceObject.sortOrder,
            },
            fields: tenantFields.map((field) => ({
              id: field.id,
              fieldKey: field.fieldKey,
              label: field.label,
              type: field.type,
              required: field.required,
              defaultValue: field.defaultValue,
              validation: field.validation,
              config: field.config,
              sortOrder: field.sortOrder,
              isSystem: field.isSystem,
            })),
            defaultView: sourceObject.defaultView,
            employeeAccess: sourceObject.employeeAccess,
          };
          await transaction.objectPublication.create({
            data: {
              id: publicationId,
              tenantId,
              objectId,
              publicationNo: 1,
              sourceDraftVersion: 1,
              configuration: jsonInput(configuration),
              changeSummary: jsonInput(
                tenantFields.map((field) => ({
                  kind: 'ADDED',
                  fieldKey: field.fieldKey,
                })),
              ),
              publishedByMemberId: publishingMemberId,
              publishedAt: now,
            },
          });
          await transaction.objectDefinition.update({
            where: { id: objectId },
            data: {
              activePublicationId: publicationId,
              status: 'ACTIVE',
              publishedAt: now,
            },
          });
        }

        const recordsByObject = new Map<string, typeof fixture.records>();
        for (const record of fixture.records) {
          const records = recordsByObject.get(record.objectCode) ?? [];
          records.push(record);
          recordsByObject.set(record.objectCode, records);
        }
        for (const [objectCode, records] of recordsByObject) {
          const objectId = objectIdByCode.get(objectCode);
          if (!objectId) throw new Error(`Unknown demo object ${objectCode}`);
          let recordNo = 1n;
          for (const [recordIndex, record] of records.entries()) {
            const ownerMemberId = record.ownerEmployeeNo
              ? memberIdByEmployeeNo.get(record.ownerEmployeeNo)
              : null;
            if (record.ownerEmployeeNo && !ownerMemberId) {
              throw new Error(
                `Unknown demo record owner ${record.ownerEmployeeNo}`,
              );
            }
            await transaction.record.create({
              data: {
                id: randomUUID(),
                tenantId,
                objectId,
                recordNo,
                ownerMemberId,
                statusKey: record.statusKey,
                title: record.title,
                data: jsonInput(record.values),
                source: 'MANUAL',
                createdByMemberId: ownerMemberId ?? publishingMemberId,
                version: 1,
                createdAt: now,
                updatedAt:
                  objectCode === 'opportunities' && recordIndex % 4 === 0
                    ? daysBefore(now, 10)
                    : now,
              },
            });
            recordNo += 1n;
          }
          await transaction.recordCounter.create({
            data: {
              tenantId,
              objectId,
              nextRecordNo: recordNo,
            },
          });
        }

        await transaction.tenantDashboardConfiguration.create({
          data: {
            tenantId,
            version: 1,
            configuration: jsonInput(DEMO_DASHBOARD_CONFIGURATION),
          },
        });

        await transaction.tenant.update({
          where: { id: tenantId },
          data: { status: 'ACTIVE', activatedAt: now },
        });
        await transaction.auditLog.create({
          data: {
            tenantId,
            actorType: 'SYSTEM',
            action: 'demo.company.seeded',
            resourceType: 'tenant',
            resourceId: tenantId,
            after: jsonInput({
              templateId,
              templateVersionId,
              members: fixture.users.length,
              objects: hydrated.objects.length,
              records: fixture.records.length,
            }),
            reason: '本地产品演示数据',
            requestId: `demo_seed_${randomUUID()}`,
          },
        });

        return {
          created: true,
          tenantId,
          templateId,
          templateVersionId,
          platformAdmin: {
            displayName: platformAdmin.displayName,
            phone: platformAdmin.phone,
          },
          memberCount: fixture.users.length,
          objectCount: hydrated.objects.length,
          recordCount: fixture.records.length,
        };
      },
      { timeout: 30_000 },
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          ...result,
          company: fixture.company,
          password: fixture.password,
          accounts: fixture.users.map((user) => ({
            displayName: user.displayName,
            phone: user.phone,
            role: user.role,
            employeeNo: user.employeeNo,
          })),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

type ExistingDemoTenant = Prisma.TenantGetPayload<{
  include: { members: true; objects: true; records: true };
}>;

async function reconcileExistingDemoTenant(
  transaction: Prisma.TransactionClient,
  tenant: ExistingDemoTenant,
  fixture: DemoCompanyFixture,
): Promise<void> {
  const opportunityObject = tenant.objects.find(
    ({ code }) => code === DEMO_DASHBOARD_CONFIGURATION.opportunity.objectCode,
  );
  if (!opportunityObject?.activePublicationId) {
    throw new Error('The existing demo opportunity table is not published');
  }

  const sourceOpportunity = fixture.template.configuration.objects.find(
    ({ code }) => code === opportunityObject.code,
  );
  const sourceStage = sourceOpportunity?.fields.find(
    ({ fieldKey }) =>
      fieldKey === DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
  );
  if (!sourceStage) throw new Error('Demo opportunity stage field is missing');

  const activePublication = await transaction.objectPublication.findUnique({
    where: { id: opportunityObject.activePublicationId },
  });
  if (!activePublication) {
    throw new Error('The active demo opportunity publication is missing');
  }

  const publishingMember = tenant.members.find(
    ({ role, status }) => role === 'TENANT_ADMIN' && status === 'ACTIVE',
  );
  if (!publishingMember) throw new Error('A demo company admin is required');

  const nextPublication = await transaction.objectPublication.aggregate({
    where: { tenantId: tenant.id, objectId: opportunityObject.id },
    _max: { publicationNo: true },
  });
  const publicationId = randomUUID();
  const now = new Date();
  const publicationNumber = (nextPublication._max.publicationNo ?? 0) + 1;
  if (
    !stageConfigurationMatches(
      activePublication.configuration,
      sourceStage.config,
    )
  ) {
    const updatedConfiguration = replaceStageConfiguration(
      activePublication.configuration,
      sourceStage.config,
      {
        id: publicationId,
        number: publicationNumber,
        sourceDraftVersion: opportunityObject.version,
        publishedAt: now.toISOString(),
      },
    );

    await transaction.fieldDefinition.updateMany({
      where: {
        tenantId: tenant.id,
        objectId: opportunityObject.id,
        fieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
      },
      data: { config: jsonInput(sourceStage.config) },
    });
    await transaction.objectPublication.create({
      data: {
        id: publicationId,
        tenantId: tenant.id,
        objectId: opportunityObject.id,
        publicationNo: publicationNumber,
        sourceDraftVersion: opportunityObject.version,
        configuration: updatedConfiguration,
        changeSummary: jsonInput([
          {
            kind: 'UPDATED',
            fieldKey: DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
          },
        ]),
        publishedByMemberId: publishingMember.id,
        publishedAt: now,
      },
    });
    await transaction.objectDefinition.update({
      where: { id: opportunityObject.id },
      data: { activePublicationId: publicationId, publishedAt: now },
    });
  }

  const memberIdByEmployeeNo = new Map(
    tenant.members.flatMap((member) =>
      member.employeeNo ? [[member.employeeNo, member.id] as const] : [],
    ),
  );
  const sourceByTitle = new Map(
    fixture.records
      .filter(({ objectCode }) => objectCode === opportunityObject.code)
      .map((record) => [record.title, record]),
  );
  const existingOpportunities = tenant.records.filter(
    ({ objectId }) => objectId === opportunityObject.id,
  );
  for (const [recordIndex, record] of existingOpportunities.entries()) {
    const source = sourceByTitle.get(record.title);
    if (!source) continue;
    const ownerMemberId = source.ownerEmployeeNo
      ? memberIdByEmployeeNo.get(source.ownerEmployeeNo)
      : null;
    if (source.ownerEmployeeNo && !ownerMemberId) {
      throw new Error(`Unknown demo record owner ${source.ownerEmployeeNo}`);
    }
    await transaction.record.update({
      where: { id: record.id },
      data: {
        ownerMemberId,
        statusKey: source.statusKey,
        data: jsonInput(source.values),
        updatedAt: recordIndex % 4 === 0 ? daysBefore(now, 10) : now,
      },
    });
  }

  await transaction.tenantDashboardConfiguration.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      version: 1,
      configuration: jsonInput(DEMO_DASHBOARD_CONFIGURATION),
    },
    update: {
      configuration: jsonInput(DEMO_DASHBOARD_CONFIGURATION),
    },
  });
}

function stageConfigurationMatches(
  rawConfiguration: Prisma.JsonValue,
  stageConfig: Record<string, unknown>,
): boolean {
  const configuration = rawConfiguration as unknown as Record<string, unknown>;
  const fields = Array.isArray(configuration.fields)
    ? (configuration.fields as Array<Record<string, unknown>>)
    : [];
  const stage = fields.find(
    (field) =>
      field.fieldKey === DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
  );
  return JSON.stringify(stage?.config) === JSON.stringify(stageConfig);
}

function replaceStageConfiguration(
  rawConfiguration: Prisma.JsonValue,
  stageConfig: Record<string, unknown>,
  publication: {
    id: string;
    number: number;
    sourceDraftVersion: number;
    publishedAt: string;
  },
): Prisma.InputJsonValue {
  const configuration = structuredClone(rawConfiguration) as unknown as Record<
    string,
    unknown
  >;
  const fields = Array.isArray(configuration.fields)
    ? (configuration.fields as Array<Record<string, unknown>>)
    : [];
  const stage = fields.find(
    (field) =>
      field.fieldKey === DEMO_DASHBOARD_CONFIGURATION.opportunity.stageFieldKey,
  );
  if (!stage) throw new Error('Published demo opportunity stage is missing');
  stage.config = stageConfig;
  configuration.publication = publication;
  return jsonInput(configuration);
}

function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
