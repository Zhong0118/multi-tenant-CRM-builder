import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  KUAIMA_ORIGIN,
  KuaimaProvider,
  normalizePhone,
  safeRecordingUrl,
  TelephonyVault,
} from './telephony-provider';
import type {
  CreateTelephonyCallDto,
  TelephonyCallQueryDto,
  TelephonyCallResponseDto,
  TelephonyHookDto,
  TelephonyPhoneFieldsDto,
  TelephonyRuntimeQueryDto,
  TelephonySettingsResponseDto,
  UpdateTelephonyBindingDto,
  UpdateTelephonySettingsDto,
} from './telephony.dto';

type TelephonyCall = Prisma.TelephonyCallGetPayload<Record<string, never>>;
type TelephonySettings = Prisma.TelephonySettingsGetPayload<
  Record<string, never>
>;

const OPEN = ['REQUESTED', 'ACCEPTED', 'UNKNOWN'];
const OUTCOMES = ['CONNECTED', 'NOT_CONNECTED'];
/** An open call may be closed by hand only after the supplier had time to answer. */
const CLOSE_AFTER_MS = 60_000;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
function fieldsOf(
  settings: TelephonySettings | null,
): TelephonyPhoneFieldsDto[] {
  return (settings?.phoneFields ?? []) as unknown as TelephonyPhoneFieldsDto[];
}
function unavailable(reason: string): never {
  throw new ApiException('VALIDATION_FAILED', 503, {
    message: `电话外呼不可用：${reason}`,
  });
}
function duration(seconds: number | null) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  return `，通话 ${minutes ? `${minutes} 分 ` : ''}${seconds % 60} 秒`;
}

@Injectable()
export class TelephonyService {
  private readonly vault: TelephonyVault;
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly objects: PublishedObjectService,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly provider: KuaimaProvider,
    @Inject(RECORDS_REPOSITORY) private readonly repository: RecordsRepository,
  ) {
    this.vault = new TelephonyVault(() =>
      this.config.get<string>('AI_MODEL_KEYRING'),
    );
  }

  private production() {
    return this.config.get('NODE_ENV') === 'production';
  }
  private liveEnabled() {
    return (
      this.config.get<string>('TELEPHONY_LIVE_ENABLED', 'false') === 'true'
    );
  }
  /**
   * The supplier origin is fixed. Outside production a loopback fake supplier
   * may stand in for it, so the whole live path can be rehearsed locally.
   */
  private kuaimaOrigin() {
    const override = this.config.get<string>('TELEPHONY_KUAIMA_ORIGIN', '');
    if (!override || this.production()) return KUAIMA_ORIGIN;
    const url = new URL(override);
    if (!['localhost', '127.0.0.1'].includes(url.hostname))
      return KUAIMA_ORIGIN;
    return url.origin;
  }
  private callbackEndpoint(tenantId: string) {
    const origin = this.config
      .get<string>('API_ORIGIN', 'http://localhost:3001')
      .replace(/\/+$/, '');
    return `${origin}/api/v1/telephony/hooks/${tenantId}`;
  }
  private publicSettings(
    tenantId: string,
    settings: TelephonySettings | null,
  ): TelephonySettingsResponseDto {
    return {
      version: settings?.version ?? 0,
      enabled: settings?.enabled ?? false,
      mode: (settings?.mode ?? 'MOCK') as 'MOCK' | 'KUAIMA',
      companyId: settings?.companyId ?? '',
      hasAppSecret: Boolean(settings?.appSecretEncrypted),
      hasCallbackToken: Boolean(settings?.callbackTokenEncrypted),
      callbackEndpoint: this.callbackEndpoint(tenantId),
      liveEnabled: this.liveEnabled(),
      mockAllowed: !this.production(),
      phoneFields: fieldsOf(settings),
    };
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  settings(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, async (tx) =>
      this.publicSettings(
        context.tenantId,
        await tx.telephonySettings.findUnique({
          where: { tenantId: context.tenantId },
        }),
      ),
    );
  }

  async updateSettings(
    context: TenantContext,
    input: UpdateTelephonySettingsDto,
  ) {
    admin(context);
    if (input.mode === 'MOCK' && this.production())
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '生产环境禁止模拟拨号。',
      });
    if (input.phoneFields) {
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
    }
    return this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony-settings`);
      const current = await tx.telephonySettings.findUnique({
        where: { tenantId: context.tenantId },
      });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const appSecret = input.appSecret?.trim();
      const data = {
        version: input.version + 1,
        enabled: input.enabled ?? current?.enabled ?? false,
        mode: input.mode ?? current?.mode ?? 'MOCK',
        companyId: input.companyId?.trim() ?? current?.companyId ?? '',
        phoneFields: (input.phoneFields
          ?.filter((entry) => entry.fieldKeys.length)
          .map(({ objectCode, fieldKeys }) => ({ objectCode, fieldKeys })) ??
          fieldsOf(current)) as unknown as Prisma.InputJsonValue,
        // A blank secret keeps the saved one; it is never read back.
        appSecretEncrypted: appSecret
          ? this.vault.seal(context.tenantId, 'appSecret', appSecret)
          : (current?.appSecretEncrypted ?? null),
      };
      if (data.mode === 'MOCK' && this.production())
        throw new ApiException('VALIDATION_FAILED', 400);
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
        after: {
          version: saved.version,
          enabled: saved.enabled,
          mode: saved.mode,
          appSecretChanged: Boolean(appSecret),
        },
      });
      return this.publicSettings(context.tenantId, saved);
    });
  }

  /**
   * Issues a new callback credential. The full URL is returned this once for
   * the administrator to hand to the supplier; afterwards only "set" shows.
   */
  async rotateCallbackToken(context: TenantContext) {
    admin(context);
    const token = randomBytes(24).toString('base64url');
    return this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony-settings`);
      const callbackTokenEncrypted = this.vault.seal(
        context.tenantId,
        'callbackToken',
        token,
      );
      // The settings form never writes this column, so issuing a credential
      // does not bump the form's version or conflict with an open edit.
      const saved = await tx.telephonySettings.upsert({
        where: { tenantId: context.tenantId },
        create: { tenantId: context.tenantId, callbackTokenEncrypted },
        update: { callbackTokenEncrypted },
      });
      await this.audit.append(tx, {
        tenantId: context.tenantId,
        actorType: 'USER',
        actorId: context.userId,
        action: 'telephony.callback_token_rotated',
        resourceType: 'telephony_settings',
        resourceId: context.tenantId,
        requestId: randomUUID(),
        after: { version: saved.version },
      });
      return {
        settings: this.publicSettings(context.tenantId, saved),
        callbackUrl: `${this.callbackEndpoint(context.tenantId)}?token=${token}`,
      };
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
      return {
        members: members.map((member) => {
          const binding = bindings.find(
            (entry) => entry.memberId === member.id,
          );
          return {
            memberId: member.id,
            displayName: member.displayName ?? member.user.displayName,
            status: member.status,
            version: binding?.version ?? 0,
            enabled: binding?.enabled ?? false,
            seatId: binding?.seatId ?? '',
            phone: binding?.phone ?? '',
          };
        }),
      };
    });
  }

  updateMember(
    context: TenantContext,
    memberId: string,
    input: UpdateTelephonyBindingDto,
  ) {
    admin(context);
    const phone = input.phone ? normalizePhone(input.phone) : '';
    if (input.enabled && (!phone || !input.seatId.trim()))
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '开启外呼前请填写坐席号和接听手机。',
      });
    return this.runner.withTenant(context, async (tx) => {
      await this.lock(tx, `${context.tenantId}:telephony-member:${memberId}`);
      const member = await tx.tenantMember.findFirst({
        where: { tenantId: context.tenantId, id: memberId },
        include: { user: { select: { displayName: true } } },
      });
      if (!member) throw new ApiException('OWNER_INVALID', 400);
      const where = {
        tenantId_memberId: { tenantId: context.tenantId, memberId },
      };
      const current = await tx.telephonyMemberBinding.findUnique({ where });
      if ((current?.version ?? 0) !== input.version)
        throw new ApiException('CONFIG_VERSION_CONFLICT', 409);
      const data = {
        version: input.version + 1,
        enabled: input.enabled,
        seatId: input.seatId.trim(),
        phone,
      };
      const result = await tx.telephonyMemberBinding.upsert({
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
        after: { enabled: result.enabled, version: result.version },
      });
      return {
        memberId,
        displayName: member.displayName ?? member.user.displayName,
        status: member.status,
        ...data,
      };
    });
  }

  private reason(
    tenantId: string,
    settings: TelephonySettings | null,
    binding: { enabled: boolean; phone: string; seatId: string } | null,
  ) {
    if (!settings?.enabled) return 'DISABLED';
    if (!binding?.enabled || !binding.phone || !binding.seatId)
      return 'MEMBER_NOT_CONFIGURED';
    if (settings.mode === 'MOCK')
      return this.production() ? 'MOCK_FORBIDDEN' : null;
    if (!this.liveEnabled()) return 'LIVE_DISABLED';
    if (
      !settings.companyId ||
      !settings.appSecretEncrypted ||
      !settings.callbackTokenEncrypted
    )
      return 'PROVIDER_NOT_CONFIGURED';
    try {
      this.vault.open(tenantId, 'appSecret', settings.appSecretEncrypted);
      this.vault.open(
        tenantId,
        'callbackToken',
        settings.callbackTokenEncrypted,
      );
    } catch {
      return 'ENCRYPTION_UNAVAILABLE';
    }
    return null;
  }

  async runtime(context: TenantContext, query: TelephonyRuntimeQueryDto) {
    if (query.recordId && !query.objectCode)
      throw new ApiException('VALIDATION_FAILED', 400);
    const { settings, binding, open } = await this.runner.withTenant(
      context,
      async (tx) => ({
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
      }),
    );
    let fields: Array<{ fieldKey: string; label: string }> = [];
    if (query.objectCode && settings?.enabled) {
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
    const reason = this.reason(context.tenantId, settings, binding);
    return {
      enabled: settings?.enabled ?? false,
      mode: (settings?.mode ?? 'MOCK') as 'MOCK' | 'KUAIMA',
      available: reason === null,
      reason,
      callerPhone: binding?.phone || null,
      liveEnabled: this.liveEnabled(),
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
          return { call: existing, fresh: false, settings: null };
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
        const reason = this.reason(context.tenantId, settings, binding);
        if (!settings || !binding || !binding.phone)
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
          input.confirmation.mode !== settings.mode ||
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
            mode: settings.mode,
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
        return { call, fresh: true, settings };
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
        const settings = result.settings!;
        const outcome = await this.provider.dial(
          {
            companyId: settings.companyId,
            appSecret: this.vault.open(
              context.tenantId,
              'appSecret',
              settings.appSecretEncrypted!,
            ),
            caller: call.callerPhone,
            callee: call.calleePhone,
          },
          fetch,
          undefined,
          this.kuaimaOrigin(),
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
            await this.lock(
              tx,
              `${context.tenantId}:telephony-bind:${outcome.providerBindId}`,
            );
          // Binding conflicts are ambiguous: do not attach the other call's supplier ID.
          const collision = outcome.providerBindId
            ? await tx.telephonyCall.findFirst({
                where: {
                  tenantId: context.tenantId,
                  providerBindId: outcome.providerBindId,
                  id: { not: call.id },
                },
              })
            : null;
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
    tenantId: string,
    authorization?: string,
    queryToken?: unknown,
  ): Promise<void> {
    const supplied = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : typeof queryToken === 'string'
        ? queryToken
        : '';
    if (
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
        tenantId,
      ) ||
      !supplied
    )
      throw new ApiException('AUTH_REQUIRED', 401);
    const settings = await this.runner.withTenant(
      this.hookContext(tenantId),
      (tx) => tx.telephonySettings.findUnique({ where: { tenantId } }),
    );
    if (!settings?.callbackTokenEncrypted)
      throw new ApiException('AUTH_REQUIRED', 401);
    let expected: Buffer;
    try {
      expected = Buffer.from(
        this.vault.open(
          tenantId,
          'callbackToken',
          settings.callbackTokenEncrypted,
        ),
      );
    } catch {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    const given = Buffer.from(supplied);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new ApiException('AUTH_REQUIRED', 401);
  }

  private hookContext(tenantId: string): TenantContext {
    // Callback authentication grants only the route's tenant-scoped integration operations.
    return {
      tenantId,
      tenantCode: '',
      userId: ZERO_UUID,
      memberId: ZERO_UUID,
      role: 'EMPLOYEE',
    };
  }

  async hook(tenantId: string, input: TelephonyHookDto) {
    // 挂断状态 has no push_type; an End status is only ever an end event.
    if (input.push_type === undefined || input.status === 'End')
      return this.hangup(tenantId, input);
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
  private hangup(tenantId: string, input: TelephonyHookDto) {
    if (input.status !== 'End')
      throw new ApiException('VALIDATION_FAILED', 400);
    const endedAt = parseSupplierTime(input.time ?? input.end_time);
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
