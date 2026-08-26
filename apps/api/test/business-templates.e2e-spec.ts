import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request, { type Agent } from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';

const origin = 'http://localhost:3000';
const verificationCode = '123456';
const platformPhone = '13977771001';
const regularPhone = '13977771002';
const tenantAdminPhone = '13977771003';
const tenantCode = 'e2e-template-company';
const templateCode = 'test-crm-e2e';
const invalidTemplateCode = '9test-crm-e2e';

const twoObjectTemplateFixture = {
  schemaVersion: 1,
  objects: [
    templateObject(
      '00000000-0000-4000-8000-000000000101',
      'customers',
      '客户',
      10,
      [
        templateField(
          '00000000-0000-4000-8000-000000000111',
          'name',
          '客户名称',
          'TEXT',
          true,
          10,
          { maxLength: 100 },
        ),
        templateField(
          '00000000-0000-4000-8000-000000000112',
          'phone',
          '联系电话',
          'PHONE',
          false,
          20,
        ),
      ],
      { name: 'EDIT', phone: 'READ_ONLY' },
    ),
    templateObject(
      '00000000-0000-4000-8000-000000000201',
      'opportunities',
      '商机',
      20,
      [
        templateField(
          '00000000-0000-4000-8000-000000000211',
          'name',
          '商机名称',
          'TEXT',
          true,
          10,
          { maxLength: 100 },
        ),
        templateField(
          '00000000-0000-4000-8000-000000000212',
          'amount',
          '预计金额',
          'MONEY',
          false,
          20,
          { scale: 2 },
        ),
      ],
      { name: 'EDIT', amount: 'EDIT' },
    ),
  ],
};

describe('Business template HTTP workflow (e2e)', () => {
  let app: INestApplication<App>;
  let adminDatabase: PrismaClient;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = verificationCode;
    process.env.WEB_ORIGIN = origin;
    process.env.DATABASE_URL = requiredEnvironment('TEST_DATABASE_URL');
    const { createDatabaseClient } = await import('@crm/database');
    adminDatabase = createDatabaseClient(
      requiredEnvironment('TEST_DATABASE_ADMIN_URL'),
    );
    app = (await createApp()) as INestApplication<App>;
  });

  beforeEach(async () => {
    await cleanup(adminDatabase);
  });

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app?.close();
    await adminDatabase?.$disconnect();
  });

  it('guards template routes and applies the current immutable version as complete tenant drafts', async () => {
    const platform = await register(platformPhone, '平台管理员');
    const regular = await register(regularPhone, '普通用户');
    await register(tenantAdminPhone, '公司管理员');
    await adminDatabase.user.update({
      where: { phone: normalized(platformPhone) },
      data: { isPlatformAdmin: true },
    });

    await regular.get('/api/v1/platform/business-templates').expect(403);
    await platform
      .post('/api/v1/platform/business-templates')
      .set('Origin', origin)
      .send({
        name: '无效代码模板',
        code: invalidTemplateCode,
        description: '模板代码必须以字母开头',
      })
      .expect(400);

    const tenant = await platform
      .post('/api/v1/platform/tenants')
      .set('Origin', origin)
      .send({
        name: '模板端到端公司',
        code: tenantCode,
        firstAdminPhone: tenantAdminPhone,
      })
      .expect(201);
    const tenantId = stringProperty(tenant.body, 'id');

    const template = await platform
      .post('/api/v1/platform/business-templates')
      .set('Origin', origin)
      .send({
        name: '测试 CRM',
        code: templateCode,
        description: '端到端模板',
      })
      .expect(201);
    const templateId = stringProperty(template.body, 'id');

    const saved = await platform
      .put(`/api/v1/platform/business-templates/${templateId}/draft`)
      .set('Origin', origin)
      .send({
        expectedVersion: 1,
        name: '测试 CRM',
        description: '端到端模板',
        configuration: twoObjectTemplateFixture,
      })
      .expect(200);
    const draftVersion = numberProperty(saved.body, 'draftVersion');

    const published = await platform
      .post(`/api/v1/platform/business-templates/${templateId}/versions`)
      .set('Origin', origin)
      .send({ expectedVersion: draftVersion })
      .expect(201);
    const templateVersionId = stringProperty(published.body, 'id');

    const firstApplication = await platform
      .post(`/api/v1/platform/business-templates/${templateId}/applications`)
      .set('Origin', origin)
      .send({ tenantId, templateVersionId })
      .expect(201);
    const applicationId = stringProperty(firstApplication.body, 'id');

    const objects = await adminDatabase.objectDefinition.findMany({
      where: { tenantId },
      include: {
        fields: { orderBy: { sortOrder: 'asc' } },
        views: true,
        permissions: true,
        fieldPermissions: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    expect(objects).toHaveLength(2);
    expect(objects.map(({ code }) => code)).toEqual([
      'customers',
      'opportunities',
    ]);
    expect(
      objects.every(
        (object) =>
          object.status === 'DRAFT' &&
          object.sourceTemplateVersionId === templateVersionId &&
          object.activePublicationId === null &&
          object.publishedAt === null &&
          object.fields.length === 2 &&
          object.views.length === 1 &&
          object.permissions.length === 1 &&
          object.fieldPermissions.length === 2,
      ),
    ).toBe(true);
    expect(objects[0]?.fields.map(({ fieldKey }) => fieldKey)).toEqual([
      'name',
      'phone',
    ]);
    expect(objects[1]?.fields.map(({ fieldKey }) => fieldKey)).toEqual([
      'name',
      'amount',
    ]);
    expect(objects.map((object) => object.views[0])).toEqual([
      expect.objectContaining({
        code: 'default',
        name: '默认列表',
        columnFieldKeys: ['name', 'phone'],
        sort: { field: 'updatedAt', direction: 'desc' },
      }),
      expect.objectContaining({
        code: 'default',
        name: '默认列表',
        columnFieldKeys: ['name', 'amount'],
        sort: { field: 'updatedAt', direction: 'desc' },
      }),
    ]);
    expect(objects.map((object) => object.permissions[0])).toEqual([
      expect.objectContaining({
        subjectType: 'ROLE',
        subjectRole: 'EMPLOYEE',
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'ALL',
        updateScope: 'OWN',
      }),
      expect.objectContaining({
        subjectType: 'ROLE',
        subjectRole: 'EMPLOYEE',
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'ALL',
        updateScope: 'OWN',
      }),
    ]);
    expect(
      objects.map((object) =>
        object.fieldPermissions.map(({ access }) => access).sort(),
      ),
    ).toEqual([
      ['EDIT', 'READ_ONLY'],
      ['EDIT', 'EDIT'],
    ]);
    expect(
      objects.some((object) =>
        twoObjectTemplateFixture.objects.some(
          (templateObject) => templateObject.id === object.id,
        ),
      ),
    ).toBe(false);
    await expect(
      adminDatabase.objectPublication.count({ where: { tenantId } }),
    ).resolves.toBe(0);

    const retriedApplication = await platform
      .post(`/api/v1/platform/business-templates/${templateId}/applications`)
      .set('Origin', origin)
      .send({ tenantId, templateVersionId })
      .expect(201);

    expect(stringProperty(retriedApplication.body, 'id')).toBe(applicationId);
    await expect(
      adminDatabase.objectDefinition.count({ where: { tenantId } }),
    ).resolves.toBe(2);
  });

  async function register(phone: string, displayName: string): Promise<Agent> {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/v1/auth/verification-challenges')
      .set('Origin', origin)
      .send({ phone, purpose: 'REGISTER', deviceKey: `device-${phone}` })
      .expect(202);
    await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        phone,
        code: verificationCode,
        displayName,
        password: 'test-password1',
        deviceSummary: 'E2E',
      })
      .expect(201);
    return agent;
  }
});

function templateObject(
  id: string,
  code: string,
  name: string,
  sortOrder: number,
  fields: ReturnType<typeof templateField>[],
  fieldAccess: Record<string, 'EDIT' | 'READ_ONLY' | 'HIDDEN'>,
) {
  return {
    id,
    code,
    name,
    description: `${name}对象`,
    icon: null,
    titleFieldKey: 'name',
    sortOrder,
    status: 'ACTIVE' as const,
    fields,
    defaultView: {
      code: 'default' as const,
      name: '默认列表',
      columnFieldKeys: fields.map(({ fieldKey }) => fieldKey),
      sort: { field: 'updatedAt' as const, direction: 'desc' as const },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false as const,
      readScope: 'ALL' as const,
      updateScope: 'OWN' as const,
      fields: fieldAccess,
    },
  };
}

function templateField(
  id: string,
  fieldKey: string,
  label: string,
  type: 'TEXT' | 'PHONE' | 'MONEY',
  required: boolean,
  sortOrder: number,
  validation: Record<string, number> = {},
) {
  return {
    id,
    fieldKey,
    label,
    type,
    required,
    defaultValue: null,
    validation,
    config: {},
    sortOrder,
    isSystem: false,
    status: 'ACTIVE' as const,
  };
}

async function cleanup(database: PrismaClient): Promise<void> {
  const tenant = await database.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true },
  });
  const templates = await database.businessTemplate.findMany({
    where: { code: { in: [templateCode, invalidTemplateCode] } },
    select: { id: true },
  });
  const users = await database.user.findMany({
    where: {
      phone: {
        in: [platformPhone, regularPhone, tenantAdminPhone].map(normalized),
      },
    },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);

  if (tenant) {
    await database.auditLog.deleteMany({ where: { tenantId: tenant.id } });
    await database.fieldPermission.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.objectPermission.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.viewDefinition.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.objectPublication.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.fieldDefinition.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.objectDefinition.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.businessTemplateApplication.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.tenantInvitation.deleteMany({
      where: { tenantId: tenant.id },
    });
    await database.tenantMember.deleteMany({ where: { tenantId: tenant.id } });
    await database.tenant.delete({ where: { id: tenant.id } });
  }
  for (const template of templates) {
    await database.businessTemplate.update({
      where: { id: template.id },
      data: { activeVersionId: null },
    });
    await database.businessTemplateVersion.deleteMany({
      where: { templateId: template.id },
    });
    await database.businessTemplate.delete({ where: { id: template.id } });
  }
  await database.session.deleteMany({ where: { userId: { in: userIds } } });
  await database.verificationChallenge.deleteMany({
    where: {
      phone: {
        in: [platformPhone, regularPhone, tenantAdminPhone].map(normalized),
      },
    },
  });
  await database.user.deleteMany({ where: { id: { in: userIds } } });
}

function stringProperty(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected ${key}`);
  }
  const result: unknown = Reflect.get(value, key);
  if (typeof result !== 'string') throw new Error(`Expected ${key}`);
  return result;
}

function numberProperty(value: unknown, key: string): number {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected ${key}`);
  }
  const result: unknown = Reflect.get(value, key);
  if (typeof result !== 'number') throw new Error(`Expected ${key}`);
  return result;
}

function normalized(phone: string): string {
  return `+86${phone}`;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
