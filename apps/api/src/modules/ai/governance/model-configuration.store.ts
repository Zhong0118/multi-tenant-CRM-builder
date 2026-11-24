import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@crm/database';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { ApiException } from '../../../common/errors/api.exception';
import { ModelKeyring, type Envelope } from './model-secrets';
import type { RuntimeModelSnapshot } from './model-runtime';
import { conflict, type Tx } from './admin-usage';
import type {
  Assignment,
  Draft,
  ModelDeclaration,
  ModelPurpose,
  ModelTest,
} from './model-admin.contract';

export type Provider = {
  id: string;
  name: string;
  preset: string;
  enabled: boolean;
  version: number;
  activeRevisionId: string | null;
  draftRevisionId: string | null;
};
export type Revision = {
  id: string;
  providerId: string;
  preset: string;
  baseURL: string;
  protocol: 'responses' | 'chat';
  embeddings: boolean;
  credentialId: string | null;
  keyLast4: string | null;
  models: ModelDeclaration[];
};
export const providerFields = Prisma.sql`id,name,preset,enabled,version,active_revision_id AS "activeRevisionId",draft_revision_id AS "draftRevisionId"`;
export const testFields = Prisma.sql`id,sequence,model_name AS model,purpose,status,steps,dimensions,duration_ms AS "durationMs",error_code AS "errorCode",started_at AS "startedAt",finished_at AS "finishedAt",input_tokens::float8 AS "inputTokens",output_tokens::float8 AS "outputTokens"`;
export const assignmentFields = Prisma.sql`purpose,provider_id AS "providerId",revision_id AS "revisionId",model_name AS model,version,dimensions`;

export async function providerFor(tx: Tx, id: string, version: number) {
  const [row] = await tx.$queryRaw<Provider[]>(
    Prisma.sql`SELECT ${providerFields} FROM ai_model_providers WHERE id=${id}::uuid`,
  );
  if (!row) throw new ApiException('OBJECT_NOT_FOUND', 404);
  if (row.version !== version) conflict();
  return row;
}
export async function revisionFor(tx: Tx, p: Provider, id: string) {
  if (id !== p.activeRevisionId && id !== p.draftRevisionId)
    conflict('配置已更新，请刷新后重测。');
  const [r] = await tx.$queryRaw<
    Omit<Revision, 'models'>[]
  >`SELECT id,provider_id AS "providerId",preset,base_url AS "baseURL",protocol,embeddings,credential_id AS "credentialId",key_last4 AS "keyLast4" FROM ai_model_revisions WHERE id=${id}::uuid AND provider_id=${p.id}::uuid`;
  if (!r) conflict();
  const models = await tx.$queryRaw<
    ModelDeclaration[]
  >`SELECT name,capabilities,context_tokens AS "contextTokens",max_output_tokens AS "maxOutputTokens",input_price::text AS "inputPrice",output_price::text AS "outputPrice",currency FROM ai_config_models WHERE revision_id=${id}::uuid ORDER BY name`;
  return { ...r, models };
}
export async function assignments(tx: Tx) {
  return tx.$queryRaw<Assignment[]>(
    Prisma.sql`SELECT ${assignmentFields} FROM ai_model_assignments ORDER BY purpose`,
  );
}
export async function persistRevision(
  tx: Tx,
  providerId: string,
  draft: Pick<
    Draft,
    'preset' | 'baseURL' | 'protocol' | 'embeddings' | 'models'
  >,
  credentialId: string | null,
  keyLast4: string | null,
) {
  const [r] = await tx.$queryRaw<
    { id: string }[]
  >`INSERT INTO ai_model_revisions(provider_id,preset,base_url,protocol,embeddings,credential_id,key_last4) VALUES (${providerId}::uuid,${draft.preset},${draft.baseURL},${draft.protocol},${draft.embeddings},${credentialId}::uuid,${keyLast4}) RETURNING id`;
  if (draft.models.length) {
    const values = draft.models.map(
      (m) =>
        Prisma.sql`(${r.id}::uuid,${m.name},${m.capabilities}::text[],${m.contextTokens}::int,${m.maxOutputTokens}::int,${m.inputPrice}::numeric,${m.outputPrice}::numeric,${m.currency})`,
    );
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO ai_config_models(revision_id,name,capabilities,context_tokens,max_output_tokens,input_price,output_price,currency) VALUES ${Prisma.join(values)}`,
    );
  }
  return r.id;
}

function mapEnvelopeError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2010'
  ) {
    const adapter = error.meta?.driverAdapterError as
      { cause?: { originalCode?: string } } | undefined;
    if ((adapter?.cause?.originalCode ?? error.meta?.code) === '42501') {
      throw new ApiException('AI_PROVIDER_UNAVAILABLE', 503, {
        message: '当前部署无法读取所选模型 Key，请检查主密钥。',
      });
    }
  }
  throw error;
}

@Injectable()
export class ModelConfigurationStore {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly config: ConfigService,
  ) {}
  ring() {
    return new ModelKeyring(this.config.get<string>('AI_MODEL_KEYRING'));
  }
  async envelope(tx: Tx, credential: string, ring = this.ring()) {
    const [row] = await tx.$queryRaw<
      { envelope: Envelope }[]
    >`SELECT ai_model_admin_envelope(${credential}::uuid,${ring.proofs()}::text[]) AS envelope`.catch(
      mapEnvelopeError,
    );
    return row.envelope;
  }
  async forAdmin(
    tx: Tx,
    p: Provider,
    r: Revision,
    model: string,
    purpose: ModelPurpose,
  ): Promise<RuntimeModelSnapshot> {
    if (!r.credentialId) conflict('请先保存该地址的 API Key。');
    const ring = this.ring();
    const apiKey = ring.open(
      p.id,
      r.credentialId,
      await this.envelope(tx, r.credentialId, ring),
    );
    const m = r.models.find((item) => item.name === model);
    return {
      provider: r.preset,
      providerId: p.id,
      purpose,
      model,
      revisionId: r.id,
      assignmentVersion: 0,
      protocol: r.protocol,
      baseURL: r.baseURL,
      apiKey,
      maxOutputTokens: m?.maxOutputTokens ?? null,
      contextTokens: m?.contextTokens ?? null,
      inputPrice: m?.inputPrice ?? null,
      outputPrice: m?.outputPrice ?? null,
      currency: m?.currency ?? null,
    };
  }
  resolve(
    actor: TenantContext,
    purpose: ModelPurpose,
  ): Promise<RuntimeModelSnapshot | null> {
    return this.runner.withTenant(actor, async (tx) => {
      const ring = this.config.get<string>('AI_MODEL_KEYRING')
        ? this.ring()
        : null;
      const [row] = await tx.$queryRaw<
        {
          snapshot: Omit<RuntimeModelSnapshot, 'apiKey'>;
          credential_id: string;
          envelope: Envelope;
        }[]
      >`SELECT * FROM ai_resolve_model(${actor.tenantId}::uuid,${actor.memberId}::uuid,${purpose},${ring?.proofs() ?? []}::text[])`.catch(
        mapEnvelopeError,
      );
      if (!row) return null;
      const apiKey = (ring ?? this.ring()).open(
        row.snapshot.providerId,
        row.credential_id,
        row.envelope,
      );
      return { ...row.snapshot, apiKey };
    });
  }
  list(user: string) {
    return this.runner.withUser(user, async (tx) => {
      const providers = await tx.$queryRaw<Provider[]>(
        Prisma.sql`SELECT ${providerFields} FROM ai_model_providers ORDER BY name,id`,
      );
      const rows = [];
      for (const p of providers) {
        const revisions = [];
        for (const id of new Set([p.draftRevisionId, p.activeRevisionId])) {
          if (!id) continue;
          const r = await revisionFor(tx, p, id);
          const tests = await tx.$queryRaw<ModelTest[]>(
            Prisma.sql`SELECT DISTINCT ON(model_name,purpose) ${testFields} FROM ai_model_tests WHERE revision_id=${id}::uuid ORDER BY model_name,purpose,sequence DESC`,
          );
          revisions.push({
            id: r.id,
            baseURL: r.baseURL,
            protocol: r.protocol,
            embeddings: r.embeddings,
            keyLast4: r.keyLast4,
            models: r.models,
            tests,
          });
        }
        rows.push({ ...p, revisions });
      }
      return {
        providers: rows,
        assignments: await assignments(tx),
        environment: this.environment(),
      };
    });
  }
  environment() {
    const provider = this.config.get<string>('AI_PROVIDER')?.trim() || null;
    const model = this.config.get<string>('AI_MODEL')?.trim() || null;
    const key = this.config.get<string>('AI_API_KEY')?.trim();
    const baseURL = this.config.get<string>('AI_BASE_URL')?.trim();
    const fake =
      provider === 'fake' && this.config.get<string>('NODE_ENV') === 'test';
    const present = Boolean(provider || model || key || baseURL);
    const missing =
      present && !fake
        ? [
            !provider && 'AI_PROVIDER',
            !model && 'AI_MODEL',
            !key && 'AI_API_KEY',
          ].filter((n): n is string => Boolean(n))
        : [];
    return {
      configured: fake || (provider === 'openai' && !!model && !!key),
      provider,
      model,
      missing,
    };
  }
}
