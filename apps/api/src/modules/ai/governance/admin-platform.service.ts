import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@crm/database';
import type { z } from 'zod';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AuditService } from '../../audit/audit.service';
import type { AuditEvent } from '../../audit/audit-event';
import { ApiException } from '../../../common/errors/api.exception';
import { inputs, outputs } from './admin.contract';
import {
  companies,
  company,
  conflict,
  digest,
  invalid,
  platformUsage,
  type Tx,
} from './admin-usage';
import { featureCatalog, readCatalog } from './feature-catalog';
type Plan = z.infer<typeof outputs.plan>;
type Settings = z.infer<typeof outputs.settings>;
type Edit = z.infer<typeof inputs.planEdit>;
export type AuditMeta = { requestId: string; ip?: string };
const planSelect = Prisma.sql`SELECT p.id,p.name,p.description,p.features,p.monthly_tokens::text AS "monthlyTokens",p.assignable,p.version,
 (SELECT count(*)::int FROM tenant_ai_configs c WHERE c.plan_id=p.id) AS companies FROM ai_plans p`;
async function getPlan(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<Plan[]>(
    Prisma.sql`${planSelect} WHERE p.id=${id}::uuid`,
  );
  if (!row)
    throw new ApiException('OBJECT_NOT_FOUND', 404, {
      message: '未找到该 AI 套餐。',
    });
  return row;
}
async function settings(tx: Tx) {
  const [row] = await tx.$queryRaw<
    Settings[]
  >`SELECT default_plan_id AS "defaultPlanId",disabled,NULLIF(reason,'') AS reason,version FROM ai_platform_settings WHERE id`;
  return row;
}
export function validatePlan(dto: Edit) {
  if (new Set(dto.features).size !== dto.features.length)
    invalid('套餐功能不能重复。');
  for (const item of featureCatalog) {
    if (!dto.features.includes(item.key)) continue;
    if (!item.released) invalid(item.label + '即将上线，暂时不能加入套餐。');
    if (item.requires && !dto.features.includes(item.requires))
      invalid(
        item.label +
          '需要同时开通' +
          featureCatalog.find((f) => f.key === item.requires)?.label +
          '。',
      );
  }
}
async function assignable(tx: Tx, id: string | null) {
  if (!id) return null;
  const p = await getPlan(tx, id);
  if (!p.assignable) invalid('该套餐已停止分配。');
  return p;
}
async function planImpact(tx: Tx, id: string, dto: Edit) {
  validatePlan(dto);
  const p = await getPlan(tx, id);
  const s = await settings(tx);
  if (!dto.assignable && s.defaultPlanId === id) {
    if (
      dto.replacementDefaultPlanId === undefined ||
      dto.replacementDefaultPlanId === id
    )
      invalid('请同时选择可分配的默认套餐或未开通。');
    await assignable(tx, dto.replacementDefaultPlanId);
  } else if (dto.replacementDefaultPlanId !== undefined)
    invalid('仅停止分配当前默认套餐时可替换默认值。');
  const removedFeatures = p.features.filter((f) => !dto.features.includes(f));
  return {
    version: p.version,
    companies: p.companies,
    removedFeatures,
    confirmation: digest(
      id,
      p.version,
      p.companies,
      s.version,
      dto.name,
      dto.description,
      [...dto.features].sort(),
      dto.monthlyTokens,
      dto.assignable,
      dto.replacementDefaultPlanId,
    ),
  };
}
async function assignment(tx: Tx, id: string, planId: string | null) {
  const c = await company(tx, id);
  const p =
    planId === c.planId && planId
      ? await getPlan(tx, planId)
      : await assignable(tx, planId);
  const features = p?.features ?? [];
  return {
    name: c.name,
    planId,
    addedFeatures: features.filter((f) => !c.features.includes(f)),
    removedFeatures: c.features.filter((f) => !features.includes(f)),
    totalTokens: p
      ? (BigInt(c.extraTokens) + BigInt(p.monthlyTokens)).toString()
      : '0',
    confirmation: digest(
      id,
      c.name,
      c.month,
      c.version,
      c.planId,
      c.planVersion,
      c.extraTokens,
      planId,
      p?.version,
    ),
  };
}
@Injectable()
export class PlatformAiAdminService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}
  private write<T>(user: string, fn: (tx: Tx) => Promise<T>) {
    return this.runner
      .withUser(user, async (tx) => {
        // Assignment, default selection and plan impact must observe one ordering.
        await tx.$queryRaw`SELECT id FROM ai_platform_settings WHERE id FOR UPDATE`;
        return fn(tx);
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2010'
        ) {
          const adapter = error.meta?.driverAdapterError as
            { cause?: { originalCode?: string } } | undefined;
          const code = adapter?.cause?.originalCode ?? error.meta?.code;
          if (code === '23505') conflict('套餐名称已被使用。');
          if (code === '23503') conflict('该套餐仍被使用。');
          if (code === '22023') conflict('幂等键或生效月份与原请求不一致。');
          if (code === '22003') invalid('额度超出可存储范围。');
        }
        throw error;
      });
  }
  private log(
    tx: Tx,
    user: string,
    meta: AuditMeta,
    event: Pick<
      AuditEvent,
      'action' | 'resourceType' | 'resourceId' | 'tenantId' | 'before' | 'after'
    >,
  ) {
    return this.audit.append(tx, {
      ...meta,
      ...event,
      actorType: 'USER',
      actorId: user,
    });
  }
  list(user: string) {
    return this.runner.withUser(user, (tx) =>
      tx.$queryRaw<Plan[]>(Prisma.sql`${planSelect} ORDER BY p.name,p.id`),
    );
  }
  plan(user: string, id: string) {
    return this.runner.withUser(user, (tx) => getPlan(tx, id));
  }
  create(user: string, dto: z.infer<typeof inputs.plan>, meta: AuditMeta) {
    validatePlan(dto);
    return this.write(user, async (tx) => {
      const [p] = await tx.$queryRaw<
        { id: string }[]
      >`INSERT INTO ai_plans(name,description,features,monthly_tokens,assignable) VALUES (${dto.name},${dto.description},${dto.features}::text[],${dto.monthlyTokens}::bigint,${dto.assignable}) RETURNING id`;
      const created = await getPlan(tx, p.id);
      await this.log(tx, user, meta, {
        action: 'ai.plan_created',
        resourceType: 'ai_plan',
        resourceId: p.id,
        after: created,
      });
      return created;
    });
  }
  preview(user: string, id: string, dto: Edit) {
    return this.runner.withUser(user, (tx) => planImpact(tx, id, dto));
  }
  update(
    user: string,
    id: string,
    dto: z.infer<typeof inputs.savePlan>,
    meta: AuditMeta,
  ) {
    return this.write(user, async (tx) => {
      const before = await getPlan(tx, id);
      const impact = await planImpact(tx, id, dto);
      if (dto.confirmation !== impact.confirmation) conflict();
      if (dto.replacementDefaultPlanId !== undefined) {
        const s = await settings(tx);
        await tx.$executeRaw`UPDATE ai_platform_settings SET default_plan_id=${dto.replacementDefaultPlanId}::uuid,version=version+1 WHERE id`;
        await this.log(tx, user, meta, {
          action: 'ai.settings_changed',
          resourceType: 'ai_settings',
          before: s,
          after: await settings(tx),
        });
      }
      await tx.$executeRaw`UPDATE ai_plans SET name=${dto.name},description=${dto.description},features=${dto.features}::text[],monthly_tokens=${dto.monthlyTokens}::bigint,assignable=${dto.assignable},version=version+1 WHERE id=${id}::uuid`;
      const after = await getPlan(tx, id);
      await this.log(tx, user, meta, {
        action: 'ai.plan_updated',
        resourceType: 'ai_plan',
        resourceId: id,
        before,
        after,
      });
      return after;
    });
  }
  remove(user: string, id: string, version: number, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const before = await getPlan(tx, id);
      if (before.version !== version) conflict();
      if (before.companies || (await settings(tx)).defaultPlanId === id)
        conflict('仍在使用的套餐不能删除。');
      await tx.$executeRaw`DELETE FROM ai_plans WHERE id=${id}::uuid`;
      await this.log(tx, user, meta, {
        action: 'ai.plan_deleted',
        resourceType: 'ai_plan',
        resourceId: id,
        before,
      });
      return { deleted: true };
    });
  }
  runtime(user: string) {
    return this.runner.withUser(user, async (tx) => {
      const s = await settings(tx);
      const provider = this.config.get<string>('AI_PROVIDER') ?? null;
      const model = this.config.get<string>('AI_MODEL') ?? null;
      const test = this.config.get<string>('NODE_ENV') === 'test';
      const configured = test
        ? provider === 'fake'
        : provider === 'openai' &&
          !!model &&
          !!this.config.get<string>('AI_API_KEY');
      const anomalies = await tx.$queryRaw<
        z.infer<typeof outputs.platform>['anomalies']
      >`SELECT model,calls::text,excess_tokens::text AS "excessTokens" FROM ai_anomaly_summary() ORDER BY model`;
      const [{ affectedCompanies }] = await tx.$queryRaw<
        { affectedCompanies: number }[]
      >`SELECT count(*)::int AS "affectedCompanies" FROM tenant_ai_configs c JOIN tenants t ON t.id=c.tenant_id
        JOIN ai_plans p ON p.id=c.plan_id WHERE t.status='ACTIVE' AND cardinality(p.features)>0`;
      return {
        ...s,
        provider,
        model,
        configured,
        anomalies,
        affectedCompanies,
        catalog: await readCatalog(tx),
      };
    });
  }
  saveSettings(user: string, dto: Settings, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const before = await settings(tx);
      if (before.version !== dto.version) conflict();
      if (dto.disabled && !dto.reason?.trim())
        invalid('紧急关闭 AI 需要填写原因。');
      await assignable(tx, dto.defaultPlanId);
      await tx.$executeRaw`UPDATE ai_platform_settings SET default_plan_id=${dto.defaultPlanId}::uuid,disabled=${dto.disabled},reason=${dto.disabled ? dto.reason : ''},version=version+1 WHERE id`;
      const after = await settings(tx);
      await this.log(tx, user, meta, {
        action: 'ai.settings_changed',
        resourceType: 'ai_settings',
        before,
        after,
      });
      return after;
    });
  }
  companies(user: string, q: z.infer<typeof inputs.companies>) {
    return this.runner.withUser(user, (tx) => companies(tx, q));
  }
  summary(user: string, id: string) {
    return this.runner.withUser(user, (tx) => platformUsage(tx, id));
  }
  previewAssignment(user: string, id: string, planId: string | null) {
    return this.runner.withUser(user, (tx) => assignment(tx, id, planId));
  }
  assign(
    user: string,
    id: string,
    dto: z.infer<typeof inputs.saveAssignment>,
    meta: AuditMeta,
  ) {
    return this.write(user, async (tx) => {
      const before = await company(tx, id);
      if (
        (await assignment(tx, id, dto.planId)).confirmation !== dto.confirmation
      )
        conflict();
      if (before.planId === dto.planId) return before;
      const [{ ok }] = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT ai_assign_plan(${id}::uuid,${dto.planId}::uuid,${before.version}::int) AS ok`;
      if (!ok) conflict();
      await this.log(tx, user, meta, {
        action: 'ai.plan_assigned',
        resourceType: 'tenant_ai_config',
        resourceId: id,
        tenantId: id,
        before: { planId: before.planId },
        after: { planId: dto.planId },
      });
      return company(tx, id);
    });
  }
  topUp(
    user: string,
    id: string,
    dto: z.infer<typeof inputs.quota>,
    meta: AuditMeta,
  ) {
    return this.write(user, async (tx) => {
      const c = await company(tx, id);
      const [{ applied }] = await tx.$queryRaw<
        { applied: boolean }[]
      >`SELECT ai_add_quota(${id}::uuid,${dto.month}::date,${dto.amount}::bigint,${dto.idempotencyKey}) AS applied`;
      if (applied) {
        if (c.month !== dto.month) conflict('加量月份已过期。');
        await this.log(tx, user, meta, {
          action: 'ai.quota_added',
          resourceType: 'tenant_ai_month',
          resourceId: id,
          tenantId: id,
          before: { month: c.month, extraTokens: c.extraTokens },
          after: {
            month: c.month,
            extraTokens: (
              BigInt(c.extraTokens) + BigInt(dto.amount)
            ).toString(),
          },
        });
      }
      return { applied, month: dto.month };
    });
  }
}
