import request from 'supertest';
import { FakeAiProvider } from '../src/modules/ai/providers/fake-ai.provider';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import { assertIsolatedTestDatabase } from './helpers/isolated-database';

type BriefService =
  import('../src/modules/ai/daily-brief/daily-brief.service').DailyBriefService;
type Result<K extends keyof BriefService> = Awaited<
  ReturnType<BriefService[K]>
>;
const read = <K extends keyof BriefService>(res: { body: unknown }) =>
  res.body as Result<K>;

describe('personal daily brief over HTTP', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  const base = () => `/api/v1/workspaces/${f.tenantA.code}/daily-brief`;
  const get = (path = '', actor = f.employee) =>
    request(h.app.getHttpServer())
      .get(base() + path)
      .set('Cookie', actor.cookie);
  const post = (path: string, actor = f.employee) =>
    request(h.app.getHttpServer())
      .post(base() + path)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000');
  beforeAll(async () => {
    assertIsolatedTestDatabase(
      process.env.TEST_DATABASE_URL,
      process.env.TEST_DATABASE_ADMIN_URL,
    );
    h = await createCriticalHarness();
  });
  beforeEach(async () => {
    f = await provisionCriticalFixture(h);
  });
  async function seedOverdue() {
    await h.adminDatabase.record.updateMany({
      where: { tenantId: f.tenantA.id },
      data: { createdAt: new Date('2020-02-01T00:00:00Z') },
    });
    await h.adminDatabase.record.update({
      where: { id: f.rollbackRecord.id },
      data: { statusKey: 'won' },
    });
    await h.adminDatabase.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: f.workflowRecord.id,
        assigneeMemberId: f.employee.memberId,
        title: '联系',
        dueAt: new Date('2020-03-01T00:00:00Z'),
      },
    });
  }
  afterAll(async () => {
    if (h) await closeCriticalHarness(h);
  });
  it('resolves priority before counting, excludes terminal, peer and cross-tenant records without AI', async () => {
    await seedOverdue();
    const body = read<'list'>(await get().expect(200));
    expect(body.groups.map((g: { total: number }) => g.total)).toEqual([
      1, 0, 1, 0,
    ]);
    expect(body.groups[0].items[0].recordId).toBe(f.workflowRecord.id);
    expect(body.groups[2].items[0].recordId).toBe(f.ownedRecord.id);
    await get('/suggestions').expect(403);
    await post('/generate').expect(403);
    await get('/settings').expect(403);
  });
  it('saves administrator rules with optimistic locking; rejects foreign tables', async () => {
    const body = read<'settings'>(await get('/settings', f.admin).expect(200));
    const save = (data: object) =>
      request(h.app.getHttpServer())
        .put(base() + '/settings')
        .set('Cookie', f.admin.cookie)
        .set('Origin', 'http://localhost:3000')
        .send(data);
    const rules = {
      version: body.version,
      objectIds: [f.object.id],
      contactDays: 20,
      stagnantDays: 10,
      reclaimDays: 2,
    };
    await save({ ...rules, objectIds: [f.tenantB.id] }).expect(400);
    await save(rules).expect(200);
    await save(rules).expect(409);
    expect(read<'settings'>(await get('/settings', f.admin)).contactDays).toBe(
      20,
    );
  });

  it('coalesces generation, binds facts to permission, charges only sends and enforces owner RLS', async () => {
    await seedOverdue();
    const db = h.adminDatabase;
    const [plan] = await db.$queryRaw<
      { id: string }[]
    >`INSERT INTO ai_plans(name,features,monthly_tokens) VALUES('brief fixture',ARRAY['daily_brief'],2000000) ON CONFLICT(name) DO UPDATE SET monthly_tokens=2000000 RETURNING id`;
    await db.$executeRaw`UPDATE tenant_ai_configs SET plan_id=${plan.id}::uuid WHERE tenant_id=${f.tenantA.id}::uuid`;
    const capture = jest.spyOn(FakeAiProvider.prototype, 'generateSalesDaily');
    capture.mockImplementationOnce(async (input) => {
      await input.onSend?.();
      const { records } = JSON.parse(input.prompt) as {
        records: {
          recordRef: string;
          facts: { ref: string; text: string }[];
        }[];
      };
      return {
        items: records.map((r) => {
          const code = r.facts.find((fact) =>
            fact.text.includes('initial-review-code'),
          );
          return {
            recordRef: r.recordRef,
            reasonFactRefs: [code?.ref ?? r.facts[0].ref],
            action: 'call',
            explanation: code
              ? '请核对initial-review-code。'
              : '联系经办人确认跟进安排。',
            suggestedTitle: code ? '核对审核编号' : '确认跟进安排',
            suggestedDue: null,
          };
        }),
      };
    });
    try {
      await Promise.all([
        post('/generate').send({ previous: null }).expect(201),
        post('/generate').send({ previous: null }).expect(201),
      ]);
      let cached = read<'suggestions'>(await get('/suggestions').expect(200));
      expect(cached.items).toHaveLength(2);
      expect(
        cached.items.find((i) => i.recordId === f.ownedRecord.id),
      ).toMatchObject({
        suggestedTitle: '核对审核编号',
        explanation: '请核对initial-review-code。',
      });
      await db.record.update({
        where: { id: f.ownedRecord.id },
        data: { ownerMemberId: f.otherEmployee.memberId },
      });
      const afterTransfer = read<'suggestions'>(
        await get('/suggestions').expect(200),
      );
      expect(afterTransfer.items.map((i) => i.recordId)).toEqual([
        f.workflowRecord.id,
      ]);
      expect(afterTransfer.items[0]).toMatchObject({
        suggestedTitle: '致电确认近况',
        explanation: '建议致电确认近况',
      });
      expect(JSON.stringify(afterTransfer)).not.toContain(
        'initial-review-code',
      );
      await db.record.update({
        where: { id: f.ownedRecord.id },
        data: { ownerMemberId: f.employee.memberId },
      });
      expect(cached.remaining).toBe(3);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(capture.mock.calls[0][0].prompt).not.toContain('hidden-owned');
      expect(capture.mock.calls[0][0].prompt).toContain('initial-review-code');
      expect(
        read<'suggestions'>(await get('/suggestions', f.admin)).items,
      ).toEqual([]);
      await db.user.update({
        where: { id: f.admin.userId },
        data: { isPlatformAdmin: true },
      });
      for (const actor of [
        f.employee,
        f.admin,
        f.otherEmployee,
        f.tenantBAdmin,
      ]) {
        const visible = await h.runtimeDatabase.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.user_id',${actor.userId},true),set_config('app.tenant_id',${f.tenantA.id},true)`;
          return tx.$queryRaw<
            { member_id: string }[]
          >`SELECT member_id FROM daily_brief_cache`;
        });
        expect(visible.map((x) => x.member_id)).toEqual(
          actor === f.employee ? [f.employee.memberId] : [],
        );
      }
      await db.$executeRaw`UPDATE ai_plans SET monthly_tokens=0 WHERE id=${plan.id}::uuid`;
      await post('/generate')
        .send({ previous: cached.generatedAt })
        .expect(429);
      expect(read<'suggestions'>(await get('/suggestions')).remaining).toBe(3);
      await db.$executeRaw`UPDATE ai_plans SET monthly_tokens=2000000 WHERE id=${plan.id}::uuid`;
      // A transport failure after dispatch charges the attempt and preserves the prior visible result.
      capture.mockImplementationOnce(async (input) => {
        await input.onSend?.();
        throw new Error('simulated transport failure');
      });
      await post('/generate')
        .send({ previous: cached.generatedAt })
        .expect(503);
      const afterFailure = read<'suggestions'>(await get('/suggestions'));
      expect(afterFailure.items).toEqual(cached.items);
      expect(afterFailure.remaining).toBe(2);
      for (let remaining = 1; remaining >= 0; remaining--) {
        cached = read<'generate'>(
          await post('/generate')
            .send({ previous: cached.generatedAt })
            .expect(201),
        );
        expect(cached.remaining).toBe(remaining);
      }
      await post('/generate')
        .send({ previous: cached.generatedAt })
        .expect(429);
      expect(capture).toHaveBeenCalledTimes(4);
      await db.record.update({
        where: { id: f.workflowRecord.id },
        data: { ownerMemberId: f.otherEmployee.memberId },
      });
      const visible = read<'suggestions'>(
        await get('/suggestions').expect(200),
      ).items;
      expect(visible.map((v: { recordId: string }) => v.recordId)).toEqual([
        f.ownedRecord.id,
      ]);
      await db.tenant.update({
        where: { id: f.tenantA.id },
        data: { timezone: 'Etc/GMT+12' },
      });
      const earlier = read<'suggestions'>(
        await get('/suggestions').expect(200),
      );
      await db.tenant.update({
        where: { id: f.tenantA.id },
        data: { timezone: 'Pacific/Kiritimati' },
      });
      const later = read<'suggestions'>(await get('/suggestions').expect(200));
      expect(earlier.localDate).not.toBe(later.localDate);
      const fresh = [earlier, later].find(
        (x) => x.localDate !== cached.localDate,
      );
      expect(fresh).toMatchObject({
        remaining: 3,
        items: [],
        generatedAt: null,
      });
      await db.$executeRaw`UPDATE tenant_ai_configs SET plan_id=NULL WHERE tenant_id=${f.tenantA.id}::uuid`;
      await get('/suggestions').expect(403);
      const direct = await h.runtimeDatabase.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id',${f.employee.userId},true),set_config('app.tenant_id',${f.tenantA.id},true)`;
        return tx.$queryRaw`SELECT member_id FROM daily_brief_cache`;
      });
      expect(direct).toEqual([]);
    } finally {
      capture.mockRestore();
    }
  });

  it('paginates equal dates, applies local boundary and completed follow-ups, and includes a readable peer record with my overdue follow-up', async () => {
    const db = h.adminDatabase;
    const invoice = await db.objectDefinition.findFirstOrThrow({
      where: { tenantId: f.tenantA.id, code: 'invoices' },
    });
    const records = await db.record.createManyAndReturn({
      data: Array.from({ length: 28 }, (_, i) => ({
        tenantId: f.tenantA.id,
        objectId: invoice.id,
        ownerMemberId:
          i === 27 ? f.otherEmployee.memberId : f.employee.memberId,
        title: '客户' + i,
        recordNo: BigInt(i + 10),
        data: { name: '客户' + i },
        createdAt: new Date('2020-02-01T00:00:00Z'),
      })),
      select: { recordNo: true, id: true },
    });
    const id = (n: number) =>
      records.find((r) => Number(r.recordNo) === n + 10)!.id;
    await db.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: id(27),
        assigneeMemberId: f.employee.memberId,
        title: '本人逾期',
        dueAt: new Date('2020-10-01'),
      },
    });
    await db.recordFollowUp.create({
      data: {
        tenantId: f.tenantA.id,
        recordId: id(26),
        assigneeMemberId: f.otherEmployee.memberId,
        title: '刚完成',
        dueAt: new Date(),
        status: 'DONE',
        completedAt: new Date(),
      },
    });
    await db.$executeRaw`UPDATE records SET pool_stage='FOLLOWING',ownership_expires_at=((CURRENT_TIMESTAMP AT TIME ZONE t.timezone)::date+4)::timestamp AT TIME ZONE t.timezone FROM tenants t WHERE t.id=records.tenant_id AND records.id=${id(25)}::uuid`;
    await db.record.update({
      where: { id: id(24) },
      data: {
        poolStage: 'FOLLOWING',
        ownershipExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const body = read<'list'>(await get().expect(200));
    const groups = body.groups;
    expect(groups[0].items[0].recordId).toBe(id(27));
    expect(groups[1].items[0].recordId).toBe(id(24));
    expect(groups[3]).toMatchObject({ total: 25 });
    expect(groups[3].items).toHaveLength(5);
    const first = read<'list'>(await get('?group=silent').expect(200))
      .groups[3];
    const last = read<'list'>(
      await get(
        '?group=silent&cursor=' + encodeURIComponent(first.nextCursor!),
      ).expect(200),
    ).groups[3];
    expect(last.nextCursor).toBeNull();
    const ids = [...first.items, ...last.items].map(
      (i: { recordId: string }) => i.recordId,
    );
    expect(ids).toEqual(
      [
        ...records
          .filter((r) => ![id(27), id(26), id(24)].includes(r.id))
          .map((r) => r.id),
      ].sort(),
    );
    await db.record.update({
      where: { id: id(24) },
      data: {
        ownerMemberId: null,
        inPublicPool: true,
        poolStage: 'CUSTOMER_POOL',
        ownershipExpiresAt: null,
      },
    });
    expect(read<'list'>(await get()).groups[1].total).toBe(0);
  });
});
