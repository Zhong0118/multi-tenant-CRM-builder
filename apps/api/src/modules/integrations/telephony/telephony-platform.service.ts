import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import type { AuditEvent } from '../../audit/audit-event';
import { AuditService } from '../../audit/audit.service';
import {
  allowance,
  readUsage,
  TelephonyLine,
  type LineMode,
} from './telephony-line';
import type {
  AddTelephonyMinutesDto,
  AssignTelephonyPlanDto,
  PlatformTelephonyResponseDto,
  PlatformTenantTelephonyResponseDto,
  TelephonyPlanInputDto,
  TelephonyPlanResponseDto,
  TelephonyReportResponseDto,
  UpdatePlatformTelephonyDto,
  UpdateTelephonyPlanDto,
} from './telephony-platform.dto';

type Tx = Prisma.TransactionClient;
export type AuditMeta = { requestId: string; ip?: string };
const withCompanies = { _count: { select: { configs: true } } } as const;
type PlanRow = Prisma.TelephonyPlanGetPayload<{
  include: typeof withCompanies;
}>;
type Plan = Prisma.TelephonyPlanGetPayload<Record<string, never>>;
type Money = Prisma.Decimal | string;

function conflict(
  message = '数据刚被修改，请刷新后重试。',
  fieldErrors?: Record<string, string[]>,
): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
    message,
    ...(fieldErrors ? { fieldErrors } : {}),
  });
}
const day = (value: Date) => value.toISOString().slice(0, 10);
const planView = (plan: PlanRow): TelephonyPlanResponseDto => ({
  id: plan.id,
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice.toFixed(2),
  assignable: plan.assignable,
  version: plan.version,
  companies: plan._count.configs,
});
const planAudit = (plan: Plan) => ({
  name: plan.name,
  seats: plan.seats,
  monthlyMinutes: plan.monthlyMinutes,
  monthlyPrice: plan.monthlyPrice.toFixed(2),
  assignable: plan.assignable,
});

/** The platform's side of calling: the line, plans, companies and the books. */
@Injectable()
export class TelephonyPlatformService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly audit: AuditService,
    private readonly line: TelephonyLine,
  ) {}

  /** Platform writes take the line row first, so they never interleave. */
  private write<T>(
    user: string,
    work: (tx: Tx) => Promise<T>,
    invalid = '请求与当前数据不一致，请刷新后重试。',
  ): Promise<T> {
    return this.runner
      .withUser(user, async (tx) => {
        await tx.$queryRaw`SELECT id FROM telephony_platform_settings WHERE id FOR UPDATE`;
        return work(tx);
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002')
            conflict('套餐名称已被使用。', { name: ['DUPLICATE'] });
          if (error.code === 'P2003')
            conflict('套餐正在使用，不能删除；可以改为停止分配。');
          if (error.code === 'P2010') {
            const adapter = error.meta?.driverAdapterError as
              { cause?: { originalCode?: string } } | undefined;
            const code = adapter?.cause?.originalCode ?? error.meta?.code;
            if (code === '23505') conflict('套餐名称已被使用。');
            if (code === '23514')
              conflict('坐席数少于公司已开的坐席，请刷新后重试。', {
                seats: ['TELEPHONY_SEATS_EXCEEDED'],
              });
            if (code === '22023') conflict(invalid);
          }
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

  private async lineView(tx: Tx): Promise<PlatformTelephonyResponseDto> {
    const row = await tx.telephonyPlatformSettings.findUniqueOrThrow({
      where: { id: true },
    });
    const mode = row.mode as LineMode;
    const problems = this.line.problems({
      mode,
      companyId: row.companyId,
      appSecretEncrypted: row.appSecretEncrypted,
      callbackTokenEncrypted: row.callbackTokenEncrypted,
    });
    const [{ seats }] = await tx.$queryRaw<
      Array<{ seats: number }>
    >`SELECT telephony_platform_seats() AS seats`;
    return {
      version: row.version,
      mode,
      companyId: row.companyId,
      hasAppSecret: Boolean(row.appSecretEncrypted),
      hasCallbackToken: Boolean(row.callbackTokenEncrypted),
      callbackEndpoint: this.line.callbackEndpoint(),
      liveEnabled: this.line.liveEnabled(),
      mockAllowed: !this.line.production(),
      costPerMinute: row.costPerMinute.toFixed(4),
      seatMonthlyCost: row.seatMonthlyCost.toFixed(2),
      ready: problems.length === 0,
      problems,
      seats,
    };
  }

  lineSettings(user: string) {
    return this.runner.withUser(user, (tx) => this.lineView(tx));
  }

  updateLine(user: string, input: UpdatePlatformTelephonyDto, meta: AuditMeta) {
    if (input.mode === 'MOCK' && this.line.production())
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '正式环境不能用模拟线路。',
      });
    return this.write(user, async (tx) => {
      const current = await tx.telephonyPlatformSettings.findUniqueOrThrow({
        where: { id: true },
      });
      if (current.version !== input.version)
        conflict('线路设置刚被修改，请刷新后重试。');
      const appSecret = input.appSecret?.trim();
      const saved = await tx.telephonyPlatformSettings.update({
        where: { id: true },
        data: {
          version: { increment: 1 },
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.companyId !== undefined
            ? { companyId: input.companyId.trim() }
            : {}),
          // A blank secret keeps the saved one; it is never read back.
          ...(appSecret
            ? {
                appSecretEncrypted: this.line.vault.seal(
                  'appSecret',
                  appSecret,
                ),
              }
            : {}),
          ...(input.costPerMinute !== undefined
            ? { costPerMinute: new Prisma.Decimal(input.costPerMinute) }
            : {}),
          ...(input.seatMonthlyCost !== undefined
            ? { seatMonthlyCost: new Prisma.Decimal(input.seatMonthlyCost) }
            : {}),
        },
      });
      const summary = (row: typeof current) => ({
        version: row.version,
        mode: row.mode,
        companyId: row.companyId,
        costPerMinute: row.costPerMinute.toFixed(4),
        seatMonthlyCost: row.seatMonthlyCost.toFixed(2),
      });
      await this.log(tx, user, meta, {
        action: 'telephony.line_updated',
        resourceType: 'telephony_platform_settings',
        before: summary(current),
        after: { ...summary(saved), appSecretChanged: Boolean(appSecret) },
      });
      return this.lineView(tx);
    });
  }

  /**
   * Issues a new callback credential. The full URL is returned this once for
   * the platform admin to hand to the supplier; afterwards only "set" shows.
   */
  rotateCallbackToken(user: string, meta: AuditMeta) {
    const token = randomBytes(24).toString('base64url');
    return this.write(user, async (tx) => {
      // The line form never writes this column, so issuing a credential does
      // not bump the form's version or conflict with an open edit.
      await tx.telephonyPlatformSettings.update({
        where: { id: true },
        data: {
          callbackTokenEncrypted: this.line.vault.seal('callbackToken', token),
        },
      });
      await this.log(tx, user, meta, {
        action: 'telephony.callback_token_rotated',
        resourceType: 'telephony_platform_settings',
      });
      return {
        settings: await this.lineView(tx),
        callbackUrl: `${this.line.callbackEndpoint()}?token=${token}`,
      };
    });
  }

  plans(user: string) {
    return this.runner.withUser(user, async (tx) =>
      (
        await tx.telephonyPlan.findMany({
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          include: withCompanies,
        })
      ).map(planView),
    );
  }

  createPlan(user: string, input: TelephonyPlanInputDto, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const plan = await tx.telephonyPlan.create({
        data: {
          name: input.name.trim(),
          seats: input.seats,
          monthlyMinutes: input.monthlyMinutes,
          monthlyPrice: new Prisma.Decimal(input.monthlyPrice),
          assignable: input.assignable,
        },
        include: withCompanies,
      });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_created',
        resourceType: 'telephony_plan',
        resourceId: plan.id,
        after: planAudit(plan),
      });
      return planView(plan);
    });
  }

  updatePlan(
    user: string,
    id: string,
    input: UpdateTelephonyPlanDto,
    meta: AuditMeta,
  ) {
    return this.write(user, async (tx) => {
      const before = await tx.telephonyPlan.findUnique({ where: { id } });
      if (!before) throw new ApiException('RECORD_NOT_FOUND', 404);
      if (before.version !== input.version)
        conflict('套餐刚被修改，请刷新后重试。');
      if (input.seats < before.seats) {
        const overflow = await tx.$queryRaw<
          Array<{ tenant_name: string; seats_enabled: number }>
        >`SELECT tenant_name, seats_enabled FROM telephony_plan_overflow(${id}::uuid, ${input.seats}::int)`;
        if (overflow.length)
          conflict(
            `坐席数不能少于这些公司已开的坐席：${overflow
              .map((row) => `${row.tenant_name}（${row.seats_enabled} 个）`)
              .join('、')}。请先请公司管理员关掉部分成员的外呼。`,
            { seats: ['TELEPHONY_SEATS_EXCEEDED'] },
          );
      }
      const plan = await tx.telephonyPlan.update({
        where: { id },
        data: {
          name: input.name.trim(),
          seats: input.seats,
          monthlyMinutes: input.monthlyMinutes,
          monthlyPrice: new Prisma.Decimal(input.monthlyPrice),
          assignable: input.assignable,
          version: { increment: 1 },
        },
        include: withCompanies,
      });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_updated',
        resourceType: 'telephony_plan',
        resourceId: id,
        before: planAudit(before),
        after: planAudit(plan),
      });
      return planView(plan);
    });
  }

  deletePlan(user: string, id: string, version: number, meta: AuditMeta) {
    return this.write(user, async (tx) => {
      const plan = await tx.telephonyPlan.findUnique({ where: { id } });
      if (!plan) throw new ApiException('RECORD_NOT_FOUND', 404);
      if (plan.version !== version) conflict('套餐刚被修改，请刷新后重试。');
      if (await tx.tenantTelephonyConfig.count({ where: { planId: id } }))
        conflict('套餐正在使用，不能删除；可以改为停止分配。');
      await tx.telephonyPlan.delete({ where: { id } });
      await this.log(tx, user, meta, {
        action: 'telephony.plan_deleted',
        resourceType: 'telephony_plan',
        resourceId: id,
        before: planAudit(plan),
      });
    });
  }

  private async companyView(
    tx: Tx,
    tenantId: string,
  ): Promise<PlatformTenantTelephonyResponseDto> {
    const usage = await readUsage(tx, tenantId);
    const config = await tx.tenantTelephonyConfig.findUnique({
      where: { tenantId },
    });
    const additions = await tx.telephonyMinuteAddition.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return {
      tenantId,
      version: config?.version ?? 0,
      planId: usage.planId,
      planName: usage.planName,
      seats: usage.seats,
      monthlyMinutes: usage.monthlyMinutes,
      month: usage.month,
      usedMinutes: usage.usedMinutes,
      extraMinutes: usage.extraMinutes,
      allowance: allowance(usage),
      seatsEnabled: usage.seatsEnabled,
      additions: additions.map((entry) => ({
        month: day(entry.month),
        minutes: entry.minutes,
        price: entry.price.toFixed(2),
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  company(user: string, tenantId: string) {
    return this.runner.withUser(user, (tx) => this.companyView(tx, tenantId));
  }

  assign(
    user: string,
    tenantId: string,
    input: AssignTelephonyPlanDto,
    meta: AuditMeta,
  ) {
    const planId = input.planId ?? null;
    return this.write(user, async (tx) => {
      const before = await this.companyView(tx, tenantId);
      if (before.version !== input.version)
        conflict('通话服务刚被修改，请刷新后重试。');
      if (before.planId === planId) return before;
      if (planId) {
        const plan = await tx.telephonyPlan.findUnique({
          where: { id: planId },
        });
        if (!plan?.assignable)
          throw new ApiException('VALIDATION_FAILED', 400, {
            message: '这个套餐不存在或已停止分配。',
            fieldErrors: { planId: ['PLAN_NOT_ASSIGNABLE'] },
          });
        if (before.seatsEnabled > plan.seats)
          conflict(
            `这家公司已开 ${before.seatsEnabled} 个坐席，「${plan.name}」只含 ${plan.seats} 个。请先请公司管理员关掉 ${before.seatsEnabled - plan.seats} 位成员的外呼。`,
            { planId: ['TELEPHONY_SEATS_EXCEEDED'] },
          );
      }
      const [{ ok }] = await tx.$queryRaw<
        Array<{ ok: boolean }>
      >`SELECT telephony_assign_plan(${tenantId}::uuid, ${planId}::uuid, ${input.version}::int) AS ok`;
      if (!ok) conflict('通话服务刚被修改，请刷新后重试。');
      await this.log(tx, user, meta, {
        action: 'telephony.plan_assigned',
        resourceType: 'tenant_telephony_config',
        resourceId: tenantId,
        tenantId,
        before: { planId: before.planId },
        after: { planId },
      });
      return this.companyView(tx, tenantId);
    });
  }

  addMinutes(
    user: string,
    tenantId: string,
    input: AddTelephonyMinutesDto,
    meta: AuditMeta,
  ) {
    const note = input.note?.trim() ?? '';
    return this.write(
      user,
      async (tx) => {
        const [{ applied }] = await tx.$queryRaw<
          Array<{ applied: boolean }>
        >`SELECT telephony_add_minutes(${tenantId}::uuid, ${input.month}::date, ${input.minutes}::int, ${input.price}::numeric, ${note}, ${input.idempotencyKey}) AS applied`;
        if (applied)
          await this.log(tx, user, meta, {
            action: 'telephony.minutes_added',
            resourceType: 'telephony_minute_addition',
            resourceId: tenantId,
            tenantId,
            after: {
              month: input.month,
              minutes: input.minutes,
              price: input.price,
              note,
            },
          });
        return { applied, month: input.month };
      },
      '只能给公司的当月加分钟；同一次加量不能改分钟数或收费。',
    );
  }

  report(user: string, month: string): Promise<TelephonyReportResponseDto> {
    return this.runner.withUser(user, async (tx) => {
      const line = await tx.telephonyPlatformSettings.findUniqueOrThrow({
        where: { id: true },
      });
      const rows = await tx.$queryRaw<
        Array<{
          tenant_id: string;
          tenant_name: string;
          plan_name: string | null;
          monthly_price: Money;
          monthly_minutes: number;
          used_minutes: number;
          extra_minutes: number;
          extra_price: Money;
          minute_cost: Money;
          seats_provisioned: number;
        }>
      >`SELECT tenant_id::text AS tenant_id, tenant_name, plan_name, monthly_price, monthly_minutes, used_minutes, extra_minutes, extra_price, minute_cost, seats_provisioned FROM telephony_report(${`${month}-01`}::date)`;
      let usedMinutes = 0;
      let revenueTotal = new Prisma.Decimal(0);
      let costTotal = new Prisma.Decimal(0);
      const out = rows.map((row) => {
        const planPrice = new Prisma.Decimal(row.monthly_price);
        const extraPrice = new Prisma.Decimal(row.extra_price);
        const minuteCost = new Prisma.Decimal(row.minute_cost);
        const seatCost = line.seatMonthlyCost.times(row.seats_provisioned);
        const revenue = planPrice.plus(extraPrice);
        const cost = minuteCost.plus(seatCost);
        usedMinutes += row.used_minutes;
        revenueTotal = revenueTotal.plus(revenue);
        costTotal = costTotal.plus(cost);
        return {
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          planName: row.plan_name,
          monthlyMinutes: row.monthly_minutes,
          usedMinutes: row.used_minutes,
          extraMinutes: row.extra_minutes,
          allowance: row.monthly_minutes + row.extra_minutes,
          planPrice: planPrice.toFixed(2),
          extraPrice: extraPrice.toFixed(2),
          revenue: revenue.toFixed(2),
          minuteCost: minuteCost.toFixed(2),
          seatCost: seatCost.toFixed(2),
          cost: cost.toFixed(2),
          margin: revenue.minus(cost).toFixed(2),
          seatsProvisioned: row.seats_provisioned,
        };
      });
      return {
        month,
        seatMonthlyCost: line.seatMonthlyCost.toFixed(2),
        rows: out,
        total: {
          usedMinutes,
          revenue: revenueTotal.toFixed(2),
          cost: costTotal.toFixed(2),
          margin: revenueTotal.minus(costTotal).toFixed(2),
        },
      };
    });
  }
}
