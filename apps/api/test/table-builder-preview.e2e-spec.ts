import request from 'supertest';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';
jest.setTimeout(120000);
describe('table builder HTTP boundary', () => {
  let h: CriticalHarness, f: CriticalFixture;
  beforeAll(async () => {
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  function post(op: string, body: object, cookie = f.admin.cookie) {
    return request(h.app.getHttpServer())
      .post('/api/v1/workspaces/' + f.tenantA.code + '/ai/table-builder/' + op)
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send(body);
  }
  it.each(['preview', 'validate', 'refine', 'confirm'])(
    'forbids employee and foreign tenant on %s',
    async (op) => {
      await post(op, {}, f.employee.cookie).expect(403);
      await post(op, {}, f.tenantBAdmin.cookie).expect(403);
    },
  );
  it('lets an administrator preview without writing and rejects an injected grant', async () => {
    const before = await h.adminDatabase.objectDefinition.count({
      where: { tenantId: f.tenantA.id },
    });
    const preview = await post('preview', {
      description:
        '我们做工程设备租赁，要管客户、租赁合同、设备台账和回款，销售只能看自己的客户。',
    }).expect(200);
    expect(preview.body.kind).toBe('blueprint');
    expect(preview.body.blueprint.tables).toHaveLength(4);
    expect(
      preview.body.issues.filter((i: { blocking: boolean }) => i.blocking),
    ).toEqual([]);
    const plan = preview.body.blueprint;
    plan.tables[0].employeeAccess = { canCreate: true, readScope: 'OWN' };
    await post('confirm', { blueprint: plan }).expect(400);
    expect(
      await h.adminDatabase.objectDefinition.count({
        where: { tenantId: f.tenantA.id },
      }),
    ).toBe(before);
  });
});
