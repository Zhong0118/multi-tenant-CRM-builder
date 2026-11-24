import { Injectable } from '@nestjs/common';
import { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import { API_ERROR_MESSAGES } from '../../../common/errors/api-error-code';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';

import type { FeatureKey, MeteredKey } from './feature-catalog';
export type AiFeature = FeatureKey;
export type AiMeteredFeature = MeteredKey;
export interface CallSnapshot {
  configSource: 'environment' | 'platform' | 'test';
  purpose: 'text' | 'vision' | 'embedding';
  providerId?: string;
  revisionId?: string;
  assignmentVersion?: number;
  deploymentConfigId?: string;
  inputPrice?: string | null;
  outputPrice?: string | null;
  currency?: string | null;
}
export interface AiReservation {
  snapshot?: CallSnapshot;
  callId: string;
  requestId: string;
  feature: AiMeteredFeature;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  expiresAt: Date;
}
export interface AiSettlement {
  callId: string;
  status: 'success' | 'failed' | 'cancelled' | 'timeout' | 'unsent';
  inputTokens?: number;
  outputTokens?: number;
}

const rejectionStatus = {
  AI_PLATFORM_DISABLED: 503,
  AI_FEATURE_NOT_INCLUDED: 403,
  AI_TENANT_QUOTA_EXHAUSTED: 429,
  AI_MEMBER_QUOTA_EXHAUSTED: 429,
  AI_REQUEST_BUDGET_INSUFFICIENT: 409,
  AI_BUDGET_RESERVED: 409,
  OBJECT_ACTION_FORBIDDEN: 403,
} as const;
type RejectionCode = keyof typeof rejectionStatus;

@Injectable()
export class AiLedgerService {
  constructor(private readonly db: DatabaseContextRunner) {}

  features(ctx: TenantContext): Promise<AiFeature[]> {
    return this.db.withTenant(ctx, async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ features: AiFeature[] }>>`
        SELECT p.features FROM tenant_ai_configs c JOIN ai_plans p ON p.id=c.plan_id
        CROSS JOIN ai_platform_settings s WHERE c.tenant_id=${ctx.tenantId}::uuid AND NOT s.disabled`;
      return (row?.features ?? []).filter(
        (f) => f !== 'table_builder' || ctx.role === 'TENANT_ADMIN',
      );
    });
  }

  async assertFeature(
    ctx: TenantContext,
    feature: AiFeature,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const gate = async (client: Prisma.TransactionClient) => {
      const [row] = await client.$queryRaw<
        Array<{ code: RejectionCode | null }>
      >`
        SELECT ai_feature_gate(${ctx.tenantId}::uuid,${ctx.memberId}::uuid,${feature}) AS code`;
      return row.code;
    };
    const code = tx ? await gate(tx) : await this.db.withTenant(ctx, gate);
    if (code) {
      // For a business transaction, its owner records the denial after rollback.
      if (!tx) await this.recordDenial(ctx, feature, code);
      throw new ApiException(code, rejectionStatus[code]);
    }
  }

  async recordDenial(
    ctx: TenantContext,
    feature: AiFeature,
    code: string,
    requestId?: string,
  ): Promise<void> {
    await this.db.withTenant(
      ctx,
      (tx) => tx.$executeRaw`
      SELECT ai_record_denial(${ctx.tenantId}::uuid,${ctx.memberId}::uuid,${feature},${code},${requestId ?? null}::text)`,
    );
  }

  async reserve(ctx: TenantContext, call: AiReservation): Promise<void> {
    const args = Prisma.sql`
      ${ctx.tenantId}::uuid,${ctx.memberId}::uuid,${call.callId}::uuid,${call.requestId},${call.feature},${call.provider},
      ${call.model},${call.inputTokens}::bigint,${call.outputTokens}::bigint,${call.expiresAt}::timestamptz`;
    const reservation = call.snapshot
      ? Prisma.sql`ai_reserve_snapshot_call(${args},${JSON.stringify(call.snapshot)}::jsonb)`
      : Prisma.sql`ai_reserve_call(${args})`;
    const [row] = await this.db.withTenant(
      ctx,
      (tx) => tx.$queryRaw<
        Array<{ code: RejectionCode | null; recovery_date: string }>
      >`
        SELECT code,recovery_date::text FROM ${reservation}`,
    );
    const { code } = row;
    if (!code) return;
    let message = API_ERROR_MESSAGES[code];
    if (
      code === 'AI_REQUEST_BUDGET_INSUFFICIENT' ||
      code === 'AI_BUDGET_RESERVED'
    ) {
      message += `本次预计需要 ${call.inputTokens + call.outputTokens} token。`;
    } else if (
      code === 'AI_TENANT_QUOTA_EXHAUSTED' ||
      code === 'AI_MEMBER_QUOTA_EXHAUSTED'
    ) {
      message += `额度将于 ${row.recovery_date} 恢复。`;
      if (code === 'AI_TENANT_QUOTA_EXHAUSTED')
        message +=
          ctx.role === 'TENANT_ADMIN'
            ? '如需加量，请联系平台。'
            : '请联系公司管理员。';
    }
    throw new ApiException(code, rejectionStatus[code], { message });
  }

  async settle(ctx: TenantContext, call: AiSettlement): Promise<void> {
    await this.db.withTenant(
      ctx,
      (tx) => tx.$executeRaw`
      SELECT ai_settle_call(${ctx.tenantId}::uuid,${ctx.memberId}::uuid,${call.callId}::uuid,${call.status},
        ${call.inputTokens ?? null}::bigint,${call.outputTokens ?? null}::bigint)`,
    );
  }
}
