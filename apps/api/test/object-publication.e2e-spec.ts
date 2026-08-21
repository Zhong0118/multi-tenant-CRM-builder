import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
import { hashSessionToken } from '../src/modules/auth/session.service';

const origin = 'http://localhost:3000';
const tenantCode = 'e2e-publication-company';
const phones = ['+8613988812001', '+8613988812002'];

interface Fixture {
  tenantId: string;
  adminCookie: string;
  employeeCookie: string;
  employeeMemberId: string;
}

interface AnalysisResponse {
  blocking: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  changes: Array<{ kind: string; fieldKey: string }>;
}

interface PublicationResponse {
  number: number;
  sourceDraftVersion: number;
}

interface NavigationResponse {
  code: string;
  canCreate: boolean;
  canRead: boolean;
}

interface RuntimeSchemaResponse {
  object: { name: string };
  publication: { number: number };
  fields: Array<{ fieldKey: string; access: string }>;
  scopes: { read: string; update: string };
}

interface RecordResponse {
  recordNo: string;
  title: string;
  ownerMemberId: string | null;
  values: Record<string, unknown>;
}

interface DraftResponse {
  object: {
    id: string;
    version: number;
    status: string;
    publicationNumber: number | null;
    hasUnpublishedChanges: boolean;
  };
  fields: Array<{
    fieldKey: string;
    publishedType: string | null;
    employeeAccess: string;
  }>;
}

/**
 * The record suite seeds a publication straight into the database, so nothing
 * proved that the designer's own configuration chain produces a snapshot the
 * runtime can serve. This drives that chain over HTTP end to end.
 */
describe('Object publication chain (e2e)', () => {
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

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app?.close();
    await adminDatabase?.$disconnect();
  });

  it('configures, publishes and then serves an object employees can use', async () => {
    const server = app.getHttpServer();
    const base = `/api/v1/workspaces/${tenantCode}`;
    const admin = (method: 'post' | 'put' | 'get' | 'patch', url: string) =>
      request(server)
        [method](url)
        .set('Origin', origin)
        .set('Cookie', fixture.adminCookie);

    // An object with no fields cannot be published.
    const created = await admin('post', `${base}/object-definitions`)
      .send({ name: '客户资料', code: 'customers' })
      .expect(201);
    const objectId = (created.body as DraftResponse).object.id;
    expect((created.body as DraftResponse).object.status).toBe('DRAFT');
    expect((created.body as DraftResponse).object.publicationNumber).toBeNull();

    const emptyAnalysis = await admin(
      'post',
      `${base}/object-definitions/${objectId}/publication-analysis`,
    )
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(
      (emptyAnalysis.body as AnalysisResponse).blocking.length,
    ).toBeGreaterThan(0);

    await admin('post', `${base}/object-definitions/${objectId}/publications`)
      .send({ expectedVersion: 1 })
      .expect(422);

    // Configure a title field, a read-only field and a hidden field.
    let version = 1;
    const addField = async (body: Record<string, unknown>) => {
      const response = await admin(
        'post',
        `${base}/object-definitions/${objectId}/fields`,
      )
        .send({ expectedVersion: version, ...body })
        .expect(201);
      version = (response.body as DraftResponse).object.version;
      return response.body as DraftResponse;
    };

    await addField({
      fieldKey: 'name',
      label: '客户名称',
      type: 'TEXT',
      required: true,
    });
    await addField({
      fieldKey: 'amount',
      label: '合同金额',
      type: 'MONEY',
      required: false,
      validation: { scale: 2 },
    });
    await addField({
      fieldKey: 'rating',
      label: '客户评级',
      type: 'SINGLE_SELECT',
      required: false,
      config: { options: [{ key: 'gold', label: '金牌' }] },
    });
    const withFields = await addField({
      fieldKey: 'internal_score',
      label: '内部评分',
      type: 'NUMBER',
      required: false,
    });
    expect(
      withFields.fields.every((field) => field.publishedType === null),
    ).toBe(true);

    const viewed = await admin(
      'put',
      `${base}/object-definitions/${objectId}/default-view`,
    )
      .send({
        expectedVersion: version,
        name: '默认视图',
        columnFieldKeys: ['name', 'amount', 'rating'],
        sort: { field: 'updatedAt', direction: 'desc' },
      })
      .expect(200);
    version = (viewed.body as DraftResponse).object.version;

    const permitted = await admin(
      'put',
      `${base}/object-definitions/${objectId}/permissions`,
    )
      .send({
        expectedVersion: version,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
        fields: {
          name: 'EDIT',
          amount: 'EDIT',
          rating: 'READ_ONLY',
          internal_score: 'HIDDEN',
        },
      })
      .expect(200);
    version = (permitted.body as DraftResponse).object.version;

    // A stale expected version must not publish.
    await admin('post', `${base}/object-definitions/${objectId}/publications`)
      .send({ expectedVersion: version - 1 })
      .expect(409);

    const published = await admin(
      'post',
      `${base}/object-definitions/${objectId}/publications`,
    )
      .send({ expectedVersion: version })
      .expect(201);
    const publication = published.body as PublicationResponse;
    expect(publication.number).toBe(1);
    expect(publication.sourceDraftVersion).toBe(version);

    const afterPublish = await admin(
      'get',
      `${base}/object-definitions/${objectId}`,
    ).expect(200);
    const draft = afterPublish.body as DraftResponse;
    expect(draft.object.status).toBe('ACTIVE');
    expect(draft.object.publicationNumber).toBe(1);
    expect(draft.object.hasUnpublishedChanges).toBe(false);
    // A published field's type is locked from here on.
    expect(draft.fields.map((field) => field.publishedType)).toEqual([
      'TEXT',
      'MONEY',
      'SINGLE_SELECT',
      'NUMBER',
    ]);

    // The employee now sees the object, without the hidden field.
    const employee = (method: 'get' | 'post', url: string) =>
      request(server)
        [method](url)
        .set('Origin', origin)
        .set('Cookie', fixture.employeeCookie);

    const navigation = await employee('get', `${base}/objects`).expect(200);
    const objects = navigation.body as NavigationResponse[];
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      code: 'customers',
      canCreate: true,
      canRead: true,
    });

    const schema = await employee(
      'get',
      `${base}/objects/customers/schema`,
    ).expect(200);
    const runtime = schema.body as RuntimeSchemaResponse;
    expect(runtime.fields.map((field) => field.fieldKey)).toEqual([
      'name',
      'amount',
      'rating',
    ]);
    expect(runtime.scopes).toEqual({ read: 'OWN', update: 'OWN' });

    // The published snapshot drives validation: money is normalized, a hidden
    // field cannot be forged, and a read-only field cannot be written.
    const record = await employee('post', `${base}/objects/customers/records`)
      .send({ values: { name: '验证客户', amount: '1200.5' } })
      .expect(201);
    const createdRecord = record.body as RecordResponse;
    expect(createdRecord.values.amount).toBe('1200.50');
    expect(createdRecord.recordNo).toBe('1');
    expect(createdRecord.title).toBe('验证客户');
    expect(createdRecord.ownerMemberId).toBe(fixture.employeeMemberId);

    await employee('post', `${base}/objects/customers/records`)
      .send({ values: { name: '越权', internal_score: 9 } })
      .expect(403);
    await employee('post', `${base}/objects/customers/records`)
      .send({ values: { name: '越权', rating: 'gold' } })
      .expect(403);

    // Editing the draft again must not disturb the version employees use.
    const renamed = await admin(
      'patch',
      `${base}/object-definitions/${objectId}`,
    )
      .send({ expectedVersion: version, name: '客户档案' })
      .expect(200);
    expect((renamed.body as DraftResponse).object.hasUnpublishedChanges).toBe(
      true,
    );
    expect((renamed.body as DraftResponse).object.publicationNumber).toBe(1);

    const unchanged = await employee(
      'get',
      `${base}/objects/customers/schema`,
    ).expect(200);
    const live = unchanged.body as RuntimeSchemaResponse;
    expect(live.object.name).toBe('客户资料');
    expect(live.publication.number).toBe(1);
  });
});

async function provision(database: PrismaClient): Promise<Fixture> {
  const now = new Date();
  const tenant = await database.tenant.create({
    data: {
      name: '发布链路测试公司',
      code: tenantCode,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });

  const [adminUser, employeeUser] = await Promise.all(
    phones.map((phone, index) =>
      database.user.create({
        data: {
          displayName: `发布测试用户 ${index + 1}`,
          phone,
          phoneVerifiedAt: now,
          passwordHash: 'not-used-by-direct-session-fixture',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  const [adminMember, employeeMember] = await Promise.all([
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
  ]);
  void adminMember;

  const adminToken = 'e2e-publication-admin-token';
  const employeeToken = 'e2e-publication-employee-token';
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

  return {
    tenantId: tenant.id,
    adminCookie: `crm_session=${adminToken}`,
    employeeCookie: `crm_session=${employeeToken}`,
    employeeMemberId: employeeMember.id,
  };
}

async function cleanup(database: PrismaClient): Promise<void> {
  const tenants = await database.tenant.findMany({
    where: { code: tenantCode },
    select: { id: true },
  });
  const tenantIds = tenants.map(({ id }) => id);
  const users = await database.user.findMany({
    where: { phone: { in: phones } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);

  if (tenantIds.length > 0) {
    const where = { tenantId: { in: tenantIds } };
    await database.auditLog.deleteMany({ where });
    await database.record.deleteMany({ where });
    await database.recordCounter.deleteMany({ where });
    await database.objectDefinition.updateMany({
      where,
      data: { activePublicationId: null },
    });
    await database.objectPublication.deleteMany({ where });
    await database.fieldPermission.deleteMany({ where });
    await database.objectPermission.deleteMany({ where });
    await database.viewDefinition.deleteMany({ where });
    await database.fieldDefinition.deleteMany({ where });
    await database.objectDefinition.deleteMany({ where });
    await database.tenantMember.deleteMany({ where });
  }
  if (userIds.length > 0) {
    await database.session.deleteMany({ where: { userId: { in: userIds } } });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (tenantIds.length > 0) {
    await database.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for e2e tests`);
  return value;
}
