import { parsePublishedObjectSchema } from '../src/modules/objects/published-object.service';
import request from 'supertest';
import { AI_PROVIDER, type AiProvider } from '../src/modules/ai/ai-provider';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';
jest.setTimeout(120000);

describe('one-sentence filter preview with tenant permissions', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const empty = { version: 1, match: 'all', conditions: [] };
  const own = {
    ...empty,
    conditions: [{ fieldKey: '$owner', operator: 'in', value: ['$me'] }],
  };
  beforeAll(async () => {
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  afterEach(() => jest.restoreAllMocks());
  function preview(
    cookie: string,
    currentRule: unknown = empty,
    baseViewId?: string,
  ) {
    return request(h.app.getHttpServer())
      .post(
        '/api/v1/workspaces/' +
          f.tenantA.code +
          '/objects/leads/filter-preview',
      )
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ text: '换成我负责的客户', currentRule, baseViewId });
  }
  it('preserves the request-time owner placeholder for two employees and omits hidden schema and row values', async () => {
    const provider = h.app.get<AiProvider>(AI_PROVIDER);
    const generate = jest
      .spyOn(provider, 'generateFilter')
      .mockResolvedValue({ rules: [own] });
    for (const member of [f.employee, f.otherEmployee]) {
      const r = await preview(member.cookie).expect(200);
      expect(r.body).toEqual({ kind: 'rule', rule: own });
    }
    for (const [input] of generate.mock.calls) {
      expect(input.fields.map((f) => f.fieldKey)).toContain('name');
      expect(JSON.stringify(input)).not.toMatch(/secret|hidden-owned|内部备注/);
    }
    await preview(f.tenantBAdmin.cookie).expect(403);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('rejects hidden, unknown and team conditions both before generation and in a mixed set of candidates', async () => {
    const generate = jest.spyOn(
      h.app.get<AiProvider>(AI_PROVIDER),
      'generateFilter',
    );
    for (const condition of [
      { fieldKey: 'secret', operator: 'contains', value: 'X' },
      { fieldKey: 'unknown', operator: 'contains', value: 'X' },
      {
        fieldKey: '$followUp',
        operator: 'dueThroughToday',
        value: { assignee: 'any' },
      },
    ]) {
      const invalid = { ...empty, conditions: [condition] };
      generate.mockClear();
      expect(
        (await preview(f.employee.cookie, invalid).expect(200)).body,
      ).toEqual({ kind: 'unavailable' });
      expect(generate).not.toHaveBeenCalled();
      generate.mockResolvedValueOnce({ rules: [own, invalid] });
      expect((await preview(f.employee.cookie).expect(200)).body).toEqual({
        kind: 'unavailable',
      });
    }
  });
  it('rechecks field access when the provider returns and rejects the entire stale preview', async () => {
    const publication =
      await h.adminDatabase.objectPublication.findFirstOrThrow({
        where: { objectId: f.object.id },
      });
    const field = parsePublishedObjectSchema(
      publication.configuration,
    ).fields.find((f) => f.fieldKey === 'reviewCode')!;
    await h.adminDatabase.fieldDefinition.create({
      data: {
        id: field.id,
        tenantId: f.tenantA.id,
        objectId: f.object.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: 'TEXT',
        sortOrder: field.sortOrder,
      },
    });
    jest
      .spyOn(h.app.get<AiProvider>(AI_PROVIDER), 'generateFilter')
      .mockImplementationOnce(async (input) => {
        expect(input.fields.map((f) => f.fieldKey)).toContain('reviewCode');
        await h.adminDatabase.memberFieldPermission.create({
          data: {
            tenantId: f.tenantA.id,
            objectId: f.object.id,
            fieldId: field.id,
            memberId: f.employee.memberId,
            access: 'HIDDEN',
          },
        });
        return {
          rules: [
            {
              ...empty,
              conditions: [
                ...own.conditions,
                { fieldKey: 'reviewCode', operator: 'eq', value: 'code' },
              ],
            },
          ],
        };
      });
    try {
      expect((await preview(f.employee.cookie).expect(200)).body).toEqual({
        kind: 'unavailable',
      });
    } finally {
      await h.adminDatabase.memberFieldPermission.deleteMany({
        where: { fieldId: field.id, memberId: f.employee.memberId },
      });
    }
  });
  it('includes only this company’s active member options for an administrator', async () => {
    const generate = jest
      .spyOn(h.app.get<AiProvider>(AI_PROVIDER), 'generateFilter')
      .mockResolvedValue({ rules: [own] });
    await preview(f.admin.cookie).expect(200);
    const owners = generate.mock.calls[0]![0].fields.find(
      (f) => f.fieldKey === '$owner',
    )!.options!.map((o) => o.key);
    expect(owners).toContain(f.employee.memberId);
    expect(owners).not.toContain(f.tenantBAdmin.memberId);
  });
  it('checks view ownership and object before generating', async () => {
    const generate = jest.spyOn(
      h.app.get<AiProvider>(AI_PROVIDER),
      'generateFilter',
    );
    await preview(f.employee.cookie, empty, f.otherRecord.id).expect(404);
    expect(generate).not.toHaveBeenCalled();
  });
});
