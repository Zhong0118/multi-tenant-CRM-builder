import request from 'supertest';

import {
  CRITICAL_SEARCH_OWN_LEADS_MARKER,
  getFakeAiProviderCapturedToolResult,
} from '../src/modules/ai/providers/fake-ai.provider';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    if (lines.length === 0) continue;
    const eventLine = lines.find((line) => line.startsWith('event: '));
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    events.push({
      event: eventLine.slice('event: '.length),
      data: JSON.parse(dataLine.slice('data: '.length)) as Record<
        string,
        unknown
      >,
    });
  }
  return events;
}

function capturedRecordIds(captured: unknown): string[] {
  if (!captured || typeof captured !== 'object') return [];
  const items = (captured as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) =>
    item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string'
      ? [(item as { id: string }).id]
      : [],
  );
}

jest.setTimeout(180_000);

describe('Critical API E2E', () => {
  let harness: CriticalHarness;
  let fixture: CriticalFixture;

  beforeAll(async () => {
    harness = await createCriticalHarness();
  });

  beforeEach(async () => {
    fixture = await provisionCriticalFixture(harness);
  });

  afterAll(async () => {
    await closeCriticalHarness(harness);
  });

  it('rejects a valid tenant A actor from tenant B workspace data', async () => {
    const before = await harness.adminDatabase.record.count({
      where: { tenantId: fixture.tenantB.id },
    });

    await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantB.code}/objects/${fixture.object.code}/records`,
      )
      .set('Cookie', fixture.employee.cookie)
      .expect(403);

    expect(
      await harness.adminDatabase.record.count({
        where: { tenantId: fixture.tenantB.id },
      }),
    ).toBe(before);
  });

  it('enforces OWN scope, hidden fields, and optimistic locking on records', async () => {
    const base = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records`;

    const created = await request(harness.app.getHttpServer())
      .post(base)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ values: { name: 'Critical lead' } })
      .expect(201);

    expect(created.body.values).toMatchObject({ name: 'Critical lead' });
    expect(created.body.values).not.toHaveProperty('secret');

    const mine = await request(harness.app.getHttpServer())
      .get(`${base}/${fixture.ownedRecord.id}`)
      .set('Cookie', fixture.employee.cookie)
      .expect(200);
    expect(mine.body.values).not.toHaveProperty('secret');

    const page = await request(harness.app.getHttpServer())
      .get(base)
      .set('Cookie', fixture.employee.cookie)
      .expect(200);
    const visibleIds = page.body.items.map((item: { id: string }) => item.id);
    expect(visibleIds).toContain(fixture.ownedRecord.id);
    expect(visibleIds).toContain(created.body.id);
    expect(visibleIds).not.toContain(fixture.otherRecord.id);

    await request(harness.app.getHttpServer())
      .get(`${base}/${fixture.otherRecord.id}`)
      .set('Cookie', fixture.employee.cookie)
      .expect(404);

    const updated = await request(harness.app.getHttpServer())
      .patch(`${base}/${created.body.id}`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ version: created.body.version, values: { name: 'Updated lead' } })
      .expect(200);

    await request(harness.app.getHttpServer())
      .patch(`${base}/${created.body.id}`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ version: created.body.version, values: { name: 'Stale update' } })
      .expect(409);

    expect(updated.body.values).not.toHaveProperty('secret');
  });

  it('executes an allowed workflow transition and rejects a stale version', async () => {
    const path = `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.object.code}/records/${fixture.workflowRecord.id}/workflow`;

    const runtime = await request(harness.app.getHttpServer())
      .get(path)
      .set('Cookie', fixture.employee.cookie)
      .expect(200);

    expect(runtime.body.currentState).toMatchObject({ key: 'new' });
    expect(runtime.body.availableTransitions).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'qualify' })]),
    );

    const executed = await request(harness.app.getHttpServer())
      .post(`${path}/transitions/qualify`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ expectedVersion: fixture.workflowRecord.version })
      .expect(201);

    expect(executed.body.currentState).toMatchObject({ key: 'qualified' });
    expect(executed.body.recordVersion).toBe(
      fixture.workflowRecord.version + 1,
    );

    const history = await request(harness.app.getHttpServer())
      .get(`${path}/history`)
      .set('Cookie', fixture.employee.cookie)
      .expect(200);
    expect(history.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transitionKey: 'qualify' }),
      ]),
    );

    await request(harness.app.getHttpServer())
      .post(`${path}/transitions/reopen`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ expectedVersion: fixture.workflowRecord.version })
      .expect(409);
  });

  it('rolls back earlier action side effects when a later action is denied', async () => {
    const auditCountBefore = await harness.adminDatabase.auditLog.count({
      where: {
        tenantId: fixture.tenantA.id,
        action: { in: ['follow_up.created', 'record.transition_executed'] },
      },
    });

    const before = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.rollbackRecord.id },
      select: { statusKey: true, version: true, data: true, ownerMemberId: true },
    });

    const response = await request(harness.app.getHttpServer())
      .post(
        `/api/v1/workspaces/${fixture.tenantA.code}/objects/${fixture.rollbackObject.code}/records/${fixture.rollbackRecord.id}/workflow/transitions/close-won`,
      )
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .send({ expectedVersion: fixture.rollbackRecord.version });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: 'ACTION_EXECUTION_FAILED' });

    expect(
      await harness.adminDatabase.recordFollowUp.count({
        where: { recordId: fixture.rollbackRecord.id },
      }),
    ).toBe(0);

    expect(
      await harness.adminDatabase.recordTransitionHistory.count({
        where: { recordId: fixture.rollbackRecord.id },
      }),
    ).toBe(0);

    const after = await harness.adminDatabase.record.findUniqueOrThrow({
      where: { id: fixture.rollbackRecord.id },
      select: { statusKey: true, version: true, data: true, ownerMemberId: true },
    });
    expect(after).toEqual(before);

    expect(
      await harness.adminDatabase.auditLog.count({
        where: {
          tenantId: fixture.tenantA.id,
          action: { in: ['follow_up.created', 'record.transition_executed'] },
        },
      }),
    ).toBe(auditCountBefore);
  });

  it('authenticates a session and revokes another active session', async () => {
    const first = request.agent(harness.app.getHttpServer());
    const second = request.agent(harness.app.getHttpServer());

    await first
      .post('/api/v1/auth/verification-challenges')
      .set('Origin', 'http://localhost:3000')
      .send({
        phone: '13911113333',
        purpose: 'REGISTER',
        deviceKey: 'critical-one',
      })
      .expect(202);

    await first
      .post('/api/v1/auth/register')
      .set('Origin', 'http://localhost:3000')
      .send({
        phone: '13911113333',
        code: '123456',
        displayName: 'Critical User',
        password: 'critical-password1',
        deviceSummary: 'Critical Browser One',
      })
      .expect(201);

    await first.get('/api/v1/me').expect(200);

    await second
      .post('/api/v1/auth/login')
      .set('Origin', 'http://localhost:3000')
      .send({
        phone: '13911113333',
        password: 'critical-password1',
        deviceKey: 'critical-two',
        deviceSummary: 'Critical Browser Two',
      })
      .expect(200);

    const sessions = await second
      .get('/api/v1/me/sessions?kind=ACTIVE&page=1&limit=100')
      .expect(200);

    expect(sessions.body).toMatchObject({ page: 1, limit: 100, total: 2 });
    expect(sessions.body.items).toHaveLength(2);
    expect(sessions.body.items[0]).not.toHaveProperty('tokenHash');

    const firstSession = sessions.body.items.find(
      (item: { deviceSummary?: string }) =>
        item.deviceSummary === 'Critical Browser One',
    );
    expect(firstSession).toBeDefined();

    await second
      .delete(`/api/v1/me/sessions/${firstSession.id}`)
      .set('Origin', 'http://localhost:3000')
      .expect(200);

    await first.get('/api/v1/me').expect(401);
  });

  it('lets an employee search only owned leads and hides secret from the stream and captured tool result', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const response = await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({ content: `请查询 ${CRITICAL_SEARCH_OWN_LEADS_MARKER}` })
      .expect(200);

    expect(response.headers['content-type']).toMatch(/text\/event-stream/);
    const events = parseSse(response.text);
    const eventNames = events.map((event) => event.event);
    expect(eventNames).toContain('conversation.ready');
    expect(eventNames).toContain('turn.started');
    expect(eventNames).toContain('tool.started');
    expect(eventNames).toContain('tool.completed');
    expect(eventNames).toContain('turn.completed');
    expect(
      events.some(
        (event) =>
          (event.event === 'tool.started' || event.event === 'tool.completed') &&
          event.data.toolName === 'search_records',
      ),
    ).toBe(true);

    const stream = response.text;
    expect(stream).not.toContain('hidden-owned');
    expect(stream).not.toContain('hidden-other');
    expect(stream).not.toContain('"secret"');
    expect(stream).not.toContain(fixture.ownedRecord.id);
    expect(stream).not.toContain(fixture.otherRecord.id);

    const captured = getFakeAiProviderCapturedToolResult();
    const ids = capturedRecordIds(captured);
    expect(ids).toContain(fixture.ownedRecord.id);
    expect(ids).not.toContain(fixture.otherRecord.id);
    expect(JSON.stringify(captured)).not.toContain('"secret"');
    expect(JSON.stringify(captured)).not.toContain('hidden-owned');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('hides another tenant and another employee from a conversation they do not own', async () => {
    const started = await request(harness.app.getHttpServer())
      .post(`/api/v1/workspaces/${fixture.tenantA.code}/ai/turns`)
      .set('Cookie', fixture.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('Accept', 'text/event-stream')
      .send({ content: '员工 A 的私有会话标题内容' })
      .expect(200);

    const ready = parseSse(started.text).find(
      (event) => event.event === 'conversation.ready',
    );
    expect(ready).toBeDefined();
    const conversationId = ready!.data.conversationId as string;
    expect(conversationId).toEqual(expect.any(String));

    const tenantBMessages = await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/conversations/${conversationId}/messages`,
      )
      .set('Cookie', fixture.tenantBAdmin.cookie);

    expect(tenantBMessages.status).toBe(403);
    expect(tenantBMessages.body).toMatchObject({ code: 'WORKSPACE_FORBIDDEN' });
    expect(JSON.stringify(tenantBMessages.body)).not.toContain(
      '员工 A 的私有会话标题内容',
    );
    expect(JSON.stringify(tenantBMessages.body)).not.toContain(conversationId);

    const tenantBList = await request(harness.app.getHttpServer())
      .get(`/api/v1/workspaces/${fixture.tenantB.code}/ai/conversations`)
      .set('Cookie', fixture.tenantBAdmin.cookie)
      .expect(200);
    expect(tenantBList.body.items).toEqual([]);
    expect(JSON.stringify(tenantBList.body)).not.toContain(conversationId);
    expect(JSON.stringify(tenantBList.body)).not.toContain(
      '员工 A 的私有会话标题内容',
    );

    const otherMessages = await request(harness.app.getHttpServer())
      .get(
        `/api/v1/workspaces/${fixture.tenantA.code}/ai/conversations/${conversationId}/messages`,
      )
      .set('Cookie', fixture.otherEmployee.cookie)
      .expect(404);
    expect(otherMessages.body).toMatchObject({
      code: 'AI_CONVERSATION_NOT_FOUND',
    });
    expect(JSON.stringify(otherMessages.body)).not.toContain(
      '员工 A 的私有会话标题内容',
    );

    const otherList = await request(harness.app.getHttpServer())
      .get(`/api/v1/workspaces/${fixture.tenantA.code}/ai/conversations`)
      .set('Cookie', fixture.otherEmployee.cookie)
      .expect(200);
    expect(otherList.body.items).toEqual([]);
    expect(JSON.stringify(otherList.body)).not.toContain(conversationId);
  });
});
