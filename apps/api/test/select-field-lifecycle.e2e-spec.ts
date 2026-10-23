import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createApp } from '../src/bootstrap';
import { hashSessionToken } from '../src/modules/auth/session.service';

const origin = 'http://localhost:3000';
const tenantCode = 'e2e-select-lifecycle';
const phones = ['+8613988813001', '+8613988813002'];

interface DraftResponse {
  object: { id: string; version: number; hasUnpublishedChanges: boolean };
  fields: Array<{
    id: string;
    fieldKey: string;
    publishedType: string | null;
    config: { options?: Array<{ key: string; status?: string }> };
  }>;
}
interface RecordResponse {
  id: string;
  title: string;
  version: number;
  values: Record<string, unknown>;
}
interface SchemaResponse {
  fields: Array<{
    fieldKey: string;
    config: { options?: Array<{ key: string; status?: string }> };
  }>;
}
interface ErrorResponse {
  code: string;
  fieldErrors: Record<string, string[]>;
}
interface AnalysisResponse {
  blocking: Array<{ code: string; fieldKey?: string }>;
}

/**
 * Single- and multi-select behaviour driven through the designer and record
 * APIs on a real database, on a table and fields named nothing like an order
 * status: values keep their shape, deactivated options stay on the records
 * that hold them, drafts reach employees only when published, and the publish
 * gate refuses configurations that would strand stored values or block creates.
 */
describe('select field lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let adminDatabase: PrismaClient;
  let fixture: { adminCookie: string; employeeCookie: string };
  let version: number;
  let objectId: string;

  const base = `/api/v1/workspaces/${tenantCode}`;
  const as =
    (cookie: () => string) =>
    (method: 'get' | 'post' | 'put' | 'patch', url: string) =>
      request(app.getHttpServer())
        [method](url)
        .set('Origin', origin)
        .set('Cookie', cookie());
  const admin = as(() => fixture.adminCookie);
  const employee = as(() => fixture.employeeCookie);
  const designer = (path = '') =>
    `${base}/object-definitions/${objectId}${path}`;

  async function draft(): Promise<DraftResponse> {
    const response = await admin('get', designer()).expect(200);
    const body = response.body as DraftResponse;
    version = body.object.version;
    return body;
  }
  async function patchField(fieldKey: string, body: Record<string, unknown>) {
    const field = (await draft()).fields.find((f) => f.fieldKey === fieldKey)!;
    const response = await admin('patch', designer(`/fields/${field.id}`))
      .send({ expectedVersion: version, ...body })
      .expect(200);
    version = (response.body as DraftResponse).object.version;
  }
  const publish = () =>
    admin('post', designer('/publications')).send({ expectedVersion: version });
  const analysis = async () =>
    (
      await admin('post', designer('/publication-analysis'))
        .send({ expectedVersion: version })
        .expect(200)
    ).body as AnalysisResponse;

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
    const created = await admin('post', `${base}/object-definitions`)
      .send({ name: '项目', code: 'projects' })
      .expect(201);
    objectId = (created.body as DraftResponse).object.id;
    version = (created.body as DraftResponse).object.version;
    const add = async (body: Record<string, unknown>) => {
      const response = await admin('post', designer('/fields'))
        .send({ expectedVersion: version, ...body })
        .expect(201);
      version = (response.body as DraftResponse).object.version;
    };
    await add({
      fieldKey: 'name',
      label: '项目名',
      type: 'TEXT',
      required: true,
    });
    await add({
      fieldKey: 'priority',
      label: '优先级',
      type: 'SINGLE_SELECT',
      required: false,
      config: {
        options: [
          { key: 'p1', label: '紧急', status: 'ACTIVE' },
          { key: 'p2', label: '普通', status: 'ACTIVE' },
        ],
      },
    });
    await add({
      fieldKey: 'labels',
      label: '标签',
      type: 'MULTI_SELECT',
      required: false,
      config: {
        options: [
          { key: 't1', label: '甲', status: 'ACTIVE' },
          { key: 't2', label: '乙', status: 'ACTIVE' },
          { key: 't3', label: '丙', status: 'ACTIVE' },
        ],
      },
    });
    let response = await admin('put', designer('/default-view'))
      .send({
        expectedVersion: version,
        name: '默认视图',
        columnFieldKeys: ['name', 'priority', 'labels'],
        sort: { field: 'updatedAt', direction: 'desc' },
      })
      .expect(200);
    version = (response.body as DraftResponse).object.version;
    response = await admin('put', designer('/permissions'))
      .send({
        expectedVersion: version,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
        fields: { name: 'EDIT', priority: 'EDIT', labels: 'EDIT' },
      })
      .expect(200);
    version = (response.body as DraftResponse).object.version;
    await publish().expect(201);
  });

  afterAll(async () => {
    await cleanup(adminDatabase);
    await app?.close();
    await adminDatabase?.$disconnect();
  });

  it('stores scalars and deduplicated arrays, and keeps deactivated values on records that hold them', async () => {
    const created = await employee('post', `${base}/objects/projects/records`)
      .send({
        values: {
          name: '官网改版',
          priority: 'p1',
          labels: ['t2', 't1', 't2'],
        },
      })
      .expect(201);
    let record = created.body as RecordResponse;
    expect(record.values).toMatchObject({
      priority: 'p1',
      labels: ['t1', 't2'],
    });

    // A scalar on a multi-select and an array on a single-select are refused.
    for (const values of [
      { name: '形状错误', labels: 't1' },
      { name: '形状错误', priority: ['p1'] },
    ]) {
      await employee('post', `${base}/objects/projects/records`)
        .send({ values })
        .expect(400);
    }

    // Deactivating in the draft changes nothing for employees until publish.
    await patchField('priority', {
      config: {
        options: [
          { key: 'p1', label: '紧急', status: 'INACTIVE' },
          { key: 'p2', label: '普通', status: 'ACTIVE' },
        ],
      },
    });
    await patchField('labels', {
      config: {
        options: [
          { key: 't1', label: '甲', status: 'INACTIVE' },
          { key: 't2', label: '乙', status: 'ACTIVE' },
          { key: 't3', label: '丙', status: 'ACTIVE' },
        ],
      },
    });
    expect((await draft()).object.hasUnpublishedChanges).toBe(true);
    const runtime = (
      await employee('get', `${base}/objects/projects/schema`).expect(200)
    ).body as SchemaResponse;
    expect(
      runtime.fields.find((f) => f.fieldKey === 'priority')!.config.options![0],
    ).toMatchObject({ key: 'p1', status: 'ACTIVE' });
    await employee('post', `${base}/objects/projects/records`)
      .send({ values: { name: '发布前仍可选', priority: 'p1' } })
      .expect(201);

    await publish().expect(201);

    // New writes cannot pick the deactivated options...
    const refused = await employee('post', `${base}/objects/projects/records`)
      .send({ values: { name: '发布后', priority: 'p1' } })
      .expect(400);
    expect((refused.body as ErrorResponse).code).toBe('FIELD_OPTION_INACTIVE');

    // ...but editing another field while the form resubmits the stored values works.
    const edited = await employee(
      'patch',
      `${base}/objects/projects/records/${record.id}`,
    )
      .send({
        version: record.version,
        values: { name: '官网改版二期', priority: 'p1', labels: ['t1', 't2'] },
      })
      .expect(200);
    record = edited.body as RecordResponse;
    expect(record.values).toMatchObject({
      name: '官网改版二期',
      priority: 'p1',
      labels: ['t1', 't2'],
    });

    // Adding an active option keeps the stored deactivated one.
    record = (
      await employee('patch', `${base}/objects/projects/records/${record.id}`)
        .send({ version: record.version, values: { labels: ['t3', 't1'] } })
        .expect(200)
    ).body as RecordResponse;
    expect(record.values.labels).toEqual(['t1', 't3']);

    // Once removed from the record, the deactivated option cannot come back.
    record = (
      await employee('patch', `${base}/objects/projects/records/${record.id}`)
        .send({ version: record.version, values: { labels: ['t3'] } })
        .expect(200)
    ).body as RecordResponse;
    await employee('patch', `${base}/objects/projects/records/${record.id}`)
      .send({ version: record.version, values: { labels: ['t3', 't1'] } })
      .expect(400);
  });

  it('keeps published option keys protected after a field is retired and restored', async () => {
    await employee('post', `${base}/objects/projects/records`)
      .send({ values: { name: '历史标签', labels: ['t1'] } })
      .expect(201);
    await patchField('labels', { status: 'INACTIVE' });
    await publish().expect(201);
    await patchField('labels', {
      status: 'ACTIVE',
      config: { options: [{ key: 't2', label: '乙', status: 'ACTIVE' }] },
    });
    expect((await analysis()).blocking).toContainEqual(
      expect.objectContaining({
        code: 'FIELD_OPTION_REMOVED',
        fieldKey: 'labels',
      }),
    );
    await publish().expect(422);
  });

  it('replaces cached titles when publishing a new title field or option label', async () => {
    await patchField('priority', { required: true });
    await publish().expect(201);
    const record = (
      await employee('post', `${base}/objects/projects/records`)
        .send({ values: { name: 'private-former-title', priority: 'p1' } })
        .expect(201)
    ).body as RecordResponse;
    const changed = await admin('patch', designer())
      .send({ expectedVersion: version, titleFieldKey: 'priority' })
      .expect(200);
    version = (changed.body as DraftResponse).object.version;
    await patchField('name', { required: false });
    const permissions = await admin('put', designer('/permissions'))
      .send({
        expectedVersion: version,
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
        fields: { name: 'HIDDEN', priority: 'EDIT', labels: 'EDIT' },
      })
      .expect(200);
    version = (permissions.body as DraftResponse).object.version;
    await publish().expect(201);
    const detail = (
      await employee(
        'get',
        `${base}/objects/projects/records/${record.id}`,
      ).expect(200)
    ).body as RecordResponse;
    expect(detail.values).not.toHaveProperty('name');
    expect(detail.title).toBe('紧急');
    const newSearch = await employee('get', `${base}/objects/projects/records`)
      .query({ search: '紧急' })
      .expect(200);
    expect(
      (newSearch.body as { items: RecordResponse[] }).items.map(
        (item) => item.id,
      ),
    ).toEqual([record.id]);
    const oldSearch = await employee('get', `${base}/objects/projects/records`)
      .query({ search: 'private-former-title' })
      .expect(200);
    expect((oldSearch.body as { items: unknown[] }).items).toEqual([]);
    const exported = await employee(
      'get',
      `${base}/objects/projects/records/export`,
    ).expect(200);
    expect(exported.text).toContain('紧急');
    expect(exported.text).not.toContain('private-former-title');
    await patchField('priority', {
      config: {
        options: [
          { key: 'p1', label: '高优先级', status: 'ACTIVE' },
          { key: 'p2', label: '普通', status: 'ACTIVE' },
        ],
      },
    });
    await publish().expect(201);
    const relabeled = await employee(
      'get',
      `${base}/objects/projects/records/${record.id}`,
    ).expect(200);
    expect((relabeled.body as RecordResponse).title).toBe('高优先级');
    expect((relabeled.body as RecordResponse).version).toBe(record.version);
  });

  it('rolls back title refresh and publication when an existing new title is too long', async () => {
    const added = await admin('post', designer('/fields'))
      .send({
        expectedVersion: version,
        fieldKey: 'email',
        label: '邮箱',
        type: 'EMAIL',
        required: true,
      })
      .expect(201);
    version = (added.body as DraftResponse).object.version;
    const permissions = await admin('put', designer('/permissions'))
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
          priority: 'EDIT',
          labels: 'EDIT',
          email: 'EDIT',
        },
      })
      .expect(200);
    version = (permissions.body as DraftResponse).object.version;
    await publish().expect(201);
    const longEmail = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(43)}.com`;
    const records: RecordResponse[] = [];
    for (const email of ['short@example.com', longEmail]) {
      records.push(
        (
          await employee('post', `${base}/objects/projects/records`)
            .send({ values: { name: '原标题', email } })
            .expect(201)
        ).body as RecordResponse,
      );
    }
    const publicationCount = await adminDatabase.objectPublication.count({
      where: { objectId },
    });
    const changed = await admin('patch', designer())
      .send({ expectedVersion: version, titleFieldKey: 'email' })
      .expect(200);
    version = (changed.body as DraftResponse).object.version;
    const refused = await publish().expect(422);
    expect((refused.body as ErrorResponse).code).toBe('PUBLICATION_BLOCKED');
    expect(
      await adminDatabase.objectPublication.count({ where: { objectId } }),
    ).toBe(publicationCount);
    for (const record of records) {
      const detail = await employee(
        'get',
        `${base}/objects/projects/records/${record.id}`,
      ).expect(200);
      expect((detail.body as RecordResponse).title).toBe('原标题');
      expect((detail.body as RecordResponse).version).toBe(record.version);
    }
  });

  it('refuses to publish a deleted published option, a select with no active option or an invalid default', async () => {
    await patchField('labels', {
      config: {
        options: [
          { key: 't1', label: '甲', status: 'ACTIVE' },
          { key: 't3', label: '丙', status: 'ACTIVE' },
        ],
      },
    });
    expect((await analysis()).blocking).toContainEqual(
      expect.objectContaining({
        code: 'FIELD_OPTION_REMOVED',
        fieldKey: 'labels',
      }),
    );
    await publish().expect(422);

    await patchField('labels', {
      config: {
        options: ['t1', 't2', 't3'].map((key) => ({
          key,
          label: key,
          status: 'INACTIVE',
        })),
      },
    });
    expect((await analysis()).blocking.map((issue) => issue.code)).toContain(
      'FIELD_OPTIONS_REQUIRED',
    );
    await publish().expect(422);

    await patchField('labels', {
      config: {
        options: ['t1', 't2', 't3'].map((key) => ({
          key,
          label: key,
          status: key === 't1' ? 'INACTIVE' : 'ACTIVE',
        })),
      },
      defaultValue: ['t1'],
    });
    expect((await analysis()).blocking.map((issue) => issue.code)).toContain(
      'FIELD_DEFAULT_VALUE_INVALID',
    );
    await publish().expect(422);

    // A published select cannot switch between single and multiple.
    const labels = (await draft()).fields.find((f) => f.fieldKey === 'labels')!;
    expect(labels.publishedType).toBe('MULTI_SELECT');
    await admin('patch', designer(`/fields/${labels.id}`))
      .send({ expectedVersion: version, type: 'SINGLE_SELECT' })
      .expect(400);

    await patchField('labels', { defaultValue: ['t2'] });
    await publish().expect(201);
  });
});

async function provision(database: PrismaClient) {
  const now = new Date();
  const tenant = await database.tenant.create({
    data: {
      name: '选择字段测试公司',
      code: tenantCode,
      status: 'ACTIVE',
      activatedAt: now,
    },
  });
  const [adminUser, employeeUser] = await Promise.all(
    phones.map((phone, index) =>
      database.user.create({
        data: {
          displayName: `选择字段用户 ${index + 1}`,
          phone,
          phoneVerifiedAt: now,
          passwordHash: 'not-used-by-direct-session-fixture',
          status: 'ACTIVE',
        },
      }),
    ),
  );
  await database.tenantMember.createMany({
    data: [
      {
        tenantId: tenant.id,
        userId: adminUser.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        joinedAt: now,
      },
      {
        tenantId: tenant.id,
        userId: employeeUser.id,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        joinedAt: now,
      },
    ],
  });
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  await database.session.createMany({
    data: [
      {
        userId: adminUser.id,
        tokenHash: hashSessionToken('e2e-select-admin'),
        expiresAt,
      },
      {
        userId: employeeUser.id,
        tokenHash: hashSessionToken('e2e-select-employee'),
        expiresAt,
      },
    ],
  });
  return {
    adminCookie: 'crm_session=e2e-select-admin',
    employeeCookie: 'crm_session=e2e-select-employee',
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
