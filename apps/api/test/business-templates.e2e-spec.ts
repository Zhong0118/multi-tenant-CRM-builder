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
const employeePhone = '13977771004';
const tenantCode = 'e2e-template-company';
const activeTenantCode = 'e2e-template-active-company';
const createdTenantCode = 'e2e-template-created-company';
const staleTenantCode = 'e2e-template-stale-company';
const raceTenantCode = 'e2e-template-race-company';
const secondTemplateCode = 'test-crm-e2e-second';
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
    const tenantAdmin = await register(tenantAdminPhone, '公司管理员');
    const employee = await register(employeePhone, '公司员工');
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
    expect(
      Object.fromEntries(
        objects.flatMap((object) =>
          object.fields.map((field) => [
            `${object.code}.${field.fieldKey}`,
            {
              type: field.type,
              required: field.required,
              validation: field.validation,
              config: field.config,
              sortOrder: field.sortOrder,
            },
          ]),
        ),
      ),
    ).toEqual({
      'customers.name': {
        type: 'TEXT',
        required: true,
        validation: { maxLength: 100 },
        config: {},
        sortOrder: 10,
      },
      'customers.phone': {
        type: 'PHONE',
        required: false,
        validation: {},
        config: {},
        sortOrder: 20,
      },
      'opportunities.name': {
        type: 'TEXT',
        required: true,
        validation: { maxLength: 100 },
        config: {},
        sortOrder: 10,
      },
      'opportunities.amount': {
        type: 'MONEY',
        required: false,
        validation: { scale: 2 },
        config: {},
        sortOrder: 20,
      },
    });
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
      Object.fromEntries(
        objects.flatMap((object) => {
          const fieldKeyById = new Map(
            object.fields.map((field) => [field.id, field.fieldKey]),
          );
          return object.fieldPermissions.map((permission) => {
            const fieldKey = fieldKeyById.get(permission.fieldId);
            if (!fieldKey) {
              throw new Error('Field permission references an unknown field');
            }
            return [`${object.code}.${fieldKey}`, permission.access];
          });
        }),
      ),
    ).toEqual({
      'customers.name': 'EDIT',
      'customers.phone': 'READ_ONLY',
      'opportunities.name': 'EDIT',
      'opportunities.amount': 'EDIT',
    });
    const generatedIds = objects.flatMap((object) => [
      object.id,
      ...object.fields.map(({ id }) => id),
      ...object.views.map(({ id }) => id),
      ...object.permissions.map(({ id }) => id),
      ...object.fieldPermissions.map(({ id }) => id),
    ]);
    const templateLocalIds = new Set([
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000111',
      '00000000-0000-4000-8000-000000000112',
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000211',
      '00000000-0000-4000-8000-000000000212',
    ]);
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
    expect(generatedIds.every((id) => !templateLocalIds.has(id))).toBe(true);
    expect(firstApplication.body).toMatchObject({
      objects: [
        {
          templateObjectId: '00000000-0000-4000-8000-000000000101',
          objectId: objects[0]?.id,
          code: 'customers',
        },
        {
          templateObjectId: '00000000-0000-4000-8000-000000000201',
          objectId: objects[1]?.id,
          code: 'opportunities',
        },
      ],
    });
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

    const customerObject = objects[0];
    if (!customerObject) throw new Error('Expected generated customers object');
    await acceptInvitation(tenantAdmin, tenantId);
    await platform
      .patch(`/api/v1/platform/tenants/${tenantId}/status`)
      .set('Origin', origin)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await platform.get(`/api/v1/workspaces/${tenantCode}`).expect(403);
    await platform
      .post(
        `/api/v1/workspaces/${tenantCode}/object-definitions/${customerObject.id}/publications`,
      )
      .set('Origin', origin)
      .send({ expectedVersion: customerObject.version })
      .expect(403);

    await tenantAdmin
      .post(`/api/v1/workspaces/${tenantCode}/invitations`)
      .set('Origin', origin)
      .send({ phone: employeePhone, role: 'EMPLOYEE' })
      .expect(201);
    await acceptInvitation(employee, tenantId);

    await tenantAdmin
      .post(
        `/api/v1/workspaces/${tenantCode}/object-definitions/${customerObject.id}/publications`,
      )
      .set('Origin', origin)
      .send({ expectedVersion: customerObject.version })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          number: 1,
          sourceDraftVersion: customerObject.version,
        });
      });

    const navigation = await employee
      .get(`/api/v1/workspaces/${tenantCode}/objects`)
      .expect(200);
    expect(navigation.body).toEqual([
      expect.objectContaining({
        code: 'customers',
        canCreate: true,
        canRead: true,
      }),
    ]);
    const runtimeSchema = await employee
      .get(`/api/v1/workspaces/${tenantCode}/objects/customers/schema`)
      .expect(200);
    expect(runtimeSchema.body).toMatchObject({
      publication: { number: 1 },
      scopes: { read: 'ALL', update: 'OWN' },
      fields: [
        { fieldKey: 'name', type: 'TEXT', required: true, access: 'EDIT' },
        {
          fieldKey: 'phone',
          type: 'PHONE',
          required: false,
          access: 'READ_ONLY',
        },
      ],
    });
    await employee
      .post(`/api/v1/workspaces/${tenantCode}/objects/customers/records`)
      .set('Origin', origin)
      .send({ values: { name: '模板运行时客户', phone: '13900000000' } })
      .expect(403);
    await employee
      .post(`/api/v1/workspaces/${tenantCode}/objects/customers/records`)
      .set('Origin', origin)
      .send({ values: { name: '模板运行时客户' } })
      .expect(201)
      .expect((response) => {
        expect(response.body).toMatchObject({
          title: '模板运行时客户',
          values: { name: '模板运行时客户' },
        });
      });
    await expect(
      adminDatabase.objectPublication.count({ where: { tenantId } }),
    ).resolves.toBe(1);

    const activeTenant = await platform
      .post('/api/v1/platform/tenants')
      .set('Origin', origin)
      .send({
        name: '非草稿模板公司',
        code: activeTenantCode,
        firstAdminPhone: tenantAdminPhone,
      })
      .expect(201);
    const activeTenantId = stringProperty(activeTenant.body, 'id');
    await acceptInvitation(tenantAdmin, activeTenantId);
    await platform
      .patch(`/api/v1/platform/tenants/${activeTenantId}/status`)
      .set('Origin', origin)
      .send({ status: 'ACTIVE' })
      .expect(200);
    // A suspended or closed company cannot be initialized; an active one that
    // has not configured any business table yet still can.
    const setStatus = (status: string) =>
      platform
        .patch(`/api/v1/platform/tenants/${activeTenantId}/status`)
        .set('Origin', origin)
        .send({ status })
        .expect(200);
    const applyToActive = () =>
      platform
        .post(`/api/v1/platform/business-templates/${templateId}/applications`)
        .set('Origin', origin)
        .send({ tenantId: activeTenantId, templateVersionId });
    await setStatus('SUSPENDED');
    await applyToActive()
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          code: 'TEMPLATE_APPLICATION_NOT_ALLOWED',
          message: '已暂停或关闭的公司不能应用模板。',
          fieldErrors: {
            application: ['已暂停或关闭的公司不能应用模板。'],
          },
        });
      });
    await setStatus('ACTIVE');
    await applyToActive().expect(201);
    await expect(
      adminDatabase.objectDefinition.count({
        where: { tenantId: activeTenantId, status: 'DRAFT' },
      }),
    ).resolves.toBeGreaterThan(0);

    // Platform identity is not company membership: the template copy above is
    // the platform's only write, and the company's tables stay the company's.
    const applied = await adminDatabase.objectDefinition.findFirstOrThrow({
      where: { tenantId: activeTenantId },
    });
    const workspace = `/api/v1/workspaces/${activeTenantCode}`;
    for (const attempt of [
      () => platform.get(`${workspace}/object-definitions`),
      () => platform.get(`${workspace}/object-definitions/${applied.id}`),
      () =>
        platform
          .post(`${workspace}/object-definitions`)
          .set('Origin', origin)
          .send({ name: '越权表', code: 'bypass' }),
      () =>
        platform
          .post(`${workspace}/object-definitions/${applied.id}/archive`)
          .set('Origin', origin)
          .send({ expectedVersion: applied.version }),
    ]) {
      const response = await attempt();
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    }
  });

  it('creates a company from a template atomically, copies select settings and search, and never copies twice', async () => {
    const platform = await register(platformPhone, '平台管理员');
    await adminDatabase.user.update({
      where: { phone: normalized(platformPhone) },
      data: { isPlatformAdmin: true },
    });
    const post = (path: string, body: object) =>
      platform.post(path).set('Origin', origin).send(body);
    async function publishTemplate(code: string, configuration: object) {
      const created = await post('/api/v1/platform/business-templates', {
        name: code,
        code,
        description: code,
      }).expect(201);
      const id = stringProperty(created.body, 'id');
      const saved = await platform
        .put(`/api/v1/platform/business-templates/${id}/draft`)
        .set('Origin', origin)
        .send({
          expectedVersion: 1,
          name: code,
          description: code,
          configuration,
        })
        .expect(200);
      const published = await post(
        `/api/v1/platform/business-templates/${id}/versions`,
        { expectedVersion: numberProperty(saved.body, 'draftVersion') },
      ).expect(201);
      return {
        templateId: id,
        templateVersionId: stringProperty(published.body, 'id'),
      };
    }
    const selectTemplate = structuredClone(twoObjectTemplateFixture) as {
      schemaVersion: 1;
      objects: Array<
        Record<string, unknown> & {
          fields: Array<Record<string, unknown>>;
          defaultView: Record<string, unknown>;
          employeeAccess: { fields: Record<string, string> };
        }
      >;
    };
    selectTemplate.objects[0].fields.push({
      ...templateField(
        '00000000-0000-4000-8000-000000000113',
        'grade',
        '客户等级',
        'TEXT',
        false,
        30,
      ),
      type: 'SINGLE_SELECT',
      defaultValue: 'b',
      config: {
        options: [
          { key: 'a', label: 'A 级', status: 'INACTIVE', color: 'BLUE' },
          { key: 'b', label: 'B 级', status: 'ACTIVE', color: 'GREEN' },
        ],
      },
    });
    selectTemplate.objects[0].defaultView.searchFieldKeys = ['phone'];
    selectTemplate.objects[0].employeeAccess.fields.grade = 'EDIT';
    const first = await publishTemplate(templateCode, selectTemplate);

    // A stale version fails the whole creation: no company is left behind.
    await post('/api/v1/platform/tenants', {
      name: '过期版本公司',
      code: staleTenantCode,
      firstAdminPhone: tenantAdminPhone,
      initialization: 'TEMPLATE',
      templateId: first.templateId,
      templateVersionId: '00000000-0000-4000-8000-00000000dead',
    }).expect(409);
    expect(
      await adminDatabase.tenant.count({ where: { code: staleTenantCode } }),
    ).toBe(0);
    // Choosing a template without naming one is refused.
    await post('/api/v1/platform/tenants', {
      name: '未选模板公司',
      code: staleTenantCode,
      firstAdminPhone: tenantAdminPhone,
      initialization: 'TEMPLATE',
    }).expect(400);

    const created = await post('/api/v1/platform/tenants', {
      name: '模板创建公司',
      code: createdTenantCode,
      firstAdminPhone: tenantAdminPhone,
      initialization: 'TEMPLATE',
      ...first,
    }).expect(201);
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      initialization: { templateVersionNo: 1, objectCount: 2 },
    });
    const createdId = stringProperty(created.body, 'id');
    const customers = await adminDatabase.objectDefinition.findFirstOrThrow({
      where: { tenantId: createdId, code: 'customers' },
      include: { fields: true, views: true },
    });
    expect(customers).toMatchObject({
      status: 'DRAFT',
      activePublicationId: null,
    });
    // Deactivated options, defaults and search fields arrive as configured.
    expect(
      customers.fields.find((field) => field.fieldKey === 'grade'),
    ).toMatchObject({
      type: 'SINGLE_SELECT',
      defaultValue: 'b',
      config: {
        options: [
          { key: 'a', label: 'A 级', status: 'INACTIVE', color: 'BLUE' },
          { key: 'b', label: 'B 级', status: 'ACTIVE', color: 'GREEN' },
        ],
      },
    });
    // The designer stores search fields beside the columns in one JSON value.
    expect(customers.views[0].columnFieldKeys).toEqual({
      columnFieldKeys: ['name', 'phone'],
      searchFieldKeys: ['phone'],
    });
    // Nothing is visible to employees until the company admin publishes.
    expect(
      await adminDatabase.objectPublication.count({
        where: { tenantId: createdId },
      }),
    ).toBe(0);

    // Concurrent and repeated applications copy once.
    const race = await post('/api/v1/platform/tenants', {
      name: '并发应用公司',
      code: raceTenantCode,
      firstAdminPhone: tenantAdminPhone,
      initialization: 'BLANK',
    }).expect(201);
    const raceId = stringProperty(race.body, 'id');
    const applies = await Promise.all(
      [0, 1, 2].map(() =>
        post(
          `/api/v1/platform/business-templates/${first.templateId}/applications`,
          {
            tenantId: raceId,
            templateVersionId: first.templateVersionId,
          },
        ),
      ),
    );
    expect(applies.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(applies.map((r) => stringProperty(r.body, 'id'))).size).toBe(
      1,
    );
    expect(
      await adminDatabase.objectDefinition.count({
        where: { tenantId: raceId },
      }),
    ).toBe(2);

    // A company that already has tables is never overwritten by another template.
    const second = await publishTemplate(
      secondTemplateCode,
      twoObjectTemplateFixture,
    );
    const before = await adminDatabase.objectDefinition.findMany({
      where: { tenantId: raceId },
      select: { id: true, version: true },
      orderBy: { id: 'asc' },
    });
    const refused = await post(
      `/api/v1/platform/business-templates/${second.templateId}/applications`,
      { tenantId: raceId, templateVersionId: second.templateVersionId },
    ).expect(409);
    expect(JSON.stringify(refused.body)).toContain('已经存在业务对象');
    expect(
      await adminDatabase.objectDefinition.findMany({
        where: { tenantId: raceId },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
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

  async function acceptInvitation(agent: Agent, tenantId: string) {
    const response = await agent.get('/api/v1/me/invitations').expect(200);
    const body: unknown = response.body;
    if (!isUnknownArray(body)) {
      throw new Error('Expected invitation list');
    }
    const invitation = body.find(
      (candidate: unknown) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        Reflect.get(candidate, 'tenantId') === tenantId &&
        Reflect.get(candidate, 'status') === 'PENDING',
    );
    const invitationId = stringProperty(invitation, 'id');
    await agent
      .post(`/api/v1/me/invitations/${invitationId}/accept`)
      .set('Origin', origin)
      .expect(201);
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
  const tenants = await database.tenant.findMany({
    where: {
      code: {
        in: [
          tenantCode,
          activeTenantCode,
          createdTenantCode,
          staleTenantCode,
          raceTenantCode,
        ],
      },
    },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const templates = await database.businessTemplate.findMany({
    where: {
      code: { in: [templateCode, invalidTemplateCode, secondTemplateCode] },
    },
    select: { id: true },
  });
  const users = await database.user.findMany({
    where: {
      phone: {
        in: [platformPhone, regularPhone, tenantAdminPhone, employeePhone].map(
          normalized,
        ),
      },
    },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);

  if (tenantIds.length > 0) {
    await database.auditLog.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.record.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.recordCounter.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.businessTemplateApplication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await database.fieldPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectPermission.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.viewDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.fieldDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.objectDefinition.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenantInvitation.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenantMember.deleteMany({
      where: { tenantId: { in: tenantIds } },
    });
    await database.tenant.deleteMany({ where: { id: { in: tenantIds } } });
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
        in: [platformPhone, regularPhone, tenantAdminPhone, employeePhone].map(
          normalized,
        ),
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

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
