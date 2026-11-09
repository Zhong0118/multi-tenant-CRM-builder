import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { PublishedObjectSchema } from '../src/modules/objects/object-schema';
import {
  createCriticalHarness,
  closeCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);
const origin = 'http://localhost:3000';

describe('create-only field permissions over HTTP', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let fields: PublishedObjectSchema['fields'];
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const records = () => `${base()}/objects/${f.object.code}/records`;
  const get = (path: string, actor: CriticalActor = f.employee) =>
    request(h.app.getHttpServer()).get(path).set('Cookie', actor.cookie);
  const post = (
    path: string,
    data: object,
    actor: CriticalActor = f.employee,
  ) =>
    request(h.app.getHttpServer())
      .post(path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(data);
  const patch = (
    path: string,
    data: object,
    actor: CriticalActor = f.employee,
  ) =>
    request(h.app.getHttpServer())
      .patch(path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(data);
  const setNameAccess = () =>
    patch(
      `${base()}/objects/${f.object.id}/member-access`,
      {
        memberIds: [f.employee.memberId],
        fields: [
          {
            fieldId: fields.find((field) => field.fieldKey === 'name')!.id,
            access: 'CREATE_ONLY',
          },
        ],
      },
      f.admin,
    );

  beforeAll(async () => {
    // The shared fixture deletes its own tenant data; never run against a live DB.
    for (const key of ['TEST_DATABASE_URL', 'TEST_DATABASE_ADMIN_URL']) {
      const url = new URL(process.env[key] ?? '');
      expect(['localhost', '127.0.0.1', '[::1]']).toContain(url.hostname);
      expect(url.pathname).toMatch(/^\/[a-z0-9_]*test[a-z0-9_]*$/i);
    }
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
    const publication =
      await h.adminDatabase.objectPublication.findFirstOrThrow({
        where: { objectId: f.object.id },
      });
    const schema =
      publication.configuration as unknown as PublishedObjectSchema;
    fields = schema.fields;
    for (const field of fields) {
      await h.adminDatabase.fieldDefinition.create({
        data: {
          id: field.id,
          tenantId: f.tenantA.id,
          objectId: f.object.id,
          fieldKey: field.fieldKey,
          label: field.label,
          type: field.type,
          required: field.required,
        },
      });
    }
  });
  afterEach(async () => {
    if (f)
      await h.adminDatabase.memberFieldPermission.deleteMany({
        where: { tenantId: f.tenantA.id },
      });
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('persists member configuration, allows creation and rejects modification; admins can correct it', async () => {
    await setNameAccess().expect(200);
    const access = await get(
      `${base()}/members/${f.employee.memberId}/object-access`,
      f.admin,
    ).expect(200);
    expect(access.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              fieldKey: 'name',
              effective: 'CREATE_ONLY',
              override: 'CREATE_ONLY',
            }),
          ]) as unknown,
        }),
      ]),
    );
    const schema = await get(
      `${base()}/objects/${f.object.code}/schema`,
    ).expect(200);
    expect(schema.body).toHaveProperty(
      'fields',
      expect.arrayContaining([
        expect.objectContaining({ fieldKey: 'name', access: 'CREATE_ONLY' }),
      ]),
    );
    const created = await post(records(), {
      values: { name: '首次录入' },
    }).expect(201);
    const row = created.body as { id: string; version: number };
    await get(`${records()}/${row.id}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toHaveProperty('values.name', '首次录入'),
      );
    await patch(`${records()}/${row.id}`, {
      version: row.version,
      values: { name: '试图修改' },
    }).expect(403);
    await patch(
      `${records()}/${row.id}`,
      { version: row.version, values: { name: '管理员纠错' } },
      f.admin,
    ).expect(200);
    await get(`${records()}/${row.id}`)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toHaveProperty('values.name', '管理员纠错'),
      );
    await post(records(), {
      values: { name: '正常', reviewCode: '只读禁止录入' },
    }).expect(403);
    await post(records(), { values: { name: '越权' } }, f.tenantBAdmin).expect(
      403,
    );
    await setNameAccess().expect(200); // Saving again does not reopen old records.
    await patch(`${records()}/${f.ownedRecord.id}`, {
      version: 1,
      values: { name: '已有数据也锁定' },
    }).expect(403);
  });

  it('accepts create-only imports and deduplicates by that field without changing existing rows', async () => {
    await setNameAccess().expect(200);
    const payload = {
      matchFields: ['name'],
      rows: [{ rowNumber: 2, values: { name: '导入新客户' } }],
    };
    await post(`${records()}/import`, { ...payload, dryRun: true }).expect(201);
    await post(`${records()}/import`, payload)
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({ created: 1, failed: 0 }),
      );
    await post(`${records()}/import`, payload)
      .expect(201)
      .expect(({ body }) =>
        expect(body).toMatchObject({ created: 0, failed: 0 }),
      );
    const batch = await post(`${records()}/batch`, {
      items: [{ recordId: f.ownedRecord.id, version: 1 }],
      values: { name: '批量绕过' },
    }).expect(201);
    expect(batch.body).toMatchObject({ updated: 0, failed: 1 });
    expect(JSON.stringify(batch.body)).toContain('FIELD_READ_ONLY');
  });

  it('recognizes published defaults and still enforces table canCreate', async () => {
    const publication =
      await h.adminDatabase.objectPublication.findFirstOrThrow({
        where: { objectId: f.object.id },
      });
    const schema =
      publication.configuration as unknown as PublishedObjectSchema;
    schema.employeeAccess.fields.name = 'CREATE_ONLY';
    const id = randomUUID();
    schema.publication.id = id;
    schema.publication.number = 2;
    schema.publication.sourceDraftVersion = 2;
    await h.adminDatabase.objectPublication.create({
      data: {
        ...publication,
        changeSummary: {},
        id,
        publicationNo: 2,
        sourceDraftVersion: 2,
        configuration: JSON.parse(JSON.stringify(schema)) as object,
      },
    });
    await h.adminDatabase.objectDefinition.update({
      where: { id: f.object.id },
      data: { activePublicationId: id, version: 2 },
    });
    await post(records(), { values: { name: '默认新建可填写' } }).expect(201);
    const otherSchema = await get(
      `${base()}/objects/${f.object.code}/schema`,
      f.otherEmployee,
    ).expect(200);
    expect(otherSchema.body).toHaveProperty(
      'fields',
      expect.arrayContaining([
        expect.objectContaining({ fieldKey: 'name', access: 'CREATE_ONLY' }),
      ]),
    );
    await h.adminDatabase.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canCreate: false,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        readScope: 'OWN',
        updateScope: 'OWN',
      },
    });
    await post(records(), { values: { name: '禁止新建' } }).expect(403);
  });
});
