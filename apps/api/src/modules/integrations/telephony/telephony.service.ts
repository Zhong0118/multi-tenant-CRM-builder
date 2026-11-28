import { Inject, Injectable } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@crm/database';
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AuditService } from '../../audit/audit.service';
import { PublishedObjectService } from '../../objects/published-object.service';
import {
  RecordsService,
  RECORDS_REPOSITORY,
  type RecordResponse,
} from '../../records/records.service';
import type { RecordsRepository } from '../../records/records.repository';
import {
  requireVisibleRecord,
  projectRecord,
} from '../../records/record-command';
import { lockMembers } from '../../records/record-ownership-locks';
import {
  allowance,
  readUsage,
  TelephonyLine,
  type LineMode,
  type LineRow,
  type Usage,
} from './telephony-line';
import {
  KuaimaProvider,
  KuaimaSeatError,
  normalizePhone,
  safeRecordingUrl,
} from './telephony-provider';
import { seatUsable, TelephonySeats, type Seat } from './telephony-seats';
import type {
  CreateTelephonyCallDto,
  TelephonyBindingResponseDto,
  TelephonyCallQueryDto,
  TelephonyCallResponseDto,
  TelephonyHookDto,
  TelephonyPhoneFieldsDto,
  TelephonyReason,
  TelephonyRuntimeQueryDto,
  TelephonySettingsResponseDto,
  UpdateTelephonyBindingDto,
  UpdateTelephonySettingsDto,
} from './telephony.dto';

type TelephonyCall = Prisma.TelephonyCallGetPayload<Record<string, never>>;
type TelephonySettings = Prisma.TelephonySettingsGetPayload<
  Record<string, never>
>;
type TelephonyBinding = Prisma.TelephonyMemberBindingGetPayload<
  Record<string, never>
>;

const OPEN = ['REQUESTED', 'ACCEPTED', 'UNKNOWN'];
const OUTCOMES = ['CONNECTED', 'NOT_CONNECTED'];
/** An open call may be closed by hand only after the supplier had time to answer. */
const CLOSE_AFTER_MS = 60_000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const REASON_TEXT: Record<TelephonyReason, string> = {
  NOT_ENABLED: '公司未开通电话外呼',
  PLATFORM_NOT_READY: '通话线路暂不可用，请联系管理员',
  MINUTES_EXHAUSTED: '本月通话分钟已用完，请联系管理员',
  MEMBER_NOT_CONFIGURED: '你还没有外呼坐席，请联系管理员',
};

function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
function fieldsOf(
  settings: TelephonySettings | null,
): TelephonyPhoneFieldsDto[] {
  return (settings?.phoneFields ?? []) as unknown as TelephonyPhoneFieldsDto[];
}
function unavailable(reason: TelephonyReason): never {
  throw new ApiException('VALIDATION_FAILED', 503, {
    message: `电话外呼不可用：${REASON_TEXT[reason]}`,
    fieldErrors: { telephony: [reason] },
  });
}
function notEnabled(): never {
  throw new ApiException('WORKSPACE_FORBIDDEN', 403, {
    message: '公司未开通电话外呼，请联系平台管理员。',
    fieldErrors: { telephony: ['NOT_ENABLED'] },
  });
}
function seatsFull(seats: number): never {
  throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
    message: `坐席已满：套餐含 ${seats} 个坐席，已全部开出。如需更多坐席，请联系平台管理员。`,
    fieldErrors: { telephony: ['TELEPHONY_SEATS_FULL'] },
  });
}
function duration(seconds: number | null) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  return `，通话 ${minutes ? `${minutes} 分 ` : ''}${seconds % 60} 秒`;
}

@Injectable()
export class TelephonyService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly objects: PublishedObjectService,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
    private readonly provider: KuaimaProvider,
    private readonly line: TelephonyLine,
    private readonly seats: TelephonySeats,
    @Inject(RECORDS_REPOSITORY) private readonly repository: RecordsRepository,
  ) {}

  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  private async publicSettings(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<TelephonySettingsResponseDto> {
    const settings = await tx.telephonySettings.findUnique({
      where: { tenantId },
    });
    const usage = await readUsage(tx, tenantId);
    const line = await this.line.read(tx);
    return {
      version: settings?.version ?? 0,
      phoneFields: fieldsOf(settings),
      plan: usage.planId
        ? {
            name: usage.planName ?? '',
            seats: usage.seats,
            monthlyMinutes: usage.monthlyMinutes,
          }
        : null,
      usage: {
        month: usage.month,
        usedMinutes: usage.usedMinutes,
        extraMinutes: usage.extraMinutes,
        allowance: allowance(usage),
        seatsEnabled: usage.seatsEnabled,
      },
      lineReady: this.line.problems(line).length === 0,
    };
  }
  private bindingView(
    member: { id: string; displayName: string; status: string },
    binding: TelephonyBinding | null,
    mode: LineMode,
  ): TelephonyBindingResponseDto {
    return {
      memberId: member.id,
      displayName: member.displayName,
      status: member.status,
      version: binding?.version ?? 0,
      enabled: binding?.enabled ?? false,
      phone: binding?.phone ?? '',
      seatStatus: binding?.seatError
        ? 'FAILED'
        : binding && seatUsable(binding.seatId, mode)
          ? 'READY'
          : 'NONE',
      seatError: binding?.seatError ?? null,
    };
  }

  settings(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, (tx) =>
      this.publicSettings(tx, context.tenantId),
    );
  }

  async updateSettings(
    context: TenantContext,
    input: UpdateTelephonySettingsDto,
  ) {
    admin(context);
    if (
      new Set(input.phoneFields.map((entry) => entry.objectCode)).size !==
      input.phoneFields.length
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    for (const entry of input.phoneFields) {
      const { schema } = await this.objects.resolveRuntimeSchema(
        context,
        entry.objectCode,
      );
      if (
        entry.fieldKeys.some(
          (key) =>
            !schema.fields.some(
              (field) =>
                field.fieldKey === key &&
                ['PHONE', 'TEXT'].includes(field.type),
            ),
        )
      )
        throw new ApiException('FIELD_INVALID', 400);
    }
    return this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony-settings`);
      if (!(await readUsage(tx, context.tenantId)).planId) notEnabled();
      const current = await tx.telephonySettings.findUnique({
        where: { tenantId: context.tenantId },
      });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const data = {
        version: input.version + 1,
        phoneFields: input.phoneFields
          .filter((entry) => entry.fieldKeys.length)
          .map(({ objectCode, fieldKeys }) => ({
            objectCode,
            fieldKeys,
          })) as unknown as Prisma.InputJsonValue,
      };
      const saved = await tx.telephonySettings.upsert({
        where: { tenantId: context.tenantId },
        create: { tenantId: context.tenantId, ...data },
        update: data,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.settings_updated',
        resourceType: 'telephony_settings',
        resourceId: context.tenantId,
        requestId: randomUUID(),
        after: { version: saved.version },
      });
      return this.publicSettings(tx, context.tenantId);
    });
  }

  members(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, async (tx) => {
      const [members, bindings] = await Promise.all([
        tx.tenantMember.findMany({
          where: { tenantId: context.tenantId },
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        tx.telephonyMemberBinding.findMany({
          where: { tenantId: context.tenantId },
        }),
      ]);
      const { mode } = await this.line.read(tx);
      return {
        members: members.map((member) =>
          this.bindingView(
            {
              id: member.id,
              displayName: member.displayName ?? member.user.displayName,
              status: member.status,
            },
            bindings.find((entry) => entry.memberId === member.id) ?? null,
            mode,
          ),
        ),
      };
    });
  }

  /**
   * Turns calling on or off for a member. Turning it on makes sure the member
   * has a supplier seat: check, then call the supplier outside any
   * transaction, then save under the company lock with a fresh seat count.
   */
  async updateMember(
    context: TenantContext,
    memberId: string,
    input: UpdateTelephonyBindingDto,
  ) {
    admin(context);
    const phone = input.phone ? normalizePhone(input.phone) : '';
    if (input.enabled && !phone)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '开启外呼前请填写接听手机。',
      });
    const where = {
      tenantId_memberId: { tenantId: context.tenantId, memberId },
    };
    const before = await this.runner.withTenant(context, async (tx) => {
      const member = await tx.tenantMember.findFirst({
        where: { tenantId: context.tenantId, id: memberId },
        include: { user: { select: { displayName: true } } },
      });
      if (!member) throw new ApiException('OWNER_INVALID', 400);
      const current = await tx.telephonyMemberBinding.findUnique({ where });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const usage = await readUsage(tx, context.tenantId);
      if (input.enabled) {
        if (!usage.planId) notEnabled();
        if (!current?.enabled && usage.seatsEnabled >= usage.seats)
          seatsFull(usage.seats);
      }
      return { member, current, line: await this.line.read(tx) };
    });
    const displayName =
      before.member.displayName ?? before.member.user.displayName;
    let seat: Seat | null = null;
    if (input.enabled) {
      if (this.line.problems(before.line).length)
        unavailable('PLATFORM_NOT_READY');
      try {
        seat = await this.seats.ensure(
          before.line,
          before.current
            ? {
                seatId: before.current.seatId,
                username: before.current.providerUsername,
                phone: before.current.phone,
              }
            : null,
          { id: memberId, name: displayName },
          phone,
        );
      } catch (error) {
        if (!(error instanceof KuaimaSeatError)) throw error;
        const seatError = error.reason.slice(0, 200);
        await this.runner.withTenant(context, (tx) =>
          tx.telephonyMemberBinding.upsert({
            where,
            create: { tenantId: context.tenantId, memberId, seatError },
            update: { seatError },
          }),
        );
        throw new ApiException('VALIDATION_FAILED', 400, {
          message: `快马：${seatError}`,
          fieldErrors: { seat: ['TELEPHONY_SEAT_FAILED'] },
        });
      }
    }
    const saved = await this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony`);
      const current = await tx.telephonyMemberBinding.findUnique({ where });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const usage = await readUsage(tx, context.tenantId);
      // Someone may have taken the last seat while the supplier was working;
      // keep the seat it made, but leave calling off.
      const full =
        input.enabled &&
        !current?.enabled &&
        (!usage.planId || usage.seatsEnabled >= usage.seats);
      const data = {
        version: input.version + 1,
        enabled: input.enabled && !full,
        phone,
        seatError: null,
        ...(seat
          ? {
              seatId: seat.seatId,
              providerUsername: seat.username,
              seatCreatedAt:
                current?.seatId === seat.seatId && current.seatCreatedAt
                  ? current.seatCreatedAt
                  : new Date(),
            }
          : {}),
      };
      const binding = await tx.telephonyMemberBinding.upsert({
        where,
        create: { tenantId: context.tenantId, memberId, ...data },
        update: data,
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.member_updated',
        resourceType: 'telephony_member',
        resourceId: memberId,
        requestId: randomUUID(),
        after: {
          enabled: binding.enabled,
          version: binding.version,
          seatId: binding.seatId || null,
        },
      });
      return { binding, full, usage, line: await this.line.read(tx) };
    });
    if (saved.full) {
      if (!saved.usage.planId) notEnabled();
      seatsFull(saved.usage.seats);
    }
    return this.bindingView(
      { id: memberId, displayName, status: before.member.status },
      saved.binding,
      saved.line.mode,
    );
  }

  /** The first unmet condition, in the order the specification lists them. */
  private reason(
    usage: Usage,
    line: LineRow,
    binding: { enabled: boolean; phone: string; seatId: string } | null,
  ): TelephonyReason | null {
    if (!usage.planId) return 'NOT_ENABLED';
    if (this.line.problems(line).length) return 'PLATFORM_NOT_READY';
    if (usage.usedMinutes >= allowance(usage)) return 'MINUTES_EXHAUSTED';
    if (
      !binding?.enabled ||
      !binding.phone ||
      !seatUsable(binding.seatId, line.mode)
    )
      return 'MEMBER_NOT_CONFIGURED';
    return null;
  }

  async runtime(context: TenantContext, query: TelephonyRuntimeQueryDto) {
    if (query.recordId && !query.objectCode)
      throw new ApiException('VALIDATION_FAILED', 400);
    const { settings, binding, open, usage, line, history } =
      await this.runner.withTenant(context, async (tx) => ({
        settings: await tx.telephonySettings.findUnique({
          where: { tenantId: context.tenantId },
        }),
        binding: await tx.telephonyMemberBinding.findUnique({
          where: {
            tenantId_memberId: {
              tenantId: context.tenantId,
              memberId: context.memberId,
            },
          },
        }),
        open: await tx.telephonyCall.findFirst({
          where: {
            tenantId: context.tenantId,
            actorMemberId: context.memberId,
            status: { in: OPEN },
          },
          select: { id: true },
        }),
        usage: await readUsage(tx, context.tenantId),
        line: await this.line.read(tx),
        history: await tx.telephonyCall.findFirst({
          where: { tenantId: context.tenantId },
          select: { id: true },
        }),
      }));
    let fields: Array<{ fieldKey: string; label: string }> = [];
    if (query.objectCode && usage.planId) {
      const { visibleSchema } = await this.objects.resolveRuntimeSchema(
        context,
        query.objectCode,
      );
      const record = query.recordId
        ? await this.records.detail(context, query.objectCode, query.recordId)
        : null;
      const configured =
        fieldsOf(settings).find(
          (entry) => entry.objectCode === query.objectCode,
        )?.fieldKeys ?? [];
      fields = visibleSchema.fields
        .filter(
          (field) =>
            configured.includes(field.fieldKey) &&
            ['PHONE', 'TEXT'].includes(field.type) &&
            (record
              ? Object.hasOwn(record.values, field.fieldKey)
              : visibleSchema.queryFieldKeys
                ? visibleSchema.queryFieldKeys.includes(field.fieldKey)
                : field.access !== 'HIDDEN'),
        )
        .map(({ fieldKey, label }) => ({ fieldKey, label }));
    }
    const reason = this.reason(usage, line, binding);
    return {
      enabled: Boolean(usage.planId),
      hasHistory: Boolean(history),
      mode: line.mode,
      available: reason === null,
      reason,
      callerPhone: binding?.phone || null,
      liveEnabled: this.line.liveEnabled(),
      openCallId: open?.id ?? null,
      fields,
    };
  }

  async createCall(context: TenantContext, input: CreateTelephonyCallDto) {
    const initial = await this.objects.resolveRuntimeSchema(
      context,
      input.objectCode,
    );
    const result = await this.repository.withTenantTransaction(
      context,
      async ({ tx, store }) => {
        await this.lock(
          tx,
          `${context.tenantId}:telephony-call:${context.memberId}`,
        );
        await lockMembers(tx, context);
        const resolved = await store.resolveCurrentObject(initial);
        const record = projectRecord(
          await requireVisibleRecord(
            store,
            resolved,
            context,
            input.recordId,
            'READ',
          ),
          resolved,
        );
        const field = resolved.schema.fields.find(
          (entry) =>
            entry.fieldKey === input.fieldKey &&
            ['PHONE', 'TEXT'].includes(entry.type),
        );
        if (!field || !Object.hasOwn(record.values, input.fieldKey))
          throw new ApiException('FIELD_HIDDEN', 403);
        const existing = await tx.telephonyCall.findUnique({
          where: {
            tenantId_actorMemberId_requestId: {
              tenantId: context.tenantId,
              actorMemberId: context.memberId,
              requestId: input.requestId,
            },
          },
        });
        if (existing) {
          if (
            existing.recordId !== input.recordId ||
            existing.objectCode !== input.objectCode ||
            existing.fieldKey !== input.fieldKey
          )
            throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
              message: '幂等键已用于其他拨号请求。',
            });
          return { call: existing, fresh: false, line: null };
        }
        const [settings, binding] = await Promise.all([
          tx.telephonySettings.findUnique({
            where: { tenantId: context.tenantId },
          }),
          tx.telephonyMemberBinding.findUnique({
            where: {
              tenantId_memberId: {
                tenantId: context.tenantId,
                memberId: context.memberId,
              },
            },
          }),
        ]);
        const usage = await readUsage(tx, context.tenantId);
        const line = await this.line.read(tx);
        const reason = this.reason(usage, line, binding);
        if (!binding || !binding.phone)
          unavailable(reason ?? 'MEMBER_NOT_CONFIGURED');
        if (
          !fieldsOf(settings).some(
            (entry) =>
              entry.objectCode === input.objectCode &&
              entry.fieldKeys.includes(input.fieldKey),
          )
        )
          throw new ApiException('FIELD_HIDDEN', 403);
        // A replay above returns its durable target. Only a missing request must
        // still match the tuple explicitly reviewed by the client.
        const callerPhone = normalizePhone(binding.phone);
        const calleePhone = normalizePhone(record.values[input.fieldKey]);
        if (
          input.confirmation.mode !== line.mode ||
          normalizePhone(input.confirmation.callerPhone) !== callerPhone ||
          normalizePhone(input.confirmation.calleePhone) !== calleePhone
        )
          throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
            message: '拨打信息已变化，请重新核对后确认。',
            fieldErrors: { confirmation: ['TELEPHONY_CONFIRMATION_CHANGED'] },
          });
        if (reason) unavailable(reason);
        if (
          await tx.telephonyCall.findFirst({
            where: {
              tenantId: context.tenantId,
              actorMemberId: context.memberId,
              status: { in: OPEN },
            },
          })
        )
          throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
            message: '你还有一通没结束的电话，先结束它再拨。',
            fieldErrors: { call: ['TELEPHONY_CALL_OPEN'] },
          });
        const call = await tx.telephonyCall.create({
          data: {
            tenantId: context.tenantId,
            actorMemberId: context.memberId,
            requestId: input.requestId,
            objectId: resolved.schema.object.id,
            objectCode: input.objectCode,
            recordId: input.recordId,
            fieldKey: input.fieldKey,
            mode: line.mode,
            callerPhone,
            calleePhone,
            seatId: binding.seatId,
          },
        });
        await this.audit.append(tx, {
          tenantId: context.tenantId,
          actorType: 'USER',
          actorId: context.userId,
          action: 'telephony.call_requested',
          resourceType: 'telephony_call',
          resourceId: call.id,
          requestId: input.requestId,
          after: { mode: call.mode },
        });
        return { call, fresh: true, line };
      },
    );
    let call = result.call;
    if (result.fresh) {
      if (call.mode === 'MOCK') {
        call = await this.runner.withTenant(context, (tx) =>
          this.merge(tx, call, {
            status: 'CONNECTED',
            durationSeconds: 30,
            beganAt: new Date(),
            endedAt: new Date(),
            recordingUrl: null,
          }),
        );
      } else {
        // The request is durable before this single, non-transactional network call.
        const account = this.line.account(result.line!);
        const outcome = await this.provider.dial(
          {
            companyId: account.companyId,
            appSecret: account.appSecret,
            caller: call.callerPhone,
            callee: call.calleePhone,
          },
          fetch,
          undefined,
          account.origin,
        );
        call = await this.runner.withTenant(context, async (tx) => {
          await tx.$queryRaw`SELECT id FROM telephony_calls WHERE tenant_id = ${context.tenantId}::uuid AND id = ${call.id}::uuid FOR UPDATE`;
          const current = await tx.telephonyCall.findUniqueOrThrow({
            where: { id: call.id },
          });
          // A manual close may have ended the call meanwhile; keep that status
          // but still attach the supplier ID so a late outcome can find it.
          const status =
            current.status === 'REQUESTED' ? outcome.status : current.status;
          if (outcome.providerBindId)
            await this.lock(tx, `telephony-bind:${outcome.providerBindId}`);
          // One supplier account serves every company: a supplier ID already
          // used anywhere is ambiguous, so do not attach it.
          const [owner] = outcome.providerBindId
            ? await tx.$queryRaw<
                Array<{ tenant_id: string | null }>
              >`SELECT telephony_route_bind(${outcome.providerBindId})::text AS tenant_id`
            : [];
          const collision = Boolean(owner?.tenant_id);
          return tx.telephonyCall.update({
            where: { id: call.id },
            data: collision
              ? { status: status === 'ACCEPTED' ? 'UNKNOWN' : status }
              : { ...outcome, status },
          });
        });
      }
    }
    return this.project(context, call);
  }

  /**
   * Ends an open call by hand when no outcome will arrive (an ambiguous
   * submission or a missing callback). It never dials again; a late supplier
   * outcome still replaces ENDED.
   */
  async closeCall(context: TenantContext, callId: string) {
    const call = await this.runner.withTenant(context, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM telephony_calls WHERE tenant_id = ${context.tenantId}::uuid AND id = ${callId}::uuid FOR UPDATE`;
      if (!rows.length) throw new ApiException('RECORD_NOT_FOUND', 404);
      const current = await tx.telephonyCall.findUniqueOrThrow({
        where: { id: callId },
      });
      if (
        context.role !== 'TENANT_ADMIN' &&
        current.actorMemberId !== context.memberId
      )
        throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
      if (!OPEN.includes(current.status)) return current;
      if (Date.now() - current.createdAt.getTime() < CLOSE_AFTER_MS)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409, {
          message: '线路可能还在接通，请 1 分钟后再结束。',
          fieldErrors: { call: ['TELEPHONY_CLOSE_TOO_EARLY'] },
        });
      const saved = await tx.telephonyCall.update({
        where: { id: callId },
        data: { status: 'ENDED', endedAt: current.endedAt ?? new Date() },
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.call_closed',
        resourceType: 'telephony_call',
        resourceId: callId,
        requestId: randomUUID(),
        before: { status: current.status },
        after: { status: saved.status },
      });
      return saved;
    });
    return this.project(context, call);
  }

  async listCalls(context: TenantContext, query: TelephonyCallQueryDto) {
    if (query.recordId && !query.objectCode)
      throw new ApiException('VALIDATION_FAILED', 400);
    if (
      query.dateFrom &&
      query.dateTo &&
      new Date(query.dateFrom) > new Date(query.dateTo)
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    const historyRecord = query.recordId
      ? await this.records.detail(context, query.objectCode!, query.recordId)
      : null;
    const where: Prisma.TelephonyCallWhereInput = {
      tenantId: context.tenantId,
      ...(context.role !== 'TENANT_ADMIN' && !query.recordId
        ? { actorMemberId: context.memberId }
        : query.memberId
          ? { actorMemberId: query.memberId }
          : {}),
      ...(query.objectCode ? { objectCode: query.objectCode } : {}),
      ...(query.recordId
        ? {
            recordId: query.recordId,
            fieldKey: { in: Object.keys(historyRecord!.values) },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };
    const result = await this.runner.withTenant(context, async (tx) => ({
      calls: await tx.telephonyCall.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      total: await tx.telephonyCall.count({ where }),
    }));
    const cache = new Map<string, Promise<RecordResponse | null>>();
    const names = await this.actorNames(
      context,
      result.calls.map((call) => call.actorMemberId),
    );
    const projected = await Promise.all(
      result.calls.map((call) => this.project(context, call, cache, names)),
    );
    // Record history may contain other actors' calls only while the selected phone field remains readable.
    const items = query.recordId
      ? projected.filter((call) => call.recordId !== null)
      : projected;
    return {
      items,
      page: query.page,
      limit: query.limit,
      total: result.total,
    };
  }

  async callDetail(context: TenantContext, callId: string) {
    const call = await this.runner.withTenant(context, (tx) =>
      tx.telephonyCall.findFirst({
        where: { tenantId: context.tenantId, id: callId },
      }),
    );
    if (!call) throw new ApiException('RECORD_NOT_FOUND', 404);
    const projected = await this.project(context, call);
    if (
      context.role !== 'TENANT_ADMIN' &&
      call.actorMemberId !== context.memberId &&
      projected.recordId === null
    )
      throw new ApiException('OBJECT_ACTION_FORBIDDEN', 403);
    return projected;
  }

  private readRecord(
    context: TenantContext,
    call: TelephonyCall,
    cache?: Map<string, Promise<RecordResponse | null>>,
  ) {
    const key = `${call.objectCode}:${call.recordId}`;
    const cached = cache?.get(key);
    if (cached) return cached;
    const read = this.records
      .detail(context, call.objectCode, call.recordId)
      .catch((error: unknown) => {
        // Lost access hides the record; only real failures surface.
        if (error instanceof ApiException && error.getStatus() < 500)
          return null;
        throw error;
      });
    cache?.set(key, read);
    return read;
  }

  private async actorNames(context: TenantContext, memberIds: string[]) {
    const ids = [...new Set(memberIds)];
    if (!ids.length) return new Map<string, string>();
    const members = await this.runner.withTenant(context, (tx) =>
      tx.tenantMember.findMany({
        where: { tenantId: context.tenantId, id: { in: ids } },
        select: {
          id: true,
          displayName: true,
          user: { select: { displayName: true } },
        },
      }),
    );
    return new Map(
      members.map((member) => [
        member.id,
        member.displayName ?? member.user.displayName,
      ]),
    );
  }

  private async project(
    context: TenantContext,
    call: TelephonyCall,
    cache?: Map<string, Promise<RecordResponse | null>>,
    names?: Map<string, string>,
  ): Promise<TelephonyCallResponseDto> {
    const [record, actorNames] = await Promise.all([
      this.readRecord(context, call, cache),
      names ?? this.actorNames(context, [call.actorMemberId]),
    ]);
    const visible = Boolean(
      record && Object.hasOwn(record.values, call.fieldKey),
    );
    return {
      id: call.id,
      requestId: call.requestId,
      actorMemberId: call.actorMemberId,
      actorName: actorNames.get(call.actorMemberId) ?? '',
      mode: call.mode as 'MOCK' | 'KUAIMA',
      status: call.status,
      callerPhone: call.callerPhone,
      calleePhone: visible ? call.calleePhone : null,
      objectCode: visible ? call.objectCode : null,
      recordId: visible ? call.recordId : null,
      recordTitle: visible ? (record?.title ?? null) : null,
      fieldKey: visible ? call.fieldKey : null,
      recordingUrl: visible ? call.recordingUrl : null,
      failureReason: call.failureReason,
      durationSeconds: call.durationSeconds,
      beganAt: call.beganAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      createdAt: call.createdAt.toISOString(),
    };
  }

  /** Bearer header, or the `token` query parameter of the URL given to the supplier. */
  async authenticateHook(
    authorization?: string,
    queryToken?: unknown,
  ): Promise<void> {
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : typeof queryToken === 'string'
        ? queryToken
        : '';
    if (!supplied) throw new ApiException('AUTH_REQUIRED', 401);
    const line = await this.runner.withUser(ZERO_UUID, (tx) =>
      this.line.read(tx),
    );
    if (!line.callbackTokenEncrypted)
      throw new ApiException('AUTH_REQUIRED', 401);
    let expected: Buffer;
    try {
      expected = Buffer.from(
        this.line.vault.open('callbackToken', line.callbackTokenEncrypted),
      );
    } catch {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    const given = Buffer.from(supplied);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new ApiException('AUTH_REQUIRED', 401);
  }

  private hookContext(tenantId: string): TenantContext {
    // A verified callback acts only on the company that owns the supplier call.
    return {
      tenantId,
      tenantCode: '',
      userId: ZERO_UUID,
      memberId: ZERO_UUID,
      role: 'EMPLOYEE',
    };
  }

  /** Which company a supplier call ID belongs to; unknown IDs are 404 so the supplier retries. */
  private async routeBind(bindId: string) {
    const [row] = await this.runner.withUser(
      ZERO_UUID,
      (tx) =>
        tx.$queryRaw<
          Array<{ tenant_id: string | null }>
        >`SELECT telephony_route_bind(${bindId})::text AS tenant_id`,
    );
    if (!row?.tenant_id) throw new ApiException('RECORD_NOT_FOUND', 404);
    return row.tenant_id;
  }

  async hook(input: TelephonyHookDto) {
    // 挂断状态 has no push_type; an End status is only ever an end event.
    if (input.push_type === undefined || input.status === 'End')
      return this.hangup(input);
    const recordingUrl = input.audio_url
      ? safeRecordingUrl(input.audio_url)
      : null;
    if (
      !input.seats_id ||
      !input.telA ||
      !input.telB ||
      (input.push_type === 1 && !['1', '0'].includes(input.status ?? '')) ||
      (input.push_type === 2 && !recordingUrl)
    )
      throw new ApiException('VALIDATION_FAILED', 400);
    const caller = normalizePhone(input.telA);
    const callee = normalizePhone(input.telB);
    const beganAt = parseSupplierTime(input.begin_time);
    const endedAt = parseSupplierTime(input.end_time);
    if (beganAt && endedAt && endedAt < beganAt)
      throw new ApiException('VALIDATION_FAILED', 400);
    const tenantId = await this.routeBind(input.bind_id);
    return this.runner.withTenant(this.hookContext(tenantId), async (tx) => {
      const call = await this.lockByBindId(tx, tenantId, input.bind_id);
      if (
        call.callerPhone !== caller ||
        call.calleePhone !== callee ||
        call.seatId !== input.seats_id
      )
        throw new ApiException('WORKSPACE_FORBIDDEN', 403);
      await this.merge(tx, call, {
        status:
          input.push_type === 2
            ? call.status
            : input.status === '1'
              ? 'CONNECTED'
              : 'NOT_CONNECTED',
        recordingUrl,
        durationSeconds: input.duration ?? null,
        beganAt,
        endedAt,
      });
      return { code: 0 };
    });
  }

  /** 挂断状态回调: an end event only; it never says whether anyone answered. */
  private async hangup(input: TelephonyHookDto) {
    if (input.status !== 'End')
      throw new ApiException('VALIDATION_FAILED', 400);
    const endedAt = parseSupplierTime(input.time ?? input.end_time);
    const tenantId = await this.routeBind(input.bind_id);
    return this.runner.withTenant(this.hookContext(tenantId), async (tx) => {
      const call = await this.lockByBindId(tx, tenantId, input.bind_id);
      if (OPEN.includes(call.status))
        await tx.telephonyCall.update({
          where: { id: call.id },
          data: { status: 'ENDED', endedAt: call.endedAt ?? endedAt },
        });
      return { code: 0 };
    });
  }

  private async lockByBindId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    bindId: string,
  ) {
    const calls = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM telephony_calls WHERE tenant_id = ${tenantId}::uuid AND provider_bind_id = ${bindId} FOR UPDATE`;
    if (!calls.length) throw new ApiException('RECORD_NOT_FOUND', 404);
    const call = await tx.telephonyCall.findUniqueOrThrow({
      where: { id: calls[0].id },
    });
    if (call.mode !== 'KUAIMA')
      throw new ApiException('WORKSPACE_FORBIDDEN', 403);
    return call;
  }

  private async merge(
    tx: Prisma.TransactionClient,
    call: TelephonyCall,
    result: {
      status: string;
      recordingUrl: string | null;
      durationSeconds: number | null;
      beganAt: Date | null;
      endedAt: Date | null;
    },
  ): Promise<TelephonyCall> {
    const final = OUTCOMES.includes(call.status);
    const status = final ? call.status : result.status;
    const createsOutcome = OUTCOMES.includes(status) && !final;
    const activityId =
      call.mode === 'KUAIMA' && createsOutcome && !call.activityId
        ? randomUUID()
        : call.activityId;
    const durationSeconds = !final
      ? (result.durationSeconds ?? call.durationSeconds)
      : call.durationSeconds;
    const saved = await tx.telephonyCall.update({
      where: { id: call.id },
      data: {
        status,
        activityId,
        ...(result.recordingUrl ? { recordingUrl: result.recordingUrl } : {}),
        ...(!final
          ? {
              durationSeconds,
              beganAt: result.beganAt ?? call.beganAt,
              endedAt: result.endedAt ?? call.endedAt,
            }
          : {}),
      },
    });
    if (activityId && !call.activityId) {
      // FK is deferred; the activity trigger recognizes this linked integration outcome and does not renew the pool.
      await tx.recordActivity.create({
        data: {
          id: activityId,
          tenantId: call.tenantId,
          recordId: call.recordId,
          actorMemberId: call.actorMemberId,
          activityType: 'CALL',
          content:
            status === 'CONNECTED'
              ? `电话外呼：已接通${duration(durationSeconds)}`
              : '电话外呼：未接通',
          resultKey: status === 'CONNECTED' ? 'CONNECTED' : 'NOT_REACHED',
          metadata: { telephonyCallId: call.id },
        },
      });
    }
    return saved;
  }
}

function parseSupplierTime(value?: string): Date | null {
  if (!value) return null;
  // Supplier's timezone-free examples are China local time; do not use the server timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(' ', 'T') + '+08:00'
    : value;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      normalized,
    )
  )
    throw new ApiException('VALIDATION_FAILED', 400);
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()))
    throw new ApiException('VALIDATION_FAILED', 400);
  return date;
}
