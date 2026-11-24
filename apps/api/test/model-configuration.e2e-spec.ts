import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { modelOutputs as outputs } from '../src/modules/ai/governance/model-admin.contract';
import { ModelConfigurationStore } from '../src/modules/ai/governance/model-configuration.store';
import { DatabaseContextRunner } from '../src/infrastructure/database/context-runner';
import {
  testModel,
  discoverModels,
} from '../src/modules/ai/governance/model-runtime';
jest.mock('../src/modules/ai/governance/model-runtime', () => ({
  testModel: jest.fn(),
  discoverModels: jest.fn(),
}));
import {
  closeCriticalHarness,
  createCriticalHarness,
  provisionCriticalFixture,
  type CriticalActor,
  type CriticalFixture,
  type CriticalHarness,
} from './helpers/critical-fixture';

describe('platform model configuration over HTTP', () => {
  jest.setTimeout(120_000);
  let h: CriticalHarness, f: CriticalFixture;
  const createdIds: string[] = [];
  const api = (
    actor: CriticalActor,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    const req = request(h.app.getHttpServer())
      [method]('/api/v1/platform/ai-models' + path)
      .set('Cookie', actor.cookie)
      .set('Origin', 'http://localhost:3000');
    return body ? req.send(body) : req;
  };
  beforeAll(async () => {
    process.env.AI_MODEL_KEYRING = JSON.stringify({
      activeKeyId: 'fixture',
      keys: { fixture: randomBytes(32).toString('base64') },
    });
    h = await createCriticalHarness();
    f = await provisionCriticalFixture(h);
    await h.adminDatabase.user.update({
      where: { id: f.tenantBAdmin.userId },
      data: { isPlatformAdmin: true },
    });
  });
  afterAll(async () => {
    if (!h) return;
    for (const providerId of createdIds) {
      await h.adminDatabase
        .$executeRaw`DELETE FROM ai_model_assignments WHERE provider_id=${providerId}::uuid`;
      await h.adminDatabase
        .$executeRaw`DELETE FROM ai_model_providers WHERE id=${providerId}::uuid`;
    }
    await closeCriticalHarness(h);
    delete process.env.AI_MODEL_KEYRING;
  });
  it('enforces roles, immutable edits, secret rotation, public responses and destination binding', async () => {
    const admin = f.tenantBAdmin;
    for (const actor of [f.employee, f.admin]) {
      await api(actor, 'get', '').expect(403);
      await api(actor, 'post', '/import-environment', {}).expect(403);
    }
    const fields = {
      name: 'fixture-' + randomUUID(),
      preset: 'custom',
      baseURL: 'https://example.com/v1',
      protocol: 'chat',
      embeddings: false,
      models: [
        {
          name: 'fixture',
          capabilities: ['text'],
          contextTokens: 48000,
          maxOutputTokens: 16000,
          inputPrice: '0.25',
          outputPrice: '1.50',
          currency: 'USD',
        },
      ],
    };
    const created = await api(admin, 'post', '/providers', fields).expect(200);
    const providerId = outputs.saved.parse(created.body).id;
    createdIds.push(providerId);
    const path = '/providers/' + providerId;
    const key = randomBytes(32).toString('base64');
    const changed = await api(admin, 'post', path + '/key', {
      version: 1,
      apiKey: key,
    }).expect(200);
    expect(changed.text.includes(key)).toBe(false);
    await api(admin, 'post', path + '/key', { version: 1, apiKey: key }).expect(
      409,
    );
    const listed = await api(admin, 'get', '').expect(200);
    expect(listed.text.includes(key)).toBe(false);
    expect(
      outputs.state
        .parse(listed.body)
        .providers.find((p) => p.id === providerId)?.revisions[0].keyLast4,
    ).toBe(key.slice(-4));
    const audit = await h.adminDatabase.auditLog.findMany({
      where: { resourceId: providerId },
    });
    expect(JSON.stringify(audit).includes(key)).toBe(false);
    const encrypted = await h.adminDatabase
      .$queryRaw`SELECT * FROM ai_model_credentials WHERE provider_id=${providerId}::uuid`;
    expect(JSON.stringify(encrypted).includes(key)).toBe(false);
    await api(admin, 'post', path + '/activate', {
      version: 2,
      revisionId: outputs.saved.parse(changed.body).revisionId,
    }).expect(409);
    await api(admin, 'patch', path, {
      ...fields,
      version: 2,
      baseURL: 'https://example.org/v1',
    }).expect(200);
    const after = await api(admin, 'get', '').expect(200);
    expect(
      outputs.state.parse(after.body).providers.find((p) => p.id === providerId)
        ?.revisions[0].keyLast4,
    ).toBeNull();
  });

  it('imports without activation, orders overlapping tests, pins current assignments and rotates old envelopes', async () => {
    const platform = f.tenantBAdmin;
    const config = h.app.get(ConfigService);
    const vendorKey = randomBytes(32).toString('hex'),
      firstMaster = randomBytes(32).toString('base64'),
      secondMaster = randomBytes(32).toString('base64');
    // The previous test also wrote an envelope; keep its original master online.
    const previous = JSON.parse(
      config.getOrThrow<string>('AI_MODEL_KEYRING'),
    ) as { keys: Record<string, string> };
    const firstKeys = { ...previous.keys, initial: firstMaster };
    const keyring = (activeKeyId: string, keys: Record<string, string>) =>
      config.set('AI_MODEL_KEYRING', JSON.stringify({ activeKeyId, keys }));
    keyring('initial', firstKeys);
    config.set('AI_PROVIDER', 'openai');
    config.set('AI_MODEL', 'imported-model');
    config.set('AI_API_KEY', vendorKey);
    config.set('AI_BASE_URL', 'https://example.org/v1');
    const imported = await api(
      platform,
      'post',
      '/import-environment',
      {},
    ).expect(200);
    const id = outputs.saved.parse(imported.body).id;
    createdIds.push(id);
    expect(
      (await api(platform, 'post', '/import-environment', {}).expect(200)).body,
    ).toEqual(imported.body);
    expect(imported.text.includes(vendorKey)).toBe(false);
    const actor = {
      userId: f.employee.userId,
      memberId: f.employee.memberId,
      tenantId: f.tenantA.id,
      tenantCode: f.tenantA.code,
      role: 'EMPLOYEE' as const,
    };
    const read = h.app.get(ModelConfigurationStore);
    const secondInstance = new ModelConfigurationStore(
      h.app.get(DatabaseContextRunner),
      config,
    );
    expect(await secondInstance.resolve(actor, 'text')).toBeNull();
    const path = '/providers/' + id,
      model = 'imported-model';
    const fields = {
      name: 'import test',
      preset: 'custom',
      baseURL: 'https://example.org/v1',
      protocol: 'responses',
      embeddings: false,
      models: [
        {
          name: model,
          capabilities: ['text'],
          contextTokens: 48000,
          maxOutputTokens: 15000,
          inputPrice: '0.25',
          outputPrice: '1.50',
          currency: 'USD',
        },
      ],
    };
    const saved = await api(platform, 'patch', path, {
      ...fields,
      version: 1,
    }).expect(200);
    let revisionId = outputs.saved.parse(saved.body).revisionId;
    const success = {
      steps: [
        { name: 'text', durationMs: 1, ok: true },
        { name: 'tool', durationMs: 2, ok: true },
        { name: 'draft', durationMs: 3, ok: true },
      ],
      durationMs: 6,
      dimensions: null,
      inputTokens: 10,
      outputTokens: 8,
      errorCode: null,
    };
    const probe = (version: number) =>
      api(platform, 'post', path + '/test', {
        version,
        revisionId,
        model,
        purpose: 'text',
      })
        .expect(200)
        .then((r) => outputs.result.parse(r.body));
    const assign = (
      version: number,
      testId: string,
      assignmentVersion: number,
    ) =>
      api(platform, 'post', '/assignments/text', {
        version,
        revisionId,
        model,
        testId,
        providerId: id,
        assignmentVersion,
      });
    jest.mocked(discoverModels).mockResolvedValue([model]);
    await api(platform, 'post', path + '/discover', {
      version: 2,
      revisionId,
    }).expect(200, { models: [model] });
    await api(platform, 'post', path + '/activate', {
      version: 2,
      revisionId,
    }).expect(409);
    jest.mocked(testModel).mockResolvedValue(success);
    const low = await probe(2);
    const insufficient = await assign(2, low.id, 0).expect(400);
    expect(insufficient.text).toContain('16000');
    fields.models[0].maxOutputTokens = 16000;
    revisionId = outputs.saved.parse(
      (
        await api(platform, 'patch', path, { ...fields, version: 2 }).expect(
          200,
        )
      ).body,
    ).revisionId;
    let finish!: (result: typeof success) => void, begin!: () => void;
    const pending = new Promise<typeof success>((resolve) => {
      finish = resolve;
    });
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    jest
      .mocked(testModel)
      .mockImplementationOnce(() => {
        begin();
        return pending;
      })
      .mockResolvedValueOnce({
        ...success,
        errorCode: 'CREDENTIAL_REJECTED',
        steps: [
          {
            name: 'text',
            durationMs: 1,
            ok: false,
            errorCode: 'CREDENTIAL_REJECTED',
          },
        ],
      });
    const older = probe(3);
    await started;
    const failure = await probe(3);
    finish(success);
    const late = await older;
    expect(late.sequence).toBeLessThan(failure.sequence);
    await assign(3, late.id, 0).expect(409);
    const ok = await probe(3);
    await assign(3, ok.id, 0).expect(200);
    const snapshot = await read.resolve(actor, 'text');
    expect(snapshot?.apiKey === vendorKey).toBe(true);
    expect(snapshot?.revisionId).toBe(revisionId);
    expect(snapshot?.assignmentVersion).toBe(1);
    await api(platform, 'delete', path, { version: 4 }).expect(409);
    await api(platform, 'post', path + '/status', {
      version: 4,
      enabled: false,
    }).expect(409);
    const runner = h.app.get(DatabaseContextRunner);
    await expect(
      runner.withTenant(
        actor,
        (tx) =>
          tx.$queryRaw`SELECT * FROM ai_resolve_model(${actor.tenantId}::uuid,${actor.memberId}::uuid,'text',ARRAY[]::text[])`,
      ),
    ).rejects.toThrow(/42501/);
    expect(
      await runner.withTenant(
        actor,
        (tx) => tx.$queryRaw`SELECT id FROM ai_model_tests`,
      ),
    ).toEqual([]);
    const next = await api(platform, 'post', path + '/key', {
      version: 4,
      apiKey: randomBytes(32).toString('hex'),
    }).expect(200);
    expect((await secondInstance.resolve(actor, 'text'))?.revisionId).toBe(
      revisionId,
    );
    revisionId = outputs.saved.parse(next.body).revisionId;
    const retest = await probe(5);
    await assign(5, retest.id, 0).expect(409);
    await assign(5, retest.id, 1).expect(200);
    const upgraded = await secondInstance.resolve(actor, 'text');
    expect(upgraded?.assignmentVersion).toBe(2);
    expect(upgraded?.revisionId).toBe(revisionId);
    expect(upgraded?.apiKey === vendorKey).toBe(false);
    expect(snapshot?.apiKey === vendorKey).toBe(true);
    keyring('unrelated', { unrelated: randomBytes(32).toString('base64') });
    await expect(secondInstance.resolve(actor, 'text')).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
    });
    await api(platform, 'post', path + '/activate', {
      revisionId,
      version: 6,
    }).expect(503);
    keyring('next', { ...firstKeys, next: secondMaster });
    const rotation = await api(
      platform,
      'post',
      '/rotate-master-key',
      {},
    ).expect(200);
    expect(
      outputs.rotation.parse(rotation.body).rotated,
    ).toBeGreaterThanOrEqual(2);
    expect(outputs.rotation.parse(rotation.body).remaining).toBe(0);
    keyring('next', { next: secondMaster });
    expect(
      (await secondInstance.resolve(actor, 'text'))?.apiKey ===
        upgraded?.apiKey,
    ).toBe(true);
    await api(platform, 'post', '/rotate-master-key', {}).expect(200, {
      rotated: 0,
      remaining: 0,
    });
  });

  it('requires explicit confirmation when the measured embedding dimensions change', async () => {
    const platform = f.tenantBAdmin;
    const fields = {
      name: 'vector-' + randomUUID(),
      preset: 'custom',
      baseURL: 'https://example.org/v1',
      protocol: 'chat',
      embeddings: true,
      models: [
        {
          name: 'vector',
          capabilities: ['embedding'],
          contextTokens: null,
          maxOutputTokens: null,
          inputPrice: null,
          outputPrice: null,
          currency: null,
        },
      ],
    };
    const p = outputs.saved.parse(
      (await api(platform, 'post', '/providers', fields).expect(200)).body,
    );
    createdIds.push(p.id);
    const path = '/providers/' + p.id;
    let head = outputs.saved.parse(
      (
        await api(platform, 'post', path + '/key', {
          version: p.version,
          apiKey: randomBytes(24).toString('base64'),
        }).expect(200)
      ).body,
    );
    async function probe(dimensions: number) {
      jest.mocked(testModel).mockResolvedValue({
        steps: [{ name: 'embedding', durationMs: 2, ok: true }],
        durationMs: 2,
        inputTokens: 2,
        outputTokens: 0,
        errorCode: null,
        dimensions,
      });
      return outputs.result.parse(
        (
          await api(platform, 'post', path + '/test', {
            version: head.version,
            revisionId: head.revisionId,
            model: 'vector',
            purpose: 'embedding',
          }).expect(200)
        ).body,
      );
    }
    await api(platform, 'post', path + '/test', {
      version: head.version,
      revisionId: head.revisionId,
      model: 'vector',
      purpose: 'vision',
    }).expect(400);
    const first = await probe(64);
    await api(platform, 'post', '/assignments/embedding', {
      version: head.version,
      revisionId: head.revisionId,
      model: 'vector',
      providerId: p.id,
      testId: first.id,
      assignmentVersion: 0,
    }).expect(200);
    head = outputs.saved.parse(
      (
        await api(platform, 'patch', path, { ...fields, version: 3 }).expect(
          200,
        )
      ).body,
    );
    await probe(128);
    await api(platform, 'post', path + '/activate', {
      version: 4,
      revisionId: head.revisionId,
    }).expect(409);
    await api(platform, 'post', path + '/activate', {
      version: 4,
      revisionId: head.revisionId,
      confirmReindex: true,
    }).expect(200);
    const state = outputs.state.parse(
      (await api(platform, 'get', '').expect(200)).body,
    );
    expect(
      state.assignments.find((a) => a.purpose === 'embedding'),
    ).toMatchObject({
      version: 2,
      dimensions: 128,
      revisionId: head.revisionId,
    });
  });
});
