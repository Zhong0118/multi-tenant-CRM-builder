import type { Prisma } from '@crm/database';
import { FakeAiProvider } from '../src/modules/ai/providers/fake-ai.provider';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { MeteredFakeProvider } from '../src/modules/ai/providers/metered-fake.provider';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120000);
describe('import preview through the workspace HTTP and provider boundaries', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const planId = randomUUID();
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
    await h.adminDatabase
      .$executeRaw`INSERT INTO ai_plans(id,name,features,monthly_tokens) VALUES(${planId}::uuid,${'import fixture ' + planId},ARRAY['import_assist'],1000000)`;
    await h.adminDatabase
      .$executeRaw`UPDATE tenant_ai_configs SET plan_id=${planId}::uuid WHERE tenant_id=${f.tenantA.id}::uuid`;
  });
  afterAll(async () => {
    if (h) {
      await h.adminDatabase
        .$executeRaw`UPDATE tenant_ai_configs SET plan_id=NULL WHERE plan_id=${planId}::uuid`;
      await h.adminDatabase
        .$executeRaw`DELETE FROM ai_plans WHERE id=${planId}::uuid`;
      await closeCriticalHarness(h);
    }
  });
  afterEach(() => jest.restoreAllMocks());
  const col = (col: string, header: string, sample: string) => ({
    col,
    header,
    samples: [sample],
    values: [{ id: 'v1', text: sample, count: 3 }],
  });
  const body = {
    sheet: '内部标题张三',
    headerEvidence: ['单位名称', '内部备注', '业务员', '审核编号'].map(
      (v, i) => ({
        col: 'C' + (i + 1),
        hashes: [createHash('sha256').update(v).digest('hex')],
      }),
    ),
    currentHeader: 3,
    headerLocked: false,
    candidates: [
      {
        headerRow: 1,
        columns: [
          col('C1', '张三客户清单', '敏感样本'),
          col('C2', '评级', '139 1111 3333'),
          col('C3', '等级', 'OWNER_SENTINEL'),
          col('C4', '来源', 'READONLY_SENTINEL'),
        ],
      },
      {
        headerRow: 3,
        columns: [
          col('C1', '单位名称', '+86 (138) 1234-5678'),
          col('C2', '内部备注', 'HIDDEN_SENTINEL'),
          col('C3', '业务员', '张三'),
          col('C4', '审核编号', '只读'),
        ],
      },
    ],
  };
  const post = (payload: unknown = body, cookie = f.employee.cookie) =>
    request(h.app.getHttpServer())
      .post(
        '/api/v1/workspaces/' + f.tenantA.code + '/objects/leads/import-assist',
      )
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send(payload as object);
  it('sends only safe metadata across all candidate rows and recovers a valid sibling', async () => {
    const records = await h.adminDatabase.record.count({
      where: { tenantId: f.tenantA.id },
    });
    const generate = jest
      .spyOn(FakeAiProvider.prototype, 'generateImportAssist')
      .mockImplementation((input) => {
        expect(JSON.stringify(input)).not.toMatch(
          /C2|C3|C4|张三|敏感样本|SENTINEL|内部备注|审核编号|业务员|reviewCode|secret|1234|[0-9a-f]{64}/,
        );
        expect(input.fields.map((f) => f.name)).toEqual(['姓名']);
        return Promise.resolve({
          version: 1,
          headerRow: 3,
          columns: [
            null,
            {
              col: 'C1',
              target: { mode: 'field', field: input.fields[0].ref },
              confidence: 'high',
              reason: 'HIDDEN_SENTINEL',
            },
          ],
          matchFields: [input.fields[0].ref, 'secret'],
        });
      });
    const result = await post().expect(200);
    expect(result.body).toMatchObject({
      headerRow: 3,
      columns: [{ col: 'C1', target: { mode: 'field', field: 'name' } }],
      matchFields: ['name'],
    });
    expect(JSON.stringify(result.body)).not.toMatch(/SENTINEL|secret/);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      await h.adminDatabase.record.count({ where: { tenantId: f.tenantA.id } }),
    ).toBe(records);
  });
  it('aborts the provider after the 25-second import deadline', async () => {
    const deadline = new AbortController();
    const native = AbortSignal.timeout.bind(AbortSignal);
    const timer = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms) =>
        ms === 25000 ? deadline.signal : native(ms),
      );
    const generate = jest
      .spyOn(FakeAiProvider.prototype, 'generateImportAssist')
      .mockImplementation((...args) => {
        const signal = args[2] as AbortSignal;
        deadline.abort();
        signal.throwIfAborted();
        return Promise.resolve({});
      });
    await post()
      .expect(504)
      .expect((res) =>
        expect(JSON.stringify(res.body)).toContain('AI_PROVIDER_TIMEOUT'),
      );
    expect(timer).toHaveBeenCalledWith(25000);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])(
    'delivers ordinary source headings to the provider and omits restricted positions (locked %s)',
    async (locked) => {
      const labels = [
        '联系人',
        '下次跟进日',
        '合同额',
        '回款日期',
        '微信',
        '职务',
        '决策人',
        '成交概率',
        '客商代码',
        '签单与否',
        '采购方',
        '报价（万元）',
      ];
      const headers = [...labels, '负责人', '内部备注', '审核编号', '人工排除'];
      const columns = headers.map((name, i) => ({
        ...col('C' + (i + 1), name, '自由样本'),
        excluded: i === headers.length - 1,
      }));
      const send = jest
        .spyOn(FakeAiProvider.prototype, 'generateImportAssist')
        .mockResolvedValue({
          version: 1,
          headerRow: 3,
          columns: [],
          matchFields: [],
        });
      await post({
        ...body,
        headerLocked: locked,
        headerEvidence: columns.map(({ col, header }) => ({
          col,
          hashes: [createHash('sha256').update(header).digest('hex')],
        })),
        candidates: [{ headerRow: 3, columns }],
      }).expect(200);
      const input = send.mock.calls[0][0];
      expect(input.candidates[0].columns.map((c) => c.header)).toEqual(labels);
      expect(JSON.stringify(input)).not.toMatch(
        /自由样本|负责人|内部备注|审核编号|人工排除/,
      );
    },
  );
  it('keeps employee-hidden and read-only fields manual even for a tenant admin', async () => {
    const send = jest
      .spyOn(FakeAiProvider.prototype, 'generateImportAssist')
      .mockImplementation((input) => {
        expect(JSON.stringify(input)).not.toMatch(
          /C2|C3|C4|SENTINEL|内部备注|审核编号|reviewCode|secret/,
        );
        expect(input.fields.map((field) => field.name)).toContain('姓名');
        return Promise.resolve({
          version: 1,
          headerRow: 3,
          columns: [],
          matchFields: [],
        });
      });
    await post(body, f.admin.cookie).expect(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('lets the admin explicitly import both manual-only fields through the ordinary import path', async () => {
    const url = '/api/v1/workspaces/' + f.tenantA.code + '/objects/leads';
    const schema = await request(h.app.getHttpServer())
      .get(url + '/schema')
      .set('Cookie', f.admin.cookie)
      .expect(200);
    const { fields } = schema.body as { fields: unknown[] };
    for (const fieldKey of ['secret', 'reviewCode']) {
      expect(fields).toContainEqual(
        expect.objectContaining({
          fieldKey,
          access: 'EDIT',
          importManualOnly: true,
        }),
      );
    }
    const send = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateImportAssist',
    );
    const result = await request(h.app.getHttpServer())
      .post(url + '/records/import')
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        dryRun: true,
        rows: [
          {
            rowNumber: 2,
            values: {
              name: '验收-仅限手动',
              secret: '本地备注',
              reviewCode: '手动编号',
            },
          },
        ],
      })
      .expect(201);
    expect(result.body as unknown).toMatchObject({
      items: [{ rowNumber: 2, status: 'READY' }],
    });
    expect(send).not.toHaveBeenCalled();
  });
  it('skips generation for resolved columns, rejects malformed input and cross-tenant actors', async () => {
    const generate = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateImportAssist',
    );
    await post({
      ...body,
      candidates: [{ headerRow: 3, columns: [col('C1', '姓名', '隐私原文')] }],
    }).expect(200);
    await post({ ...body, currentHeader: 11 }).expect(400);
    await post(body, f.tenantBAdmin.cookie).expect(403);
    expect(generate).not.toHaveBeenCalled();
  });
  it('rechecks entitlement before returning and before the next call', async () => {
    const generate = jest
      .spyOn(MeteredFakeProvider.prototype, 'generateImportAssist')
      .mockImplementationOnce(async () => {
        await h.adminDatabase
          .$executeRaw`UPDATE ai_plans SET features=ARRAY[]::text[] WHERE id=${planId}::uuid`;
        return { version: 1, headerRow: 3, columns: [], matchFields: [] };
      });
    try {
      await post().expect(403);
      await post({ invalid: 'do not echo' }).expect(403);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      await h.adminDatabase
        .$executeRaw`UPDATE ai_plans SET features=ARRAY['import_assist'] WHERE id=${planId}::uuid`;
    }
  });
  it('rejects revoked canImport even for a client that bypasses the drawer', async () => {
    const generate = jest
      .spyOn(MeteredFakeProvider.prototype, 'generateImportAssist')
      .mockImplementationOnce(async () => {
        await h.adminDatabase.objectPermission.create({
          data: {
            tenantId: f.tenantA.id,
            objectId: f.object.id,
            subjectType: 'MEMBER',
            subjectMemberId: f.employee.memberId,
            canRead: true,
            canCreate: true,
            canImport: false,
            canUpdate: true,
            canDelete: false,
            readScope: 'OWN',
            updateScope: 'OWN',
          },
        });
        return { version: 1, headerRow: 3, columns: [], matchFields: [] };
      });
    try {
      await post().expect(403);
      await post({ invalid: 'do not echo' }).expect(403);
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      await h.adminDatabase.objectPermission.deleteMany({
        where: { objectId: f.object.id, subjectMemberId: f.employee.memberId },
      });
    }
  });
  it('rejects a changed publication after the model returns', async () => {
    const db = h.adminDatabase;
    const previous = await db.objectPublication.findFirstOrThrow({
      where: { tenantId: f.tenantA.id, objectId: f.object.id },
    });
    const id = randomUUID(),
      publishedAt = new Date();
    jest
      .spyOn(MeteredFakeProvider.prototype, 'generateImportAssist')
      .mockImplementationOnce(async () => {
        await db.objectPublication.create({
          data: {
            id,
            objectId: f.object.id,
            tenantId: f.tenantA.id,
            publicationNo: 2,
            sourceDraftVersion: 2,
            publishedByMemberId: f.admin.memberId,
            publishedAt,
            changeSummary: {},
            configuration: {
              ...(previous.configuration as Prisma.JsonObject),
              publication: {
                id,
                number: 2,
                sourceDraftVersion: 2,
                publishedAt: publishedAt.toISOString(),
              },
            },
          },
        });
        await db.objectDefinition.update({
          where: { id: f.object.id },
          data: { activePublicationId: id },
        });
        return { version: 1, headerRow: 3, columns: [], matchFields: [] };
      });
    try {
      await post()
        .expect(409)
        .expect((r) =>
          expect(r.body).toMatchObject({ code: 'CONFIG_VERSION_CONFLICT' }),
        );
    } finally {
      await db.objectDefinition.update({
        where: { id: f.object.id },
        data: { activePublicationId: previous.id },
      });
    }
  });
});
