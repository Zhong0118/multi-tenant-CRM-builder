import { parsePublishedObjectSchema } from '../src/modules/objects/published-object.service';
import request from 'supertest';
import { MeteredFakeProvider } from '../src/modules/ai/providers/metered-fake.provider';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  publishObject,
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
    text = '换成我负责的客户',
    code = 'leads',
  ) {
    return request(h.app.getHttpServer())
      .post(
        `/api/v1/workspaces/${f.tenantA.code}/objects/${code}/filter-preview`,
      )
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ text, currentRule, baseViewId });
  }
  it('preserves the request-time owner placeholder for two employees and omits hidden schema and row values', async () => {
    const provider = MeteredFakeProvider.prototype;
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
      MeteredFakeProvider.prototype,
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
      .spyOn(MeteredFakeProvider.prototype, 'generateFilter')
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
  const ownerRule = (...members: string[]) => ({
    ...empty,
    conditions: [{ fieldKey: '$owner', operator: 'in', value: members }],
  });
  it('preserves selected members through request-local handles without sending the roster', async () => {
    const generate = jest
      .spyOn(MeteredFakeProvider.prototype, 'generateFilter')
      .mockImplementation((input) =>
        Promise.resolve({ rules: [input.currentRule] }),
      );
    const draft = ownerRule(
      f.employee.memberId,
      '$me',
      f.otherEmployee.memberId,
    );
    for (let i = 0; i < 2; i++) {
      expect((await preview(f.admin.cookie, draft).expect(200)).body).toEqual({
        kind: 'rule',
        rule: draft,
      });
      const [input] = generate.mock.calls[i];
      const prompt = JSON.stringify(input);
      for (const member of [
        f.admin,
        f.employee,
        f.otherEmployee,
        f.tenantBAdmin,
      ])
        expect(prompt).not.toContain(member.memberId);
      expect(prompt).not.toMatch(/Critical (Employee|Other|Admin|Tenant B)/);
      expect(input.currentRule.conditions[0]).toMatchObject({
        value: [expect.any(String), '$me', expect.any(String)],
      });
    }
    expect(generate.mock.calls[0][0].currentRule).not.toEqual(
      generate.mock.calls[1][0].currentRule,
    );
  });
  it('resolves a unique exact name from the request and rejects an entire mixed preview for missing or unauthorized names', async () => {
    const generate = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateFilter',
    );
    generate.mockResolvedValueOnce({ rules: [ownerRule('Critical Other')] });
    expect(
      (
        await preview(
          f.admin.cookie,
          empty,
          undefined,
          'Critical Other 负责的客户',
        ).expect(200)
      ).body,
    ).toEqual({ kind: 'rule', rule: ownerRule(f.otherEmployee.memberId) });
    for (const [actor, name, text] of [
      [f.employee, 'Critical Other', 'Critical Other 负责的客户'],
      [
        f.admin,
        'Critical Tenant B Admin',
        'Critical Tenant B Admin 负责的客户',
      ],
      [f.admin, 'Other', 'Other 负责的客户'],
      [f.admin, 'Critical Other', '现有条件'],
      [f.admin, f.otherEmployee.memberId, f.otherEmployee.memberId],
    ] as const) {
      generate.mockResolvedValueOnce({ rules: [own, ownerRule(name)] });
      expect(
        (await preview(actor.cookie, empty, undefined, text).expect(200)).body,
      ).toEqual({ kind: 'unavailable' });
    }
    generate.mockClear();
    expect(
      (
        await preview(
          f.employee.cookie,
          ownerRule(f.otherEmployee.memberId),
        ).expect(200)
      ).body,
    ).toEqual({ kind: 'unavailable' });
    expect(generate).not.toHaveBeenCalled();
  });
  it('rejects duplicate effective names and rechecks carried members after generation', async () => {
    const generate = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateFilter',
    );
    const target = { id: f.otherEmployee.memberId };
    try {
      await h.adminDatabase.tenantMember.update({
        where: target,
        data: { displayName: 'Critical Employee' },
      });
      generate.mockResolvedValueOnce({
        rules: [own, ownerRule('Critical Employee')],
      });
      expect(
        (
          await preview(
            f.admin.cookie,
            empty,
            undefined,
            'Critical Employee 负责的客户',
          ).expect(200)
        ).body,
      ).toEqual({ kind: 'unavailable' });
      generate.mockImplementationOnce(async () => {
        await h.adminDatabase.tenantMember.update({
          where: target,
          data: { status: 'DISABLED' },
        });
        return { rules: [own] };
      });
      expect(
        (await preview(f.admin.cookie, ownerRule(target.id)).expect(200)).body,
      ).toEqual({ kind: 'unavailable' });
    } finally {
      await h.adminDatabase.tenantMember.update({
        where: target,
        data: { status: 'ACTIVE', displayName: null },
      });
    }
  });
  it('resolves MEMBER names within a leader’s current group and rejects a carried peer after removal', async () => {
    const db = h.adminDatabase;
    const code = 'member_demo';
    const object = await publishObject(db, {
      tenantId: f.tenantA.id,
      publisherMemberId: f.admin.memberId,
      code,
      name: '成员测试',
      fields: [
        {
          key: 'name',
          label: '名称',
          type: 'TEXT',
          required: true,
          access: 'EDIT',
        },
        {
          key: 'advisor',
          label: '顾问',
          type: 'MEMBER',
          required: false,
          access: 'EDIT',
        },
      ],
      access: {
        canCreate: false,
        canRead: true,
        canUpdate: false,
        readScope: 'OWN',
        updateScope: 'NONE',
      },
      now: new Date(),
    });
    const group = await db.memberGroup.create({
      data: { tenantId: f.tenantA.id, name: '销售一组' },
    });
    await db.tenantMember.updateMany({
      where: { id: { in: [f.employee.memberId, f.otherEmployee.memberId] } },
      data: { groupId: group.id },
    });
    await db.memberGroup.update({
      where: { id: group.id },
      data: { leaderMemberId: f.employee.memberId },
    });
    await db.objectPermission.create({
      data: {
        tenantId: f.tenantA.id,
        objectId: object.id,
        subjectType: 'MEMBER',
        subjectMemberId: f.employee.memberId,
        canRead: true,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        readScope: 'GROUP',
        updateScope: 'NONE',
      },
    });
    const advisor = (value: string) => ({
      ...empty,
      conditions: [{ fieldKey: 'advisor', operator: 'in', value: [value] }],
    });
    const generate = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateFilter',
    );
    const named = (name: string) =>
      preview(f.employee.cookie, empty, undefined, '顾问是' + name, code);
    generate.mockResolvedValueOnce({ rules: [advisor('Critical Other')] });
    expect((await named('Critical Other').expect(200)).body).toEqual({
      kind: 'rule',
      rule: advisor(f.otherEmployee.memberId),
    });
    generate.mockResolvedValueOnce({ rules: [advisor('Critical Admin')] });
    expect((await named('Critical Admin').expect(200)).body).toEqual({
      kind: 'unavailable',
    });
    generate.mockImplementationOnce(async (input) => {
      await db.tenantMember.update({
        where: { id: f.otherEmployee.memberId },
        data: { groupId: null },
      });
      return { rules: [input.currentRule] };
    });
    expect(
      (
        await preview(
          f.employee.cookie,
          advisor(f.otherEmployee.memberId),
          undefined,
          '保留顾问',
          code,
        ).expect(200)
      ).body,
    ).toEqual({ kind: 'unavailable' });
    for (const [input] of generate.mock.calls) {
      const metadata = JSON.stringify({ ...input, text: undefined });
      expect(metadata).not.toMatch(/Critical (Employee|Other|Admin|Tenant B)/);
      expect(metadata).not.toContain(f.otherEmployee.memberId);
    }
  });
  it('checks view ownership and object before generating', async () => {
    const generate = jest.spyOn(
      MeteredFakeProvider.prototype,
      'generateFilter',
    );
    await preview(f.employee.cookie, empty, f.otherRecord.id).expect(404);
    expect(generate).not.toHaveBeenCalled();
  });
});
