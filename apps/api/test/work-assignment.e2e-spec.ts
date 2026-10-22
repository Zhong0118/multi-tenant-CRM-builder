import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

const origin = 'http://localhost:3000';
const json = <T>(response: { body: unknown }) => response.body as T;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
jest.setTimeout(120_000);

/**
 * Handing work to another member, checked where it commits. The tests hold
 * the recipient's member row in a separate transaction so the request is
 * parked inside its own transaction, change what the recipient may do, and
 * only then let the request continue: a check made before the transaction
 * opened would have let the assignment through.
 */
describe('assigning work to members (HTTP + PostgreSQL)', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}`;
  const send = (
    method: 'post' | 'patch' | 'put',
    path: string,
    body: object,
    actor: CriticalActor = f.admin,
  ) =>
    request(h.app.getHttpServer())
      [method](base() + path)
      .set('Cookie', actor.cookie)
      .set('Origin', origin)
      .send(body);

  /** Runs `request` while the recipient's member row is held, then `change`s. */
  async function parkedBehind(
    memberId: string,
    start: () => PromiseLike<request.Response>,
    change: (
      tx: Parameters<
        Parameters<CriticalHarness['adminDatabase']['$transaction']>[0]
      >[0],
    ) => Promise<unknown>,
  ) {
    let pending!: Promise<request.Response>;
    await h.adminDatabase.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM tenant_members WHERE id=${memberId}::uuid FOR UPDATE`;
        pending = Promise.resolve(start());
        await pause(600);
        await change(tx);
      },
      { timeout: 20_000 },
    );
    return pending;
  }

  beforeAll(async () => {
    h = await createCriticalHarness();
    await h.app.listen(0, '127.0.0.1');
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });

  it('refuses a record follow-up for a member whose table access was revoked after the request started', async () => {
    const dueAt = new Date(Date.now() + 86_400_000).toISOString();
    const body = {
      objectCode: f.object.code,
      recordId: f.ownedRecord.id,
      title: '回访',
      dueAt,
      assigneeMemberId: f.employee.memberId,
    };
    const refused = await parkedBehind(
      f.employee.memberId,
      () => send('post', '/follow-ups', body),
      (tx) =>
        tx.objectPermission.create({
          data: {
            tenantId: f.tenantA.id,
            objectId: f.object.id,
            subjectType: 'MEMBER',
            subjectMemberId: f.employee.memberId,
            canCreate: false,
            canRead: false,
            canUpdate: false,
            readScope: 'NONE',
            updateScope: 'NONE',
          },
        }),
    );
    expect(refused.status).toBe(400);
    expect(
      await h.adminDatabase.recordFollowUp.count({
        where: { tenantId: f.tenantA.id, title: '回访' },
      }),
    ).toBe(0);

    // With access restored the same assignment goes through.
    await h.adminDatabase.objectPermission.deleteMany({
      where: { subjectMemberId: f.employee.memberId },
    });
    const created = await send('post', '/follow-ups', body).expect(201);
    expect(json<{ assigneeMemberId: string }>(created).assigneeMemberId).toBe(
      f.employee.memberId,
    );
  });
});
