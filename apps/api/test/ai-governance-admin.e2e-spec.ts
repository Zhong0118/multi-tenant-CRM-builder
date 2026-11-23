import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';
import { outputs } from '../src/modules/ai/governance/admin.contract';

jest.setTimeout(120_000);
describe('AI governance administration over HTTP with restricted PostgreSQL roles', () => {
  let h: CriticalHarness;
  let f: CriticalFixture;
  let planId: string | undefined;
  const http = (
    actor: CriticalActor,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    const req = request(h.app.getHttpServer())
      [method]('/api/v1' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000');
    return body ? req.send(body) : req;
  };
  beforeAll(async () => {
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
    await h.adminDatabase.user.update({
      where: { id: f.tenantBAdmin.userId },
      data: { isPlatformAdmin: true },
    });
  });
  afterAll(async () => {
    if (!h) return;
    if (planId) {
      await h.adminDatabase
        .$executeRaw`UPDATE tenant_ai_configs SET plan_id=NULL WHERE plan_id=${planId}::uuid`;
      await h.adminDatabase
        .$executeRaw`DELETE FROM ai_plans WHERE id=${planId}::uuid`;
    }
    await closeCriticalHarness(h);
  });
  it('enforces session roles, stale previews, exact quota replays, audit and zero-content platform aggregates', async () => {
    const workspace = '/workspaces/' + f.tenantA.code + '/ai';
    const detail = '/platform/tenants/' + f.tenantA.id + '/ai';
    const platform = f.tenantBAdmin;
    await http(f.admin, 'get', '/platform/ai-plans').expect(403);
    for (const suffix of ['/settings', '/usage', '/operations'])
      await http(f.employee, 'get', workspace + suffix).expect(403);
    await http(platform, 'get', workspace + '/operations').expect(403);
    const fields = {
      name: 'governance-' + randomUUID(),
      description: 'HTTP fixture',
      features: ['assistant'],
      monthlyTokens: '20000',
      assignable: true,
    };
    const created = outputs.plan.parse(
      (await http(platform, 'post', '/platform/ai-plans', fields).expect(200))
        .body,
    );
    planId = created.id;
    const initial = outputs.assignment.parse(
      (
        await http(platform, 'post', detail + '/preview', { planId }).expect(
          200,
        )
      ).body,
    );
    const edit = { ...fields, monthlyTokens: '20001' };
    const change = outputs.planImpact.parse(
      (
        await http(
          platform,
          'post',
          '/platform/ai-plans/' + planId + '/preview',
          edit,
        ).expect(200)
      ).body,
    );
    await http(platform, 'patch', '/platform/ai-plans/' + planId, {
      ...edit,
      confirmation: change.confirmation,
    }).expect(200);
    await http(platform, 'patch', detail, {
      planId,
      confirmation: initial.confirmation,
    }).expect(409);
    const current = outputs.assignment.parse(
      (
        await http(platform, 'post', detail + '/preview', { planId }).expect(
          200,
        )
      ).body,
    );
    await http(platform, 'patch', detail, {
      planId,
      confirmation: current.confirmation,
    }).expect(200);
    await http(platform, 'delete', '/platform/ai-plans/' + planId, {
      version: 2,
    }).expect(409);
    const pre = outputs.workspace.parse(
      (await http(f.admin, 'get', workspace + '/settings').expect(200)).body,
    );
    const quota = {
      month: pre.month,
      amount: '100',
      idempotencyKey: randomUUID(),
    };
    const concurrent = await Promise.all([
      http(platform, 'post', detail + '/quota', quota).expect(200),
      http(platform, 'post', detail + '/quota', quota).expect(200),
    ]);
    expect(
      concurrent.map((r) => outputs.topUp.parse(r.body).applied).sort(),
    ).toEqual([false, true]);
    await http(platform, 'post', detail + '/quota', {
      ...quota,
      amount: '101',
    }).expect(409);
    await http(f.admin, 'patch', workspace + '/settings', {
      allocation: 'equal',
      confirmation: pre.preview.confirmation,
    }).expect(409);
    const post = outputs.workspace.parse(
      (await http(f.admin, 'get', workspace + '/settings').expect(200)).body,
    );
    expect(post).toMatchObject({
      extraTokens: '100',
      totalTokens: '20101',
      preview: { members: 3, shareTokens: '6700' },
    });
    await http(f.admin, 'patch', workspace + '/settings', {
      allocation: 'equal',
      confirmation: post.preview.confirmation,
    }).expect(200);
    const capability = outputs.capabilities.parse(
      (await http(f.employee, 'get', workspace + '/capabilities').expect(200))
        .body,
    );
    expect(capability).toMatchObject({
      features: ['assistant'],
      notice: 'personal',
      remainingTokens: '6700',
    });
    const aggregate = outputs.summary.parse(
      (await http(platform, 'get', detail).expect(200)).body,
    );
    expect(aggregate.trend).toHaveLength(6);
    expect(
      outputs.usage.parse(
        (await http(f.admin, 'get', workspace + '/usage').expect(200)).body,
      ).members,
    ).toHaveLength(3);
    expect(
      outputs.companies.parse(
        (
          await http(
            platform,
            'get',
            '/platform/ai-companies?search=critical-a',
          ).expect(200)
        ).body,
      ).items[0]?.tenantId,
    ).toBe(f.tenantA.id);
    for (const sort of ['', '&aiOrder=desc', '&aiOrder=asc']) {
      const { body } = await http(
        platform,
        'get',
        '/platform/tenants?search=critical-a' + sort,
      ).expect(200);
      expect(body.items[0]).toMatchObject({
        id: f.tenantA.id,
        aiPlanName: aggregate.planName,
        aiPercent: aggregate.percent,
      });
      expect(body.items[0]).toHaveProperty('configuration');
    }
    expect(
      await h.adminDatabase.auditLog.count({
        where: { tenantId: f.tenantA.id, action: 'ai.quota_added' },
      }),
    ).toBe(1);
  });
  it('can pause, restore and change the default without reassigning existing companies', async () => {
    const platform = f.tenantBAdmin;
    const path = '/platform/ai-settings';
    const before = outputs.platform.parse(
      (await http(platform, 'get', path).expect(200)).body,
    );
    const existing = outputs.summary.parse(
      (
        await http(
          platform,
          'get',
          '/platform/tenants/' + f.tenantA.id + '/ai',
        ).expect(200)
      ).body,
    );
    const tenantId = randomUUID();
    try {
      await http(platform, 'patch', path, {
        version: before.version,
        defaultPlanId: null,
        disabled: true,
        reason: '   ',
      }).expect(400);
      const changed = outputs.settings.parse(
        (
          await http(platform, 'patch', path, {
            version: before.version,
            defaultPlanId: null,
            disabled: true,
            reason: 'governance test',
          }).expect(200)
        ).body,
      );
      expect(changed).toMatchObject({ disabled: true, defaultPlanId: null });
      const caps = outputs.capabilities.parse(
        (
          await http(
            f.employee,
            'get',
            '/workspaces/' + f.tenantA.code + '/ai/capabilities',
          ).expect(200)
        ).body,
      );
      expect(caps).toMatchObject({ disabled: true, features: [] });
      await http(platform, 'patch', path, {
        version: before.version,
        defaultPlanId: before.defaultPlanId,
        disabled: false,
        reason: null,
      }).expect(409);
      await h.adminDatabase.tenant.create({
        data: {
          id: tenantId,
          name: 'AI default fixture',
          code: 'gov-' + tenantId,
          status: 'ACTIVE',
        },
      });
      expect(
        outputs.summary.parse(
          (
            await http(
              platform,
              'get',
              '/platform/tenants/' + tenantId + '/ai',
            ).expect(200)
          ).body,
        ).planId,
      ).toBeNull();
      expect(
        outputs.summary.parse(
          (
            await http(
              platform,
              'get',
              '/platform/tenants/' + f.tenantA.id + '/ai',
            ).expect(200)
          ).body,
        ).planId,
      ).toBe(existing.planId);
      await http(platform, 'patch', path, {
        version: changed.version,
        defaultPlanId: before.defaultPlanId,
        disabled: before.disabled,
        reason: before.reason,
      }).expect(200);
    } finally {
      await h.adminDatabase
        .$executeRaw`UPDATE ai_platform_settings SET default_plan_id=${before.defaultPlanId}::uuid, disabled=${before.disabled},reason=${before.reason ?? ''} WHERE id`;
      await h.adminDatabase.tenant.deleteMany({ where: { id: tenantId } });
    }
  });
  it('returns metadata only from list and strips deleted target details and their generic audit payload', async () => {
    const workspace = '/workspaces/' + f.tenantA.code + '/ai';
    const id = randomUUID();
    const requestId = randomUUID();
    await h.adminDatabase
      .$executeRaw`INSERT INTO ai_operation_records(id,tenant_id,member_id,feature,source,status,request_id,request_text,object_id,record_id,changes)
 VALUES (${id}::uuid,${f.tenantA.id}::uuid,${f.employee.memberId}::uuid,'write_proposal','proposal','EXECUTED',${requestId},'secret historical input',${f.object.id}::uuid,${randomUUID()}::uuid,'{"operationType":"UPDATE_RECORD"}'::jsonb)`;
    await h.adminDatabase.auditLog.create({
      data: {
        tenantId: f.tenantA.id,
        actorType: 'USER',
        actorId: f.employee.userId,
        resourceType: 'record',
        resourceId: f.ownedRecord.id,
        action: 'record.updated',
        after: {
          aiOperationId: id,
          values: { sensitive: 'secret historical input' },
        },
        requestId,
      },
    });
    const page = outputs.operations.parse(
      (
        await http(
          f.admin,
          'get',
          workspace + '/operations?source=proposal&limit=1',
        ).expect(200)
      ).body,
    );
    expect(page.items[0]?.id).toBe(id);
    for (const [operationType, matches] of [
      ['UPDATE_RECORD', true],
      ['ADD_ACTIVITY_NOTE', false],
    ] as const) {
      const url =
        workspace +
        '/operations?memberId=' +
        f.employee.memberId +
        '&operationType=' +
        operationType;
      const filtered = outputs.operations.parse(
        (await http(f.admin, 'get', url).expect(200)).body,
      );
      expect(filtered.items.some((item) => item.id === id)).toBe(matches);
    }
    const operation = outputs.detail.parse(
      (await http(f.admin, 'get', workspace + '/operations/' + id).expect(200))
        .body,
    );
    expect(operation).toMatchObject({
      id,
      requestText: null,
      items: [],
      objectId: null,
      recordId: null,
      auditId: null,
    });
    await http(
      f.tenantBAdmin,
      'get',
      '/workspaces/' + f.tenantB.code + '/ai/operations/' + id,
    ).expect(404);
    const audits = await http(
      f.admin,
      'get',
      '/workspaces/' + f.tenantA.code + '/audit',
    ).expect(200);
    expect(audits.text).not.toContain('secret historical input');
    const platformAudit = await http(
      f.tenantBAdmin,
      'get',
      '/platform/audit?tenantId=' + f.tenantA.id,
    ).expect(200);
    expect(platformAudit.text).not.toContain('secret historical input');
  });
});
