import request from 'supertest';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import { randomUUID } from 'node:crypto';
import { ConversationService } from '../src/modules/ai/conversation.service';
import { AssistantQuestionsService } from '../src/modules/ai/assistant-questions.service';
import type { TenantContext } from '../src/common/tenancy/tenant-context';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

jest.setTimeout(120_000);
describe('assistant question lifecycle under current CRM permissions', () => {
  let h: CriticalHarness, f: CriticalFixture, actor: TenantContext;
  let q: AssistantQuestionsService, c: ConversationService;
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    q = h.app.get(AssistantQuestionsService);
    c = h.app.get(ConversationService);
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
    actor = {
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      memberId: f.employee.memberId,
      userId: f.employee.userId,
      role: 'EMPLOYEE',
    };
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  it('uses all-or-nothing hints, only tool-issued candidates and refreshed titles', async () => {
    const ref = { objectCode: 'leads', recordId: f.ownedRecord.id };
    expect(
      await q.resolvePage(actor, { ...ref, viewId: randomUUID() }),
    ).toBeUndefined();
    expect(
      await q.resolvePage(actor, { ...ref, recordId: randomUUID() }),
    ).toBeUndefined();
    expect(await q.resolvePage(actor, ref)).toMatchObject(ref);
    const t = await c.beginTurn(actor, { content: '找这条记录' });
    await q.remember(actor, t, [ref], 'page');
    const request = {
      kind: 'choose_record' as const,
      objectCode: 'leads',
      recordIds: [ref.recordId],
    };
    await expect(q.open(actor, t, request)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await q.remember(actor, t, [ref], 'tool');
    const question = await q.open(actor, t, request);
    if (question?.kind !== 'choose_record')
      throw Error('expected record question');
    await h.adminDatabase.record.update({
      where: { id: ref.recordId },
      data: { title: '新名称' },
    });
    const pick = {
      kind: 'choose_record' as const,
      optionId: question.options[0].id,
    };
    const results = await Promise.all([
      q.resume(actor, t.conversationId, question.questionId, pick),
      q.resume(actor, t.conversationId, question.questionId, pick),
    ]);
    expect(results.map((r) => r.replay).sort()).toEqual([false, true]);
    expect(results.find((r) => !r.replay)?.answer).toMatchObject({
      ...ref,
      label: '新名称',
      question: question.prompt,
    });
    const history = await c.messages(actor, t.conversationId, {});
    expect(
      history.items.find((m) => m.role === 'ASSISTANT')?.questions,
    ).toMatchObject([
      { state: 'ANSWERED', options: [{ label: '新名称' }], answer: pick },
    ]);
    await expect(
      q.resume(actor, t.conversationId, question.questionId, {
        ...pick,
        optionId: 'forged',
      }),
    ).rejects.toBeDefined();
  });
  it('supersedes the old question atomically when the user sends a new message', async () => {
    const t = await c.beginTurn(actor, { content: '选个做法' });
    const card = await q.open(actor, t, {
      kind: 'choose_option',
      options: ['只写纪要', '建议跟进'],
    });
    await c.beginTurn(actor, {
      conversationId: t.conversationId,
      content: '换个问题',
    });
    await expect(
      q.resume(actor, t.conversationId, card!.questionId, {
        kind: 'choose_option',
        otherText: '迟到的补充',
      }),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE' });
    expect(
      await h.adminDatabase.aiQuestion.findUnique({
        where: { id: card!.questionId },
      }),
    ).toMatchObject({ state: 'SUPERSEDED', answer: null });
  });
  it('revalidates the anchored list draft and the saved answer when retrying a failed continuation', async () => {
    const page = await q.resolvePage(actor, { objectCode: 'leads' });
    const draft = {
      version: 1 as const,
      match: 'all' as const,
      conditions: [],
    };
    const t = await c.beginTurn(actor, { content: '帮我筛选' });
    const card = await q.open(
      actor,
      t,
      { kind: 'choose_option', options: ['看我负责的', '最近联系的'] },
      page,
      draft,
    );
    const pick = {
      kind: 'choose_option' as const,
      otherText: '找我负责的客户',
    };
    const run = await q.resume(actor, t.conversationId, card!.questionId, pick);
    expect(run).toMatchObject({
      page,
      filterDraft: draft,
      answer: pick,
      replay: false,
    });
    await c.finalizeAssistant(actor, t.turnId, {
      status: 'FAILED',
      content: '',
      providerAttempt: 2,
    });
    const retry = await q.retryAnswer(actor, t.turnId);
    expect(retry).toMatchObject({
      page,
      filterDraft: draft,
      answer: pick,
      replay: false,
      turn: { assistant: { providerUsage: { providerAttempts: 3 } } },
    });
  });
  it('projects editable controls from the target and rejects forged keys and changed visibility on answer or replay', async () => {
    const ref = { objectCode: 'leads', recordId: f.ownedRecord.id };
    const t = await c.beginTurn(actor, { content: '改一下' });
    await q.remember(actor, t, [ref], 'page');
    for (const keys of [['secret'], ['reviewCode'], ['ownerMemberId']])
      await expect(
        q.open(actor, t, {
          kind: 'fill_fields',
          mode: 'pick_any',
          ...ref,
          fieldKeys: keys,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const card = await q.open(actor, t, {
      kind: 'fill_fields',
      mode: 'pick_any',
      ...ref,
      fieldKeys: [],
    });
    expect(card).toMatchObject({
      kind: 'fill_fields',
      fields: [{ key: 'name', label: '姓名', requiredForAnswer: false }],
    });
    for (const key of ['secret', 'reviewCode', 'forged']) {
      const values = { name: '预期', [key]: '隐藏' };
      const response = await request(h.app.getHttpServer())
        .post('/api/v1/workspaces/' + f.tenantA.code + '/ai/turns')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', f.employee.cookie)
        .send({
          conversationId: t.conversationId,
          answer: {
            questionId: card!.questionId,
            value: { kind: 'fill_fields', values },
          },
        })
        .expect(400);
      expect(response.body).toHaveProperty('fieldErrors', {});
      expect(JSON.stringify(response.body)).not.toContain(key);
    }
    const row = await h.adminDatabase.record.findUniqueOrThrow({
      where: { id: ref.recordId },
    });
    await h.adminDatabase.record.update({
      where: { id: ref.recordId },
      data: { ownerMemberId: f.otherEmployee.memberId },
    });
    await expect(
      q.resume(actor, t.conversationId, card!.questionId, {
        kind: 'fill_fields',
        values: { name: '新名称' },
      }),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE' });
    expect(
      (await c.messages(actor, t.conversationId, {})).items.find(
        (m) => m.role === 'ASSISTANT',
      )?.questions,
    ).toEqual([]);
    expect(
      (
        await h.adminDatabase.record.findUniqueOrThrow({
          where: { id: ref.recordId },
        })
      ).data,
    ).toEqual(row.data);
  });
  it.each(['missing', 'pick_any'] as const)(
    'validates %s on the open card and accepts a corrected answer',
    async (mode) => {
      const admin: TenantContext = {
        ...actor,
        memberId: f.admin.memberId,
        userId: f.admin.userId,
        role: 'TENANT_ADMIN',
      };
      const ref = { objectCode: 'leads', recordId: f.ownedRecord.id };
      const t = await c.beginTurn(admin, { content: '改一下' });
      await q.remember(admin, t, [ref], 'page');
      const card = await q.open(admin, t, {
        kind: 'fill_fields',
        mode,
        ...ref,
        fieldKeys: ['name', 'reviewCode'],
      });
      expect(card).toMatchObject({
        fields: [
          { key: 'name', requiredForAnswer: mode === 'missing' },
          { key: 'reviewCode', requiredForAnswer: mode === 'missing' },
        ],
      });
      const resume = (values: Record<string, unknown>) =>
        q.resume(admin, t.conversationId, card!.questionId, {
          kind: 'fill_fields',
          values,
        });
      await expect(
        resume({ name: 266, reviewCode: 'A' }),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: { name: ['字段值格式不正确。'] },
      });
      if (mode === 'missing') {
        await expect(resume({})).rejects.toMatchObject({
          fieldErrors: {
            name: ['请填写必填字段。'],
            reviewCode: ['请填写必填字段。'],
          },
        });
        for (const values of [
          { name: '新名称' },
          { name: '新名称', reviewCode: '   ' },
          { name: '新名称', reviewCode: null },
        ])
          await expect(resume(values)).rejects.toMatchObject({
            code: 'VALIDATION_FAILED',
            fieldErrors: { reviewCode: ['请填写必填字段。'] },
          });
      } else {
        await expect(resume({ reviewCode: null })).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
        });
      }
      expect(
        await h.adminDatabase.aiQuestion.findUniqueOrThrow({
          where: { id: card!.questionId },
        }),
      ).toMatchObject({ state: 'OPEN', answer: null });
      const corrected =
        mode === 'missing'
          ? { name: '新名称', reviewCode: 'A' }
          : { reviewCode: 'A' };
      expect((await resume(corrected)).answer.values).toEqual(corrected);
    },
  );
  it.each([true, false])(
    'restores required=%s on pre-mode cards',
    async (required) => {
      const admin: TenantContext = {
        ...actor,
        memberId: f.admin.memberId,
        userId: f.admin.userId,
        role: 'TENANT_ADMIN',
      };
      const ref = { objectCode: 'leads', recordId: f.ownedRecord.id };
      const t = await c.beginTurn(admin, { content: '补齐' });
      await q.remember(admin, t, [ref], 'page');
      const card = await q.open(admin, t, {
        kind: 'fill_fields',
        mode: 'pick_any',
        ...ref,
        fieldKeys: ['name', 'reviewCode'],
      });
      const where = { id: card!.questionId };
      const row = await h.adminDatabase.aiQuestion.findUniqueOrThrow({ where });
      const legacy = { ...(row.definition as Record<string, string>) };
      delete legacy.mode;
      const definition = { ...legacy, required };
      await h.adminDatabase.aiQuestion.update({ where, data: { definition } });
      const messages = await c.messages(admin, t.conversationId, {});
      expect(messages.items.flatMap((m) => m.questions ?? [])).toMatchObject([
        {
          fields: [
            { key: 'name', requiredForAnswer: required },
            { key: 'reviewCode', requiredForAnswer: required },
          ],
        },
      ]);
      const partial = {
        kind: 'fill_fields' as const,
        values: { name: '新名称' },
      };
      const resume = q.resume(
        admin,
        t.conversationId,
        card!.questionId,
        partial,
      );
      if (required)
        await expect(resume).rejects.toMatchObject({
          fieldErrors: { reviewCode: ['请填写必填字段。'] },
        });
      else expect((await resume).answer.values).toEqual(partial.values);
    },
  );
  it('can retry a previously accepted legacy answer that cleared an optional field', async () => {
    const admin: TenantContext = {
      ...actor,
      memberId: f.admin.memberId,
      userId: f.admin.userId,
      role: 'TENANT_ADMIN',
    };
    const ref = { objectCode: 'leads', recordId: f.ownedRecord.id };
    const t = await c.beginTurn(admin, { content: '改一下' });
    await q.remember(admin, t, [ref], 'page');
    const card = await q.open(admin, t, {
      kind: 'fill_fields',
      mode: 'pick_any',
      ...ref,
      fieldKeys: ['reviewCode'],
    });
    const where = { id: card!.questionId };
    const row = await h.adminDatabase.aiQuestion.findUniqueOrThrow({ where });
    const legacy = { ...(row.definition as Record<string, string>) };
    delete legacy.mode;
    const answer = { kind: 'fill_fields', values: { reviewCode: null } };
    await h.adminDatabase.aiQuestion.update({
      where,
      data: {
        definition: { ...legacy, required: false },
        state: 'ANSWERED',
        answer,
      },
    });
    await h.adminDatabase.aiMessage.update({
      where: { id: t.assistant.id },
      data: { status: 'FAILED' },
    });
    expect((await q.retryAnswer(admin, t.turnId))?.answer.values).toEqual(
      answer.values,
    );
  });
  it('rejects HTTP answers sent to a different conversation, member, tenant, or forged option', async () => {
    const t = await c.beginTurn(actor, { content: '请说明' });
    const prior = await c.beginTurn(actor, { content: '另一个会话' });
    const card = await q.open(actor, t, {
      kind: 'choose_option',
      options: ['只记纪要', '建议跟进'],
    });
    const answer = {
      questionId: card!.questionId,
      value: { kind: 'choose_option', optionId: 'forged' },
    };
    const send = (tenant: string, cookie: string, body: unknown) =>
      request(h.app.getHttpServer())
        .post('/api/v1/workspaces/' + tenant + '/ai/turns')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', cookie)
        .send(body as object);
    await send(f.tenantA.code, f.employee.cookie, {
      conversationId: t.conversationId,
      answer,
    }).expect(400);
    await send(f.tenantA.code, f.employee.cookie, {
      conversationId: prior.conversationId,
      answer,
    }).expect(404);
    await send(f.tenantA.code, f.otherEmployee.cookie, {
      conversationId: t.conversationId,
      answer,
    }).expect(404);
    await send(f.tenantB.code, f.tenantBAdmin.cookie, {
      conversationId: t.conversationId,
      answer,
    }).expect(404);
    expect(
      await h.adminDatabase.aiQuestion.findUnique({
        where: { id: card!.questionId },
      }),
    ).toMatchObject({ state: 'OPEN', answer: null });
  });
  it('retains expiry, cancellation and a hard limit of three cards on the same logical turn', async () => {
    const t = await c.beginTurn(actor, { content: '先提问' });
    const input = {
      kind: 'choose_option' as const,
      options: ['只记纪要', '建议跟进'],
    };
    let next = t;
    for (let i = 0; i < 3; i++) {
      const card = await q.open(actor, next, input);
      next = (
        await q.resume(actor, t.conversationId, card!.questionId, {
          kind: 'choose_option',
          otherText: '补充',
        })
      ).turn;
    }
    expect(await q.open(actor, next, input)).toBeNull();
    const another = await c.beginTurn(actor, { content: '另外一个问题' });
    const expires = await q.open(actor, another, input);
    await h.adminDatabase.aiQuestion.update({
      where: { id: expires!.questionId },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      q.resume(actor, another.conversationId, expires!.questionId, {
        kind: 'choose_option',
        otherText: '已经过期',
      }),
    ).rejects.toMatchObject({ code: 'AI_TURN_NOT_RETRYABLE' });
    const fresh = await c.beginTurn(actor, {
      conversationId: another.conversationId,
      content: '新问题',
    });
    const cancelled = await q.open(actor, fresh, input);
    await q.cancel(actor, fresh.conversationId, cancelled!.questionId);
    const states = (await c.messages(actor, another.conversationId, {})).items
      .flatMap((m) => m.questions ?? [])
      .map((q) => q.state);
    expect(states).toEqual(['EXPIRED', 'CANCELLED']);
  });
});
