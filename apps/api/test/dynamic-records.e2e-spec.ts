import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@crm/database';
import request from 'supertest';
import type { App } from 'supertest/types';

import { FollowUpsRepository } from '../src/modules/follow-ups/follow-ups.repository';
import { PublishedObjectService } from '../src/modules/objects/published-object.service';
import type { RecordImportResponse } from '../src/modules/records/records.service';
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

interface MemberObjectAccessApiResponse {
  mode: 'INHERIT' | 'OVERRIDE';
  override: Record<string, unknown> | null;
  effective: Record<string, unknown>;
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

    const accessPath = `/api/v1/workspaces/${tenantCode}/members/${fixture.employeeMemberId}/object-access/${fixture.objectId}`;
    await request(app.getHttpServer())
      .put(accessPath)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({
        mode: 'OVERRIDE',
        canCreate: false,
        canRead: false,
        canUpdate: false,
        readScope: 'NONE',
        updateScope: 'NONE',
      })
      .expect(200)
      .expect((response) => {
        const body = parseMemberObjectAccess(response.body as unknown);
        expect(body).toMatchObject({
          mode: 'OVERRIDE',
          effective: { canRead: false, readScope: 'NONE' },
        });
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/schema`)
      .set('Cookie', fixture.employeeCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records`)
      .set('Cookie', fixture.employeeCookie)
      .expect(403);

    await request(app.getHttpServer())
      .put(accessPath)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({ mode: 'INHERIT' })
      .expect(200)
      .expect((response) => {
        const body = parseMemberObjectAccess(response.body as unknown);
        expect(body).toMatchObject({
          mode: 'INHERIT',
          override: null,
          effective: { canRead: true, readScope: 'OWN' },
        });
      });
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/schema`)
      .set('Cookie', fixture.employeeCookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records`)
      .set('Cookie', fixture.employeeCookie)
      .expect(200);

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

  it('replays concurrent CSV batches and retries corrected failures without duplicate records', async () => {
    const batchId = '83a0532e-857d-441d-8cab-b7ef0e47d4b0';
    const run = (rows: unknown[]) =>
      request(app.getHttpServer())
        .post(
          `/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records/import`,
        )
        .set('Cookie', fixture.adminCookie)
        .set('Origin', origin)
        .send({ batchId, rows })
        .expect(201);
    const rows = [
      { rowNumber: 2, values: { name: 'CSV success' } },
      { rowNumber: 3, values: {} },
    ];
    const results = await Promise.all([run(rows), run(rows)]);
    const [first, replay] = results.map(
      (response) => response.body as RecordImportResponse,
    );
    expect(first).toMatchObject({ created: 1, failed: 1 });
    expect(first.items[0].record?.id).toBe(replay.items[0].record?.id);
    expect(
      await adminDatabase.record.count({
        where: { tenantId: fixture.tenantId },
      }),
    ).toBe(1);
    const corrected = await run([
      { rowNumber: 2, values: { name: 'Changed' } },
      { rowNumber: 3, values: { name: 'Fixed' } },
    ]);
    const correctedResult = corrected.body as RecordImportResponse;
    expect(correctedResult.failed).toBe(0);
    expect(correctedResult.items[0].record?.title).toBe('CSV success');
    expect(
      await adminDatabase.record.count({
        where: { tenantId: fixture.tenantId },
      }),
    ).toBe(2);
  });

  it('rechecks record ownership within follow-up writes and fails closed with no scopes', async () => {
    const record = await createRecord(fixture.employeeCookie, {
      values: { name: 'Follow-up race' },
    });
    const base = `/api/v1/workspaces/${tenantCode}/follow-ups`;
    const body = {
      objectCode,
      recordId: record.id,
      title: 'Call',
      dueAt: '2026-09-10T08:00:00Z',
    };
    const post = () =>
      request(app.getHttpServer())
        .post(base)
        .set('Cookie', fixture.employeeCookie)
        .set('Origin', origin)
        .send(body);
    const repository = app.get(FollowUpsRepository);
    const original = repository.findRecord.bind(repository);
    const transferDuringCheck = () =>
      jest
        .spyOn(repository, 'findRecord')
        .mockImplementationOnce(async (...args) => {
          const checked = await original(...args);
          await adminDatabase.record.update({
            where: { id: record.id },
            data: { ownerMemberId: fixture.otherMemberId },
          });
          return checked;
        });
    let spy = transferDuringCheck();
    await post().expect(404);
    spy.mockRestore();
    expect(
      await adminDatabase.recordFollowUp.count({
        where: { tenantId: fixture.tenantId },
      }),
    ).toBe(0);
    await adminDatabase.record.update({
      where: { id: record.id },
      data: { ownerMemberId: fixture.employeeMemberId },
    });
    const task = await post().expect(201);
    const taskId = (task.body as { id: string }).id;
    expect(typeof taskId).toBe('string');
    const nav = jest
      .spyOn(app.get(PublishedObjectService), 'listAccessible')
      .mockResolvedValueOnce([]);
    const empty = await request(app.getHttpServer())
      .get(base)
      .set('Cookie', fixture.employeeCookie)
      .expect(200);
    expect(empty.body).toMatchObject({
      items: [],
      total: 0,
      openCount: 0,
      overdueCount: 0,
    });
    nav.mockRestore();
    spy = transferDuringCheck();
    await request(app.getHttpServer())
      .patch(`${base}/${taskId}`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .send({ version: 1, status: 'DONE' })
      .expect(404);
    spy.mockRestore();
    const unchanged = await adminDatabase.recordFollowUp.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(unchanged).toMatchObject({ version: 1, status: 'OPEN' });
    await adminDatabase.record.update({
      where: { id: record.id },
      data: { ownerMemberId: fixture.employeeMemberId },
    });
    const complete = () =>
      request(app.getHttpServer())
        .patch(`${base}/${taskId}`)
        .set('Cookie', fixture.employeeCookie)
        .set('Origin', origin)
        .send({ version: 1, status: 'DONE' });
    const completed = await Promise.all([complete(), complete()]);
    expect(completed.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    expect(
      await adminDatabase.auditLog.count({
        where: { resourceId: taskId, action: 'follow_up.completed' },
      }),
    ).toBe(1);
  });

  it('keeps attachments and related record titles within current record permissions', async () => {
    const owned = await createRecord(fixture.adminCookie, {
      values: { name: 'Attachment record' },
      ownerMemberId: fixture.employeeMemberId,
    });
    const other = await createRecord(fixture.adminCookie, {
      values: { name: 'Private related title' },
      ownerMemberId: fixture.otherMemberId,
    });
    const base = `/api/v1/workspaces/${tenantCode}/objects/${objectCode}/records/${owned.id}`;
    const uploaded = await request(app.getHttpServer())
      .post(`${base}/attachments`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .attach('file', Buffer.from('original attachment bytes'), 'notes.txt')
      .expect(201);
    const attachment = uploaded.body as { id: string };
    expect(typeof attachment.id).toBe('string');
    await request(app.getHttpServer())
      .get(`${base}/attachments/${attachment.id}`)
      .set('Cookie', fixture.employeeCookie)
      .expect(200)
      .expect('Content-Type', /application\/octet-stream/)
      .expect('Cache-Control', 'private, no-store');
    await request(app.getHttpServer())
      .post(`${base}/relations`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .send({ objectCode, recordId: other.id })
      .expect(404);
    await request(app.getHttpServer())
      .post(`${base}/relations`)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({ objectCode, recordId: other.id })
      .expect(201);
    await request(app.getHttpServer())
      .get(`${base}/relations`)
      .set('Cookie', fixture.employeeCookie)
      .expect(200)
      .expect([]);
    await request(app.getHttpServer())
      .post(`${base}/attachments`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .attach('file', Buffer.from('no'), 'program.exe')
      .expect(400);
    await adminDatabase.record.update({
      where: { id: owned.id },
      data: { ownerMemberId: fixture.otherMemberId },
    });
    await request(app.getHttpServer())
      .get(`${base}/attachments/${attachment.id}`)
      .set('Cookie', fixture.employeeCookie)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${base}/attachments/${attachment.id}`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`${base}/attachments/${attachment.id}`)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .expect(204);
    await request(app.getHttpServer())
      .get(`${base}/attachments/${attachment.id}`)
      .set('Cookie', fixture.adminCookie)
      .expect(404);
  });

  it('hands over owned records and open tasks before disabling a member', async () => {
    const owned = await createRecord(fixture.adminCookie, {
      values: { name: 'Handover record' },
      ownerMemberId: fixture.employeeMemberId,
    });
    await request(app.getHttpServer())
      .post(`/api/v1/workspaces/${tenantCode}/follow-ups`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .send({
        objectCode,
        recordId: owned.id,
        title: 'Handover task',
        dueAt: '2026-10-01T08:00:00.000Z',
      })
      .expect(201);
    const base = `/api/v1/workspaces/${tenantCode}/members/${fixture.employeeMemberId}`;
    await request(app.getHttpServer())
      .patch(base)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({ status: 'DISABLED' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`${base}/offboarding`)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({ recipientMemberId: fixture.adminMemberId })
      .expect(201)
      .expect({ records: 1, openTasks: 1 });
    const record = await adminDatabase.record.findUniqueOrThrow({
      where: { id: owned.id },
    });
    expect(record.ownerMemberId).toBe(fixture.adminMemberId);
    expect(
      await adminDatabase.recordFollowUp.count({
        where: {
          recordId: owned.id,
          assigneeMemberId: fixture.adminMemberId,
          status: 'OPEN',
        },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get(`/api/v1/workspaces/${tenantCode}/follow-ups`)
      .set('Cookie', fixture.employeeCookie)
      .expect(403);
  });

  it('allows the sole admin to hand over to an employee without leaving no administrator', async () => {
    const root = `/api/v1/workspaces/${tenantCode}/members`;
    await request(app.getHttpServer())
      .post(`${root}/admin-handoff`)
      .set('Cookie', fixture.adminCookie)
      .set('Origin', origin)
      .send({ recipientMemberId: fixture.employeeMemberId })
      .expect(201);
    await request(app.getHttpServer())
      .get(root)
      .set('Cookie', fixture.adminCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(root)
      .set('Cookie', fixture.employeeCookie)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${root}/${fixture.employeeMemberId}/role`)
      .set('Cookie', fixture.employeeCookie)
      .set('Origin', origin)
      .send({ role: 'EMPLOYEE' })
      .expect(409);
    expect(
      await adminDatabase.tenantMember.count({
        where: {
          tenantId: fixture.tenantId,
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      }),
    ).toBe(1);
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

function parseMemberObjectAccess(
  value: unknown,
): MemberObjectAccessApiResponse {
  if (
    !isRecord(value) ||
    (value.mode !== 'INHERIT' && value.mode !== 'OVERRIDE') ||
    (value.override !== null && !isRecord(value.override)) ||
    !isRecord(value.effective)
  ) {
    throw new Error('Expected a member object access response');
  }
  return {
    mode: value.mode,
    override: value.override,
    effective: value.effective,
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
        id: randomUUID(),
        name: '动态记录测试公司',
        code: tenantCode,
        status: 'ACTIVE',
        activatedAt: now,
      },
    }),
    database.tenant.create({
      data: {
        id: randomUUID(),
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
          id: randomUUID(),
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
        id: randomUUID(),
        tenantId: tenant.id,
        userId: adminUser.id,
        role: 'TENANT_ADMIN',
        status: 'ACTIVE',
        joinedAt: now,
      },
    }),
    database.tenantMember.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        userId: employeeUser.id,
        role: 'EMPLOYEE',
        status: 'ACTIVE',
        joinedAt: now,
      },
    }),
    database.tenantMember.create({
      data: {
        id: randomUUID(),
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
        id: randomUUID(),
        userId: adminUser.id,
        tokenHash: hashSessionToken(adminToken),
        expiresAt,
      },
    }),
    database.session.create({
      data: {
        id: randomUUID(),
        userId: employeeUser.id,
        tokenHash: hashSessionToken(employeeToken),
        expiresAt,
      },
    }),
  ]);

  const object = await database.objectDefinition.create({
    data: {
      id: randomUUID(),
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
    for (const tenantId of tenantIds) {
      await database.$executeRaw`DELETE FROM record_attachments WHERE tenant_id = ${tenantId}::uuid`;
      await database.$executeRaw`DELETE FROM record_relations WHERE tenant_id = ${tenantId}::uuid`;
      await database.$executeRaw`DELETE FROM record_import_rows WHERE tenant_id = ${tenantId}::uuid`;
    }
    await database.recordFollowUp.deleteMany({
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
