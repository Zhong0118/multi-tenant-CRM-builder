import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@crm/database';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import {
  RATE_LIMITER,
  type RateLimiter,
} from '../../../infrastructure/rate-limit/rate-limiter';
import { AuditService } from '../../audit/audit.service';
import { ApiException } from '../../../common/errors/api.exception';
import { conflict, invalid, type Tx } from './admin-usage';
import type { AuditMeta } from './admin-platform.service';
import {
  modelInputs,
  MODEL_TEST_SUITE_VERSION,
  type Draft,
  type ModelTest,
  type ModelPurpose,
  type Assignment,
} from './model-admin.contract';
import {
  ModelConfigurationStore,
  persistRevision,
  providerFor,
  revisionFor,
  testFields,
  assignments,
  type Provider,
  type Revision,
} from './model-configuration.store';
import { normalizeModelBaseURL, ModelConnectionError } from './model-transport';

function runtime(): typeof import('./model-runtime') {
  // CommonJS Nest also serves legacy/test deployments without loading the SDK.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy CommonJS SDK boundary
  return require('./model-runtime') as typeof import('./model-runtime');
}
type Input<K extends keyof typeof modelInputs> = z.infer<
  (typeof modelInputs)[K]
>;
type Actor = { user: string; meta: AuditMeta };
function normalize(draft: Draft): Draft {
  if (new Set(draft.models.map((m) => m.name)).size !== draft.models.length)
    invalid('模型名称不能重复。');
  for (const m of draft.models) {
    if (new Set(m.capabilities).size !== m.capabilities.length)
      invalid('模型能力不能重复。');
    if ((m.inputPrice !== null || m.outputPrice !== null) && !m.currency)
      invalid('请填写单价币种。');
    if (
      m.maxOutputTokens &&
      m.contextTokens &&
      m.maxOutputTokens > m.contextTokens
    )
      invalid('最大输出不能超过上下文长度。');
  }
  try {
    return { ...draft, baseURL: normalizeModelBaseURL(draft.baseURL) };
  } catch {
    invalid('请填写有效的公开 HTTPS 基址。');
  }
}
function capable(r: Revision, model: string, purpose: ModelPurpose) {
  const m = r.models.find((m) => m.name === model);
  if (
    !m?.capabilities.includes(purpose) ||
    (purpose === 'embedding' && !r.embeddings)
  )
    invalid('当前配置未声明对应模型及接口能力。');
  return m;
}
const selected = (p: Provider) => p.draftRevisionId ?? p.activeRevisionId!;
const revisionSummary = (r: Revision) => ({
  id: r.id,
  baseURL: r.baseURL,
  protocol: r.protocol,
  embeddings: r.embeddings,
  models: r.models,
});

@Injectable()
export class ModelAdminService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly store: ModelConfigurationStore,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}
  private write<T>(actor: Actor, work: (tx: Tx) => Promise<T>) {
    return this.runner.withUser(actor.user, async (tx) => {
      // Configuration writes are rare. This existing singleton serializes edits,
      // assignment changes and test completions across all API replicas.
      const rows = await tx.$queryRaw<
        { id: boolean }[]
      >`SELECT id FROM ai_platform_settings WHERE id AND ai_is_platform() FOR UPDATE`;
      if (!rows.length) throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      return work(tx);
    });
  }
  private log(
    tx: Tx,
    actor: Actor,
    id: string | undefined,
    action: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) {
    return this.audit.append(tx, {
      ...actor.meta,
      actorId: actor.user,
      actorType: 'USER',
      resourceType: 'ai_model_provider',
      resourceId: id,
      action: 'ai.model_' + action,
      before,
      after,
    });
  }
  private async credential(tx: Tx, id: string, version: number, key: string) {
    const ring = this.store.ring(),
      credentialId = randomUUID();
    const e = ring.seal(id, credentialId, key),
      keyLast4 = key.slice(-4);
    await tx.$executeRaw`INSERT INTO ai_model_credentials(id,provider_id,version,last_four,key_id,nonce,ciphertext,tag,verifier) VALUES (${credentialId}::uuid,${id}::uuid,${version}::int,${keyLast4},${e.keyId},${e.nonce},${e.ciphertext},${e.tag},${ring.verifier()})`;
    return { credentialId, keyLast4 };
  }
  private async insert(tx: Tx, actor: Actor, draft: Draft, key?: string) {
    const [{ id }] = await tx.$queryRaw<
      { id: string }[]
    >`INSERT INTO ai_model_providers(name,preset,environment_import) VALUES(${draft.name},${draft.preset},${key !== undefined}) RETURNING id`;
    const c = key === undefined ? null : await this.credential(tx, id, 1, key);
    const revisionId = await persistRevision(
      tx,
      id,
      draft,
      c?.credentialId ?? null,
      c?.keyLast4 ?? null,
    );
    await tx.$executeRaw`UPDATE ai_model_providers SET draft_revision_id=${revisionId}::uuid WHERE id=${id}::uuid`;
    await this.log(
      tx,
      actor,
      id,
      key === undefined ? 'created' : 'environment_imported',
      undefined,
      { ...draft, revisionId },
    );
    return { id, version: 1, revisionId };
  }
  create(actor: Actor, input: Draft) {
    const draft = normalize(input);
    return this.write(actor, (tx) => this.insert(tx, actor, draft));
  }
  importEnvironment(actor: Actor) {
    return this.write(actor, async (tx) => {
      const [prior] = await tx.$queryRaw<
        { id: string; version: number; revisionId: string }[]
      >`SELECT id,version,coalesce(draft_revision_id,active_revision_id) AS "revisionId" FROM ai_model_providers WHERE environment_import`;
      if (prior) return prior;
      const env = this.store.environment();
      const key = this.config.get<string>('AI_API_KEY')?.trim();
      if (
        !env.configured ||
        env.provider !== 'openai' ||
        !env.model ||
        !key ||
        key.length < 5
      )
        invalid('旧部署配置不完整，无法转换。');
      const draft = normalize({
        name: '环境变量连接',
        preset: 'openai',
        baseURL:
          this.config.get<string>('AI_BASE_URL')?.trim() ||
          'https://api.openai.com/v1',
        protocol: 'responses',
        embeddings: false,
        models: [
          {
            name: env.model,
            capabilities: ['text'],
            contextTokens: null,
            maxOutputTokens: null,
            inputPrice: null,
            outputPrice: null,
            currency: null,
          },
        ],
      });
      return this.insert(tx, actor, draft, key);
    });
  }
  edit(actor: Actor, id: string, input: Input<'edit'>) {
    const { version, ...fields } = input,
      draft = normalize(fields);
    return this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, version),
        prior = await revisionFor(tx, p, selected(p));
      const retain = prior.baseURL === draft.baseURL;
      if (retain && prior.credentialId)
        await this.store.forAdmin(tx, p, prior, '', 'text');
      const revisionId = await persistRevision(
        tx,
        id,
        draft,
        retain ? prior.credentialId : null,
        retain ? prior.keyLast4 : null,
      );
      await tx.$executeRaw`UPDATE ai_model_providers SET name=${draft.name},preset=${draft.preset},draft_revision_id=${revisionId}::uuid,version=version+1 WHERE id=${id}::uuid`;
      await this.log(
        tx,
        actor,
        id,
        'edited',
        { name: p.name, preset: p.preset, ...revisionSummary(prior) },
        { ...draft, revisionId },
      );
      return { id, version: version + 1, revisionId };
    });
  }
  key(actor: Actor, id: string, input: Input<'key'>) {
    return this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, input.version),
        r = await revisionFor(tx, p, selected(p));
      const c = await this.credential(tx, id, p.version + 1, input.apiKey);
      const revisionId = await persistRevision(
        tx,
        id,
        r,
        c.credentialId,
        c.keyLast4,
      );
      await tx.$executeRaw`UPDATE ai_model_providers SET draft_revision_id=${revisionId}::uuid,version=version+1 WHERE id=${id}::uuid`;
      await this.log(tx, actor, id, 'key_changed', undefined, {
        status: '已更换',
      });
      return { id, version: p.version + 1, revisionId };
    });
  }
  private rate(actor: Actor) {
    return this.limiter.consume({
      key: 'platform-ai-model:' + actor.user,
      limit: 12,
      windowSeconds: 60,
    });
  }
  async discover(
    actor: Actor,
    id: string,
    input: Input<'revisionAction'>,
    signal: AbortSignal,
  ) {
    await this.rate(actor);
    const config = await this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, input.version),
        r = await revisionFor(tx, p, input.revisionId);
      return this.store.forAdmin(tx, p, r, '', 'text');
    });
    try {
      const models = await runtime().discoverModels(config, signal);
      return { models: models.filter((name) => !name.includes(config.apiKey)) };
    } catch (error) {
      const code =
        error instanceof ModelConnectionError
          ? error.code
          : 'MODEL_REQUEST_FAILED';
      throw new ApiException('AI_PROVIDER_UNAVAILABLE', 502, {
        message: '获取模型失败（' + code + '），可手动录入模型名称。',
      });
    }
  }
  async test(
    actor: Actor,
    id: string,
    input: Input<'test'>,
    signal: AbortSignal,
  ) {
    await this.rate(actor);
    const { config, testId } = await this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, input.version),
        r = await revisionFor(tx, p, input.revisionId);
      capable(r, input.model, input.purpose);
      const config = await this.store.forAdmin(
        tx,
        p,
        r,
        input.model,
        input.purpose,
      );
      const [t] = await tx.$queryRaw<
        { id: string }[]
      >`INSERT INTO ai_model_tests(revision_id,credential_id,model_name,purpose,suite,actor_id) VALUES (${r.id}::uuid,${r.credentialId}::uuid,${input.model},${input.purpose},${MODEL_TEST_SUITE_VERSION},${actor.user}::uuid) RETURNING id`;
      return { config, testId: t.id };
    });
    const started = performance.now();
    const outcome: Awaited<
      ReturnType<ReturnType<typeof runtime>['testModel']>
    > = await Promise.resolve()
      .then(() => runtime().testModel(config, signal))
      .catch(() => ({
        errorCode: signal.aborted ? 'CANCELLED' : 'MODEL_REQUEST_FAILED',
        steps: [],
        inputTokens: 0,
        outputTokens: 0,
        dimensions: null,
        durationMs: Math.round(performance.now() - started),
      }));
    const status =
      outcome.errorCode ||
      signal.aborted ||
      !outcome.steps.length ||
      outcome.steps.some((s) => !s.ok)
        ? 'failed'
        : 'success';
    return this.write(actor, async (tx) => {
      const [row] = await tx.$queryRaw<
        ModelTest[]
      >(Prisma.sql`UPDATE ai_model_tests SET status=${status},finished_at=clock_timestamp(),error_code=${outcome.errorCode ?? (status === 'failed' ? 'CANCELLED' : null)},
        steps=${JSON.stringify(outcome.steps)}::jsonb,dimensions=${outcome.dimensions}::int,duration_ms=${outcome.durationMs}::int,input_tokens=${outcome.inputTokens}::bigint,output_tokens=${outcome.outputTokens}::bigint
        WHERE id=${testId}::uuid RETURNING ${testFields}`);
      if (!row) conflict('该连接已删除。');
      await this.log(tx, actor, id, 'tested', undefined, {
        testId,
        status,
        model: input.model,
        purpose: input.purpose,
      });
      return row;
    });
  }
  private async latest(
    tx: Tx,
    r: Revision,
    model: string,
    purpose: ModelPurpose,
    testId?: string,
  ) {
    const m = capable(r, model, purpose);
    if (purpose !== 'embedding' && (!m.contextTokens || !m.maxOutputTokens))
      invalid('请补齐上下文长度和最大输出。');
    if (purpose === 'text') {
      const over = await tx.$queryRaw<
        { label: string; limit: number }[]
      >`SELECT label,output_limit AS "limit" FROM ai_feature_catalog WHERE purpose='text' AND output_limit>${m.maxOutputTokens}::int ORDER BY position`;
      if (over.length)
        invalid(
          '最大输出不足：' +
            over.map((i) => i.label + ' ' + i.limit + ' token').join('、') +
            '。',
        );
    }
    const [t] = await tx.$queryRaw<
      { id: string; status: string; dimensions: number | null }[]
    >`SELECT id,status,dimensions FROM ai_model_tests WHERE revision_id=${r.id}::uuid AND credential_id=${r.credentialId}::uuid AND model_name=${model} AND purpose=${purpose} AND suite=${MODEL_TEST_SUITE_VERSION} AND finished_at IS NOT NULL ORDER BY sequence DESC LIMIT 1`;
    if (
      !t ||
      t.status !== 'success' ||
      (testId && t.id !== testId) ||
      (purpose === 'embedding' && !t.dimensions)
    )
      conflict('需要当前配置、模型和用途的最新成功测试。');
    return t;
  }
  private async apply(
    actor: Actor,
    id: string,
    input: Input<'activate'>,
    target?: {
      purpose: ModelPurpose;
      model: string;
      testId: string;
      assignmentVersion: number;
    },
  ) {
    return this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, input.version),
        r = await revisionFor(tx, p, input.revisionId);
      if (!p.enabled) conflict('请先启用连接。');
      // Confirm every affected assignment under the same lock used for finishing tests.
      const current = await assignments(tx);
      if (
        target &&
        (current.find((a) => a.purpose === target.purpose)?.version ?? 0) !==
          target.assignmentVersion
      )
        conflict();
      if (!r.credentialId) conflict('请先设置 Key 并完成测试。');
      await this.store.forAdmin(tx, p, r, '', 'text');
      const changed: {
        purpose: ModelPurpose;
        model: string;
        dimensions: number | null;
        before?: Assignment;
      }[] = [];
      for (const old of current.filter(
        (a) => a.providerId === id && a.purpose !== target?.purpose,
      )) {
        const t = await this.latest(tx, r, old.model, old.purpose);
        if (old.revisionId === r.id) continue;
        changed.push({
          purpose: old.purpose,
          model: old.model,
          dimensions: t.dimensions,
          before: old,
        });
      }
      if (target) {
        const t = await this.latest(
          tx,
          r,
          target.model,
          target.purpose,
          target.testId,
        );
        changed.push({
          ...target,
          dimensions: t.dimensions,
          before: current.find((a) => a.purpose === target.purpose),
        });
      }
      if (!target && !changed.length) {
        const [ok] = await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT EXISTS(SELECT FROM (SELECT DISTINCT ON (model_name,purpose) status FROM ai_model_tests WHERE revision_id=${r.id}::uuid AND credential_id=${r.credentialId}::uuid AND suite=${MODEL_TEST_SUITE_VERSION} AND finished_at IS NOT NULL ORDER BY model_name,purpose,sequence DESC) latest WHERE status='success') AS ok`;
        if (!ok.ok) conflict('请先完成至少一个用途测试。');
      }
      for (const c of changed) {
        if (
          c.purpose === 'embedding' &&
          c.before?.dimensions &&
          c.before.dimensions !== c.dimensions &&
          !input.confirmReindex
        )
          conflict('向量维度已改变，请确认已有资料需要重新建立索引。');
        await tx.$executeRaw`INSERT INTO ai_model_assignments(purpose,provider_id,revision_id,model_name,version,dimensions) VALUES(${c.purpose},${id}::uuid,${r.id}::uuid,${c.model},1,${c.dimensions}::int)
          ON CONFLICT(purpose) DO UPDATE SET provider_id=excluded.provider_id,revision_id=excluded.revision_id,model_name=excluded.model_name,version=ai_model_assignments.version+1,dimensions=excluded.dimensions`;
        await this.log(tx, actor, id, 'assigned', c.before, {
          purpose: c.purpose,
          providerId: id,
          revisionId: r.id,
          model: c.model,
          dimensions: c.dimensions,
          version: (c.before?.version ?? 0) + 1,
        });
      }
      await tx.$executeRaw`UPDATE ai_model_providers SET active_revision_id=${r.id}::uuid,draft_revision_id=CASE WHEN draft_revision_id=${r.id}::uuid THEN NULL ELSE draft_revision_id END,version=version+1 WHERE id=${id}::uuid`;
      await this.log(
        tx,
        actor,
        id,
        'activated',
        { revisionId: p.activeRevisionId },
        { revisionId: r.id },
      );
      return { ok: true };
    });
  }
  activate(actor: Actor, id: string, input: Input<'activate'>) {
    return this.apply(actor, id, input);
  }
  assign(actor: Actor, purpose: ModelPurpose, input: Input<'assign'>) {
    return this.apply(actor, input.providerId, input, { ...input, purpose });
  }
  status(actor: Actor, id: string, version: number, enabled: boolean | null) {
    return this.write(actor, async (tx) => {
      const p = await providerFor(tx, id, version);
      if (!enabled && (await assignments(tx)).some((a) => a.providerId === id))
        conflict('该供应商仍在用途分配中，请先更换模型。');
      if (enabled === null)
        await tx.$executeRaw`DELETE FROM ai_model_providers WHERE id=${id}::uuid`;
      else
        await tx.$executeRaw`UPDATE ai_model_providers SET enabled=${enabled},version=version+1 WHERE id=${id}::uuid`;
      await this.log(
        tx,
        actor,
        id,
        enabled === null ? 'deleted' : 'status_changed',
        { name: p.name, enabled: p.enabled },
        enabled === null ? undefined : { enabled },
      );
      return { ok: true };
    });
  }
  rotate(actor: Actor) {
    return this.write(actor, async (tx) => {
      const ring = this.store.ring();
      const rows = await tx.$queryRaw<
        { id: string; provider_id: string; remaining: bigint }[]
      >`SELECT * FROM ai_model_rotation_pending(${ring.activeKeyId})`;
      let rotated = 0;
      for (const c of rows) {
        const prior = await this.store.envelope(tx, c.id, ring),
          key = ring.open(c.provider_id, c.id, prior),
          next = ring.seal(c.provider_id, c.id, key);
        const [changed] = await tx.$queryRaw<
          { ok: boolean }[]
        >`SELECT ai_model_rotate_one(${c.id}::uuid,${prior.keyId},${prior.nonce},${next.keyId},${next.nonce},${next.ciphertext},${next.tag},${ring.verifier()}) AS ok`;
        if (changed.ok) {
          if (
            ring.open(
              c.provider_id,
              c.id,
              await this.store.envelope(tx, c.id, ring),
            ) !== key
          )
            throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503);
          rotated++;
        }
      }
      const remaining = Number(rows[0]?.remaining ?? 0) - rotated;
      if (rotated)
        await this.log(tx, actor, undefined, 'master_rotated', undefined, {
          rotated,
          remaining,
        });
      return { rotated, remaining };
    });
  }
}
