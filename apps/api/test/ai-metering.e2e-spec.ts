import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

describe('governed model calls from the filter endpoint', () => {
  let h: CriticalHarness, f: CriticalFixture;
  beforeAll(async () => {
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
  });
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  const send = () =>
    request(h.app.getHttpServer())
      .post(`/api/v1/workspaces/${f.tenantA.code}/objects/leads/filter-preview`)
      .set('Cookie', f.employee.cookie)
      .set('Origin', 'http://localhost:3000')
      .set('X-Request-Id', 'same-client-request-id')
      .send({
        text: '换成我负责的客户',
        currentRule: { version: 1, match: 'all', conditions: [] },
      });
  it('bills the full fake provider path by member and releases the 13th reservation before sending', async () => {
    for (let i = 0; i < 12; i++) await send().expect(200);
    const denied = await send().expect(429);
    expect(denied.body).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 60,
    });
    expect(denied.headers['retry-after']).toBe('60');
    const [row] = await h.adminDatabase.$queryRaw<
      { count: number; input: number; output: number; unsent: number }[]
    >`
      SELECT count(*) FILTER(WHERE status='success')::int AS count,sum(input_tokens)::int AS input,
      sum(output_tokens)::int AS output,count(*) FILTER(WHERE status='unsent')::int AS unsent FROM ai_model_calls
      WHERE tenant_id=${f.tenantA.id}::uuid AND member_id=${f.employee.memberId}::uuid AND feature='filter' AND request_id='same-client-request-id'`;
    expect(row).toEqual({ count: 12, input: 96, output: 144, unsent: 1 });
  });
});
