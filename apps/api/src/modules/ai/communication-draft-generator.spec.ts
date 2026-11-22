import { PublishedObjectService } from '../objects/published-object.service';
import type { PublishedObjectSchema } from '../objects/object-schema';
import type {
  RecordsRepository,
  RecordsStore,
} from '../records/records.repository';
import type { FollowUpsService } from '../follow-ups/follow-ups.service';
import {
  employee,
  otherMemberId,
  otherRecordId,
  ownRecordId,
  recordToolFixture,
} from './tools/record-read-tools.fixture';
import { CommunicationDraftGenerator } from './communication-draft-generator';
import { FakeAiProvider } from './providers/fake-ai.provider';

function fixture() {
  const { store, publishedRepository } = recordToolFixture();
  const publication = publishedRepository.record
    .configuration as PublishedObjectSchema;
  for (const [key, type, access, isSystem, config] of [
    [
      'phase',
      'SINGLE_SELECT',
      'EDIT',
      false,
      {
        options: [
          { key: 'quote', label: '报价', status: 'ACTIVE' },
          { key: 'deleted', label: '已停用', status: 'INACTIVE' },
        ],
      },
    ],
    ['locked', 'TEXT', 'READ_ONLY', false, {}],
    ['firstOnly', 'TEXT', 'CREATE_ONLY', false, {}],
    ['systemKey', 'TEXT', 'EDIT', true, {}],
    ['role', 'TEXT', 'EDIT', false, {}],
    ['amount', 'MONEY', 'EDIT', false, {}],
    ['apiKey', 'TEXT', 'EDIT', false, {}],
  ] as const) {
    publication.fields.push({
      ...publication.fields[0],
      id: key,
      fieldKey: key,
      label: key,
      type,
      required: false,
      isSystem,
      config: structuredClone(
        config,
      ) as PublishedObjectSchema['fields'][number]['config'],
    });
    publication.employeeAccess.fields[key] = access;
  }
  Object.assign(store.records[0].values, {
    phase: 'quote',
    locked: '可见只读',
    apiKey: 'provider-private-credential',
  });
  const transactionStore = {
    findRecord: store.findRecord.bind(store),
    listActivities: store.listActivities.bind(store),
    resolveCurrentObject: store.resolveCurrentObject.bind(store),
    lockRecord: ({
      objectId,
      recordId,
    }: {
      objectId: string;
      recordId: string;
    }) => store.findRecord(objectId, recordId),
    lockActiveOwners: async () => {},
    getTenantTimezone: () => Promise.resolve('America/New_York'),
  };
  const records = {
    withTenant: <T>(_actor: unknown, work: (s: RecordsStore) => Promise<T>) =>
      work(transactionStore as unknown as RecordsStore),
  } as RecordsRepository;
  const followUps = {
    listForAi: jest
      .fn()
      .mockResolvedValue([
        { title: '我的待办', dueAt: '2026-11-01T12:00:00Z' },
      ]),
  };
  const provider = new FakeAiProvider();
  const service = new CommunicationDraftGenerator(
    records,
    new PublishedObjectService(publishedRepository),
    followUps as unknown as FollowUpsService,
    provider,
  );
  return { service, provider, followUps, publishedRepository, store };
}

describe('communication draft generation', () => {
  it('offers only editable published data, reads recent visible activity and the actor’s own OPEN tasks', async () => {
    const { service, provider, followUps } = fixture();
    const ctx = await service.context(employee, 'leads', ownRecordId);
    expect(ctx).toMatchObject({
      objectId: 'object-leads',
      publicationId: 'publication-leads',
      expectedVersion: 1,
      timeZone: 'America/New_York',
    });
    expect(ctx.visibleFieldKeys).toEqual(
      expect.arrayContaining(['name', 'phase', 'locked']),
    );
    expect(ctx.fields.map((f) => f.fieldKey)).toEqual([
      'name',
      'phase',
      'amount',
    ]);
    expect(ctx.fields[1]).toMatchObject({
      oldValue: 'quote',
      options: [{ key: 'quote', label: '报价' }],
    });
    expect(followUps.listForAi).toHaveBeenCalledWith(
      employee,
      expect.objectContaining({
        objectCode: 'leads',
        recordId: ownRecordId,
        status: 'OPEN',
      }),
    );
    const gen = jest
      .spyOn(provider, 'generateCommunication')
      .mockResolvedValue({ note: '纪要', followUp: null, fieldChanges: [] });
    await service.generate(ctx, '本次沟通');
    const payload = JSON.stringify(gen.mock.calls[0][0]);
    expect(payload).toMatch(/自己的跟进/);
    expect(payload).toMatch(/我的待办/);
    expect(payload).not.toMatch(
      /别人的跟进|仅管理员可见|provider-private-credential|已停用/,
    );
    await expect(
      service.context(employee, 'leads', otherRecordId),
    ).rejects.toMatchObject({ code: 'RECORD_NOT_FOUND' });
  });

  it('limits a peer draft to that record’s group field permissions and current activities', async () => {
    const { service, provider, publishedRepository, store } = fixture();
    const row = publishedRepository.record;
    const schema = row.configuration as PublishedObjectSchema;
    row.memberId = employee.memberId;
    row.groupOwnerMemberIds = [employee.memberId, otherMemberId];
    row.memberOverride = {
      ...schema.employeeAccess,
      readScope: 'GROUP',
      updateScope: 'ALL',
      groupFieldAccess: {
        name: 'READ_ONLY',
        phase: 'HIDDEN',
        amount: 'READ_ONLY',
        secret: 'EDIT',
      },
    };
    Object.assign(store.records[1].values, {
      phase: 'peer-private-phase',
      amount: '9000',
    });
    store.activities = store.activities.filter(
      (activity) => activity.recordId !== otherRecordId,
    );
    const ctx = await service.context(employee, 'leads', otherRecordId);
    expect(ctx.fields.map((field) => field.fieldKey)).toEqual(['secret']);
    expect(ctx.visibleFieldKeys).not.toContain('phase');
    const generate = jest.spyOn(provider, 'generateCommunication');
    await service.generate(ctx, '本次沟通');
    const payload = JSON.stringify(generate.mock.calls[0][0]);
    expect(payload).toContain('别人的机密');
    expect(payload).not.toMatch(/peer-private-phase|别人的跟进/);
  });

  it('checks quoted evidence and ignores fabricated keys, inactive choices, and model-invented dates', async () => {
    const { service, provider } = fixture();
    const ctx = await service.context(employee, 'leads', ownRecordId);
    jest.spyOn(provider, 'generateCommunication').mockResolvedValue({
      note: '预算尚待批准',
      followUp: {
        title: '联系客户',
        suggestedDate: '2099-01-01',
        evidence: '过段时间联系',
      },
      fieldChanges: [
        { fieldKey: 'secret', value: 'x', evidence: '报价' },
        { fieldKey: 'locked', value: 'x', evidence: '报价' },
        { fieldKey: 'phase', value: 'deleted', evidence: '报价' },
        { fieldKey: 'phase', value: 'quote', evidence: '这句话不存在' },
        { fieldKey: 'phase', value: 'quote', evidence: '报价' },
      ],
    });
    const output = await service.generate(ctx, '客户要求报价，过段时间联系');
    expect(output.followUp?.suggestedDate).toBeNull();
    expect(output.fieldChanges).toEqual([
      { fieldKey: 'phase', value: 'quote', evidence: '报价' },
    ]);
  });

  it('resolves relative dates and explicit times using the tenant calendar across DST, leaves ambiguous dates unset', async () => {
    const { service } = fixture();
    const ctx = {
      ...(await service.context(employee, 'leads', ownRecordId)),
      now: '2026-10-31T23:30:00.000Z',
    };
    for (const [text, expected] of [
      ['预算还没批，下周再联系', '2026-11-02T14:00:00.000Z'],
      ['月底联系客户', '2026-10-31T13:00:00.000Z'],
      ['2026-11-05 14:30 再联系', '2026-11-05T19:30:00.000Z'],
      ['改天再联系', null],
    ]) {
      const result = await service.generate(ctx, text!);
      expect(result.followUp?.suggestedDate).toBe(expected);
    }
  });

  it('proposes two editable fields with evidence and omits a requested read-only field', async () => {
    const { service } = fixture();
    const ctx = await service.context(employee, 'leads', ownRecordId);
    const result = await service.generate(
      ctx,
      '下周再联系。phase：报价，amount：180000，locked：123456789。',
    );
    expect(result.fieldChanges).toEqual([
      { fieldKey: 'phase', evidence: 'phase：报价', value: 'quote' },
      { fieldKey: 'amount', evidence: 'amount：180000', value: '180000.00' },
    ]);
    expect(result.followUp?.suggestedDate).toBeTruthy();
  });

  it('aborts a provider that ignores cancellation after the configured timeout', async () => {
    const { service, provider } = fixture();
    const ctx = await service.context(employee, 'leads', ownRecordId);
    const prior = process.env.AI_TIMEOUT_MS;
    process.env.AI_TIMEOUT_MS = '10';
    try {
      const request = jest
        .spyOn(provider, 'generateCommunication')
        .mockImplementation(() => new Promise(() => {}));
      await expect(service.generate(ctx, '请联系')).rejects.toMatchObject({
        code: 'AI_PROVIDER_TIMEOUT',
      });
      expect(request.mock.calls[0][1].aborted).toBe(true);
    } finally {
      if (prior === undefined) delete process.env.AI_TIMEOUT_MS;
      else process.env.AI_TIMEOUT_MS = prior;
    }
  });

  it('returns controlled errors on invalid model output and fake provider failure', async () => {
    const { service, provider } = fixture();
    const ctx = await service.context(employee, 'leads', ownRecordId);
    await expect(service.generate(ctx, '模拟服务不可用')).rejects.toMatchObject(
      { code: 'AI_PROVIDER_UNAVAILABLE' },
    );
    jest
      .spyOn(provider, 'generateCommunication')
      .mockResolvedValue({ note: 'draft', targetId: 'injected' });
    await expect(service.generate(ctx, '真实原话')).rejects.toMatchObject({
      code: 'AI_TURN_FAILED',
    });
  });
});
