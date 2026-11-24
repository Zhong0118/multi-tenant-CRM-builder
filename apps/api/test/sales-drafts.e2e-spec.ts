import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { FakeAiProvider } from '../src/modules/ai/providers/fake-ai.provider';
import { localDateAt } from '../src/modules/follow-ups/follow-up-workbench-time';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';
import {
  createCriticalHarness,
  provisionCriticalFixture,
  closeCriticalHarness,
  type CriticalHarness,
  type CriticalFixture,
} from './helpers/critical-fixture';

jest.setTimeout(120000);
describe('sales draft permissions, privacy and metering over HTTP', () => {
  let h: CriticalHarness, f: CriticalFixture;
  const plan = randomUUID();
  const options = {
    kind: 'message',
    purpose: 'quote',
    length: 'short',
    tone: 'friendly',
  };
  const path = (id: string) => '/ai/writing/leads/' + id;
  const post = (url: string, data: object, actor = f.employee) =>
    request(h.app.getHttpServer())
      .post('/api/v1/workspaces/' + f.tenantA.code + url)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000')
      .send(data);
  const count = (feature: string) =>
    h.adminDatabase.aiModelCall.count({
      where: { tenantId: f.tenantA.id, feature },
    });
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) {
      await h.adminDatabase
        .$executeRaw`UPDATE tenant_ai_configs SET plan_id=NULL WHERE plan_id=${plan}::uuid`;
      await h.adminDatabase
        .$executeRaw`DELETE FROM ai_plans WHERE id=${plan}::uuid`;
      await closeCriticalHarness(h);
    }
  });
  it('denies unentitled calls and excludes hidden fields and unreadable records from actual model inputs', async () => {
    await post(path(f.ownedRecord.id), options).expect(403);
    await post('/ai/daily-report', { workDate: '2026-11-24' }).expect(403);
    expect(await count('writing')).toBe(0);
    await h.adminDatabase
      .$executeRaw`INSERT INTO ai_plans(id,name,features,monthly_tokens) VALUES(${plan}::uuid,${'test-' + plan},ARRAY['writing','daily_report'],1000000)`;
    await h.adminDatabase
      .$executeRaw`UPDATE tenant_ai_configs SET plan_id=${plan}::uuid WHERE tenant_id=${f.tenantA.id}::uuid`;
    const spy = jest.spyOn(FakeAiProvider.prototype, 'generateSalesDaily');
    try {
      await post(path(f.otherRecord.id), options).expect(404);
      await post(path(f.ownedRecord.id), options, f.tenantBAdmin).expect(403);
      const before = await h.adminDatabase.recordActivity.count({
        where: { recordId: f.ownedRecord.id },
      });
      const generated = await post(path(f.ownedRecord.id), options).expect(200);
      expect(generated.text).toContain('"type":"block"');
      const prompt = spy.mock.calls.at(-1)![0].prompt;
      expect(prompt).toContain('员工自己的线索');
      expect(prompt).not.toMatch(/hidden-owned|hidden-other|他人线索|内部备注/);
      expect(
        await h.adminDatabase.recordActivity.count({
          where: { recordId: f.ownedRecord.id },
        }),
      ).toBe(before);
      expect(await count('writing')).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
  it('uses only own activity, attributes completed followups once, and does not save a report', async () => {
    const tenantId = f.tenantA.id,
      recordId = f.ownedRecord.id,
      actorMemberId = f.employee.memberId;
    const { timezone } = await h.adminDatabase.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const now = new Date(),
      day = localDateAt(now, timezone);
    const { id } = await h.adminDatabase.recordActivity.create({
      data: {
        tenantId,
        recordId,
        actorMemberId,
        activityType: 'CALL',
        content: '完成演示回访',
      },
    });
    await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId,
        recordId,
        assigneeMemberId: f.otherEmployee.memberId,
        title: '回访产品演示',
        dueAt: now,
        status: 'DONE',
        completedAt: now,
        completionActivityId: id,
      },
    });
    await h.adminDatabase.recordActivity.create({
      data: {
        tenantId,
        recordId,
        actorMemberId: f.otherEmployee.memberId,
        activityType: 'MESSAGE',
        content: '同事做的不能计入',
      },
    });
    const spy = jest.spyOn(FakeAiProvider.prototype, 'generateSalesDaily');
    try {
      const response = await post('/ai/daily-report', { workDate: day }).expect(
        200,
      );
      const body = response.body as {
        sections: { completed: string; problems: string };
      };
      expect(body.sections.completed).toContain('回访产品演示');
      expect(body.sections.problems).toBe('');
      const prompt = spy.mock.calls.at(-1)![0].prompt;
      expect(prompt.match(/完成演示回访/g)).toHaveLength(1);
      expect(prompt).not.toContain('同事做的不能计入');
      expect(
        await h.adminDatabase.dailyReport.count({ where: { tenantId } }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
  it('uses the existing record chooser before writing when a name matches twice', async () => {
    await h.adminDatabase
      .$executeRaw`UPDATE ai_plans SET features=ARRAY['assistant','writing','daily_report'] WHERE id=${plan}::uuid`;
    await h.adminDatabase.record.update({
      where: { id: f.otherRecord.id },
      data: {
        ownerMemberId: f.employee.memberId,
        title: '员工自己的线索',
        data: { name: '员工自己的线索', secret: 'other-private' },
      },
    });
    const before = await count('writing');
    const ask = await post('/ai/turns', {
      content: '给员工自己的线索写条微信',
      context: { objectCode: 'leads' },
    }).expect(200);
    expect(ask.text).toContain('event: question.ready');
    expect(await count('writing')).toBe(before);
    const data = (event: string): unknown =>
      JSON.parse(
        ask.text.split('event: ' + event + '\ndata: ')[1].split('\n')[0],
      );
    const { conversationId } = data('conversation.ready') as {
      conversationId: string;
    };
    const { question } = data('question.ready') as {
      question: { questionId: string; kind: string; options: { id: string }[] };
    };
    expect(question.kind).toBe('choose_record');
    expect(question.options).toHaveLength(2);
    const answer = await post('/ai/turns', {
      conversationId,
      answer: {
        questionId: question.questionId,
        value: { kind: 'choose_record', optionId: question.options[0].id },
      },
    }).expect(200);
    expect(answer.text).toContain('event: action.ready');
    expect(await count('writing')).toBe(before + 1);
  });
  it('meters nested writing separately and keeps the draft outside saved chat history', async () => {
    await h.adminDatabase
      .$executeRaw`UPDATE ai_plans SET features=ARRAY['assistant','writing','daily_report'] WHERE id=${plan}::uuid`;
    const writingCalls = await count('writing'),
      assistantCalls = await count('assistant');
    const result = await post('/ai/turns', {
      content: '帮我写一条微信',
      context: { objectCode: 'leads', recordId: f.ownedRecord.id },
    }).expect(200);
    expect(result.text).toContain('event: action.ready');
    expect(result.text).toContain('"blocks"');
    const rows = await h.adminDatabase.aiMessage.findMany({
      where: { tenantId: f.tenantA.id, role: 'ASSISTANT' },
    });
    expect(JSON.stringify(rows)).not.toContain('"blocks"');
    expect(await count('writing')).toBe(writingCalls + 1);
    expect(await count('assistant')).toBe(assistantCalls + 1);
  });
});
