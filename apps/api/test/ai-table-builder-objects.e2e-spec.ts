import { randomUUID } from 'node:crypto';
import type { TableBlueprint, TableBuilderTarget } from '@crm/contracts';
import request from 'supertest';
import { validateBlueprint } from '../src/modules/ai/table-blueprint';
import { AuditService } from '../src/modules/audit/audit.service';
import type { DraftGroupAnalysisDto } from '../src/modules/objects/dto/template-initialization.dto';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

type Summary = { id: string; code: string; version: number };
type Draft = {
  object: Summary;
  fields: { fieldKey: string; type: string; employeeAccess: string }[];
};
const builder = '/ai/table-builder';
const defs = '/object-definitions';
const group = defs + '/draft-group';

function blueprint(names: string[]): TableBlueprint {
  return validateBlueprint(
    {
      version: 1,
      assumptions: [],
      omitted: [],
      tables: names.map((name, i) => {
        const title = randomUUID();
        return {
          id: randomUUID(),
          code: 'batch-table-' + (i + 1),
          name,
          reason: '业务实体',
          titleFieldId: title,
          fields: [
            {
              id: title,
              fieldKey: 'business_name',
              label: '业务名称',
              type: 'TEXT',
              required: true,
              reason: '识别记录',
            },
            {
              id: randomUUID(),
              fieldKey: 'advisor',
              label: '技术顾问',
              type: 'MEMBER',
              required: false,
              reason: '服务联络',
            },
          ],
          view: { columnIds: [title], reason: '识别记录' },
          employeeIntent: [
            {
              request: '销售看自己',
              reason: '手动配置',
              recommendation: 'CREATE_OWN',
            },
          ],
        };
      }),
    },
    [],
  ).blueprint;
}

jest.setTimeout(90_000);
describe('AI table builder transactions over HTTP with PostgreSQL RLS', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  const api = (
    method: 'post' | 'put' | 'get',
    path: string,
    actor = f.admin,
    tenant = f.tenantA,
  ) =>
    request(h.app.getHttpServer())
      [method]('/api/v1/workspaces/' + tenant.code + path)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000');
  const confirm = (plan: TableBlueprint, target?: TableBuilderTarget) =>
    api('post', builder + '/confirm').send({ blueprint: plan, target });
  const analyze = async (ids: string[]) =>
    (
      await api('post', group + '/analysis')
        .send({ objectIds: ids })
        .expect(200)
    ).body as DraftGroupAnalysisDto;
  const expected = (result: DraftGroupAnalysisDto) => ({
    objects: result.objects.map((o) => ({
      id: o.id,
      expectedVersion: o.version,
      expectedPoolConfigVersion: o.poolConfigVersion,
    })),
  });

  it('denies employees every entry and validates tenant membership, target IDs and escalated permissions', async () => {
    const plan = blueprint(['租赁合同']);
    for (const action of ['preview', 'validate', 'refine', 'confirm']) {
      await api('post', builder + '/' + action, f.employee)
        .send({ blueprint: plan })
        .expect(403);
    }
    for (const action of ['analysis', 'publications']) {
      await api('post', group + '/' + action, f.employee)
        .send(
          action === 'analysis'
            ? { objectIds: [f.object.id] }
            : {
                objects: [
                  {
                    id: f.object.id,
                    expectedVersion: 1,
                    expectedPoolConfigVersion: 1,
                  },
                ],
              },
        )
        .expect(403);
    }
    await api('post', builder + '/confirm', f.tenantBAdmin, f.tenantB)
      .send({
        blueprint: plan,
        target: { objectId: f.object.id, expectedVersion: 1 },
      })
      .expect(404);
    await api('post', group + '/analysis', f.tenantBAdmin, f.tenantB)
      .send({ objectIds: [f.object.id] })
      .expect(404);
    for (const employeePresets of [
      { [plan.tables[0].id]: 'ADMIN' },
      { [plan.tables[0].id]: { canRead: true } },
      { [randomUUID()]: 'CREATE_OWN' },
    ]) {
      await api('post', builder + '/confirm')
        .send({ blueprint: plan, employeePresets })
        .expect(400);
    }
    await api('post', builder + '/confirm')
      .send({
        blueprint: plan,
        target: { objectId: f.object.id, expectedVersion: 1 },
        employeePresets: { [plan.tables[0].id]: 'CREATE_OWN' },
      })
      .expect(400);
    Object.assign(plan.tables[0], {
      employeeAccess: { canRead: true, readScope: 'ALL' },
    });
    await confirm(plan).expect(400);
    expect(
      await h.adminDatabase.objectDefinition.count({
        where: { tenantId: f.tenantA.id, name: '租赁合同' },
      }),
    ).toBe(0);
  });

  it('revalidates edited codes and stores the same keys used by the title and list', async () => {
    const plan = blueprint(['设备维护']);
    const t = plan.tables[0];
    t.code = 'equipment-maintenance';
    t.fields[0].fieldKey = 'service_name';
    const preview = await api('post', builder + '/validate')
      .send({ blueprint: plan })
      .expect(200);
    expect(
      (preview.body as { issues: { blocking: boolean }[] }).issues.some(
        (i) => i.blocking,
      ),
    ).toBe(false);
    const [obj] = (
      (await confirm(plan).expect(200)).body as { objects: Summary[] }
    ).objects;
    expect(obj.code).toBe(t.code);
    const draft = (await api('get', defs + '/' + obj.id).expect(200))
      .body as Draft & {
      object: { titleFieldKey: string };
      defaultView: { columnFieldKeys: string[] };
    };
    expect(draft.fields.map((field) => field.fieldKey)).toEqual([
      'service_name',
      'advisor',
    ]);
    expect(draft.object.titleFieldKey).toBe('service_name');
    expect(draft.defaultView.columnFieldKeys).toEqual(['service_name']);
  });

  it('serializes simultaneous confirmations and rejects archived names and reserved execution codes', async () => {
    const plan = blueprint(['租赁合同']);
    const concurrent = await Promise.all([confirm(plan), confirm(plan)]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    const db = h.adminDatabase;
    expect(
      await db.objectDefinition.count({
        where: { tenantId: f.tenantA.id, name: '租赁合同' },
      }),
    ).toBe(1);
    const [obj] = (
      concurrent.find((r) => r.status === 200)!.body as { objects: Summary[] }
    ).objects;
    await db.objectDefinition.update({
      where: { id: obj.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    const renamed = structuredClone(plan);
    renamed.tables[0].name = '另一份租约';
    await confirm(renamed).expect(409);
    const sameName = blueprint(['租赁合同']);
    sameName.tables[0].code = 'archived-name';
    await confirm(sameName).expect(409);
  });

  it('rolls back three creations, their dependent rows and the entire audit trail on a third-table write failure', async () => {
    const plan = blueprint(['客户登记', '租赁合同', '设备清单']);
    const counts = () =>
      Promise.all([
        h.adminDatabase.objectDefinition.count({
          where: { tenantId: f.tenantA.id },
        }),
        h.adminDatabase.fieldDefinition.count({
          where: { tenantId: f.tenantA.id },
        }),
        h.adminDatabase.viewDefinition.count({
          where: { tenantId: f.tenantA.id },
        }),
        h.adminDatabase.objectPermission.count({
          where: { tenantId: f.tenantA.id },
        }),
        h.adminDatabase.fieldPermission.count({
          where: { tenantId: f.tenantA.id },
        }),
        h.adminDatabase.auditLog.count({
          where: { tenantId: f.tenantA.id, resourceType: 'object_definition' },
        }),
      ]);
    const before = await counts();
    const audit = h.app.get(AuditService);
    const next = audit.append.bind(audit);
    let created = 0;
    const fail = jest
      .spyOn(audit, 'append')
      .mockImplementation(async (tx, event) => {
        if (event.action === 'object.created' && ++created === 3)
          throw new Error('Injected third object audit failure');
        return next(tx, event);
      });
    try {
      await api('post', builder + '/confirm')
        .send({
          blueprint: plan,
          employeePresets: Object.fromEntries(
            plan.tables.map((t) => [t.id, 'CREATE_OWN']),
          ),
        })
        .expect(500);
    } finally {
      fail.mockRestore();
    }
    expect(created).toBe(3);
    expect(await counts()).toEqual(before);
  });

  it('saves selected presets by table in the draft and publishes the selected access to employees', async () => {
    const plan = blueprint(['维修工单', '设备登记']);
    const result = await api('post', builder + '/confirm')
      .send({
        blueprint: plan,
        employeePresets: {
          [plan.tables[0].id]: 'CREATE_OWN',
          [plan.tables[1].id]: 'READ_ALL_UPDATE_OWN',
        },
      })
      .expect(200);
    const { objects } = result.body as { objects: Summary[] };
    for (const [i, object] of objects.entries()) {
      const detail = (await api('get', defs + '/' + object.id).expect(200))
        .body as Draft & {
        employeeAccess: object;
      };
      expect(detail.employeeAccess).toMatchObject({
        canCreate: true,
        canRead: true,
        canUpdate: true,
        canDelete: false,
        canImport: false,
        canExport: false,
        updateScope: 'OWN',
        readScope: i === 0 ? 'OWN' : 'ALL',
      });
      expect(detail.fields.map((field) => field.employeeAccess)).toEqual([
        'EDIT',
        'EDIT',
      ]);
    }
    const ready = await analyze(objects.map((o) => o.id));
    expect(ready.blocking).toEqual([]);
    await api('post', group + '/publications')
      .send(expected(ready))
      .expect(200);
    await api('post', '/objects/' + objects[0].code + '/records', f.employee)
      .send({ values: { [plan.tables[0].fields[0].fieldKey]: '设备维修' } })
      .expect(201);
    await api('post', '/objects/' + objects[1].code + '/records', f.employee)
      .send({ values: { [plan.tables[1].fields[0].fieldKey]: '设备登记' } })
      .expect(201);
  });

  it('publishes only after manual grants and group checks, then appends hidden fields without changing the active schema', async () => {
    const plan = blueprint(['租赁合同', '设备清单']);
    const { objects } = (await confirm(plan).expect(200)).body as {
      objects: Summary[];
    };
    const ids = objects.map((o) => o.id);
    const live = async (code: string) =>
      (await api('get', '/objects/' + code + '/schema', f.employee).expect(200))
        .body as {
        fields: { fieldKey: string }[];
        publication: { number: number };
      };
    const nav = await api('get', '/objects', f.employee).expect(200);
    expect(
      (nav.body as { code: string }[]).some((o) =>
        objects.some((d) => d.code === o.code),
      ),
    ).toBe(false);
    const blocked = await analyze(ids);
    expect(blocked.blocking.length).toBeGreaterThan(0);
    await api('post', group + '/publications')
      .send(expected(blocked))
      .expect(422);
    for (const [i, o] of objects.entries()) {
      const title = plan.tables[i].fields[0].fieldKey;
      await api('put', defs + '/' + o.id + '/permissions')
        .send({
          expectedVersion: o.version,
          canCreate: true,
          canRead: true,
          canUpdate: false,
          canDelete: false,
          readScope: 'OWN',
          updateScope: 'NONE',
          fields: { [title]: 'EDIT' },
        })
        .expect(200);
    }
    const ready = await analyze(ids);
    expect(ready.blocking).toEqual([]);
    await api('post', group + '/publications')
      .send(expected(blocked))
      .expect(409);
    const stalePool = expected(ready);
    stalePool.objects[1].expectedPoolConfigVersion++;
    await api('post', group + '/publications')
      .send(stalePool)
      .expect(409);
    expect(
      await h.adminDatabase.objectPublication.count({
        where: { objectId: { in: ids } },
      }),
    ).toBe(0);
    await api('post', group + '/publications')
      .send(expected(ready))
      .expect(200);
    await api('post', group + '/publications')
      .send(expected(ready))
      .expect(409);
    const [obj] = ready.objects;
    expect(obj.nextPublicationNumber).toBe(1);
    const original = await live(obj.code);
    const previousFields = await h.adminDatabase.fieldDefinition.findMany({
      where: { objectId: obj.id },
      orderBy: { id: 'asc' },
    });
    const previousViews = await h.adminDatabase.viewDefinition.findMany({
      where: { objectId: obj.id },
      orderBy: { id: 'asc' },
    });
    const previousAccess = await h.adminDatabase.objectPermission.findMany({
      where: { objectId: obj.id },
      orderBy: { id: 'asc' },
    });

    const record = await api(
      'post',
      '/objects/' + obj.code + '/records',
      f.employee,
    )
      .send({ values: { [plan.tables[0].fields[0].fieldKey]: '样例合同' } })
      .expect(201);
    expect((record.body as { title: string }).title).toBe('样例合同');
    const newPlan = blueprint([obj.name]);
    Object.assign(newPlan.tables[0], {
      id: obj.id,
      code: obj.code,
      titleFieldId: '',
      employeeIntent: [],
      view: { columnIds: [], reason: '保留视图' },
    });
    newPlan.tables[0].fields = [
      {
        ...newPlan.tables[0].fields[0],
        label: '合同到期日',
        fieldKey: 'end_date',
        required: false,
        type: 'DATE',
      },
    ];
    const target = { objectId: obj.id, expectedVersion: obj.version };
    await confirm(newPlan, target).expect(200);
    await confirm(newPlan, target).expect(409);
    const draft = (await api('get', defs + '/' + obj.id).expect(200))
      .body as Draft;
    expect(draft.fields.at(-1)).toMatchObject({
      type: 'DATE',
      employeeAccess: 'HIDDEN',
    });
    expect(draft.fields[0].employeeAccess).toBe('EDIT');
    expect(await live(obj.code)).toEqual(original);
    expect(
      await h.adminDatabase.fieldDefinition.findMany({
        where: { id: { in: previousFields.map((f) => f.id) } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(previousFields);
    expect(
      await h.adminDatabase.viewDefinition.findMany({
        where: { objectId: obj.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(previousViews);
    expect(
      await h.adminDatabase.objectPermission.findMany({
        where: { objectId: obj.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(previousAccess);
    await request(h.app.getHttpServer())
      .patch('/api/v1/workspaces/' + f.tenantA.code + defs + '/' + obj.id)
      .set('Cookie', f.admin.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ expectedVersion: draft.object.version, name: '新合同台账' })
      .expect(200);
    const previousName = blueprint([obj.name]);
    previousName.tables[0].code = 'new-lease';
    await confirm(previousName).expect(409);
  });
  it('confirms six forty-field tables within one transaction, including MEMBER additions', async () => {
    const plan = blueprint(Array.from({ length: 6 }, (_, i) => '租赁区域' + i));
    for (const t of plan.tables) {
      const [title, member] = t.fields;
      t.fields = [
        title,
        ...Array.from({ length: 39 }, (_, i) => ({
          ...member,
          id: randomUUID(),
          fieldKey: 'advisor_' + i,
          label: '顾问岗位' + i,
          reason: '管理员需要在列表中查看这项信息。'.repeat(7),
        })),
      ];
    }
    const { blueprint: ready, issues } = validateBlueprint(plan, []);
    expect(issues.filter((i) => i.blocking)).toEqual([]);
    const bytes = Buffer.byteLength(JSON.stringify({ blueprint: ready }));
    expect(bytes).toBeGreaterThan(100 * 1024);
    await api('post', defs)
      .send({ name: 'x'.repeat(bytes) })
      .expect(413);
    await api('post', builder + '/validate')
      .send({ description: 'x'.repeat(2 * 1024 * 1024) })
      .expect(413);
    await api('post', builder + '/validate')
      .send({ blueprint: ready })
      .expect(200);
    const res = await confirm(ready).expect(200);
    const { objects } = res.body as { objects: Summary[] };
    expect(
      await h.adminDatabase.fieldDefinition.count({
        where: { objectId: { in: objects.map((o) => o.id) } },
      }),
    ).toBe(240);
  });
  it('appends an explicitly hidden field while leaving an unfinished manual draft editable', async () => {
    const { object } = (
      await api('post', defs)
        .send({ name: '待配置的合同', code: 'incomplete' })
        .expect(201)
    ).body as Draft;
    const plan = blueprint(['待配置的合同']);
    const t = plan.tables[0];
    Object.assign(t, {
      id: object.id,
      code: object.code,
      titleFieldId: '',
      employeeIntent: [],
      view: { columnIds: [], reason: '保留既有配置' },
    });
    t.fields = [{ ...t.fields[1], label: '技术顾问' }];
    const target = { objectId: object.id, expectedVersion: object.version };
    const checked = await api('post', builder + '/validate')
      .send({ blueprint: plan, target })
      .expect(200);
    expect(
      (checked.body as { issues: { blocking: boolean }[] }).issues.filter(
        (i) => i.blocking,
      ),
    ).toEqual([]);
    await confirm(plan, target).expect(200);
    const draft = (await api('get', defs + '/' + object.id).expect(200))
      .body as Draft & { employeeAccess: unknown; defaultView: unknown };
    expect(draft.employeeAccess).toBeNull();
    expect(draft.defaultView).toBeNull();
    expect(draft.fields[0].employeeAccess).toBe('HIDDEN');
  });
});
