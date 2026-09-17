import request from 'supertest';

import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

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
});
