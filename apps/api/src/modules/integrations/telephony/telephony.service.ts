import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@crm/database';
type TelephonyCall = Prisma.TelephonyCallGetPayload<Record<string, never>>;
type TelephonySettings = Prisma.TelephonySettingsGetPayload<
  Record<string, never>
>;
import { ApiException } from '../../../common/errors/api.exception';
import type { TenantContext } from '../../../common/tenancy/tenant-context';
import { DatabaseContextRunner } from '../../../infrastructure/database/context-runner';
import { AuditService } from '../../audit/audit.service';
import { PublishedObjectService } from '../../objects/published-object.service';
import {
  RecordsService,
  RECORDS_REPOSITORY,
} from '../../records/records.service';
import type { RecordsRepository } from '../../records/records.repository';
import {
  requireVisibleRecord,
  projectRecord,
} from '../../records/record-command';
import { lockMembers } from '../../records/record-ownership-locks';
import {
  decryptSecret,
  encryptSecret,
  KuaimaProvider,
  normalizePhone,
  safeRecordingUrl,
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

const OPEN = ['REQUESTED', 'ACCEPTED', 'UNKNOWN'];
const OUTCOMES = ['CONNECTED', 'NOT_CONNECTED'];
function admin(context: TenantContext) {
  if (context.role !== 'TENANT_ADMIN')
    throw new ApiException('WORKSPACE_FORBIDDEN', 403);
}
function fieldsOf(
  settings: TelephonySettings | null,
): TelephonyPhoneFieldsDto[] {
  return (settings?.phoneFields ?? []) as unknown as TelephonyPhoneFieldsDto[];
}
function publicSettings(
  settings: TelephonySettings | null,
): TelephonySettingsResponseDto {
  return {
    version: settings?.version ?? 0,
    enabled: settings?.enabled ?? false,
    mode: (settings?.mode ?? 'MOCK') as 'MOCK' | 'KUAIMA',
    companyId: settings?.companyId ?? '',
    hasAppSecret: Boolean(settings?.appSecretEncrypted),
    hasCallbackToken: Boolean(settings?.callbackTokenEncrypted),
    phoneFields: fieldsOf(settings),
  };
}
function unavailable(reason: string): never {
  throw new ApiException('VALIDATION_FAILED', 503, {
    message: `电话外呼不可用：${reason}`,
  });
}
@Injectable()
export class TelephonyService {
  constructor(
    private readonly runner: DatabaseContextRunner,
    private readonly objects: PublishedObjectService,
    private readonly records: RecordsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly provider: KuaimaProvider,
    @Inject(RECORDS_REPOSITORY) private readonly repository: RecordsRepository,
  ) {}

  private key() {
    return this.config.get<string>('TELEPHONY_ENCRYPTION_KEY', '');
  }
  private async lock(tx: Prisma.TransactionClient, key: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  settings(context: TenantContext) {
    admin(context);
    return this.runner.withTenant(context, async (tx) =>
      publicSettings(
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
    if (input.mode === 'MOCK' && this.config.get('NODE_ENV') === 'production')
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '生产环境禁止模拟拨号。',
      });
    if (input.callbackToken && input.callbackToken.length < 16)
      throw new ApiException('VALIDATION_FAILED', 400, {
        message: '回调验证凭据至少需要 16 个字符。',
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
      const data = {
        version: input.version + 1,
        enabled: input.enabled ?? current?.enabled ?? false,
        mode: input.mode ?? current?.mode ?? 'MOCK',
        companyId: input.companyId ?? current?.companyId ?? '',
        phoneFields: (input.phoneFields ??
          fieldsOf(current)) as unknown as Prisma.InputJsonValue,
        appSecretEncrypted: input.appSecret
          ? encryptSecret(input.appSecret, this.key())
          : (current?.appSecretEncrypted ?? null),
        callbackTokenEncrypted: input.callbackToken
          ? encryptSecret(input.callbackToken, this.key())
          : (current?.callbackTokenEncrypted ?? null),
      };
      if (data.mode === 'MOCK' && this.config.get('NODE_ENV') === 'production')
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
        },
      });
      return publicSettings(saved);
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
      throw new ApiException('VALIDATION_FAILED', 400);
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
    settings: TelephonySettings | null,
    binding: { enabled: boolean; phone: string; seatId: string } | null,
  ) {
    if (!settings?.enabled) return 'DISABLED';
    if (!binding?.enabled || !binding.phone || !binding.seatId)
      return 'MEMBER_NOT_CONFIGURED';
    if (settings.mode === 'MOCK')
      return this.config.get('NODE_ENV') === 'production'
        ? 'MOCK_FORBIDDEN'
        : null;
    if (this.config.get<string>('TELEPHONY_LIVE_ENABLED', 'false') !== 'true')
      return 'LIVE_DISABLED';
    if (
      !settings.companyId ||
      !settings.appSecretEncrypted ||
      !settings.callbackTokenEncrypted
    )
      return 'PROVIDER_NOT_CONFIGURED';
    try {
      decryptSecret(settings.appSecretEncrypted, this.key());
      decryptSecret(settings.callbackTokenEncrypted, this.key());
    } catch {
      return 'ENCRYPTION_UNAVAILABLE';
    }
    return null;
  }
  async runtime(context: TenantContext, query: TelephonyRuntimeQueryDto) {
    if (query.recordId && !query.objectCode)
      throw new ApiException('VALIDATION_FAILED', 400);
    const { settings, binding } = await this.runner.withTenant(
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
      }),
    );
    let fields: Array<{ fieldKey: string; label: string }> = [];
    if (query.objectCode) {
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
    const reason = this.reason(settings, binding);
    return {
      enabled: settings?.enabled ?? false,
      mode: (settings?.mode ?? 'MOCK') as 'MOCK' | 'KUAIMA',
      available: reason === null,
      reason,
      callerPhone: binding?.phone || null,
      liveEnabled:
        this.config.get<string>('TELEPHONY_LIVE_ENABLED', 'false') === 'true',
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
        const reason = this.reason(settings, binding);
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
            message: '已有未结束或待核实通话，请勿重复拨号。',
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
        const outcome = await this.provider.dial({
          companyId: settings.companyId,
          appSecret: decryptSecret(settings.appSecretEncrypted!, this.key()),
          caller: call.callerPhone,
          callee: call.calleePhone,
        });
        call = await this.runner.withTenant(context, async (tx) => {
          await tx.$queryRaw`SELECT id FROM telephony_calls WHERE tenant_id = ${context.tenantId}::uuid AND id = ${call.id}::uuid FOR UPDATE`;
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
            data: collision ? { status: 'UNKNOWN' } : outcome,
          });
        });
      }
    }
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
    const projected = await Promise.all(
      result.calls.map((call) => this.project(context, call)),
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
  private async project(
    context: TenantContext,
    call: TelephonyCall,
  ): Promise<TelephonyCallResponseDto> {
    let recordTitle: string | null = null;
    let visible = false;
    try {
      const record = await this.records.detail(
        context,
        call.objectCode,
        call.recordId,
      );
      visible = Object.hasOwn(record.values, call.fieldKey);
      if (visible) recordTitle = record.title;
    } catch (error) {
      if (!(error instanceof ApiException) || error.getStatus() >= 500)
        throw error;
    }
    return {
      id: call.id,
      requestId: call.requestId,
      actorMemberId: call.actorMemberId,
      mode: call.mode as 'MOCK' | 'KUAIMA',
      status: call.status,
      callerPhone: call.callerPhone,
      calleePhone: visible ? call.calleePhone : null,
      objectCode: visible ? call.objectCode : null,
      recordId: visible ? call.recordId : null,
      recordTitle,
      fieldKey: visible ? call.fieldKey : null,
      recordingUrl: visible ? call.recordingUrl : null,
      durationSeconds: call.durationSeconds,
      beganAt: call.beganAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      createdAt: call.createdAt.toISOString(),
    };
  }
  async authenticateHook(
    tenantId: string,
    authorization?: string,
  ): Promise<void> {
    if (
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
        tenantId,
      ) ||
      !authorization?.startsWith('Bearer ')
    )
      throw new ApiException('AUTH_REQUIRED', 401);
    const context = this.hookContext(tenantId);
    const settings = await this.runner.withTenant(context, (tx) =>
      tx.telephonySettings.findUnique({ where: { tenantId } }),
    );
    if (!settings?.callbackTokenEncrypted)
      throw new ApiException('AUTH_REQUIRED', 401);
    let expected: Buffer;
    try {
      expected = Buffer.from(
        decryptSecret(settings.callbackTokenEncrypted, this.key()),
      );
    } catch {
      throw new ApiException('AUTH_REQUIRED', 401);
    }
    const supplied = Buffer.from(authorization.slice(7));
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new ApiException('AUTH_REQUIRED', 401);
  }
  private hookContext(tenantId: string): TenantContext {
    // Callback authentication grants only the route's tenant-scoped integration operations.
    return {
      tenantId,
      tenantCode: '',
      userId: '00000000-0000-0000-0000-000000000000',
      memberId: '00000000-0000-0000-0000-000000000000',
      role: 'EMPLOYEE',
    };
  }
  async hook(tenantId: string, input: TelephonyHookDto) {
    const recordingUrl = input.audio_url
      ? safeRecordingUrl(input.audio_url)
      : null;
    if (
      (input.push_type === 1 && !input.status) ||
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
      const calls = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM telephony_calls WHERE tenant_id = ${tenantId}::uuid AND provider_bind_id = ${input.bind_id} FOR UPDATE`;
      if (!calls.length) throw new ApiException('RECORD_NOT_FOUND', 404);
      const call = await tx.telephonyCall.findUniqueOrThrow({
        where: { id: calls[0].id },
      });
      if (
        call.mode !== 'KUAIMA' ||
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
              : input.status === '0'
                ? 'NOT_CONNECTED'
                : 'ENDED',
        recordingUrl,
        durationSeconds: input.duration ?? null,
        beganAt,
        endedAt,
      });
      return { code: 0 };
    });
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
    const saved = await tx.telephonyCall.update({
      where: { id: call.id },
      data: {
        status,
        activityId,
        ...(result.recordingUrl ? { recordingUrl: result.recordingUrl } : {}),
        ...(!final
          ? {
              durationSeconds: result.durationSeconds ?? call.durationSeconds,
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
          content: '电话外呼结果',
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
