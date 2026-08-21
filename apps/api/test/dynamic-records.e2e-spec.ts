import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
import { hashSessionToken } from '../src/modules/auth/session.service';

const origin = 'http://localhost:3000';
const tenantCode = 'e2e-records-company';
const foreignTenantCode = 'e2e-records-foreign';
const objectCode = 'leads';
const phones = ['+8613988811001', '+8613988811002', '+8613988811003'];

interface Fixture {
  tenantId: string;
  objectId: string;
  adminCookie: string;
  employeeCookie: string;
  adminMemberId: string;
  employeeMemberId: string;
  otherMemberId: string;
}

interface RecordApiResponse {
  id: string;
  recordNo: string;
  ownerMemberId: string | null;
  values: Record<string, unknown>;
  version: number;
}

describe('Dynamic records API (e2e)', () => {
  let app: INestApplication<App>;
  let adminDatabase: PrismaClient;
  let fixture: Fixture;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DEV_VERIFICATION_CODE = '123456';
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
    fixture = await provision(adminDatabase);
  });

  it('enforces tenant, ownership, field access, counters, and versions', async () => {
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${foreignTenantCode}/objects/${objectCode}/records`,
      )
      .set('Cookie', fixture.employeeCookie)
      .expect(403);

    const owned = await createRecord(fixture.adminCookie, {
      values: {
        name: '员工自己的线索',
        email: 'owned@example.com',
        secret: '仅管理员可见',
      },
      ownerMemberId: fixture.employeeMemberId,
    });
    await createRecord(fixture.adminCookie, {
      values: { name: '其他员工的线索' },
      ownerMemberId: fixture.otherMemberId,
    });

    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records`)
      .set('Cookie', fixture.employeeCookie)
      .expect(200)
      .expect((response) => {
        const body = parseRecordPage(response.body as unknown);
        expect(body).toMatchObject({ total: 1 });
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: owned.id,
          ownerMemberId: fixture.employeeMemberId,
          values: {
            name: '员工自己的线索',
            email: 'owned@example.com',
          },
        });
        expect(body.items[0]?.values).not.toHaveProperty('secret');
      });

    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records/${owned.id}`,
      )
      .set('Cookie', fixture.employeeCookie)
      .expect(200)
      .expect((response) => {
        const body = parseRecordResponse(response.body as unknown);
        expect(body.values).toEqual({
          name: '员工自己的线索',
          email: 'owned@example.com',
        });
      });

    const otherRecord = await adminDatabase.record.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        objectId: fixture.objectId,
        ownerMemberId: fixture.otherMemberId,
      },
    });
    await request(app.getHttpServer())
      .get(
        `/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records/${otherRecord.id}`,
      )
      .set('Cookie', fixture.employeeCookie)
      .expect(404);

    await createRecord(
      fixture.employeeCookie,
      {
        values: { name: '不可填写只读邮箱', email: 'blocked@example.com' },
      },
      403,
    );
    await createRecord(
      fixture.employeeCookie,
      { values: { name: '不可填写隐藏字段', secret: 'blocked' } },
      403,
    );
    const employeeCreated = await createRecord(fixture.employeeCookie, {
      values: { name: '员工新线索' },
      ownerMemberId: fixture.otherMemberId,
    });
    expect(employeeCreated.ownerMemberId).toBe(fixture.employeeMemberId);

    const [concurrentA, concurrentB] = await Promise.all([
      createRecord(fixture.adminCookie, {
        values: { name: '并发线索 A' },
        ownerMemberId: fixture.adminMemberId,
      }),
      createRecord(fixture.adminCookie, {
        values: { name: '并发线索 B' },
        ownerMemberId: fixture.adminMemberId,
      }),
    ]);
    const concurrentNumbers = [
      BigInt(concurrentA.recordNo),
      BigInt(concurrentB.recordNo),
    ].sort((left, right) => (left < right ? -1 : 1));
    expect(concurrentNumbers[0]).not.toBe(concurrentNumbers[1]);
    expect(concurrentNumbers[1] - concurrentNumbers[0]).toBe(1n);

    const updatePath = `/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records/${employeeCreated.id}`;
    const concurrentUpdates = await Promise.all([
      request(app.getHttpServer())
        .patch(updatePath)
        .set('Cookie', fixture.employeeCookie)
        .set('Origin', origin)
        .send({ version: employeeCreated.version, values: { name: '更新 A' } }),
      request(app.getHttpServer())
        .patch(updatePath)
        .set('Cookie', fixture.employeeCookie)
        .set('Origin', origin)
        .send({ version: employeeCreated.version, values: { name: '更新 B' } }),
    ]);
    expect(concurrentUpdates.map(({ status }) => status).sort()).toEqual([
      200, 409,
    ]);

    const stored = await adminDatabase.record.findUniqueOrThrow({
      where: { id: owned.id },
    });
    expect(stored.data).toMatchObject({ secret: '仅管理员可见' });
    const audit = await adminDatabase.auditLog.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        action: 'record.created',
        resourceId: owned.id,
      },
    });
    expect(audit.after).toMatchObject({
      values: { secret: '仅管理员可见' },
    });
  });

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app.close();
    await adminDatabase.$disconnect();
  });

  async function createRecord(
    cookie: string,
    body: {
      values: Record<string, unknown>;
      ownerMemberId?: string;
    },
    expectedStatus = 201,
  ): Promise<RecordApiResponse> {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body)
      .expect(expectedStatus);
    if (expectedStatus !== 201) return emptyRecordResponse();
    return parseRecordResponse(response.body as unknown);
  }
});

function parseRecordPage(value: unknown): {
  items: RecordApiResponse[];
  total: number;
} {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.total !== 'number'
  ) {
    throw new Error('Expected a record page response');
  }
  return { items: value.items.map(parseRecordResponse), total: value.total };
}

function parseRecordResponse(value: unknown): RecordApiResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.recordNo !== 'string' ||
    (value.ownerMemberId !== null && typeof value.ownerMemberId !== 'string') ||
    !isRecord(value.values) ||
    typeof value.version !== 'number'
  ) {
    throw new Error('Expected a record response');
  }
  return {
    id: value.id,
    recordNo: value.recordNo,
    ownerMemberId: value.ownerMemberId,
    values: value.values,
    version: value.version,
  };
}

function emptyRecordResponse(): RecordApiResponse {
  return { id: '', recordNo: '0', ownerMemberId: null, values: {}, version: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function provision(database: PrismaClient): Promise<Fixture> {
  const now = new Date();
  const [tenant, foreignTenant] = await Promise.all([
    database.tenant.create({
      data: {
        name: '动态记录测试公司',
        code: tenantCode,
        status: 'ACTIVE',
        activatedAt: now,
      },
    }),
    database.tenant.create({
      data: {
        name: '其他测试公司',
        code: foreignTenantCode,
        status: 'ACTIVE',
        activatedAt: now,
      },
    }),
  ]);
  void foreignTenant;

  const [adminUser, employeeUser, otherUser] = await Promise.all(
    phones.map((phone, index) =>
      database.user.create({
        data: {
          displayName: `记录测试用户 ${index + 1}`,
          phone,
          phoneVerifiedAt: now,
          passwordHash: 'not-used-by-direct-session-fixture',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const [adminMember, employeeMember, otherMember] = await Promise.all([
    database.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: adminUser.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        joinedAt: now,
      },
    }),
    database.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: employeeUser.id,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        joinedAt: now,
      },
    }),
    database.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: otherUser.id,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        joinedAt: now,
      },
    }),
  ]);

  const adminToken = 'e2e-records-admin-token';
  const employeeToken = 'e2e-records-employee-token';
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  await Promise.all([
    database.session.create({
      data: {
        userId: adminUser.id,
        tokenHash: hashSessionToken(adminToken),
        expiresAt,
      },
    }),
    database.session.create({
      data: {
        userId: employeeUser.id,
        tokenHash: hashSessionToken(employeeToken),
        expiresAt,
      },
    }),
  ]);

  const object = await database.objectDefinition.create({
    data: {
      tenantId: tenant.id,
      name: '销售线索',
      code: objectCode,
      titleFieldKey: 'name',
      status: 'DRAFT',
      version: 4,
    },
  });
  const fieldIds = {
    name: crypto.randomUUID(),
    email: crypto.randomUUID(),
    secret: crypto.randomUUID(),
  };
  const publicationId = crypto.randomUUID();
  const configuration = {
    publication: {
      id: publicationId,
      number: 1,
      sourceDraftVersion: 4,
      publishedAt: now.toISOString(),
    },
    object: {
      id: object.id,
      code: objectCode,
      name: '销售线索',
      description: null,
      titleFieldKey: 'name',
      icon: null,
      sortOrder: 0,
    },
    fields: [
      publishedField(fieldIds.name, 'name', '姓名', 'TEXT', true, 10),
      publishedField(fieldIds.email, 'email', '邮箱', 'EMAIL', false, 20),
      publishedField(
        fieldIds.secret,
        'secret',
        '内部备注',
        'TEXTAREA',
        false,
        30,
      ),
    ],
    defaultView: {
      code: 'default',
      name: '全部线索',
      columnFieldKeys: ['name', 'email'],
      sort: { field: 'updatedAt', direction: 'desc' },
    },
    employeeAccess: {
      canCreate: true,
      canRead: true,
      canUpdate: true,
      canDelete: false,
      readScope: 'OWN',
      updateScope: 'OWN',
      fields: { name: 'EDIT', email: 'READ_ONLY', secret: 'HIDDEN' },
    },
  };
  await database.objectPublication.create({
    data: {
      id: publicationId,
      tenantId: tenant.id,
      objectId: object.id,
      publicationNo: 1,
      sourceDraftVersion: 4,
      configuration,
      changeSummary: {},
      publishedByMemberId: adminMember.id,
      publishedAt: now,
    },
  });
  await database.objectDefinition.update({
    where: { id: object.id },
    data: {
      activePublicationId: publicationId,
      status: 'ACTIVE',
      publishedAt: now,
    },
  });

  return {
    tenantId: tenant.id,
    objectId: object.id,
    adminCookie: `crm_session=${adminToken}`,
    employeeCookie: `crm_session=${employeeToken}`,
    adminMemberId: adminMember.id,
    employeeMemberId: employeeMember.id,
    otherMemberId: otherMember.id,
  };
}

function publishedField(
  id: string,
  fieldKey: string,
  label: string,
  type: 'TEXT' | 'EMAIL' | 'TEXTAREA',
  required: boolean,
  sortOrder: number,
) {
  return {
    id,
    fieldKey,
    label,
    type,
    required,
    defaultValue: null,
    validation: {},
    config: {},
    sortOrder,
    isSystem: false,
  };
}

async function cleanup(database: PrismaClient): Promise<void> {
  const tenants = await database.tenant.findMany({
    where: { code: { in: [tenantCode, foreignTenantCode] } },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const users = await database.user.findMany({
    where: { phone: { in: phones } },
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
    await database.objectDefinition.updateMany({
      where: { tenantId: { in: tenantIds } },
      data: { activePublicationId: null },
    });
    await database.objectPublication.deleteMany({
      where: { tenantId: { in: tenantIds } },
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
  await database.session.deleteMany({ where: { userId: { in: userIds } } });
  await database.user.deleteMany({ where: { id: { in: userIds } } });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
